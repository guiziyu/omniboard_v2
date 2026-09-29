import type { Client, Pool } from './db';
// 审计事件与业务写入同一事务(proposal §4);表只追加(data-model §4.2)。
export const auditActions = [
  'auth.create',
  'auth.update_tags',
  'auth.update_whitelist',
  'auth.update_owner',
  'auth.rotate_key',
  'auth.terminate',
  'hft_config.create',
  'hft_config.update',
  'hft_restart.request',
  'member.invite',
  'member.role',
  'member.disable',
  'member.enable',
  'member.reset_totp',
  'session.revoke',
  'agent_token.create',
  'agent_token.revoke',
  'login.locked',
] as const;
export type AuditAction = (typeof auditActions)[number];
export type Actor = {
  id: string;
  via: 'session' | 'agent_token' | 'cli' | 'system';
  agentTokenId?: string;
};
export type AuditEvent = {
  actor: Actor;
  action: AuditAction;
  targetTable: string;
  targetKey: string;
  before?: unknown;
  after?: unknown;
  stepUp: boolean;
  /** 需要通知 owner(frontend-spec 12.11)。邮件发送是 TODO,目前只标记。 */
  notify?: boolean;
};
// 密钥列即使被误传进来也不落审计(frontend-spec 12.7「没有任何密钥明文」)。
const secretKey = /^(api_?(key|secret|pass)|apiKey|apiSecret|apiPass|password|passphrase)$/i;
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, secretKey.test(k) ? 'changed' : redact(v)]),
    );
  return value;
}
export async function audit(client: Client, event: AuditEvent): Promise<string> {
  const json = (v: unknown) => (v === undefined ? null : JSON.stringify(redact(v)));
  const result = await client.query<{ id: string }>(
    `INSERT INTO omniboard.audit_event
       (actor_id, via, agent_token_id, action, target_table, target_key, before, after, step_up, notify_required)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      event.actor.id,
      event.actor.via,
      event.actor.agentTokenId ?? null,
      event.action,
      event.targetTable,
      event.targetKey,
      json(event.before),
      json(event.after),
      event.stepUp,
      event.notify ?? false,
    ],
  );
  return result.rows[0]!.id;
}

// ---- 审计日志页(frontend-spec 12.10) ----
export const auditCategories = {
  accounts: ['auth.'],
  hft: ['hft_config.', 'hft_restart.'],
  members: ['member.', 'session.'],
  tokens: ['agent_token.'],
  login: ['login.'],
} as const;
export type AuditQuery = {
  actorId?: string;
  category?: keyof typeof auditCategories;
  target?: string;
  from?: string;
  to?: string;
  /** 翻页:只取 id 小于它的事件。 */
  before?: string;
};
export type AuditRow = {
  id: string;
  at: Date;
  actorId: string;
  actorName: string;
  via: Actor['via'];
  agentTokenName: string | null;
  action: AuditAction;
  targetTable: string;
  targetKey: string;
  before: unknown;
  after: unknown;
  stepUp: boolean;
};
export const AUDIT_PAGE = 50;
export async function listAudit(pool: Pool, query: AuditQuery): Promise<AuditRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (query.actorId) add('e.actor_id = ?', query.actorId);
  if (query.category) {
    const prefixes = auditCategories[query.category];
    const clauses = prefixes.map((p) => {
      params.push(`${p}%`);
      return `e.action LIKE $${params.length}`;
    });
    where.push(`(${clauses.join(' OR ')})`);
  }
  if (query.target) add("(e.target_key ILIKE '%' || ? || '%')", query.target);
  if (query.from) add('e.at >= ?', query.from);
  if (query.to) add('e.at < ?', query.to);
  if (query.before) add('e.id < ?', query.before);
  const result = await pool.query<AuditRow>(
    `SELECT e.id, e.at, e.actor_id AS "actorId", m.name AS "actorName", e.via,
            t.name AS "agentTokenName", e.action, e.target_table AS "targetTable",
            e.target_key AS "targetKey", e.before, e.after, e.step_up AS "stepUp"
       FROM omniboard.audit_event e
       JOIN omniboard.member m ON m.id = e.actor_id
       LEFT JOIN omniboard.agent_token t ON t.id = e.agent_token_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY e.id DESC
      LIMIT ${AUDIT_PAGE}`,
    params,
  );
  return result.rows;
}
