import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapAdmin } from '../src/server/auth';
import {
  claimGroups,
  explorationModel,
  explorationNeighborhood,
} from '../src/shared/exploration-model';
import type { ExplorationGraph } from '../src/shared/exploration';
import type { KnowledgeObject } from '../src/shared/operations';
import { harness, tokenOf } from './helpers';
// 共享对象、结论、关系与跨机构身份(frontend-spec 7.4、7.10–7.14)。
// v1 tests/exploration(第二个)、operations(objects share source records)、identities 的断言逐条保留;
// 任务相关的断言(任务引用随身份合并与撤销改变)随工作台(§10)迁移。v1 的 knowledge 接口并入 exploration。
// 单 workspace 之后「其他 workspace 的对象」不再存在,那条断言去掉。

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const h = await harness();
  t.after(h.close);
  const owner = await h.activate(
    (await bootstrapAdmin(h.ctx, { name: 'Owner', email: 'owner@example.test' })).token,
  );
  const sessions: Record<string, string> = { admin: owner.cookie };
  for (const role of ['editor', 'reader']) {
    h.tick();
    const invited = await h.request(
      'POST',
      '/api/members',
      { cookie: owner.cookie },
      { name: role, email: `${role}@example.test`, role },
    );
    sessions[role] = (await h.activate(tokenOf(invited.json().inviteLink))).cookie;
  }
  const call = (method: 'GET' | 'POST', url: string, body?: unknown, role = 'editor') =>
    h.request(method, url, { cookie: sessions[role]! }, body);
  const org = async (name: string) =>
    (await call('POST', '/api/organizations', { name, tags: ['exchange'] })).json().id as string;
  const sql = (text: string, values: unknown[] = []) => h.ctx.pool.query(text, values);
  /** 组织架构图里的一条人员记录;dossier=false 时去掉自动档案(v1 用例直接插入记录,没有档案)。 */
  async function position(
    orgId: string,
    name = 'Morgan Fixture',
    visibility = 'team',
    options: { reportsTo?: string; dossier?: boolean } = {},
  ) {
    const response = await call(
      'POST',
      `/api/organizations/${orgId}/tabs/org_chart/records`,
      {
        title: 'Fixture role',
        body: 'Exact fixture body',
        scope: 'Fixture scope',
        status: 'unverified',
        visibility,
        personName: name,
        reportsTo: options.reportsTo ?? '',
        rawText: `Exact fixture profile for ${name} at ${orgId}`,
      },
      'admin',
    );
    assert.equal(response.statusCode, 201, response.body);
    const recordId = response.json().id as string;
    if (options.dossier === false) {
      await sql('DELETE FROM omniboard.object_records WHERE object_id = $1', [
        `person-record:${recordId}`,
      ]);
      await sql('DELETE FROM omniboard.knowledge_objects WHERE id = $1', [
        `person-record:${recordId}`,
      ]);
    }
    return recordId;
  }
  /** 没有姓名的一条来源记录(讨论 tab 不需要结构化字段)。 */
  async function source(orgId: string, visibility = 'team') {
    const response = await call(
      'POST',
      `/api/organizations/${orgId}/tabs/comments/records`,
      {
        title: 'Fixture source',
        body: 'Synthetic fixture note',
        scope: 'Organization-wide',
        status: 'unverified',
        visibility,
        rawText: 'Synthetic fixture evidence',
      },
      'admin',
    );
    assert.equal(response.statusCode, 201, response.body);
    return response.json().id as string;
  }
  const graph = async (orgId: string, role = 'editor') =>
    (
      await call('GET', `/api/organizations/${orgId}/exploration`, undefined, role)
    ).json<ExplorationGraph>();
  const detail = async (objectId: string) =>
    (await call('GET', `/api/knowledge/identities/${objectId}`)).json() as {
      object: KnowledgeObject;
      history: { id: string; kind: string; evidenceId: string; canUndo: boolean }[];
    };
  return { h, call, sql, sessions, org, position, source, graph, detail };
}

