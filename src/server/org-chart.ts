import type { Client } from './db';
import { problem } from './auth';
import { saveEvidence } from './evidence';
import type { Visibility } from '../shared/types';
// 组织架构图的汇报关系(frontend-spec 6.2;data-model §3.3),从 v1 src/server/org-chart.ts 迁移。

/** 同一机构的架构图写入串行执行,环检测读到的上级链不会被并发的移动改掉。 */
export async function lockChart(client: Client, organizationId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('org_chart:' || $1, 0))", [
    organizationId,
  ]);
}
/** 上级必须是本机构、可见性相同的职位,且不能是自己或自己的后代。 */
export async function validateReportsTo(
  client: Client,
  organizationId: string,
  recordId: string,
  parentId: string,
  visibility: Visibility,
) {
  if (!parentId) return;
  const positions = await client.query<{ id: string; parent: string; visibility: Visibility }>(
    `SELECT id, reports_to AS parent, visibility FROM omniboard.module_records
      WHERE organization_id = $1 AND tab_id = 'org_chart'`,
    [organizationId],
  );
  const byId = new Map(positions.rows.map((p) => [p.id, p]));
  const parent = byId.get(parentId);
  if (!parent || parent.visibility !== visibility)
    problem(422, 'Choose a manager in this organization with the same visibility.');
  const visited = new Set([recordId]);
  let cursor = parentId;
  while (cursor) {
    if (visited.has(cursor)) problem(422, 'Reporting relationships cannot contain cycles.');
    visited.add(cursor);
    const position = byId.get(cursor);
    if (!position) problem(422, 'The manager must be a position in this organization.');
    cursor = position.parent;
  }
}
/** 写入一条关系:理由存为独立证据(导入时可直接引用已上传的证据),人员自己的原文不变。 */
export async function saveRelationship(
  client: Client,
  recordId: string,
  input: {
    kind: 'confirmed' | 'unconfirmed';
    note: string;
    sourceUrl: string;
    visibility: Visibility;
    evidenceId?: string;
  },
): Promise<string> {
  const evidenceId =
    input.evidenceId ??
    (await saveEvidence(client, Buffer.from(input.note), {
      source: 'manual',
      url: input.sourceUrl,
      visibility: input.visibility,
      contentType: 'text/plain; charset=utf-8',
      filename: 'relationship-reference.txt',
    }));
  await client.query(
    `INSERT INTO omniboard.org_chart_relationships (record_id, kind, note, evidence_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (record_id) DO UPDATE
       SET kind = excluded.kind, note = excluded.note, evidence_id = excluded.evidence_id`,
    [recordId, input.kind, input.note, evidenceId],
  );
  return evidenceId;
}
