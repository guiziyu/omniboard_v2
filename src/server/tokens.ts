import type { Pool } from './db';
import { id, tx } from './db';
import { audit, type Actor } from './audit';
import { atLeast, problem, roles, type AuthContext, type Role, type User } from './auth';
import { randomToken, sha256 } from './crypto';
// agent 用的 API 令牌(frontend-spec 12.6,proposal §5)。令牌绑定成员与角色;明文只在创建时返回一次。
export const tokenRoles = ['reader', 'editor', 'admin'] as const;
export type TokenRole = (typeof tokenRoles)[number];
export const tokenLifetimes = [7, 30, 90] as const;
const PREFIX = 'obt_';
const lower = (a: Role, b: Role): Role => (roles.indexOf(a) <= roles.indexOf(b) ? a : b);
/** 按令牌取调用者:成员须为 active;生效角色取令牌角色与成员当前角色中较低者。 */
export async function tokenPrincipal(
  ctx: AuthContext,
  raw: string,
): Promise<{ user: User; agentTokenId: string } | undefined> {
  if (!raw.startsWith(PREFIX)) return;
  const now = new Date(ctx.now());
  const result = await ctx.pool.query<User & { tokenId: string; tokenRole: TokenRole }>(
    `SELECT t.id AS "tokenId", t.role AS "tokenRole", m.id, m.name, m.email, m.role,
            COALESCE(p.locale, 'en') AS locale
       FROM omniboard.agent_token t JOIN omniboard.member m ON m.id = t.member_id
       LEFT JOIN omniboard.member_preference p ON p.member_id = m.id
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND t.expires_at > $2 AND m.status = 'active'`,
    [sha256(raw), now],
  );
  const row = result.rows[0];
  if (!row) return;
  // 每分钟最多记一次最近使用时间,避免每个请求都写库。
  await ctx.pool.query(
    `UPDATE omniboard.agent_token SET last_used_at = $2
      WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < $2::timestamptz - interval '1 minute')`,
    [row.tokenId, now],
  );
  const { tokenId, tokenRole, ...user } = row;
  return { user: { ...user, role: lower(tokenRole, user.role) }, agentTokenId: tokenId };
}
export type TokenView = {
  id: string;
  name: string;
  role: TokenRole;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  state: 'active' | 'expired' | 'revoked';
};
export async function listTokens(pool: Pool, memberId: string, now: Date): Promise<TokenView[]> {
  const result = await pool.query<TokenView>(
    `SELECT id, name, role, created_at AS "createdAt", expires_at AS "expiresAt",
            last_used_at AS "lastUsedAt",
            CASE WHEN revoked_at IS NOT NULL THEN 'revoked'
                 WHEN expires_at <= $2 THEN 'expired' ELSE 'active' END AS state
       FROM omniboard.agent_token WHERE member_id = $1 ORDER BY created_at DESC, id`,
    [memberId, now],
  );
  return result.rows;
}
export async function createToken(
  ctx: AuthContext,
  actor: Actor,
  user: User,
  input: { name: string; role: TokenRole; expiresInDays: (typeof tokenLifetimes)[number] },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  if (!atLeast(user.role, input.role))
    problem(403, 'A token cannot have a higher role than yours.');
  const tokenId = id();
  const token = `${PREFIX}${randomToken()}`;
  const expiresAt = new Date(ctx.now() + input.expiresInDays * 86_400_000);
  await tx(ctx.pool, async (client) => {
    await client.query(
      `INSERT INTO omniboard.agent_token (id, member_id, name, role, token_hash, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tokenId, user.id, input.name, input.role, sha256(token), new Date(ctx.now()), expiresAt],
    );
    await audit(client, {
      actor,
      action: 'agent_token.create',
      targetTable: 'omniboard.agent_token',
      targetKey: tokenId,
      after: { name: input.name, role: input.role, memberId: user.id, expiresAt },
      stepUp: false,
    });
  });
  return { id: tokenId, token, expiresAt };
}
/** 吊销:本人吊销自己的令牌;admin 可吊销任何成员的(ownerId 指定成员)。 */
export async function revokeToken(
  ctx: AuthContext,
  actor: Actor,
  ownerId: string,
  tokenId: string,
): Promise<void> {
  await tx(ctx.pool, async (client) => {
    const revoked = await client.query(
      `UPDATE omniboard.agent_token SET revoked_at = $3
        WHERE id = $1 AND member_id = $2 AND revoked_at IS NULL RETURNING name`,
      [tokenId, ownerId, new Date(ctx.now())],
    );
    if (!revoked.rowCount) {
      const exists = await client.query(
        'SELECT 1 FROM omniboard.agent_token WHERE id = $1 AND member_id = $2',
        [tokenId, ownerId],
      );
      if (exists.rowCount) return;
      problem(404, 'Token not found.');
    }
    await audit(client, {
      actor,
      action: 'agent_token.revoke',
      targetTable: 'omniboard.agent_token',
      targetKey: tokenId,
      after: { name: revoked.rows[0].name, memberId: ownerId },
      stepUp: false,
    });
  });
}