test('person dossiers: named records get one independent person object; imports do not', async (t) => {
  const { sql, org, position, source } = await setup(t);
  const a = await org('Dossier organization');
  const first = await position(a, 'Same Name');
  const second = await position(a, 'Same Name');
  const unnamed = await source(a);
  const objects = await sql(
    `SELECT k.id, k.name, k.scope, x.record_id FROM omniboard.knowledge_objects k
       JOIN omniboard.object_records x ON x.object_id = k.id ORDER BY k.id`,
  );
  assert.deepEqual(
    objects.rows.map((r) => [r.id, r.name, r.scope, r.record_id]).sort(),
    [
      [`person-record:${first}`, 'Same Name', 'Personnel dossier', first],
      [`person-record:${second}`, 'Same Name', 'Personnel dossier', second],
    ].sort(),
    'records with the same name stay separate; unnamed records get no dossier',
  );
  assert.ok(!objects.rows.some((r) => r.record_id === unnamed));
});

test('existing records form an evidence-backed graph without writes or hidden-data leakage', async (t) => {
  const { call, sql, org, position, graph } = await setup(t);
  const a = await org('Graph fixture');
  const manager = await position(a, 'Fixture manager', 'team', { dossier: false });
  const person = await position(a, 'Fixture person', 'team', {
    reportsTo: manager,
    dossier: false,
  });
  const duplicate = await position(a, 'Fixture person', 'team', { dossier: false });
  const secret = await position(a, 'Restricted fixture', 'admin', { dossier: false });
  const count = async (table: string) =>
    Number((await sql(`SELECT count(*) AS n FROM omniboard.${table}`)).rows[0].n);
  const evidenceBefore = await count('evidence');
  let data = await graph(a, 'reader');
  assert.equal(data.contextRecords.length, 3);
  assert.equal(data.objects.length, 0);
  assert.ok(!JSON.stringify(data).includes(secret));
  assert.ok(!JSON.stringify(data).includes('Restricted fixture'));
  assert.equal(await count('evidence'), evidenceBefore, 'browsing writes nothing');
  assert.equal(await count('knowledge_objects'), 0);
  let model = explorationModel(data);
  assert.equal(model.nodes.filter((n) => n.name === 'Fixture person').length, 2);
  assert.equal(model.edges.filter((e) => e.kind === 'reporting').length, 1);
  const edge = model.edges.find((e) => e.kind === 'reporting')!;
  assert.equal(edge.fromId, 'record:' + person);
  assert.equal(edge.toId, 'record:' + manager);
  assert.equal(edge.certainty, 'unconfirmed');
  assert.ok(data.references[edge.evidenceId]);
  const neighborhood = explorationNeighborhood(
    model.nodes,
    model.edges,
    'record:' + person,
    2,
    false,
  );
  assert.ok(neighborhood.nodes.some((n) => n.node.id === 'record:' + manager));
  assert.ok(
    !neighborhood.nodes.some((n) => n.node.id === 'record:' + duplicate),
    'The organization hub must not imply that unrelated people have a business relationship',
  );
  const create = {
    kind: 'person',
    name: 'Tracked fixture',
    scope: 'Synthetic scope',
    visibility: 'team',
    sourceRecordId: person,
  };
  const object = (
    await call('POST', `/api/organizations/${a}/knowledge/objects`, create, 'admin')
  ).json().id as string;
  data = await graph(a, 'reader');
  model = explorationModel(data);
  assert.ok(!model.nodes.some((n) => n.id === 'record:' + person));
  assert.ok(model.edges.some((e) => e.fromId === object && e.toId === 'record:' + manager));
  const reused = await call(
    'POST',
    `/api/organizations/${a}/knowledge/objects`,
    { ...create, name: 'Other explicit interpretation' },
    'admin',
  );
  assert.equal(reused.statusCode, 201);
  assert.equal(
    reused.json().id,
    object,
    'A repeated creation request reuses the existing personnel dossier.',
  );
  // 旧库里可能有显式的歧义映射:一条记录被两个对象引用时不猜汇报线。
  await sql(
    `INSERT INTO omniboard.knowledge_objects (id, organization_id, kind, name, scope, visibility)
     SELECT 'legacy-ambiguity', organization_id, kind, 'Other explicit interpretation', scope, visibility
       FROM omniboard.knowledge_objects WHERE id = $1`,
    [object],
  );
  await sql("INSERT INTO omniboard.object_records VALUES ('legacy-ambiguity', $1)", [person]);
  data = await graph(a, 'reader');
  assert.equal(
    explorationModel(data).edges.filter((e) => e.kind === 'reporting').length,
    0,
    'Ambiguous explicit mappings must not invent a reporting edge',
  );
  assert.equal((await graph(a, 'admin')).contextRecords.length, 4);
  assert.equal(
    (
      await call(
        'POST',
        `/api/organizations/${a}/knowledge/objects`,
        { kind: 'person', name: 'No', scope: 'No', visibility: 'team', sourceRecordId: person },
        'reader',
      )
    ).statusCode,
    403,
  );
});

