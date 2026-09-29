import type { Client } from './db';
import { problem } from './auth';
import type { Visibility } from '../shared/types';
// 讨论与联系人对话记录的引用(frontend-spec 5.9),从 v1 src/server/discussion.ts 迁移。

/**
 * replyTo 只能指向本机构的根讨论(回复只有一层);relatedRecord 只能指向本机构的联系人。
 * 被引用的记录或其原文是 admin 可见时,讨论也必须是 admin,不能借引用放宽可见性。
 * 已归并的别名记录不能再被引用。回复继承父讨论关联的联系人。
 */
export async function validateDiscussionReferences(
  client: Client,
  organizationId: string,
  structured: Record<string, string>,
  visibility: Visibility,
  recordId?: string,
) {
  for (const [field, expectedTab] of [
    ['replyTo', 'comments'],
    ['relatedRecord', 'contacts'],
  ] as const) {
    const refId = structured[field];
    if (!refId) continue;
    const target = (
      await client.query<{
        visibility: Visibility;
        evidence_visibility: Visibility;
        tab_id: string;
        structured: Record<string, string>;
      }>(
        `SELECT r.visibility, e.visibility AS evidence_visibility, r.tab_id, r.structured
           FROM omniboard.module_records r JOIN omniboard.evidence e ON e.id = r.evidence_id
          WHERE r.id = $1 AND r.organization_id = $2
            AND NOT EXISTS (SELECT 1 FROM omniboard.record_aliases a WHERE a.alias_id = r.id)`,
        [refId, organizationId],
      )
    ).rows[0];
    const parent = target?.structured ?? {};
    if (
      refId === recordId ||
      !target ||
      target.tab_id !== expectedTab ||
      (field === 'replyTo' && parent.replyTo) ||
      ((target.visibility === 'admin' || target.evidence_visibility === 'admin') &&
        visibility !== 'admin') ||
      (field === 'replyTo' &&
        structured.relatedRecord &&
        structured.relatedRecord !== parent.relatedRecord)
    )
      problem(422, 'The linked record is unavailable for this discussion scope.');
    if (field === 'replyTo') structured.relatedRecord = parent.relatedRecord || '';
  }
}
