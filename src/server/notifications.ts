import type { Pool } from './db';
import { tx } from './db';
import { audit } from './audit';
// 通知 owner 的 outbox(frontend-spec 12.11,D5):事件与业务同事务标记 notify_required,
// 提交后在这里发送,结果写一条 notify_result 事件。失败不重试、不回滚业务。
export type Message = { subject: string; text: string };
/** 未配置发送通道时为 undefined,结果记为 failed。 */
export type Sender = ((message: Message) => Promise<void>) | undefined;
type Pending = {
  id: string;
  at: Date;
  actor_id: string;
  actor_name: string;
  action: string;
  target_table: string;
  target_key: string;
  before: unknown;
  after: unknown;
};
export function describe(event: Pending, origin: string): Message {
  const lines = [
    `Actor: ${event.actor_name}`,
    `Time (UTC): ${event.at.toISOString()}`,
    `Action: ${event.action}`,
    `Target: ${event.target_table} ${event.target_key}`,
    ...(event.before === null ? [] : [`Before: ${JSON.stringify(event.before)}`]),
    ...(event.after === null ? [] : [`After: ${JSON.stringify(event.after)}`]),
    `Audit log: ${origin}/w/internal/audit?event=${event.id}`,
  ];
  return {
    subject: `[Omniboard] ${event.action} · ${event.target_key}`,
    text: lines.join('\n'),
  };
}
/** 发送所有未发送的通知;单实例由服务端 advisory lock 保证,这里再用事务锁防止并发调用重复发送。 */
export async function deliverPending(pool: Pool, sender: Sender, origin: string): Promise<number> {
  return tx(pool, async (client) => {
    const got = await client.query<{ ok: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtext('omniboard.notify')) AS ok",
    );
    if (!got.rows[0]!.ok) return 0;
    const pending = await client.query<Pending>(
      `SELECT e.id, e.at, e.actor_id, m.name AS actor_name, e.action, e.target_table, e.target_key, e.before, e.after
         FROM omniboard.audit_event e JOIN omniboard.member m ON m.id = e.actor_id
        WHERE e.notify_required
          AND NOT EXISTS (SELECT 1 FROM omniboard.audit_event n
                           WHERE n.action = 'notify_result' AND (n.after->>'eventId')::bigint = e.id)
        ORDER BY e.id LIMIT 50`,
    );
    for (const event of pending.rows) {
      let result: 'sent' | 'failed' = 'failed';
      let error: string | undefined = 'Notification is not configured.';
      if (sender) {
        try {
          await sender(describe(event, origin));
          result = 'sent';
          error = undefined;
        } catch (e) {
          error = (e as Error).message.slice(0, 500);
        }
      }
      await audit(client, {
        actor: { id: event.actor_id, via: 'system' },
        action: 'notify_result',
        targetTable: 'omniboard.audit_event',
        targetKey: event.id,
        after: { eventId: Number(event.id), result, ...(error ? { error } : {}) },
        stepUp: false,
      });
    }
    return pending.rows.length;
  });
}
