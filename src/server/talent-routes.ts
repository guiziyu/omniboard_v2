import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Client } from './db';
import { tx } from './db';
import { problem } from './auth';
import { requireImport, requireRole } from './access';
import type { OrganizationDeps } from './organization-routes';
import { checkEvidence } from './records';
import { insert, objectVisibility } from './knowledge-import';
import { talentDirectory, talentPerson } from './talent';
import {
  decideDuplicate,
  duplicateDecisionInput,
  importPersonProfile,
  sourceProfile,
} from './person-profiles';
import { positionDrivers, savePositionDriver } from './position-drivers';
import { careerPositionSchema, personSourceKey } from '../shared/person-profile';
import { positionDriverDataSchema, positionDriverInputSchema } from '../shared/position-drivers';
import type { Visibility } from '../shared/types';
// 人才目录、个人履历、疑似重复与岗位目标与激励的接口(frontend-spec 6.9–6.16)。
// 读取任何角色可用,写入要 editor 以上;admin 范围由各自的服务端规则再检查。

const idParam = z.object({ id: z.string().min(1).max(200) });
const positionParams = z.object({
  id: z.string().min(1).max(200),
  positionId: z.string().min(1).max(200),
});

// ---- 迁移导入(data-model §3.4;只在导入窗口内由 admin 令牌调用,以 id 为键,已存在 → 409) ----
const key = z.string().min(1).max(200);
const at = z.iso.datetime({ offset: true });
const profileImport = z
  .object({
    id: key,
    objectId: key,
    url: z.string().min(1).max(2000),
    visibility: z.enum(['team', 'admin']),
    revision: z.number().int().positive(),
    updatedAt: at,
    captures: z
      .array(
        z
          .object({
            id: key,
            evidenceId: key,
            payload: z.record(z.string(), z.unknown()),
            fingerprint: z.string().min(1).max(200),
            observedOn: z.iso.date(),
            authorId: key,
            createdAt: at,
          })
          .strict(),
      )
      .min(1)
      .max(1000),
    positions: z
      .array(
        z
          .object({
            id: key,
            data: careerPositionSchema,
            evidenceId: key,
            updatedAt: at,
            startRecordId: z.union([key, z.literal('')]).default(''),
            endRecordId: z.union([key, z.literal('')]).default(''),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
const duplicateImport = z
  .object({
    leftId: key,
    rightId: key,
    decision: z.enum(['different', 'later']),
    reason: z.string().trim().min(1).max(4000),
    evidenceId: key,
    authorId: key,
    createdAt: at,
  })
  .strict();
const driverImport = z
  .object({
    id: key,
    positionId: key,
    data: positionDriverDataSchema,
    visibility: z.enum(['team', 'admin']),
    evidenceId: key,
    attachmentEvidenceId: z.union([key, z.literal('')]).default(''),
    revision: z.number().int().positive(),
    authorId: key,
    createdAt: at,
    updatedAt: at,
  })
  .strict();
const already = 'This item has already been imported.';
const missing = 'A referenced item has not been imported yet.';

/** 生成的变动记录先经记录导入写入(带 `structured.personProfileId`),这里只接回归属。 */
async function importProfile(client: Client, input: z.infer<typeof profileImport>) {
  let source: ReturnType<typeof personSourceKey>;
  try {
    source = personSourceKey(input.url);
  } catch (error) {
    problem(422, (error as Error).message);
  }
  if ((await objectVisibility(client, input.objectId)) !== input.visibility)
    problem(422, 'Choose a person with the same access level.');
  const kind = await client.query<{ kind: string }>(
    'SELECT kind FROM omniboard.knowledge_objects WHERE id = $1',
    [input.objectId],
  );
  if (kind.rows[0]?.kind !== 'person') problem(422, 'Choose a person with the same access level.');
  if (
    !(await insert(
      client,
      `INSERT INTO omniboard.person_source_profiles
         (id, object_id, provider, external_key, url, visibility, revision, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
      [
        input.id,
        input.objectId,
        source.provider,
        source.key,
        source.url,
        input.visibility,
        input.revision,
        input.updatedAt,
      ],
    ))
  )
    problem(409, already);
  // 采集按导入顺序(旧在前)得到 seq,与 v1 的 rowid 顺序一致。
  for (const c of input.captures) {
    await checkEvidence(client, c.evidenceId, input.visibility);
    await insert(
      client,
      `INSERT INTO omniboard.person_profile_captures
         (id, profile_id, evidence_id, payload, fingerprint, observed_on, author_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        c.id,
        input.id,
        c.evidenceId,
        c.payload,
        c.fingerprint,
        c.observedOn,
        c.authorId,
        c.createdAt,
      ],
    );
  }
  for (const p of input.positions) {
    await checkEvidence(client, p.evidenceId, input.visibility);
    await insert(
      client,
      `INSERT INTO omniboard.person_profile_positions
         (id, profile_id, source_key, data, evidence_id, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [p.id, input.id, p.data.key, p.data, p.evidenceId, p.updatedAt],
    );
    for (const [kind, recordId] of [
      ['start', p.startRecordId],
      ['end', p.endRecordId],
    ] as const) {
      if (!recordId) continue;
      const record = (
        await client.query<{
          tab_id: string;
          visibility: Visibility;
          structured: Record<string, string>;
        }>('SELECT tab_id, visibility, structured FROM omniboard.module_records WHERE id = $1', [
          recordId,
        ])
      ).rows[0];
      if (!record) problem(422, missing);
      if (
        record.tab_id !== 'people_movements' ||
        record.visibility !== input.visibility ||
        record.structured.careerPositionId !== p.id
      )
        problem(422, 'The generated movement does not belong to this career entry.');
      await insert(
        client,
        'INSERT INTO omniboard.person_profile_records (position_id, kind, record_id) VALUES ($1,$2,$3)',
        [p.id, kind, recordId],
      );
    }
  }
  return true;
}

export function registerTalentRoutes(app: FastifyInstance, deps: OrganizationDeps) {
  const { pool } = deps;
  const today = () => new Date(deps.now()).toISOString().slice(0, 10);

  app.get('/api/talent', async (request) => talentDirectory(pool, request.user, request.query));
  app.get('/api/talent/:id', async (request) =>
    talentPerson(pool, request.user, idParam.parse(request.params).id),
  );
  app.post('/api/talent/source-profiles', async (request, reply) => {
    requireRole(request, 'editor');
    const saved = await importPersonProfile(pool, request.user, request.body, today());
    return reply.code(201).send(saved);
  });
  app.get('/api/talent/source-profiles/:id', async (request) =>
    sourceProfile(pool, request.user, idParam.parse(request.params).id),
  );
  app.post('/api/talent/people/:id/duplicate-decision', async (request) => {
    requireRole(request, 'editor');
    const input = duplicateDecisionInput.parse(request.body);
    return decideDuplicate(pool, request.user, idParam.parse(request.params).id, input);
  });

  const drivers = '/api/organizations/:id/positions/:positionId/drivers';
  app.get(drivers, async (request) => {
    const params = positionParams.parse(request.params);
    return positionDrivers(pool, request.user, params.id, params.positionId);
  });
  app.post(drivers, async (request, reply) => {
    requireRole(request, 'editor');
    const params = positionParams.parse(request.params);
    const input = positionDriverInputSchema.parse(request.body);
    const saved = await savePositionDriver(
      pool,
      request.user,
      params.id,
      params.positionId,
      undefined,
      input,
    );
    return reply.code(201).send(saved);
  });
  app.patch(drivers + '/:driverId', async (request) => {
    requireRole(request, 'editor');
    const params = positionParams
      .extend({ driverId: z.string().min(1).max(200) })
      .parse(request.params);
    const input = positionDriverInputSchema.parse(request.body);
    return savePositionDriver(
      pool,
      request.user,
      params.id,
      params.positionId,
      params.driverId,
      input,
    );
  });

  const route = <T extends z.ZodType>(
    path: string,
    schema: T,
    write: (client: Client, input: z.infer<T>) => Promise<boolean>,
  ) =>
    app.post(path, async (request, reply) => {
      const input = schema.parse(request.body);
      await requireImport(pool, request);
      await tx(pool, (client) => write(client, input));
      return reply.code(201).send({ ok: true });
    });
  route('/api/import/person-profiles', profileImport, importProfile);
  route('/api/import/person-duplicate-decisions', duplicateImport, async (client, input) => {
    if (!(input.leftId < input.rightId))
      problem(422, 'Order the pair so that leftId sorts before rightId.');
    const visibility = await objectVisibility(client, input.leftId);
    if ((await objectVisibility(client, input.rightId)) !== visibility)
      problem(422, 'Choose two separate people with the same access level.');
    await checkEvidence(client, input.evidenceId, visibility);
    if (
      !(await insert(
        client,
        `INSERT INTO omniboard.person_duplicate_decisions
           (left_id, right_id, decision, reason, evidence_id, author_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [
          input.leftId,
          input.rightId,
          input.decision,
          input.reason,
          input.evidenceId,
          input.authorId,
          input.createdAt,
        ],
      ))
    )
      problem(409, already);
    return true;
  });
  route('/api/import/position-drivers', driverImport, async (client, input) => {
    const position = (
      await client.query<{ tab_id: string; visibility: Visibility }>(
        'SELECT tab_id, visibility FROM omniboard.module_records WHERE id = $1',
        [input.positionId],
      )
    ).rows[0];
    if (!position) problem(422, missing);
    if (position.tab_id !== 'org_chart') problem(422, 'Position insights belong to Org Chart.');
    if (position.visibility === 'admin' && input.visibility !== 'admin')
      problem(422, 'Restricted evidence requires an administrator-only item.');
    await checkEvidence(client, input.evidenceId, input.visibility);
    if (input.attachmentEvidenceId)
      await checkEvidence(client, input.attachmentEvidenceId, input.visibility);
    if (
      !(await insert(
        client,
        `INSERT INTO omniboard.position_drivers
           (id, position_id, data, visibility, evidence_id, attachment_evidence_id, revision,
            author_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [
          input.id,
          input.positionId,
          input.data,
          input.visibility,
          input.evidenceId,
          input.attachmentEvidenceId || null,
          input.revision,
          input.authorId,
          input.createdAt,
          input.updatedAt,
        ],
      ))
    )
      problem(409, already);
    return true;
  });
}
