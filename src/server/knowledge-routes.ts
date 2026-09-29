import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from './access';
import type { OrganizationDeps } from './organization-routes';
import { getOrganization } from './organizations';
import {
  acceptClaim,
  acceptInput,
  addClaim,
  addRelation,
  claimInput,
  createObject,
  exploration,
  objectRows,
  identityHistory,
  identitySearch,
  linkIdentityRecord,
  linkInput,
  mergeIdentities,
  mergeInput,
  objectInput,
  relationInput,
  searchInput,
  undoInput,
  undoMerge,
  unlinkInput,
  unlinkRecord,
} from './knowledge';
import { registerKnowledgeImport } from './knowledge-import';
// 关系与证据的接口(frontend-spec 7)。读取任何角色可用,写入要 editor 以上。
const idParam = z.object({ id: z.string().min(1).max(200) });
export function registerKnowledgeRoutes(app: FastifyInstance, deps: OrganizationDeps) {
  const { pool, store } = deps;
  const today = () => new Date(deps.now()).toISOString().slice(0, 10);

  app.get('/api/organizations/:id/exploration', async (request) => {
    const org = await getOrganization(pool, idParam.parse(request.params).id, request.user.role);
    return exploration(pool, org, request.user, today());
  });
  // 记录详情的「关联对象」与联系人合并卡片(5.2、5.3)。
  app.get('/api/organizations/:id/objects', async (request) => {
    const org = await getOrganization(pool, idParam.parse(request.params).id, request.user.role);
    return { objects: await objectRows(pool, request.user, org.id) };
  });
  app.post('/api/organizations/:id/knowledge/objects', async (request, reply) => {
    requireRole(request, 'editor');
    const input = objectInput.parse(request.body);
    const org = await getOrganization(pool, idParam.parse(request.params).id, request.user.role);
    return reply.code(201).send(await createObject(pool, request.user, org.id, input));
  });
  app.post('/api/knowledge/objects/:id/records', async (request) => {
    requireRole(request, 'editor');
    const input = linkInput.parse(request.body);
    return linkIdentityRecord(pool, store, request.user, idParam.parse(request.params).id, input);
  });
  app.post('/api/knowledge/objects/:id/claims', async (request, reply) => {
    requireRole(request, 'editor');
    const input = claimInput.parse(request.body);
    const saved = await addClaim(
      pool,
      store,
      request.user,
      idParam.parse(request.params).id,
      input,
      today(),
    );
    return reply.code(201).send(saved);
  });
  app.post('/api/knowledge/claims/:id/accept', async (request) => {
    requireRole(request, 'editor');
    const input = acceptInput.parse(request.body);
    return acceptClaim(pool, request.user, idParam.parse(request.params).id, input, today());
  });
  app.post('/api/knowledge/relations', async (request, reply) => {
    requireRole(request, 'editor');
    const input = relationInput.parse(request.body);
    return reply.code(201).send(await addRelation(pool, store, request.user, input));
  });
  app.get('/api/knowledge/identities', async (request) =>
    identitySearch(pool, request.user, searchInput.parse(request.query)),
  );
  app.get('/api/knowledge/identities/:id', async (request) =>
    identityHistory(pool, request.user, idParam.parse(request.params).id),
  );
  app.post('/api/knowledge/identities/:id/merge', async (request) => {
    requireRole(request, 'editor');
    const input = mergeInput.parse(request.body);
    return mergeIdentities(pool, store, request.user, idParam.parse(request.params).id, input);
  });
  app.post('/api/knowledge/identities/:id/undo', async (request) => {
    requireRole(request, 'editor');
    const input = undoInput.parse(request.body);
    return undoMerge(pool, store, request.user, idParam.parse(request.params).id, input);
  });
  app.post('/api/knowledge/identities/:id/unlink', async (request) => {
    requireRole(request, 'editor');
    const input = unlinkInput.parse(request.body);
    return unlinkRecord(pool, store, request.user, idParam.parse(request.params).id, input);
  });
  registerKnowledgeImport(app, pool);
}