test('objects share source records, claims retain conflicting and historical evidence, and adoption is audited', async (t) => {
  const { call, sql, org, source, graph } = await setup(t);
  const a = await org('Operations fixture');
  const other = await org('Other fixture');
  const publicRecord = await source(a);
  const privateRecord = await source(a, 'admin');
  const create = {
    kind: 'capability',
    name: 'Synthetic streaming permission',
    scope: 'Fixture account',
    visibility: 'team',
    sourceRecordId: publicRecord,
  };
  const objects = `/api/organizations/${a}/knowledge/objects`;
  assert.equal(
    (await call('POST', objects, { ...create, sourceRecordId: privateRecord }, 'admin')).statusCode,
    422,
  );
  const response = await call('POST', objects, create);
  assert.equal(response.statusCode, 201, response.body);
  const obj = response.json().id as string;
  await call(
    'POST',
    objects,
    {
      ...create,
      name: 'Restricted fixture object',
      visibility: 'admin',
      sourceRecordId: privateRecord,
    },
    'admin',
  );
  const another = await source(a);
  assert.equal(
    (await call('POST', `/api/knowledge/objects/${obj}/records`, { recordId: another })).statusCode,
    200,
  );
  const claim = {
    field: 'Subscription interval',
    value: 'Fixture value A',
    scope: 'Fixture account',
    observedOn: '2020-01-01',
    rawText: 'Synthetic original statement A',
  };
  const claims = `/api/knowledge/objects/${obj}/claims`;
  const a1 = (await call('POST', claims, claim)).json().id as string;
  const b1 = (
    await call('POST', claims, {
      ...claim,
      value: 'Fixture value B',
      rawText: 'Synthetic original statement B',
    })
  ).json().id as string;
  for (const patch of [
    { validFrom: '2026-02-30' },
    { validFrom: '2026-05-01', validUntil: '2026-04-01' },
    { observedOn: '2026-09-30' },
    { rawText: '' },
  ])
    assert.equal(
      (await call('POST', claims, { ...claim, ...patch })).statusCode,
      422,
      JSON.stringify(patch),
    );
  const expired = (
    await call('POST', claims, { ...claim, value: 'Old fixture value', validUntil: '2020-01-02' })
  ).json().id as string;
  let data = await graph(a);
  assert.equal(data.objects.length, 1);
  assert.equal(data.objects[0]!.records.length, 2);
  assert.equal(data.claims.filter((c) => c.conflict).length, 2);
  assert.equal(data.claims.find((c) => c.id === expired)?.current, false);
  assert.equal(data.claims.find((c) => c.id === a1)?.status, 'reported');
  const accept = (claimId: string, body: object) =>
    call('POST', `/api/knowledge/claims/${claimId}/accept`, body);
  assert.equal((await accept(expired, { revision: 1, reason: 'Fixture review' })).statusCode, 422);
  assert.equal((await accept(b1, { revision: 1, reason: ' ' })).statusCode, 422);
  assert.equal(
    (
      await call(
        'POST',
        `/api/knowledge/claims/${b1}/accept`,
        { revision: 1, reason: 'x' },
        'reader',
      )
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await accept(b1, {
        revision: 1,
        reason: 'Second fixture source applies to the current scope',
      })
    ).statusCode,
    200,
  );
  data = await graph(a);
  assert.equal(data.claims.find((c) => c.id === a1)?.status, 'superseded');
  assert.equal(data.claims.find((c) => c.id === a1)?.revision, 2);
  assert.equal(data.claims.find((c) => c.id === b1)?.status, 'accepted');
  assert.equal(data.claims.filter((c) => c.conflict).length, 0);
  assert.ok(
    data.decisions.some(
      (d) => d.claimId === b1 && d.reason === 'Second fixture source applies to the current scope',
    ),
  );
  assert.equal((await accept(a1, { revision: 1, reason: 'Stale decision' })).statusCode, 409);
  const original = data.claims.find((c) => c.id === a1)!.evidenceId;
  assert.equal(
    (await call('GET', `/api/evidence/${original}`)).json().text,
    'Synthetic original statement A',
  );
  const readerView = await graph(a, 'reader');
  assert.ok(!JSON.stringify(readerView).includes('Restricted fixture object'));
  const titles = (await sql('SELECT title, visibility FROM omniboard.operation_events ORDER BY id'))
    .rows;
  assert.ok(titles.some((e) => e.title === 'Object added · Synthetic streaming permission'));
  assert.ok(
    titles.some(
      (e) =>
        e.title === 'Evidence reviewed · Synthetic streaming permission · Subscription interval',
    ),
  );
  assert.ok(
    titles.some((e) => e.title.startsWith('Object added · Restricted') && e.visibility === 'admin'),
  );
  const target = (
    await call('POST', objects, { ...create, name: 'Fixture account', kind: 'account' })
  ).json().id as string;
  const relation = {
    fromId: obj,
    toId: target,
    label: 'available to',
    certainty: 'unconfirmed',
    rawText: 'Fixture relationship',
  };
  assert.equal(
    (await call('POST', '/api/knowledge/relations', { ...relation, toId: obj })).statusCode,
    422,
  );
  assert.equal(
    (await call('POST', '/api/knowledge/relations', { ...relation, rawText: '' })).statusCode,
    422,
    'a relationship needs an original or a source record',
  );
  assert.equal((await call('POST', '/api/knowledge/relations', relation)).statusCode, 201);
  data = await graph(a);
  assert.equal(data.relations[0]?.certainty, 'unconfirmed');
  assert.equal(data.relations[0]?.current, true);
  assert.ok(titles.length < (await sql('SELECT id FROM omniboard.operation_events')).rows.length);
  assert.equal(
    (await call('POST', `/api/knowledge/objects/${obj}/records`, { recordId: await source(other) }))
      .statusCode,
    422,
    'a record from another organization needs a reason',
  );
});

