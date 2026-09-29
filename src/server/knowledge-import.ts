import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Client, Pool } from './db';
import { tx } from './db';
import { problem } from './auth';
import { requireImport } from './access';
import { checkEvidence } from './records';
import type { Visibility } from '../shared/types';
// 共享对象、结论、关系、身份决定与活动历史的迁移导入(data-model §3.4、§3.3;proposal §9)。
// 只在导入窗口内由 admin 令牌调用;以 id 为键,已存在返回 409(与记录导入相同),重定向按对幂等。
// 外键指向的对象、记录、证据和成员必须先导入。

const key = z.string().min(1).max(200);
const day = z.union([z.literal(''), z.iso.date()]).default('');
const at = z.iso.datetime({ offset: true });

/** 把约束错误翻成调用方能处理的状态码,而不是 500。 */
async function insert(client: Client, sql: string, values: unknown[]): Promise<boolean> {
  try {
    return !!(await client.query(sql, values)).rowCount;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === '23503') problem(422, 'A referenced item has not been imported yet.');
    if (code === '23514') problem(422, 'The imported values do not satisfy the table rules.');
    if (code === '23505') problem(409, 'This item has already been imported.');
    throw error;
  }
}
async function objectVisibility(client: Client, objectId: string): Promise<Visibility> {
  const row = (
    await client.query<{ visibility: Visibility }>(
      'SELECT visibility FROM omniboard.knowledge_objects WHERE id = $1',
      [objectId],
    )
  ).rows[0];
  return row?.visibility ?? problem(422, 'A referenced item has not been imported yet.');
}

const objectImport = z
  .object({
    id: key,
    organizationId: key,
    kind: z.enum(['person', 'account', 'capability', 'resource']),
    name: z.string().trim().min(1).max(160),
    scope: z.string().trim().min(1).max(500),
    visibility: z.enum(['team', 'admin']),
    revision: z.number().int().positive(),
    updatedAt: at,
    recordIds: z.array(key).max(1000).default([]),
  })
  .strict();
const claimImport = z
  .object({
    id: key,
    objectId: key,
    organizationId: key,
    field: z.string().trim().min(1).max(100),
    value: z.string().trim().min(1).max(2000),
    scope: z.string().trim().min(1).max(500),
    validFrom: day,
    validUntil: day,
    observedOn: day,
    recordedAt: at,
    status: z.enum(['reported', 'accepted', 'superseded']),
    evidenceId: key,
    sourceRecordId: z.union([key, z.literal('')]).default(''),
    revision: z.number().int().positive(),
  })
  .strict();
const relationImport = z
  .object({
    id: key,
    fromId: key,
    toId: key,
    label: z.string().trim().min(1).max(120),
    certainty: z.enum(['confirmed', 'unconfirmed']),
    validFrom: day,
    validUntil: day,
    evidenceId: key,
  })
  .strict();
const redirectImport = z.object({ objectId: key, targetId: key }).strict();
const identityEventImport = z
  .object({
    id: key,
    objectId: key,
    otherId: z.union([key, z.literal('')]).default(''),
    recordId: z.union([key, z.literal('')]).default(''),
    kind: z.enum(['link', 'unlink', 'merge', 'undo_merge']),
    reason: z.string().min(1).max(4000),
    evidenceId: key,
    authorId: key,
    createdAt: at,
    reversesId: z.union([key, z.literal('')]).default(''),
  })
  .strict();
const operationEventImport = z
  .object({
    importId: key,
    organizationId: key,
    targetId: key,
    kind: z.string().min(1).max(40),
    title: z.string().min(1).max(1000),
    payload: z.record(z.string(), z.unknown()),
    visibility: z.enum(['team', 'admin']),
    authorId: key,
    createdAt: at,
  })
  .strict();

