import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Pool } from './db';
import { tx } from './db';
import { problem, type User } from './auth';
import { requireImport, requireRole } from './access';
import type { OrganizationDeps } from './organization-routes';
import { getOrganization } from './organizations';
import { moduleData } from './records';
import {
  integrationPlans,
  staleDaysSetting,
  verificationAlerts,
  verificationEvidence,
  type ReadOptions,
} from './connector-requests';
import { connectorBoard, leafDetail, venueBoard } from './connectors';
import { getTask, taskRows, transitionInput, transitionTask } from './work';
import { requestFileSchema } from '../shared/verification-contract';
import type { OrganizationWork } from '../shared/integration';
// 接入请求、Connector 看板与 Overview 工作摘要的接口(frontend-spec 4.8、10.4 第 11 项、11)。
// 全部只读,一键完成除外(editor 以上);导入只在导入窗口内由 admin 令牌调用。
const idParam = z.object({ id: z.string().min(1).max(200) });
const venueParam = z.object({ venue: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/) });
const leafParam = z.object({
  venue: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  featureKey: z.string().regex(/^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*$/),
});
const grafanaUrl = () => process.env.GRAFANA_URL || '';

/** 有任务的机构(没选机构时,工作台与看板只检查这些机构的请求告警,11.5)。 */
export async function organizationsWithTasks(pool: Pool, user: User) {
  return [...new Set((await taskRows(pool, user)).map((t) => t.organizationId))];
}

