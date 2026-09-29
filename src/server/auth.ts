import type { Client, Pool } from './db';
import { id, tx } from './db';
import { audit, type Actor } from './audit';
import {
  hashPassword,
  normalizeRecoveryCode,
  open,
  randomToken,
  recoveryCode,
  seal,
  sha256,
  verifyPassword,
} from './crypto';
import { base32, matchStep, newSecret, otpauthUri } from './totp';
// 登录、会话、邀请激活与当场确认(frontend-spec 12.2–12.5,data-model §4.1)。
export const roles = ['reader', 'editor', 'trader', 'admin'] as const;
export type Role = (typeof roles)[number];
export const atLeast = (role: Role, min: Role) => roles.indexOf(role) >= roles.indexOf(min);
export type User = { id: string; name: string; email: string; role: Role; locale: string };
export type AuthContext = { pool: Pool; totpKey: Buffer; now: () => number };
export class Problem extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export function problem(statusCode: number, message: string): never {
  throw new Problem(statusCode, message);
}
const SESSION_MS = 8 * 3600_000;
const INVITE_MS = 72 * 3600_000;
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60_000;
const RECOVERY_CODES = 10;
const incorrect = 'Email, password or code is incorrect.';
const expiredLink =
  'This link has expired or was already used. Ask an administrator for a new one.';
const lockedMessage = (until: Date) => `Too many attempts. Try again after ${until.toISOString()}.`;
type MemberRow = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'invited' | 'active' | 'disabled';
  password_hash: string | null;
  totp_secret_enc: Buffer | null;
  totp_last_step: string | null;
  failed_logins: number;
  locked_until: Date | null;
};
const at = (ctx: AuthContext) => new Date(ctx.now());

export async function sessionUser(
  ctx: AuthContext,
  token: string | undefined,
): Promise<User | undefined> {
  if (!token) return;
  const result = await ctx.pool.query<User>(
    `SELECT m.id, m.name, m.email, m.role, COALESCE(p.locale, 'en') AS locale
       FROM omniboard.session s JOIN omniboard.member m ON m.id = s.member_id
       LEFT JOIN omniboard.member_preference p ON p.member_id = m.id
      WHERE s.token_hash = $1 AND s.expires_at > $2 AND m.status = 'active'`,
    [sha256(token), at(ctx)],
  );
  return result.rows[0];
}
/** 每人一个会话:新登录替换旧会话(proposal §4)。 */
async function startSession(client: Client, ctx: AuthContext, memberId: string): Promise<string> {
  const token = randomToken();
  await client.query(
    `INSERT INTO omniboard.session (token_hash, member_id, created_at, expires_at) VALUES ($1,$2,$3,$4)
     ON CONFLICT (member_id) DO UPDATE SET token_hash = EXCLUDED.token_hash, created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at`,
    [sha256(token), memberId, at(ctx), new Date(ctx.now() + SESSION_MS)],
  );
  await client.query(
    'UPDATE omniboard.member SET last_login_at = $2, failed_logins = 0, locked_until = NULL WHERE id = $1',
    [memberId, at(ctx)],
  );
  return token;
}
export async function endSession(pool: Pool, token: string | undefined): Promise<void> {
  if (token)
    await pool.query('DELETE FROM omniboard.session WHERE token_hash = $1', [sha256(token)]);
}
/** 失败计数;第 5 次锁定 15 分钟、结束会话并写审计。返回锁定截止时间。 */
async function recordFailure(
  client: Client,
  ctx: AuthContext,
  member: MemberRow,
): Promise<Date | null> {
  const failures = member.failed_logins + 1;
  if (failures < LOCK_AFTER) {
    await client.query('UPDATE omniboard.member SET failed_logins = $2 WHERE id = $1', [
      member.id,
      failures,
    ]);
    return null;
  }
  const until = new Date(ctx.now() + LOCK_MS);
  await client.query(
    'UPDATE omniboard.member SET failed_logins = 0, locked_until = $2 WHERE id = $1',
    [member.id, until],
  );
  await client.query('DELETE FROM omniboard.session WHERE member_id = $1', [member.id]);
  await audit(client, {
    actor: { id: member.id, via: 'session' },
    action: 'login.locked',
    targetTable: 'omniboard.member',
    targetKey: member.id,
    after: { lockedUntil: until.toISOString() },
    stepUp: false,
  });
  return until;
}
/** 校验 TOTP 但不写库;返回可接受的时间片(大于上次已用时间片)。 */
function acceptedStep(ctx: AuthContext, member: MemberRow, code: string): number | null {
  if (!member.totp_secret_enc) return null;
  const step = matchStep(open(ctx.totpKey, member.totp_secret_enc), code, ctx.now());
  if (step === null) return null;
  return member.totp_last_step !== null && step <= Number(member.totp_last_step) ? null : step;
}
const lockMember = (client: Client, where: string, value: string) =>
  client.query<MemberRow>(`SELECT * FROM omniboard.member WHERE ${where} = $1 FOR UPDATE`, [value]);

