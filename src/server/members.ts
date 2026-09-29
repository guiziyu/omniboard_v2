import type { Client, Pool } from './db';
import { tx } from './db';
import { audit, type Actor } from './audit';
import { createInvite, problem, type AuthContext, type Role } from './auth';
// 团队成员页的操作(frontend-spec 12.5)。都在同一事务里写审计;涉及 admin 的变更先锁表,
// 保证「至少一个 active admin」在并发下也成立。
export type MemberView = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'invited' | 'active' | 'disabled';
  lastLoginAt: Date | null;
  createdAt: Date;
  activeTokens: number;
};
export async function listMembers(pool: Pool, now: Date): Promise<MemberView[]> {
  const result = await pool.query<MemberView>(
    `SELECT m.id, m.name, m.email, m.role, m.status, m.last_login_at AS "lastLoginAt",
            m.created_at AS "createdAt",
            (SELECT count(*)::int FROM omniboard.agent_token t
              WHERE t.member_id = m.id AND t.revoked_at IS NULL AND t.expires_at > $1) AS "activeTokens"
       FROM omniboard.member m ORDER BY m.created_at, m.id`,
    [now],
  );
  return result.rows;
}
type Target = {
  id: string;
  role: Role;
  status: MemberView['status'];
  password_hash: string | null;
  totp_secret_enc: Buffer | null;
};
async function lockTarget(client: Client, memberId: string): Promise<Target> {
  await client.query('LOCK TABLE omniboard.member IN SHARE ROW EXCLUSIVE MODE');
  const result = await client.query<Target>(
    'SELECT id, role, status, password_hash, totp_secret_enc FROM omniboard.member WHERE id = $1',
    [memberId],
  );
  return result.rows[0] ?? problem(404, 'Member not found.');
}
async function requireActiveAdmin(client: Client): Promise<void> {
  const result = await client.query(
    "SELECT 1 FROM omniboard.member WHERE role = 'admin' AND status = 'active' LIMIT 1",
  );
  if (!result.rowCount) problem(409, 'At least one active administrator is required.');
}
const notSelf = (actor: Actor, targetId: string, message: string) => {
  if (actor.id === targetId) problem(409, message);
};
const privileged = (role: Role) => role === 'trader' || role === 'admin';
const endAccess = async (client: Client, memberId: string, at: Date) => {
  await client.query('DELETE FROM omniboard.session WHERE member_id = $1', [memberId]);
  await client.query(
    'UPDATE omniboard.member_invite SET used_at = $2 WHERE member_id = $1 AND used_at IS NULL',
    [memberId, at],
  );
};

export async function changeRole(
  ctx: AuthContext,
  actor: Actor,
  memberId: string,
  role: Role,
): Promise<void> {
  notSelf(actor, memberId, 'You cannot change your own role.');
  await tx(ctx.pool, async (client) => {
    const target = await lockTarget(client, memberId);
    if (target.role === role) return;
    await client.query('UPDATE omniboard.member SET role = $2 WHERE id = $1', [memberId, role]);
    await requireActiveAdmin(client);
    await audit(client, {
      actor,
      action: 'member.role',
      targetTable: 'omniboard.member',
      targetKey: memberId,
      before: { role: target.role },
      after: { role },
      stepUp: false,
      notify: privileged(target.role) || privileged(role),
    });
  });
}
/** 停用:立即结束会话、吊销全部令牌、作废未用的邀请。 */
export async function disableMember(ctx: AuthContext, actor: Actor, memberId: string) {
  notSelf(actor, memberId, 'You cannot disable yourself.');
  const at = new Date(ctx.now());
  await tx(ctx.pool, async (client) => {
    const target = await lockTarget(client, memberId);
    if (target.status === 'disabled') return;
    await client.query("UPDATE omniboard.member SET status = 'disabled' WHERE id = $1", [memberId]);
    await endAccess(client, memberId, at);
    const revoked = await client.query(
      'UPDATE omniboard.agent_token SET revoked_at = $2 WHERE member_id = $1 AND revoked_at IS NULL',
      [memberId, at],
    );
    await requireActiveAdmin(client);
    await audit(client, {
      actor,
      action: 'member.disable',
      targetTable: 'omniboard.member',
      targetKey: memberId,
      before: { status: target.status },
      after: { status: 'disabled', revokedTokens: revoked.rowCount },
      stepUp: false,
      notify: true,
    });
  });
}
/** 恢复:已绑定过验证器的回到 active,否则回到 invited(需重新发邀请)。 */
export async function enableMember(ctx: AuthContext, actor: Actor, memberId: string) {
  await tx(ctx.pool, async (client) => {
    const target = await lockTarget(client, memberId);
    if (target.status !== 'disabled') return;
    const status = target.password_hash && target.totp_secret_enc ? 'active' : 'invited';
    await client.query(
      'UPDATE omniboard.member SET status = $2, failed_logins = 0, locked_until = NULL WHERE id = $1',
      [memberId, status],
    );
    await audit(client, {
      actor,
      action: 'member.enable',
      targetTable: 'omniboard.member',
      targetKey: memberId,
      before: { status: 'disabled' },
      after: { status },
      stepUp: false,
    });
  });
}
/** 重置验证器:回到 invited、清掉 TOTP、结束会话,返回 purpose=reset 的邀请令牌;密码保留。 */
export async function resetAuthenticator(
  ctx: AuthContext,
  actor: Actor,
  memberId: string,
): Promise<string> {
  const at = new Date(ctx.now());
  return tx(ctx.pool, async (client) => {
    const target = await lockTarget(client, memberId);
    if (target.status === 'disabled') problem(409, 'Enable this member first.');
    if (!target.password_hash)
      problem(409, 'This member has not activated yet. Resend the invite.');
    await client.query(
      `UPDATE omniboard.member SET status = 'invited', totp_secret_enc = NULL, totp_last_step = NULL,
              failed_logins = 0, locked_until = NULL WHERE id = $1`,
      [memberId],
    );
    await endAccess(client, memberId, at);
    await requireActiveAdmin(client);
    const token = await createInvite(client, ctx, memberId, 'reset', actor.id);
    await audit(client, {
      actor,
      action: 'member.reset_totp',
      targetTable: 'omniboard.member',
      targetKey: memberId,
      before: { status: target.status },
      after: { status: 'invited' },
      stepUp: false,
      notify: true,
    });
    return token;
  });
}
/** 重发邀请:只对 invited;旧链接作废。没设过密码的走激活,设过的(重置中)走 reset。 */
export async function resendInvite(ctx: AuthContext, actor: Actor, memberId: string) {
  return tx(ctx.pool, async (client) => {
    const target = await lockTarget(client, memberId);
    if (target.status !== 'invited') problem(409, 'Only invited members can receive a new invite.');
    const purpose = target.password_hash ? 'reset' : 'activate';
    const token = await createInvite(client, ctx, memberId, purpose, actor.id);
    await audit(client, {
      actor,
      action: 'member.invite',
      targetTable: 'omniboard.member',
      targetKey: memberId,
      after: { resend: true, purpose },
      stepUp: false,
    });
    return token;
  });
}
export async function signOutMember(ctx: AuthContext, actor: Actor, memberId: string) {
  await tx(ctx.pool, async (client) => {
    await lockTarget(client, memberId);
    const ended = await client.query('DELETE FROM omniboard.session WHERE member_id = $1', [
      memberId,
    ]);
    await audit(client, {
      actor,
      action: 'session.revoke',
      targetTable: 'omniboard.member',
      targetKey: memberId,
      after: { sessionsEnded: ended.rowCount },
      stepUp: false,
    });
  });
}
