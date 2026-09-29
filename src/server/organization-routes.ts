import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { problem } from './auth';
import type { Pool } from './db';
import { tx } from './db';
import { importedTime, requireImport, requireRole } from './access';
import {
  assertCanRead,
  evidencePreview,
  getEvidence,
  saveEvidence,
  type EvidenceStore,
} from './evidence';
import {
  canonicalId,
  createOrganization,
  directory,
  getOrganization,
  importOrganizationAlias,
  linkSource,
  logoEvidence,
  metricInput,
  metricPoints,
  organizationAliasInput,
  organizationCount,
  organizationInput,
  recordMetric,
  setLogo,
  sourceMatches,
} from './organizations';
import {
  importFields,
  importRecordAlias,
  knownTab,
  moduleData,
  moveRelationship,
  observations,
  recordAliasInput,
  recordHistory,
  recordInput,
  relationshipInput,
  saveRecord,
} from './records';
import { getOrganizationProfile, saveOrganizationProfile } from './profiles';
import { tabsFor } from '../shared/registry';
// 机构目录、机构、记录、指标观测与证据的接口(frontend-spec 2.6、3、5、6.2、9.2–9.3)。
export type OrganizationDeps = { pool: Pool; store: EvidenceStore; now: () => number };
const idParam = z.object({ id: z.string().min(1).max(100) });
/** 原件以附件或图片返回:禁止脚本,SVG 里的脚本也不执行。 */
function sendOriginal(reply: FastifyReply, bytes: Buffer, contentType: string) {
  return reply
    .header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox")
    .type(contentType)
    .send(bytes);
}
export function registerOrganizationRoutes(app: FastifyInstance, deps: OrganizationDeps) {
  const { pool, store } = deps;

  // 侧栏机构总数,排除别名机构(frontend-spec 2.3)。
  app.get('/api/summary', async () => ({ organizations: await organizationCount(pool) }));

  app.get('/api/organizations', async (request) =>
    directory(pool, request.user.role, request.query, deps.now()),
  );
  app.post('/api/organizations', async (request, reply) => {
    requireRole(request, 'editor');
    const { createdAt, ...input } = organizationInput.parse(request.body);
    const created = await createOrganization(
      pool,
      request.user,
      input,
      await importedTime(pool, request, createdAt),
    );
    return reply.code(201).send(created);
  });
  // 详情(frontend-spec 4.1):别名解析到规范机构;附最近一次采集的来源与可读的档案条目。
  app.get('/api/organizations/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    const org = await getOrganization(pool, id, request.user.role);
    return {
      organization: {
        ...org,
        sources: await observations(pool, org.id),
        profile: await getOrganizationProfile(pool, org.id, request.user.role),
      },
      tabs: tabsFor(org.tags),
    };
  });
  // 样本历史(4.9):所有成功采集批次,最多 200 行。
  app.get('/api/organizations/:id/observations', async (request) => {
    const org = await getOrganization(pool, idParam.parse(request.params).id, request.user.role);
    return { observations: await observations(pool, org.id, true) };
  });
  const tabParam = z.object({ id: z.string().min(1).max(100), tab: z.string().min(1).max(40) });
  app.get('/api/organizations/:id/tabs/:tab', async (request) => {
    const { id, tab } = tabParam.parse(request.params);
    if (!knownTab(tab)) problem(404, 'Module not found.');
    const org = await getOrganization(pool, id, request.user.role);
    return moduleData(pool, org, tab, request.user.role);
  });
  const recordParam = tabParam.extend({ recordId: z.string().min(1).max(100).optional() });
  for (const method of ['POST', 'PATCH'] as const)
    app.route({
      method,
      url: `/api/organizations/:id/tabs/:tab/records${method === 'PATCH' ? '/:recordId' : ''}`,
      bodyLimit: 8_000_000,
      handler: async (request, reply) => {
        requireRole(request, 'editor');
        const { id, tab, recordId } = recordParam.parse(request.params);
        const input = recordInput.parse(request.body);
        if (importFields.some((field) => input[field] !== undefined))
          await requireImport(pool, request);
        const org = await getOrganization(pool, id, request.user.role);
        const saved = await saveRecord(pool, store, request.user, org, tab, recordId, input);
        return reply
          .code(saved.created ? 201 : 200)
          .send({ id: saved.id, revision: saved.revision });
      },
    });
  // 调整汇报关系(6.2):拖拽、键盘与侧栏都走这里。
  const positionParam = z.object({
    id: z.string().min(1).max(100),
    recordId: z.string().min(1).max(100),
  });
  app.patch('/api/organizations/:id/org-chart/:recordId/relationship', async (request) => {
    requireRole(request, 'editor');
    const { id, recordId } = positionParam.parse(request.params);
    const input = relationshipInput.parse(request.body);
    const org = await getOrganization(pool, id, request.user.role);
    return moveRelationship(pool, store, request.user, org.id, recordId, input);
  });
  // 合并关系的迁移导入(data-model §3.2、§3.3):只在导入窗口内由 admin 令牌写入。
  app.post('/api/import/organization-aliases', async (request, reply) => {
    const input = organizationAliasInput.parse(request.body);
    await requireImport(pool, request);
    return reply.code((await importOrganizationAlias(pool, input)) ? 201 : 200).send({ ok: true });
  });
  app.post('/api/import/record-aliases', async (request, reply) => {
    const input = recordAliasInput.parse(request.body);
    await requireImport(pool, request);
    return reply.code((await importRecordAlias(pool, input)) ? 201 : 200).send({ ok: true });
  });
  app.get('/api/records/:id/history', async (request) => ({
    history: await recordHistory(pool, idParam.parse(request.params).id, request.user.role),
  }));
  // 档案只经导入写入(4.7);带 revision 乐观并发。
  const profileInput = z
    .object({ profile: z.unknown(), revision: z.number().int().min(0) })
    .strict();
  app.put('/api/organizations/:id/profile', async (request) => {
    requireRole(request, 'editor');
    const { profile, revision } = profileInput.parse(request.body);
    const org = await getOrganization(pool, idParam.parse(request.params).id, request.user.role);
    return {
      profile:
        (await saveOrganizationProfile(pool, request.user, org.id, profile, revision)) ?? null,
    };
  });

  app.get('/api/organizations/:id/logo', async (request, reply) => {
    const logo = await logoEvidence(
      pool,
      await canonicalId(pool, idParam.parse(request.params).id),
    );
    reply.header('Cache-Control', 'private, max-age=86400');
    return sendOriginal(reply, await store.get(logo.sha256), logo.content_type);
  });
  const logoInput = z
    .object({
      logoEvidenceId: z.string().min(1).max(100),
      sourceUrl: z.string().max(2000),
      evidenceId: z.string().min(1).max(100).optional(),
    })
    .strict();
  app.put('/api/organizations/:id/logo', async (request) => {
    requireRole(request, 'editor');
    await setLogo(pool, idParam.parse(request.params).id, logoInput.parse(request.body));
    return { ok: true };
  });

  const pointsQuery = z.object({ column: z.string().max(40).optional() }).strict();
  app.get('/api/organizations/:id/metrics', async (request) => {
    const organizationId = await canonicalId(pool, idParam.parse(request.params).id);
    const { column } = pointsQuery.parse(request.query);
    return {
      points: await metricPoints(pool, [organizationId], column),
      candidates: await sourceMatches(pool, organizationId),
    };
  });
  app.post('/api/organizations/:id/metrics', async (request, reply) => {
    requireRole(request, 'editor');
    const { capturedAt, ...input } = metricInput.parse(request.body);
    const result = await recordMetric(
      pool,
      store,
      request.user,
      idParam.parse(request.params).id,
      input,
      await importedTime(pool, request, capturedAt),
    );
    return reply.code(201).send(result);
  });

  const mappingInput = z.object({ organizationId: z.string().min(1).max(100) }).strict();
  app.patch('/api/sources/mappings/:id', async (request) => {
    requireRole(request, 'admin');
    const { organizationId } = mappingInput.parse(request.body);
    const org = await getOrganization(pool, organizationId, request.user.role);
    await linkSource(pool, request.user, idParam.parse(request.params).id, org.id);
    return { ok: true };
  });

  // 上传原件(迁移导入、附件):声明的 sha256 必须与内容一致(proposal §9)。
  const evidenceInput = z
    .object({
      id: z.string().trim().min(1).max(100).optional(),
      source: z.string().trim().min(1).max(40),
      url: z.string().max(2000).default(''),
      contentType: z.string().min(1).max(200),
      filename: z.string().trim().min(1).max(255).optional(),
      parserVersion: z.string().trim().min(1).max(80).optional(),
      visibility: z.enum(['team', 'admin']).default('team'),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      contentBase64: z.base64().max(40_000_000),
      capturedAt: z.iso.datetime({ offset: true }).optional(),
    })
    .strict();
  app.post('/api/evidence', { bodyLimit: 41_000_000 }, async (request, reply) => {
    requireRole(request, 'editor');
    const { id, capturedAt, sha256, contentBase64, ...info } = evidenceInput.parse(request.body);
    if (info.visibility === 'admin') requireRole(request, 'admin');
    const at = await importedTime(pool, request, capturedAt);
    const evidenceId = await tx(pool, (client) =>
      saveEvidence(client, store, Buffer.from(contentBase64, 'base64'), info, {
        id,
        sha256,
        capturedAt: at,
      }),
    );
    return reply.code(201).send({ id: evidenceId });
  });
  app.get('/api/evidence/:id', async (request) => {
    const evidence = await getEvidence(pool, idParam.parse(request.params).id);
    assertCanRead(evidence, request.user.role);
    return evidencePreview(store, evidence);
  });
  app.get('/api/evidence/:id/download', async (request, reply) => {
    const evidence = await getEvidence(pool, idParam.parse(request.params).id);
    assertCanRead(evidence, request.user.role);
    reply.header(
      'Content-Disposition',
      `attachment; filename="reference"; filename*=UTF-8''${encodeURIComponent(evidence.filename)}`,
    );
    return sendOriginal(reply, await store.get(evidence.sha256), 'application/octet-stream');
  });
}
