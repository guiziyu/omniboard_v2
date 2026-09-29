import type { Client } from './db';
import type { User } from './auth';
import type { Access } from '../shared/operations';
// 活动历史与任务写锁。单独成模块:记录保存的钩子(接入请求)也要写任务,不经 knowledge / work 以免循环引用。

/** 活动历史(frontend-spec 8.4)。 */
export async function event(
  client: Client,
  organizationId: string,
  targetId: string,
  kind: string,
  title: string,
  access: Access,
  user: User,
  payload: unknown,
) {
  await client.query(
    `INSERT INTO omniboard.operation_events
       (organization_id, target_id, kind, title, payload, visibility, author_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [organizationId, targetId, kind, title, payload, access, user.id],
  );
}
/** 同一机构的任务写入串行:前置环检测、重开检查与各类幂等检查读到的都是已提交状态。 */
export async function lockWork(client: Client, organizationId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('work:' || $1, 0))", [
    organizationId,
  ]);
}