export function registerIntegrationRoutes(app: FastifyInstance, deps: OrganizationDeps) {
  const { pool, store } = deps;
  const options = (user: User): ReadOptions => ({
    admin: user.role === 'admin',
    now: new Date(deps.now()).toISOString(),
    staleDays: staleDaysSetting(),
  });

  app.get('/api/organizations/:id/integrations', async (request) => {
    const org = await getOrganization(pool, idParam.parse(request.params).id, request.user.role);
    return { requests: await integrationPlans(pool, org.id, options(request.user)) };
  });
  // 我方工作摘要(4.8):任务、接入与联系人的汇总;admin 记录的内容对其他角色不出现。
  app.get('/api/organizations/:id/work-summary', async (request): Promise<OrganizationWork> => {
    const org = await getOrganization(pool, idParam.parse(request.params).id, request.user.role);
    const role = request.user.role;
    const onboarding = await moduleData(pool, org, 'onboarding', role);
    return {
      organizationId: org.id,
      asOf: options(request.user).now,
      tasks: await taskRows(pool, request.user, org.id),
      onboarding,
      contacts: await moduleData(pool, org, 'contacts', role),
      compliance: await moduleData(pool, org, 'compliance', role),
      requests:
        onboarding.status === 'not_applicable' || onboarding.status === 'restricted'
          ? []
          : (await integrationPlans(pool, org.id, options(request.user))).map((plan) => ({
              id: plan.id,
              recordId: plan.recordId,
              state: plan.state,
              blockers: plan.blockers,
              awaiting: [...new Set(plan.leaves.flatMap((l) => l.awaiting.map((a) => a.resource)))],
              createdAt: plan.createdAt,
            })),
    };
  });

  app.get('/api/connectors', async (request) => {
    const read = options(request.user);
    const alerts = [];
    for (const orgId of await organizationsWithTasks(pool, request.user))
      alerts.push(
        ...(await verificationAlerts(pool, orgId, read)).filter((a) =>
          ['request', 'connector'].includes(a.kind),
        ),
      );
    return { ...(await connectorBoard(pool, read)), grafanaUrl: grafanaUrl(), alerts };
  });
  app.get('/api/connectors/:venue', async (request) => {
    const parsed = venueParam.safeParse(request.params);
    const board = parsed.success
      ? await venueBoard(pool, parsed.data.venue, options(request.user))
      : undefined;
    return board ? { ...board, grafanaUrl: grafanaUrl() } : problem(404, 'Connector not found.');
  });
  app.get('/api/connectors/:venue/leaves/:featureKey', async (request) => {
    const parsed = leafParam.safeParse(request.params);
    const detail = parsed.success
      ? await leafDetail(pool, parsed.data.venue, parsed.data.featureKey, options(request.user))
      : undefined;
    return detail ?? problem(404, 'Leaf not found.');
  });

  // 标准 validation 任务的验证证据与一键完成(10.4 第 11 项)。
  app.get('/api/work/tasks/:id/verification', async (request) => {
    const task = await getTask(pool, request.user, idParam.parse(request.params).id);
    return {
      taskId: task.id,
      attempts: await verificationEvidence(
        pool,
        task.organizationId,
        request.user.role === 'admin',
      ),
    };
  });
  app.post('/api/work/tasks/:id/verification-complete', async (request) => {
    requireRole(request, 'editor');
    const input = z
      .object({ revision: z.number().int().positive(), runId: z.string().min(1).max(64) })
      .strict()
      .parse(request.body);
    const task = await getTask(pool, request.user, idParam.parse(request.params).id);
    if (task.templateKey !== 'validation')
      problem(422, 'Only the standard validation task is completed with a verification run.');
    const attempt =
      (await verificationEvidence(pool, task.organizationId, request.user.role === 'admin')).find(
        (a) => a.runId === input.runId,
      ) ??
      problem(404, 'No passed verification run with this id is attached to this organization.');
    return transitionTask(
      pool,
      store,
      request.user,
      task.id,
      transitionInput.parse({
        revision: input.revision,
        state: 'done',
        outcome: `Verification passed: ${attempt.venueKey} ${attempt.suite} (run ${attempt.runId}, ${attempt.passedCount} passed, ${attempt.skippedCount} skipped, observed ${attempt.finishedAt}).`,
        environment: `${attempt.environment} · ${attempt.accountName} (${attempt.accountKind})`,
        codeRevision: attempt.buildRevision + (attempt.buildDirty ? ' (dirty)' : ''),
        rawText: JSON.stringify({ schema_version: 1, source: 'quant_pg', attempt }, null, 2),
        sourceRecordId: attempt.requestRecordId,
        claim: true,
      }),
    );
  });

  // 迁移导入 v1 integration_jobs(proposal §9):request_id 原样保留(已写进 verification.live_test_*)。
  const requestImport = z
    .object({
      requestId: z.uuid(),
      organizationId: z.string().min(1).max(200),
      recordId: z.string().min(1).max(200),
      recordRevision: z.number().int().positive(),
      action: z.enum(['validate_readonly', 'prepare_config', 'propose_adapter_change']),
      declaredRevision: z.string().max(200).default(''),
      request: requestFileSchema,
      createdAt: z.iso.datetime({ offset: true }),
    })
    .strict();
  app.post('/api/import/connector-requests', async (request, reply) => {
    const input = requestImport.parse(request.body);
    await requireImport(pool, request);
    if (input.request.request_id.toLowerCase() !== input.requestId.toLowerCase())
      problem(422, 'The request JSON must carry the same request_id.');
    const created = await tx(pool, async (client) => {
      const record = (
        await client.query<{ organization_id: string }>(
          'SELECT organization_id FROM omniboard.module_records WHERE id = $1',
          [input.recordId],
        )
      ).rows[0];
      if (!record) problem(422, 'A referenced item has not been imported yet.');
      if (record.organization_id !== input.organizationId)
        problem(422, 'The record belongs to another organization.');
      try {
        return (
          await client.query(
            `INSERT INTO omniboard.connector_request
               (request_id, organization_id, record_id, record_revision, action, declared_revision,
                request, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
            [
              input.requestId.toLowerCase(),
              input.organizationId,
              input.recordId,
              input.recordRevision,
              input.action,
              input.declaredRevision || null,
              { ...input.request, request_id: input.requestId.toLowerCase() },
              input.createdAt,
            ],
          )
        ).rowCount;
      } catch (error) {
        if ((error as { code?: string }).code === '23503')
          problem(422, 'A referenced item has not been imported yet.');
        throw error;
      }
    });
    if (!created) problem(409, 'This item has already been imported.');
    return reply.code(201).send({ ok: true });
  });
}