export type LoginInput = { email: string; password: string; code?: string; recoveryCode?: string };
export async function login(
  ctx: AuthContext,
  input: LoginInput,
): Promise<{ token: string; user: User; recoveryCodesLeft?: number }> {
  // 失败计数必须提交,所以事务只返回结果,错误在事务外抛出。
  const outcome = await tx(ctx.pool, async (client) => {
    const member = (await lockMember(client, 'email', input.email.trim().toLowerCase())).rows[0];
    if (!member) {
      verifyPassword(input.password, null);
      return { ok: false, error: incorrect, status: 401 } as const;
    }
    if (member.locked_until && member.locked_until.getTime() > ctx.now())
      return { ok: false, error: lockedMessage(member.locked_until), status: 429 } as const;
    const passwordOk = verifyPassword(input.password, member.password_hash);
    if (member.status !== 'active') return { ok: false, error: incorrect, status: 401 } as const;
    let step: number | null = null;
    let recoveryHash: string | null = null;
    if (input.code) step = acceptedStep(ctx, member, input.code);
    else if (input.recoveryCode) {
      const hash = sha256(normalizeRecoveryCode(input.recoveryCode));
      const found = await client.query(
        'SELECT 1 FROM omniboard.member_recovery_code WHERE member_id = $1 AND code_hash = $2 AND used_at IS NULL',
        [member.id, hash],
      );
      if (found.rowCount) recoveryHash = hash;
    }
    if (!passwordOk || (step === null && recoveryHash === null)) {
      const until = await recordFailure(client, ctx, member);
      return until
        ? ({ ok: false, error: lockedMessage(until), status: 429 } as const)
        : ({ ok: false, error: incorrect, status: 401 } as const);
    }
    let recoveryCodesLeft: number | undefined;
    if (step !== null)
      await client.query('UPDATE omniboard.member SET totp_last_step = $2 WHERE id = $1', [
        member.id,
        step,
      ]);
    else {
      await client.query(
        'UPDATE omniboard.member_recovery_code SET used_at = $3 WHERE member_id = $1 AND code_hash = $2',
        [member.id, recoveryHash, at(ctx)],
      );
      const left = await client.query<{ n: string }>(
        'SELECT count(*) AS n FROM omniboard.member_recovery_code WHERE member_id = $1 AND used_at IS NULL',
        [member.id],
      );
      recoveryCodesLeft = Number(left.rows[0]!.n);
    }
    const token = await startSession(client, ctx, member.id);
    return { ok: true, token, memberId: member.id, recoveryCodesLeft } as const;
  });
  if (!outcome.ok) problem(outcome.status, outcome.error);
  const user = await sessionUser(ctx, outcome.token);
  return { token: outcome.token, user: user!, recoveryCodesLeft: outcome.recoveryCodesLeft };
}

