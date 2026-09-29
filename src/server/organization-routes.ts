import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { Pool } from './db';
import { tx } from './db';
import { importedTime, requireRole } from './access';
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
  logoEvidence,
  metricInput,
  metricPoints,
  organizationCount,
  organizationInput,
  recordMetric,
  setLogo,
} from './organizations';
// 机构目录、机构、指标观测与证据的接口(frontend-spec 2.6、3、5.10、9.2–9.3)。
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
  app.get('/api/organizations/:id', async (request) => {
    const { id } = idParam.parse(request.params);
    return { organization: await getOrganization(pool, id, request.user.role) };
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
    return { points: await metricPoints(pool, [organizationId], column) };
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