test('shared identities span organizations, preserve scoped claims, and merge reversibly', async (t) => {
  const { call, sql, org, position, graph, detail } = await setup(t);
  const a = await org('Identity Alpha');
  const b = await org('Identity Beta');
  const c = await org('Identity Gamma');
  const ra = await position(a, 'Morgan Fixture', 'team', { dossier: false });
  const rb = await position(b, 'Morgan Fixture', 'team', { dossier: false });
  const rc = await position(c, 'Partner Fixture', 'team', { dossier: false });
  const object = async (orgId: string, recordId: string, name: string) => {
    const r = await call(
      'POST',
      `/api/organizations/${orgId}/knowledge/objects`,
      {
        name,
        kind: 'person',
        scope: 'Fixture scope',
        visibility: 'team',
        sourceRecordId: recordId,
      },
      'admin',
    );
    assert.equal(r.statusCode, 201, r.body);
    return r.json().id as string;
  };
  const oa = await object(a, ra, 'Morgan Fixture');
  const ob = await object(b, rb, 'M. Fixture');
  const oc = await object(c, rc, 'Partner Fixture');
  const claim = async (obj: string, sourceRecordId: string, value: string) => {
    const r = await call('POST', `/api/knowledge/objects/${obj}/claims`, {
      field: 'Account approval',
      scope: 'Institutional',
      value,
      sourceRecordId,
    });
    assert.equal(r.statusCode, 201, r.body);
    return r.json().id as string;
  };
  const ca = await claim(oa, ra, 'Approved at Alpha');
  const cb = await claim(ob, rb, 'Waiting at Beta');
  assert.equal(
    (
      await call('POST', `/api/knowledge/objects/${oa}/claims`, {
        field: 'Account approval',
        scope: 'Institutional',
        value: 'Elsewhere',
        sourceRecordId: rb,
      })
    ).statusCode,
    422,
    'evidence must come from an organization linked to the identity',
  );
  const relation = await call('POST', '/api/knowledge/relations', {
    fromId: ob,
    toId: oc,
    label: 'works with',
    certainty: 'unconfirmed',
    sourceRecordId: rb,
  });
  assert.equal(relation.statusCode, 201, relation.body);
  const recordsBefore = (await sql('SELECT * FROM omniboard.module_records ORDER BY id')).rows;
  const claimsBefore = (
    await sql('SELECT id, object_id, evidence_id FROM omniboard.knowledge_claims ORDER BY id')
  ).rows;
  const merge = await call('POST', `/api/knowledge/identities/${oa}/merge`, {
    otherId: ob,
    revision: 1,
    otherRevision: 1,
    reason: 'Same synthetic official profile explicitly lists both organizations.',
  });
  assert.equal(merge.statusCode, 200, merge.body);
  for (const orgId of [a, b]) {
    const data = await graph(orgId);
    assert.equal(data.objects.filter((o) => o.id === oa).length, 1);
    assert.equal(data.identityAliases?.[ob], oa);
    assert.equal(
      data.objects.some((o) => o.id === ob),
      false,
    );
    assert.equal(data.objects.find((o) => o.id === oa)!.records.length, 2);
    assert.deepEqual(
      new Set(data.objects.find((o) => o.id === oa)!.organizations!.map((o) => o.id)),
      new Set([a, b]),
    );
    assert.equal(
      data.claims.some((x) => x.conflict),
      false,
      'Different institutions are not competing interpretations.',
    );
    assert.equal(claimGroups(data.claims).length, 2);
    const model = explorationModel(data);
    assert.equal(model.nodes.filter((n) => n.id === oa).length, 1);
    assert.ok(model.edges.some((e) => e.fromId === 'organization:' + a && e.toId === oa));
    assert.ok(model.edges.some((e) => e.fromId === 'organization:' + b && e.toId === oa));
    assert.ok(model.edges.some((e) => e.fromId === oa && e.toId === oc));
  }
  assert.equal(
    (await detail(ob)).object.id,
    oa,
    'Old identity links resolve to the canonical identity.',
  );
  assert.equal(
    (await call('GET', '/api/knowledge/identities?q=M.%20Fixture&kind=person')).json().objects[0]
      .id,
    oa,
    'Old names remain searchable.',
  );
  const extra = await claim(oa, ra, 'Alternative Alpha claim');
  let data = await graph(a);
  assert.equal(data.claims.find((x) => x.id === cb)!.conflict, false);
  assert.equal(data.claims.find((x) => x.id === ca)!.conflict, true);
  assert.equal(
    (
      await call('POST', `/api/knowledge/claims/${extra}/accept`, {
        revision: 1,
        reason: 'Fixture verification at Alpha only.',
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (await sql('SELECT status FROM omniboard.knowledge_claims WHERE id = $1', [cb])).rows[0].status,
    'reported',
  );
  assert.deepEqual(
    (await sql('SELECT * FROM omniboard.module_records ORDER BY id')).rows,
    recordsBefore,
  );
  for (const row of claimsBefore)
    assert.deepEqual(
      (
        await sql(
          'SELECT id, object_id, evidence_id FROM omniboard.knowledge_claims WHERE id = $1',
          [row.id],
        )
      ).rows[0],
      row,
    );
  const merged = await detail(oa);
  const decision = merged.history.find((e) => e.kind === 'merge')!;
  assert.equal(decision.canUndo, true);
  assert.match(
    (await call('GET', `/api/evidence/${decision.evidenceId}/download`)).body,
    /Same synthetic official profile/,
  );
  const undo = (body: object) => call('POST', `/api/knowledge/identities/${oa}/undo`, body);
  assert.equal(
    (await undo({ eventId: decision.id, revision: merged.object.revision - 1, reason: 'Stale' }))
      .statusCode,
    409,
  );
  const undone = await undo({
    eventId: decision.id,
    revision: merged.object.revision,
    reason: 'Fixture correction: preserve each original identity.',
  });
  assert.equal(undone.statusCode, 200, undone.body);
  assert.equal((await detail(ob)).object.id, ob);
  assert.deepEqual(
    (await detail(ob)).object.records.map((r) => r.id),
    [rb],
  );
  assert.equal(
    (
      await undo({
        eventId: decision.id,
        revision: (await detail(oa)).object.revision,
        reason: 'Repeated undo',
      })
    ).statusCode,
    409,
  );
  data = await graph(b);
  assert.ok(data.objects.some((o) => o.id === ob) && !data.identityAliases?.[ob]);
});

test('identity candidates exclude retired dossiers and records without collapsing people with the same name', async (t) => {
  const { call, sql, org, position, detail } = await setup(t);
  const a = await org('Identity Alpha');
  const b = await org('Identity Beta');
  const c = await org('Identity Gamma');
  const ra = await position(a, 'Morgan Fixture', 'team', { dossier: false });
  const rb = await position(b, 'Morgan Fixture', 'team', { dossier: false });
  const retired = await position(c, 'Morgan Fixture', 'team', { dossier: false });
  const retiredInActiveOrg = await position(a, 'Morgan Fixture', 'team', { dossier: false });
  const object = async (orgId: string, recordId: string) =>
    (
      await call(
        'POST',
        `/api/organizations/${orgId}/knowledge/objects`,
        {
          name: 'Morgan Fixture',
          kind: 'person',
          scope: 'Fixture scope',
          visibility: 'team',
          sourceRecordId: recordId,
        },
        'admin',
      )
    ).json().id as string;
  const oa = await object(a, ra);
  const ob = await object(b, rb);
  await sql(
    `INSERT INTO omniboard.organization_aliases (alias_id, organization_id, reason, payload)
     VALUES ($1, $2, 'Reviewed fixture duplicate', '{}')`,
    [c, a],
  );
  await sql('INSERT INTO omniboard.record_aliases VALUES ($1, $2), ($3, $2)', [
    retired,
    ra,
    retiredInActiveOrg,
  ]);
  const search = (await call('GET', '/api/knowledge/identities?q=Morgan&kind=person')).json();
  assert.deepEqual(new Set(search.objects.map((o: { id: string }) => o.id)), new Set([oa, ob]));
  assert.deepEqual(new Set(search.records.map((r: { id: string }) => r.id)), new Set([ra, rb]));
  for (const recordId of [retired, retiredInActiveOrg]) {
    const response = await call('POST', `/api/knowledge/objects/${oa}/records`, {
      recordId,
      reason: 'Archived records must not become active identity candidates.',
      revision: 1,
    });
    assert.equal(response.statusCode, 404, response.body);
  }
  assert.equal((await detail(oa)).object.revision, 1);
  assert.equal((await detail(oa)).object.records.length, 1);
});

test('cross-organization linking requires reasons, compatible access and fresh revisions without hidden identity leakage', async (t) => {
  const { call, sql, org, position, detail } = await setup(t);
  const a = await org('Identity Alpha');
  const b = await org('Identity Beta');
  const ra = await position(a, 'Morgan Fixture', 'team', { dossier: false });
  const rb = await position(b, 'Morgan Fixture', 'team', { dossier: false });
  const privateRecord = await position(b, 'Secret Fixture', 'admin', { dossier: false });
  const object = async (orgId: string, recordId: string, name: string, visibility: string) =>
    (
      await call(
        'POST',
        `/api/organizations/${orgId}/knowledge/objects`,
        { name, kind: 'person', scope: 'Fixture scope', visibility, sourceRecordId: recordId },
        'admin',
      )
    ).json().id as string;
  const oa = await object(a, ra, 'Morgan Fixture', 'team');
  const privateObject = await object(b, privateRecord, 'Secret Fixture', 'admin');
  const link = (body: object, role = 'editor') =>
    call('POST', `/api/knowledge/objects/${oa}/records`, body, role);
  assert.equal((await link({ recordId: rb })).statusCode, 422);
  assert.equal(
    (await link({ recordId: rb, reason: 'Source explicitly lists both roles.', revision: 99 }))
      .statusCode,
    409,
  );
  assert.equal(
    (await link({ recordId: privateRecord, reason: 'Rejected private link' }, 'admin')).statusCode,
    422,
  );
  assert.equal(
    (
      await link(
        { recordId: rb, reason: 'Source explicitly lists both roles.', revision: 1 },
        'reader',
      )
    ).statusCode,
    403,
  );
  const linked = await link({
    recordId: rb,
    reason: 'Source explicitly lists both roles.',
    revision: 1,
  });
  assert.equal(linked.statusCode, 200, linked.body);
  assert.equal((await detail(oa)).object.records.length, 2);
  assert.equal((await call('GET', '/api/knowledge/identities?q=Secret')).json().objects.length, 0);
  assert.equal((await call('GET', `/api/knowledge/identities/${privateObject}`)).statusCode, 404);
  const body = {
    otherId: privateObject,
    revision: 2,
    otherRevision: 1,
    reason: 'Rejected access mismatch',
  };
  assert.equal((await call('POST', `/api/knowledge/identities/${oa}/merge`, body)).statusCode, 404);
  assert.equal(
    (await call('POST', `/api/knowledge/identities/${oa}/merge`, body, 'admin')).statusCode,
    422,
  );
  const unlink = (payload: object) =>
    call('POST', `/api/knowledge/identities/${oa}/unlink`, payload);
  assert.equal(
    (await unlink({ recordId: rb, revision: 2, reason: 'Fixture identity correction.' }))
      .statusCode,
    200,
  );
  assert.equal((await detail(oa)).object.records.length, 1);
  assert.equal(
    (await sql('SELECT 1 FROM omniboard.module_records WHERE id = $1', [rb])).rowCount,
    1,
  );
  assert.equal(
    (await unlink({ recordId: ra, revision: 3, reason: 'Do not remove last source.' })).statusCode,
    422,
  );
  assert.equal(
    (await link({ recordId: rb, reason: 'Restore reviewed association.', revision: 3 })).statusCode,
    200,
  );
  const history = (await detail(oa)).history.map((e) => e.kind);
  assert.deepEqual(history, ['link', 'unlink', 'link']);
});

test('import: objects, claims, relations and identity decisions need the import window', async (t) => {
  const { h, call, sql, sessions, org, source, graph } = await setup(t);
  const a = await org('Import fixture');
  const b = await org('Other import fixture');
  const bearer = (
    await h.request(
      'POST',
      '/api/tokens',
      { cookie: sessions.admin! },
      {
        name: 'importer',
        role: 'admin',
        expiresInDays: 7,
      },
    )
  ).json().token as string;
  const post = (path: string, body: object) => h.request('POST', path, { bearer }, body);
  const recordA = await source(a);
  const recordB = await source(b);
  const secretRecord = await source(a, 'admin');
  const evidence = (await graph(a)).records.find((r) => r.id === recordA)!.evidenceId;
  const editorId = (await call('GET', '/api/session')).json().user.id as string;
  // 导入的记录不自动建人员档案;v1 的档案随共享对象一起导入。
  const imported = await post(`/api/organizations/${a}/tabs/org_chart/records`, {
    id: 'v1-person',
    title: 'Imported role',
    body: 'Imported',
    scope: 'Fixture',
    status: 'unverified',
    visibility: 'team',
    personName: 'Imported Person',
    evidenceId: evidence,
  });
  assert.equal(imported.statusCode, 201, imported.body);
  assert.equal(
    (await sql("SELECT 1 FROM omniboard.knowledge_objects WHERE id = 'person-record:v1-person'"))
      .rowCount,
    0,
  );
  const object = {
    id: 'person-record:v1-person',
    organizationId: a,
    kind: 'person',
    name: 'Imported Person',
    scope: 'Personnel dossier',
    visibility: 'team',
    revision: 3,
    updatedAt: '2026-01-05T00:00:00Z',
    recordIds: ['v1-person', recordB],
  };
  assert.equal(
    (await h.request('POST', '/api/import/knowledge-objects', { cookie: sessions.admin! }, object))
      .statusCode,
    403,
  );
  assert.equal(
    (await post('/api/import/knowledge-objects', { ...object, recordIds: ['missing'] })).statusCode,
    422,
  );
  assert.equal(
    (await post('/api/import/knowledge-objects', { ...object, recordIds: [secretRecord] }))
      .statusCode,
    422,
  );
  assert.equal((await post('/api/import/knowledge-objects', object)).statusCode, 201);
  assert.equal((await post('/api/import/knowledge-objects', object)).statusCode, 409);
  const other = { ...object, id: 'v1-other', name: 'Other', revision: 1, recordIds: [recordA] };
  assert.equal((await post('/api/import/knowledge-objects', other)).statusCode, 201);
  const claim = {
    id: 'v1-claim',
    objectId: object.id,
    organizationId: b,
    field: 'Account approval',
    value: 'Approved',
    scope: 'Institutional',
    validFrom: '2025-01-01',
    recordedAt: '2025-01-02T03:04:05Z',
    status: 'accepted',
    evidenceId: evidence,
    sourceRecordId: recordB,
    revision: 2,
  };
  assert.equal(
    (await post('/api/import/knowledge-claims', { ...claim, objectId: 'missing' })).statusCode,
    422,
  );
  assert.equal((await post('/api/import/knowledge-claims', claim)).statusCode, 201);
  const relation = {
    id: 'v1-relation',
    fromId: object.id,
    toId: 'v1-other',
    label: 'works with',
    certainty: 'confirmed',
    evidenceId: evidence,
  };
  assert.equal((await post('/api/import/knowledge-relations', relation)).statusCode, 201);
  const redirect = { objectId: 'v1-other', targetId: object.id };
  assert.equal((await post('/api/import/identity-redirects', redirect)).statusCode, 201);
  assert.equal((await post('/api/import/identity-redirects', redirect)).statusCode, 200);
  assert.equal(
    (await post('/api/import/identity-redirects', { objectId: 'v1-other', targetId: 'v1-other' }))
      .statusCode,
    422,
  );
  const decision = {
    id: 'v1-decision',
    objectId: object.id,
    otherId: 'v1-other',
    kind: 'merge',
    reason: 'Reviewed in v1.',
    evidenceId: evidence,
    authorId: editorId,
    createdAt: '2025-03-01T00:00:00Z',
  };
  assert.equal((await post('/api/import/identity-events', decision)).statusCode, 201);
  const activity = {
    importId: '42',
    organizationId: a,
    targetId: object.id,
    kind: 'claim',
    title: 'Evidence reviewed · Imported Person · Account approval',
    payload: { claimId: 'v1-claim', reason: 'Checked the signed form.' },
    visibility: 'team',
    authorId: editorId,
    createdAt: '2025-01-03T00:00:00Z',
  };
  assert.equal((await post('/api/import/operation-events', activity)).statusCode, 201);
  assert.equal((await post('/api/import/operation-events', activity)).statusCode, 409);
  const data = await graph(a);
  const person = data.objects.find((o) => o.id === object.id)!;
  assert.equal(person.revision, 3);
  assert.deepEqual(person.aliases, ['Imported Person', 'Other']);
  assert.equal(data.identityAliases?.['v1-other'], object.id);
  assert.equal(data.claims.find((c) => c.id === 'v1-claim')?.organizationId, b);
  assert.equal(
    data.claims.find((c) => c.id === 'v1-claim')?.recordedAt,
    '2025-01-02T03:04:05.000Z',
  );
  assert.deepEqual(data.decisions, [
    {
      claimId: 'v1-claim',
      reason: 'Checked the signed form.',
      author: 'editor',
      createdAt: '2025-01-03T00:00:00.000Z',
    },
  ]);
  await sql("UPDATE omniboard.app_setting SET value = 'false' WHERE key = 'import_open'");
  assert.equal(
    (await post('/api/import/knowledge-relations', { ...relation, id: 'late' })).statusCode,
    403,
  );
});