export function registerKnowledgeImport(app: FastifyInstance, pool: Pool) {
  const route = <T extends z.ZodType>(
    path: string,
    schema: T,
    write: (client: Client, input: z.infer<T>) => Promise<boolean>,
  ) =>
    app.post(path, async (request, reply) => {
      const input = schema.parse(request.body);
      await requireImport(pool, request);
      const created = await tx(pool, (client) => write(client, input));
      return reply.code(created ? 201 : 200).send({ ok: true });
    });

  route('/api/import/knowledge-objects', objectImport, async (client, input) => {
    const records = await client.query<{ visibility: Visibility }>(
      'SELECT visibility FROM omniboard.module_records WHERE id = ANY($1)',
      [input.recordIds],
    );
    if (records.rowCount !== new Set(input.recordIds).size)
      problem(422, 'A referenced item has not been imported yet.');
    if (input.visibility === 'team' && records.rows.some((r) => r.visibility === 'admin'))
      problem(422, 'Restricted evidence requires an administrator-only item.');
    if (
      !(await insert(
        client,
        `INSERT INTO omniboard.knowledge_objects
           (id, organization_id, kind, name, scope, visibility, revision, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [
          input.id,
          input.organizationId,
          input.kind,
          input.name,
          input.scope,
          input.visibility,
          input.revision,
          input.updatedAt,
        ],
      ))
    )
      problem(409, 'This item has already been imported.');
    for (const recordId of new Set(input.recordIds))
      await client.query(
        'INSERT INTO omniboard.object_records (object_id, record_id) VALUES ($1, $2)',
        [input.id, recordId],
      );
    return true;
  });
  route('/api/import/knowledge-claims', claimImport, async (client, input) => {
    await checkEvidence(client, input.evidenceId, await objectVisibility(client, input.objectId));
    if (
      !(await insert(
        client,
        `INSERT INTO omniboard.knowledge_claims
           (id, object_id, field, value, scope, valid_from, valid_until, observed_on, recorded_at,
            status, evidence_id, source_record_id, revision, organization_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT (id) DO NOTHING`,
        [
          input.id,
          input.objectId,
          input.field,
          input.value,
          input.scope,
          input.validFrom || null,
          input.validUntil || null,
          input.observedOn || null,
          input.recordedAt,
          input.status,
          input.evidenceId,
          input.sourceRecordId || null,
          input.revision,
          input.organizationId,
        ],
      ))
    )
      problem(409, 'This item has already been imported.');
    return true;
  });
  route('/api/import/knowledge-relations', relationImport, async (client, input) => {
    const visibility = await objectVisibility(client, input.fromId);
    if ((await objectVisibility(client, input.toId)) !== visibility)
      problem(422, 'Connected objects must have the same access level.');
    await checkEvidence(client, input.evidenceId, visibility);
    if (
      !(await insert(
        client,
        `INSERT INTO omniboard.knowledge_relations
           (id, from_id, to_id, label, certainty, valid_from, valid_until, evidence_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [
          input.id,
          input.fromId,
          input.toId,
          input.label,
          input.certainty,
          input.validFrom || null,
          input.validUntil || null,
          input.evidenceId,
        ],
      ))
    )
      problem(409, 'This item has already been imported.');
    return true;
  });
  route('/api/import/identity-redirects', redirectImport, async (client, input) => {
    if (input.objectId === input.targetId) problem(422, 'An identity cannot redirect to itself.');
    if (
      await insert(
        client,
        `INSERT INTO omniboard.knowledge_identity_redirects (object_id, target_id) VALUES ($1, $2)
         ON CONFLICT (object_id) DO NOTHING`,
        [input.objectId, input.targetId],
      )
    )
      return true;
    const current = await client.query<{ target_id: string }>(
      'SELECT target_id FROM omniboard.knowledge_identity_redirects WHERE object_id = $1',
      [input.objectId],
    );
    if (current.rows[0]!.target_id !== input.targetId)
      problem(409, 'This identity already redirects to another identity.');
    return false;
  });
  route('/api/import/identity-events', identityEventImport, async (client, input) => {
    await checkEvidence(client, input.evidenceId, await objectVisibility(client, input.objectId));
    if (
      !(await insert(
        client,
        `INSERT INTO omniboard.knowledge_identity_events
           (id, object_id, other_id, record_id, kind, reason, evidence_id, author_id, created_at,
            reverses_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [
          input.id,
          input.objectId,
          input.otherId || null,
          input.recordId || null,
          input.kind,
          input.reason,
          input.evidenceId,
          input.authorId,
          input.createdAt,
          input.reversesId || null,
        ],
      ))
    )
      problem(409, 'This item has already been imported.');
    return true;
  });
  route('/api/import/operation-events', operationEventImport, async (client, input) => {
    if (
      !(await insert(
        client,
        `INSERT INTO omniboard.operation_events
           (import_id, organization_id, target_id, kind, title, payload, visibility, author_id,
            created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (import_id) DO NOTHING`,
        [
          input.importId,
          input.organizationId,
          input.targetId,
          input.kind,
          input.title,
          input.payload,
          input.visibility,
          input.authorId,
          input.createdAt,
        ],
      ))
    )
      problem(409, 'This item has already been imported.');
    return true;
  });
}