/**
 * 当场确认(frontend-spec 12.4)。在业务事务之前、单独提交:验证码一经接受即作废;
 * 失败计入锁定,第 5 次锁定并结束会话。恢复码不可用于确认。
 */
export async function stepUp(ctx: AuthContext, memberId: string, code: string): Promise<void> {
  const outcome = await tx(ctx.pool, async (client) => {
    const member = (await lockMember(client, 'id', memberId)).rows[0];
    if (!member || member.status !== 'active')
      return { status: 401, error: 'Sign in to continue.' } as const;
    const step = acceptedStep(ctx, member, code);
    if (step === null) {
      const until = await recordFailure(client, ctx, member);
      return until
        ? ({ status: 429, error: lockedMessage(until) } as const)
        : ({ status: 403, error: 'The code is incorrect.' } as const);
    }
    await client.query(
      'UPDATE omniboard.member SET totp_last_step = $2, failed_logins = 0 WHERE id = $1',
      [member.id, step],
    );
    return null;
  });
  if (outcome) problem(outcome.status, outcome.error);
}

// ---- 邀请与激活 ----
export const inviteLink = (origin: string, token: string) => `${origin}/activate?token=${token}`;
/** 生成邀请;同一成员此前未用的链接全部作废。 */
export async function createInvite(
  client: Client,
  ctx: AuthContext,
  memberId: string,
  purpose: 'activate' | 'reset',
  createdBy: string,
): Promise<string> {
  await client.query(
    'UPDATE omniboard.member_invite SET used_at = $2 WHERE member_id = $1 AND used_at IS NULL',
    [memberId, at(ctx)],
  );
  const token = randomToken();
  await client.query(
    'INSERT INTO omniboard.member_invite (token_hash, member_id, purpose, expires_at, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [sha256(token), memberId, purpose, new Date(ctx.now() + INVITE_MS), createdBy, at(ctx)],
  );
  return token;
}
type InviteRow = {
  token_hash: string;
  purpose: 'activate' | 'reset';
  pending_totp_enc: Buffer | null;
  member_id: string;
  name: string;
  email: string;
};
async function loadInvite(client: Client | Pool, ctx: AuthContext, token: string, lock: boolean) {
  const result = await client.query<InviteRow>(
    `SELECT i.token_hash, i.purpose, i.pending_totp_enc, m.id AS member_id, m.name, m.email
       FROM omniboard.member_invite i JOIN omniboard.member m ON m.id = i.member_id
      WHERE i.token_hash = $1 AND i.used_at IS NULL AND i.expires_at > $2 AND m.status = 'invited'
      ${lock ? 'FOR UPDATE OF i' : ''}`,
    [sha256(token), at(ctx)],
  );
  return result.rows[0] ?? problem(410, expiredLink);
}
export async function inviteInfo(ctx: AuthContext, token: string) {
  const invite = await loadInvite(ctx.pool, ctx, token, false);
  return { name: invite.name, email: invite.email, purpose: invite.purpose };
}
/** 12.2 第 2 步:生成待确认的 TOTP 密钥;重复调用会换一个新密钥。 */
export async function beginTotp(
  ctx: AuthContext,
  token: string,
): Promise<{ secret: string; uri: string }> {
  return tx(ctx.pool, async (client) => {
    const invite = await loadInvite(client, ctx, token, true);
    const secret = newSecret();
    await client.query(
      'UPDATE omniboard.member_invite SET pending_totp_enc = $2 WHERE token_hash = $1',
      [invite.token_hash, seal(ctx.totpKey, secret)],
    );
    return { secret: base32(secret), uri: otpauthUri(secret, invite.email) };
  });
}
export async function completeActivation(
  ctx: AuthContext,
  token: string,
  input: { password?: string; code: string },
): Promise<{ token: string; user: User; recoveryCodes: string[] }> {
  const done = await tx(ctx.pool, async (client) => {
    const invite = await loadInvite(client, ctx, token, true);
    if (
      invite.purpose === 'activate' &&
      !(input.password && input.password.length >= 12 && input.password.length <= 200)
    )
      problem(422, 'Password must be 12–200 characters.');
    if (!invite.pending_totp_enc) problem(409, 'Set up your authenticator first.');
    const step = matchStep(open(ctx.totpKey, invite.pending_totp_enc), input.code, ctx.now());
    if (step === null)
      problem(422, 'The code is incorrect. Check the time on your phone and try again.');
    await client.query(
      `UPDATE omniboard.member SET status = 'active', totp_secret_enc = $2, totp_last_step = $3,
              password_hash = COALESCE($4, password_hash), failed_logins = 0, locked_until = NULL
        WHERE id = $1`,
      [
        invite.member_id,
        invite.pending_totp_enc,
        step,
        invite.purpose === 'activate' ? hashPassword(input.password!) : null,
      ],
    );
    await client.query('UPDATE omniboard.member_invite SET used_at = $2 WHERE token_hash = $1', [
      invite.token_hash,
      at(ctx),
    ]);
    const recoveryCodes = await replaceRecoveryCodes(client, invite.member_id);
    const session = await startSession(client, ctx, invite.member_id);
    return { token: session, recoveryCodes };
  });
  const user = await sessionUser(ctx, done.token);
  return { ...done, user: user! };
}
export async function replaceRecoveryCodes(client: Client, memberId: string): Promise<string[]> {
  await client.query('DELETE FROM omniboard.member_recovery_code WHERE member_id = $1', [memberId]);
  const codes = Array.from({ length: RECOVERY_CODES }, recoveryCode);
  for (const code of codes)
    await client.query(
      'INSERT INTO omniboard.member_recovery_code (member_id, code_hash) VALUES ($1,$2)',
      [memberId, sha256(normalizeRecoveryCode(code))],
    );
  return codes;
}

