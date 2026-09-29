import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './access';
import type { OrganizationDeps } from './organization-routes';
import { staleDaysSetting, verificationAlerts } from './connector-requests';
import { getOrganization } from './organizations';
import {
  createTask,
  planInput,
  progressInput,
  recordTaskProgress,
  startInput,
  startOnboarding,
  taskHistory,
  taskInput,
  transitionInput,
  transitionTask,
  updateTaskPlan,
  workFeed,
} from './work';
// 工作台接口(frontend-spec 10)。读取任何角色可用,写入要 editor 以上(reader 写入在 app.ts 统一拒绝)。
const idParam = z.object({ id: z.string().min(1).max(200) });
const feedQuery = z.object({ organizationId: z.string().max(200).default('') });
export function registerWorkRoutes(app: FastifyInstance, deps: OrganizationDeps) {
  const { pool, store } = deps;
  const today = () => new Date(deps.now()).toISOString().slice(0, 10);

  app.get('/api/work', async (request) => {
    const requested = feedQuery.parse(request.query).organizationId;
    const orgId = requested ? (await getOrganization(pool, requested, request.user.role)).id : '';
    const feed = await workFeed(pool, request.user, orgId, today());
    // 接入请求失败与验证过期的告警(11.5):选了机构只看它,否则只看有任务的机构。
    const read = {
      admin: request.user.role === 'admin',
      now: new Date(deps.now()).toISOString(),
      staleDays: staleDaysSetting(),
    };
    const scoped = orgId ? [orgId] : [...new Set(feed.tasks.map((t) => t.organizationId))];
    for (const scope of scoped) feed.alerts.push(...(await verificationAlerts(pool, scope, read)));
    return feed;
  });
  app.post('/api/organizations/:id/work/start', async (request, reply) => {
    requireRole(request, 'editor');
    const input = startInput.parse(request.body ?? {});
    const result = await startOnboarding(
      pool,
      store,
      request.user,
      idParam.parse(request.params).id,
      input,
    );
    return reply.code(result.created ? 201 : 200).send(result);
  });
  app.post('/api/organizations/:id/work/tasks', async (request, reply) => {
    requireRole(request, 'editor');
    const input = taskInput.parse(request.body);
    const created = await createTask(
      pool,
      store,
      request.user,
      idParam.parse(request.params).id,
      input,
    );
    return reply.code(201).send(created);
  });
  app.patch('/api/work/tasks/:id', async (request) => {
    requireRole(request, 'editor');
    const input = planInput.parse(request.body);
    return updateTaskPlan(pool, store, request.user, idParam.parse(request.params).id, input);
  });
  app.post('/api/work/tasks/:id/actions', async (request) => {
    requireRole(request, 'editor');
    const input = transitionInput.parse(request.body);
    return transitionTask(pool, store, request.user, idParam.parse(request.params).id, input);
  });
  app.post('/api/work/tasks/:id/updates', async (request) => {
    requireRole(request, 'editor');
    const input = progressInput.parse(request.body);
    return recordTaskProgress(pool, store, request.user, idParam.parse(request.params).id, input);
  });
  app.get('/api/work/tasks/:id/history', async (request) =>
    taskHistory(pool, request.user, idParam.parse(request.params).id),
  );
}
