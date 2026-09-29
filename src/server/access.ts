import type { FastifyRequest } from 'fastify';
import { atLeast, problem, type Role, type User } from './auth';
import type { Actor } from './audit';
import { tx, type Client, type Pool } from './db';
declare module 'fastify' {
  interface FastifyRequest {
    user: User;
    actor: Actor;
  }
}
export function requireRole(request: FastifyRequest, min: Role): void {
  if (!atLeast(request.user.role, min))
    problem(
      403,
      min === 'admin'
        ? 'Administrator access is required.'
        : min === 'trader'
          ? 'This action requires the trader role.'
          : 'This role has read-only access.',
    );
}
/** 令牌调用不能做需要人在场的操作(当场确认、成员与令牌管理,frontend-spec 12.6)。 */
export function requireInteractive(request: FastifyRequest): void {
  if (request.actor.via !== 'session') problem(403, 'This action requires an interactive session.');
}
/** 交易页面与读接口(frontend-spec 12.7、12.8):trader 与 admin;其他角色看不到这一页(404)。 */
export function requireTrader(request: FastifyRequest): void {
  if (!atLeast(request.user.role, 'trader')) problem(404, 'Not found.');
}
/** 影响实盘的写操作(12.1):trader 角色,且必须是登录会话,令牌不行。当场确认(12.4)暂缓,TODO。 */
export function requireLiveWrite(request: FastifyRequest): void {
  requireRole(request, 'trader');
  requireInteractive(request);
}
/** 写 quant 的控制表:DB 约束拒绝时带上约束名(12.7),表单内容由前端保留。 */
export async function quantWrite<T>(pool: Pool, fn: (client: Client) => Promise<T>): Promise<T> {
  try {
    return await tx(pool, fn);
  } catch (error) {
    const pg = error as { code?: string; constraint?: string };
    if (pg.code === '23514' || pg.code === '23502')
      problem(422, `The database rejected this change: ${pg.constraint ?? 'not null'}`);
    throw error;
  }
}
/**
 * 迁移导入专用的字段(proposal §9、D6):系统时间、原作者、原 revision、已上传的证据 id。只在导入窗口打开时、
 * 由 admin 令牌写入;其余调用方传了就拒绝,不静默忽略。窗口由 `npm run cli -- close-import` 关闭。
 */
export async function requireImport(pool: Pool, request: FastifyRequest): Promise<void> {
  const open = await pool.query<{ value: boolean }>(
    "SELECT value FROM omniboard.app_setting WHERE key = 'import_open'",
  );
  if (request.actor.via !== 'agent_token' || request.user.role !== 'admin' || !open.rows[0]?.value)
    problem(
      403,
      'Imported fields can only be written with an administrator token while the import window is open.',
    );
}
export async function importedTime(
  pool: Pool,
  request: FastifyRequest,
  value: string | undefined,
): Promise<Date | undefined> {
  if (value === undefined) return undefined;
  await requireImport(pool, request);
  return new Date(value);
}
