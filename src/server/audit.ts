import type { Client } from './db';
// 审计事件与业务写入同一事务(proposal §4);表只追加(data-model §4.2)。
export type AuditAction =
  | 'auth.create'
  | 'auth.update_tags'
  | 'auth.update_whitelist'
  | 'auth.update_owner'
  | 'auth.rotate_key'
  | 'auth.terminate'
  | 'hft_config.create'
  | 'hft_config.update'
  | 'hft_restart.request'
  | 'member.invite'
  | 'member.role'
  | 'member.disable'
  | 'member.enable'
  | 'member.reset_totp'
  | 'session.revoke'
  | 'agent_token.create'
  | 'agent_token.revoke'
  | 'login.locked'
  | 'notify_result';
export type Actor = { id: string; via: 'session' | 'agent_token' | 'cli'; agentTokenId?: string };
export type AuditEvent = {
  actor: Actor;
  action: AuditAction;
  targetTable: string;
  targetKey: string;
  before?: unknown;
  after?: unknown;
  stepUp: boolean;
};
export async function audit(client: Client, event: AuditEvent): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO omniboard.audit_event
       (actor_id, via, agent_token_id, action, target_table, target_key, before, after, step_up, notify)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'none') RETURNING id`,
    [
      event.actor.id,
      event.actor.via,
      event.actor.agentTokenId ?? null,
      event.action,
      event.targetTable,
      event.targetKey,
      event.before === undefined ? null : JSON.stringify(event.before),
      event.after === undefined ? null : JSON.stringify(event.after),
      event.stepUp,
    ],
  );
  return result.rows[0]!.id;
}
