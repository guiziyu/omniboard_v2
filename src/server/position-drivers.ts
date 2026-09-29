import type { Client, Pool } from './db';
import { id, tx } from './db';
import { problem, type User } from './auth';
import { saveEvidence, type EvidenceStore } from './evidence';
import {
  positionDriverInputSchema,
  type PositionDriver,
  type PositionDriverData,
} from '../shared/position-drivers';
import type { Visibility } from '../shared/types';
import type { z } from 'zod';
// 岗位目标与激励(frontend-spec 6.16),从 v1 src/server/position-drivers.ts 迁移。
// 情报绑定组织架构图的一个职位:同名的人到了另一家机构看不到;不根据数值目标生成完成率。

type Db = Pool | Client;
const admin = (user: User) => user.role === 'admin';
type Position = {
  id: string;
  personName: string;
  roleTitle: string;
  visibility: Visibility;
  organizationId: string;
  organizationName: string;
};
/** 职位必须属于这个机构、在组织架构图里、可见且没有退役;否则 404。 */
async function position(db: Db, user: User, organizationId: string, positionId: string) {
  const found = (
    await db.query<Position>(
      `SELECT r.id, r.person_name AS "personName", r.title AS "roleTitle", r.visibility,
              o.id AS "organizationId", o.name AS "organizationName"
         FROM omniboard.module_records r
         JOIN omniboard.organizations o ON o.id = r.organization_id
         JOIN omniboard.evidence e ON e.id = r.evidence_id
        WHERE r.id = $1 AND r.organization_id = $2 AND r.tab_id = 'org_chart'
          AND (r.visibility = 'team' OR $3) AND (e.visibility = 'team' OR $3)
          AND NOT EXISTS (SELECT 1 FROM omniboard.organization_aliases a WHERE a.alias_id = o.id)
          AND NOT EXISTS (SELECT 1 FROM omniboard.record_aliases a WHERE a.alias_id = r.id)`,
      [positionId, organizationId, admin(user)],
    )
  ).rows[0];
  return found ?? problem(404, 'Position not found.');
}
export async function positionDrivers(
  db: Db,
  user: User,
  organizationId: string,
  positionId: string,
): Promise<PositionDriver[]> {
  const p = await position(db, user, organizationId, positionId);
  const rows = (
    await db.query<{
      id: string;
      data: PositionDriverData;
      positionId: string;
      revision: number;
      evidenceId: string;
      attachmentEvidenceId: string | null;
      updatedAt: Date;
    }>(
      `SELECT d.id, d.data, d.position_id AS "positionId", d.revision, d.evidence_id AS "evidenceId",
              d.attachment_evidence_id AS "attachmentEvidenceId", d.updated_at AS "updatedAt"
         FROM omniboard.position_drivers d
         JOIN omniboard.evidence e ON e.id = d.evidence_id
         LEFT JOIN omniboard.evidence a ON a.id = d.attachment_evidence_id
        WHERE d.position_id = $1 AND (d.visibility = 'team' OR $2)
          AND (e.visibility = 'team' OR $2) AND (a.id IS NULL OR a.visibility = 'team' OR $2)
        ORDER BY d.updated_at DESC, d.id`,
      [positionId, admin(user)],
    )
  ).rows;
  return rows.map(({ data, updatedAt, ...r }) => ({
    ...data,
    ...r,
    updatedAt: updatedAt.toISOString(),
    personName: p.personName,
    roleTitle: p.roleTitle,
    organizationId: p.organizationId,
    organizationName: p.organizationName,
  }));
}
export async function savePositionDriver(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  organizationId: string,
  positionId: string,
  driverId: string | undefined,
  input: z.infer<typeof positionDriverInputSchema>,
): Promise<{ id: string; revision: number }> {
  if (user.role === 'reader') problem(403, 'This role has read-only access.');
  return tx(pool, async (client) => {
    const p = await position(client, user, organizationId, positionId);
    const current = driverId
      ? (
          await client.query<{
            id: string;
            revision: number;
            visibility: Visibility;
            attachment_evidence_id: string | null;
          }>(
            `SELECT id, revision, visibility, attachment_evidence_id FROM omniboard.position_drivers
              WHERE id = $1 AND position_id = $2 AND (visibility = 'team' OR $3) FOR UPDATE`,
            [driverId, positionId, admin(user)],
          )
        ).rows[0]
      : undefined;
    if (driverId && !current) problem(404, 'Position insight not found.');
    if (current ? current.revision !== input.revision : input.revision !== undefined)
      problem(409, 'This insight changed. Reload before saving.');
    const recordId = current?.id ?? id();
    const revision = (current?.revision ?? 0) + 1;
    // admin 情报不会因为岗位后来放宽而对外开放;可见性建立后不再改变(data-model §1)。
    const visibility: Visibility =
      p.visibility === 'admin' || current?.visibility === 'admin' ? 'admin' : 'team';
    const evidenceId = await saveEvidence(client, store, Buffer.from(input.rawText), {
      source: input.data.basis === 'public_source' ? 'public_profile' : 'user_report',
      url: input.sourceUrl,
      contentType: 'text/plain; charset=utf-8',
      visibility,
    });
    let attachmentId = current?.attachment_evidence_id ?? null;
    if (input.attachment) {
      const bytes = Buffer.from(input.attachment.base64, 'base64');
      if (!bytes.length || bytes.length > 5_000_000)
        problem(422, 'Attachments must be between 1 byte and 5 MB.');
      attachmentId = await saveEvidence(client, store, bytes, {
        source: 'attachment',
        url: input.sourceUrl,
        contentType: 'application/octet-stream',
        filename: input.attachment.filename,
        visibility,
      });
    }
    if (current) {
      const changed = await client.query(
        `UPDATE omniboard.position_drivers
            SET data = $2, evidence_id = $3, attachment_evidence_id = $4, revision = $5,
                author_id = $6, updated_at = now()
          WHERE id = $1 AND revision = $7`,
        [recordId, input.data, evidenceId, attachmentId, revision, user.id, input.revision],
      );
      if (changed.rowCount !== 1) problem(409, 'This insight changed. Reload before saving.');
    } else
      await client.query(
        `INSERT INTO omniboard.position_drivers
           (id, position_id, data, visibility, evidence_id, attachment_evidence_id, revision, author_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [recordId, positionId, input.data, visibility, evidenceId, attachmentId, revision, user.id],
      );
    await client.query(
      `INSERT INTO omniboard.edit_history (id, subject_id, action, revision, payload, author_id)
       VALUES ($1,$2,'position_driver_saved',$3,$4,$5)`,
      [
        id(),
        recordId,
        revision,
        { positionId, ...input.data, evidenceId, attachmentEvidenceId: attachmentId, visibility },
        user.id,
      ],
    );
    return { id: recordId, revision };
  });
}
