import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './access';
import type { OrganizationDeps } from './organization-routes';
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

  app.get('/api/work', async (request) =>
    workFeed(pool, request.user, feedQuery.parse(request.query).organizationId, today()),
  );
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