// ---- 成员(frontend-spec 12.5;其余操作在成员管理那一步补) ----
export type NewMember = { id?: string; name: string; email: string; role: Role };
export async function inviteMember(
  client: Client,
  ctx: AuthContext,
  actor: Actor,
  input: NewMember,
): Promise<{ id: string; token: string }> {
  const memberId = input.id ?? id();
  const email = input.email.trim().toLowerCase();
  const exists = await client.query('SELECT 1 FROM omniboard.member WHERE email = $1', [email]);
  if (exists.rowCount) problem(409, 'This email is already registered.');
  await client.query(
    "INSERT INTO omniboard.member (id, name, email, role, status, created_at) VALUES ($1,$2,$3,$4,'invited',$5)",
    [memberId, input.name.trim(), email, input.role, at(ctx)],
  );
  const token = await createInvite(
    client,
    ctx,
    memberId,
    'activate',
    actor.via === 'cli' ? memberId : actor.id,
  );
  await audit(client, {
    actor: actor.via === 'cli' ? { id: memberId, via: 'cli' } : actor,
    action: 'member.invite',
    targetTable: 'omniboard.member',
    targetKey: memberId,
    after: { name: input.name.trim(), email, role: input.role },
    stepUp: false,
  });
  return { id: memberId, token };
}
/** 首个 admin:仅在没有 active 或 invited 的 admin 时可用(cli bootstrap-admin)。 */
export async function bootstrapAdmin(ctx: AuthContext, input: { name: string; email: string }) {
  return tx(ctx.pool, async (client) => {
    await client.query('LOCK TABLE omniboard.member IN SHARE ROW EXCLUSIVE MODE');
    const admins = await client.query(
      "SELECT 1 FROM omniboard.member WHERE role = 'admin' AND status IN ('active','invited')",
    );
    if (admins.rowCount)
      problem(409, 'An administrator already exists. Use the Team members page.');
    return inviteMember(client, ctx, { id: '', via: 'cli' }, { ...input, role: 'admin' });
  });
}
