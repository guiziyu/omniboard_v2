import { z } from 'zod';
import type { Client, Pool } from './db';
import { id, tx } from './db';
import { problem, type User } from './auth';
import { saveEvidence, type EvidenceStore } from './evidence';
import { getOrganization } from './organizations';
import { event, lockWork } from './operation-log';
import {
  checkAccess,
  checkReference,
  claimRows,
  dateInput,
  evidence,
  getObject,
  identityIndex,
  reference,
  text,
  visibilityInput,
} from './knowledge';
import { tabsFor } from '../shared/registry';
import {
  dependencyLayers,
  isFinished,
  onboardingTemplate,
  type Access,
  type TaskActionResult,
  type TaskHistoryEvent,
  type WorkFeed,
  type WorkTask,
} from '../shared/operations';
import type { ExplorationGraph } from '../shared/exploration';
import { taskGuidance } from '../shared/focus';
import { taskAttention } from '../shared/work-queue';
// 工作台任务(frontend-spec 10.1–10.7;data-model §3.4),从 v1 src/server/operations/
// (queries.ts taskRows/getTask、task-service.ts、work.ts)迁移。
// 接入请求带来的告警、验证证据与一键完成随接入请求(§11)一起迁移。

type Db = Pool | Client;
const admin = (user: User) => user.role === 'admin';

// ---- 读模型(v1 queries.ts taskRows) ----
export async function taskRows(
  db: Db,
  user: User,
  orgId = '',
  index?: Awaited<ReturnType<typeof identityIndex>>,
): Promise<WorkTask[]> {
  const rows = (
    await db.query<
      Omit<WorkTask, 'displayState' | 'objectIds' | 'dependencies' | 'blockers' | 'updatedAt'> & {
        updatedAt: Date;
      }
    >(
      `SELECT t.id, t.organization_id AS "organizationId", o.name AS "organizationName", t.title,
              t.lane, t.state, t.origin, COALESCE(t.template_key, '') AS "templateKey",
              COALESCE(t.owner_id, '') AS "ownerId", COALESCE(m.name, 'Unassigned') AS "ownerName",
              t.description, t.next_step AS "nextStep", t.completion_criteria AS "completionCriteria",
              COALESCE(t.follow_up_on, '') AS "followUpOn", t.outcome, COALESCE(t.due_on, '') AS "dueOn",
              t.visibility, t.revision, t.updated_at AS "updatedAt", t.evidence_id AS "evidenceId",
              COALESCE(t.source_record_id, '') AS "sourceRecordId"
         FROM omniboard.work_tasks t
         JOIN omniboard.organizations o ON o.id = t.organization_id
         LEFT JOIN omniboard.member m ON m.id = t.owner_id
        WHERE ($1 = '' OR t.organization_id = $1) AND (t.visibility = 'team' OR $2)
        ORDER BY t.updated_at DESC, t.id COLLATE "C"`,
      [orgId, admin(user)],
    )
  ).rows;
  const deps = (
    await db.query<{ taskId: string; prerequisiteId: string }>(
      `SELECT d.task_id AS "taskId", d.prerequisite_id AS "prerequisiteId"
         FROM omniboard.task_dependencies d JOIN omniboard.work_tasks t ON t.id = d.task_id
        WHERE ($1 = '' OR t.organization_id = $1) AND (t.visibility = 'team' OR $2)
        ORDER BY d.task_id COLLATE "C", d.prerequisite_id COLLATE "C"`,
      [orgId, admin(user)],
    )
  ).rows;
  const objects = (
    await db.query<{ taskId: string; objectId: string }>(
      `SELECT x.task_id AS "taskId", x.object_id AS "objectId"
         FROM omniboard.task_objects x
         JOIN omniboard.work_tasks t ON t.id = x.task_id
         JOIN omniboard.knowledge_objects k ON k.id = x.object_id
        WHERE ($1 = '' OR t.organization_id = $1) AND (t.visibility = 'team' OR $2)
          AND (k.visibility = 'team' OR $2)
        ORDER BY x.task_id COLLATE "C", x.object_id COLLATE "C"`,
      [orgId, admin(user)],
    )
  ).rows;
  const depsByTask = new Map<string, string[]>();
  const objectsByTask = new Map<string, string[]>();
  // 任务引用的是原对象;身份合并后读作规范对象,撤销后回到原对象(7.14)。
  const canonical = (index ?? (await identityIndex(db, user))).canonical;
  for (const dep of deps) {
    const group = depsByTask.get(dep.taskId) || [];
    group.push(dep.prerequisiteId);
    depsByTask.set(dep.taskId, group);
  }
  for (const obj of objects) {
    const group = objectsByTask.get(obj.taskId) || [];
    const identity = canonical.get(obj.objectId);
    if (identity && !group.includes(identity)) group.push(identity);
    objectsByTask.set(obj.taskId, group);
  }
  const byId = new Map(rows.map((t) => [t.id, t]));
  return rows.map((t) => {
    const dependencies = depsByTask.get(t.id) || [];
    // 看不到的前置仍然算阻塞项,只是不透露标题(10.3)。
    const blockers = dependencies
      .filter((d) => !isFinished(byId.get(d)?.state || ''))
      .map((d) => ({
        id: byId.has(d) ? d : '',
        title: byId.get(d)?.title || 'Restricted prerequisite',
      }));
    return {
      ...t,
      updatedAt: t.updatedAt.toISOString(),
      nextStep: t.nextStep || taskGuidance[t.templateKey]?.nextStep || '',
      completionCriteria:
        t.completionCriteria || taskGuidance[t.templateKey]?.completionCriteria || '',
      dependencies: dependencies.filter((d) => byId.has(d)),
      blockers,
      objectIds: objectsByTask.get(t.id) || [],
      displayState: isFinished(t.state)
        ? t.state
        : blockers.length
          ? 'blocked'
          : t.state === 'planned'
            ? 'ready'
            : t.state,
    };
  });
}
async function taskOrganization(db: Db, user: User, taskId: string) {
  const row = (
    await db.query<{ organization_id: string }>(
      `SELECT organization_id FROM omniboard.work_tasks
        WHERE id = $1 AND (visibility = 'team' OR $2)`,
      [taskId, admin(user)],
    )
  ).rows[0];
  return row?.organization_id ?? problem(404, 'Task not found.');
}
export async function getTask(db: Db, user: User, taskId: string): Promise<WorkTask> {
  const orgId = await taskOrganization(db, user, taskId);
  return (
    (await taskRows(db, user, orgId)).find((t) => t.id === taskId) ??
    problem(404, 'Task not found.')
  );
}

// ---- 工作台数据(v1 work.ts GET /work) ----
export async function workFeed(
  pool: Pool,
  user: User,
  orgId: string,
  today: string,
): Promise<WorkFeed> {
  if (orgId) orgId = (await getOrganization(pool, orgId, user.role)).id;
  const index = await identityIndex(pool, user);
  const tasks = await taskRows(pool, user, orgId, index);
  const claims = await claimRows(pool, user, today, orgId, index);
  const objects = new Map(
    index.objects
      .filter((o) => !orgId || o.organizations?.some((org) => org.id === orgId))
      .map((o) => [o.id, o]),
  );
  const events = (
    await pool.query<
      Omit<WorkFeed['events'][number], 'createdAt' | 'id'> & {
        id: string;
        createdAt: Date;
      }
    >(
      `SELECT e.id, e.title, e.created_at AS "createdAt", m.name AS author,
              e.organization_id AS "organizationId", e.target_id AS "targetId", e.kind
         FROM omniboard.operation_events e JOIN omniboard.member m ON m.id = e.author_id
        WHERE ($1 = '' OR e.organization_id = $1) AND (e.visibility = 'team' OR $2)
        ORDER BY e.id DESC LIMIT 100`,
      [orgId, admin(user)],
    )
  ).rows.map((e) => ({ ...e, id: Number(e.id), createdAt: e.createdAt.toISOString() }));
  const soon = new Date(Date.parse(today) + 30 * 86400000).toISOString().slice(0, 10);
  const alerts: WorkFeed['alerts'] = tasks
    .filter((t) => taskAttention(t, today).length > 0)
    .map((t) => ({
      id: t.id,
      targetId: t.id,
      kind: 'task',
      organizationId: t.organizationId,
      title: t.title,
      detail: taskAttention(t, today).join(' · '),
    }));
  for (const claim of claims) {
    if (claim.status === 'superseded') continue;
    const obj = objects.get(claim.objectId);
    if (!obj) continue;
    if (claim.conflict || (claim.validUntil && claim.validUntil <= soon))
      alerts.push({
        id: claim.id,
        targetId: obj.id,
        kind: 'claim',
        organizationId: claim.organizationId || obj.organizationId,
        title: obj.name + ' · ' + claim.field,
        detail: claim.conflict
          ? 'Conflicting values need review'
          : claim.validUntil < today
            ? 'Evidence validity ended · ' + claim.validUntil
            : 'Expires soon · ' + claim.validUntil,
      });
  }
  const members = (
    await pool.query<WorkFeed['members'][number]>(
      `SELECT id, name FROM omniboard.member WHERE status <> 'disabled'
        ORDER BY name COLLATE "C", id COLLATE "C"`,
    )
  ).rows;
  const organizations = (
    await pool.query<WorkFeed['organizations'][number]>(
      `SELECT o.id, o.name,
              ARRAY(SELECT t.tag FROM omniboard.organization_tags t
                     WHERE t.organization_id = o.id ORDER BY t.tag) AS tags
         FROM omniboard.organizations o
        WHERE NOT EXISTS (SELECT 1 FROM omniboard.organization_aliases a WHERE a.alias_id = o.id)
        ORDER BY o.name COLLATE "C", o.id COLLATE "C"`,
    )
  ).rows;
  const followed = (
    await pool.query<{ id: string }>(
      `SELECT organization_id AS id FROM omniboard.organization_follows
        WHERE owner_id = $1 ORDER BY organization_id COLLATE "C"`,
      [user.id],
    )
  ).rows.map((f) => f.id);
  return { tasks, followedOrganizationIds: followed, events, alerts, members, organizations };
}
export async function taskHistory(
  pool: Pool,
  user: User,
  taskId: string,
): Promise<{ events: TaskHistoryEvent[] }> {
  const task = await getTask(pool, user, taskId);
  const events = await pool.query<Omit<TaskHistoryEvent, 'createdAt'> & { createdAt: Date }>(
    `SELECT e.title, e.payload, e.created_at AS "createdAt", m.name AS author
       FROM omniboard.operation_events e JOIN omniboard.member m ON m.id = e.author_id
      WHERE e.target_id = $1 AND (e.visibility = 'team' OR $2)
      ORDER BY e.id DESC`,
    [task.id, admin(user)],
  );
  return { events: events.rows.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })) };
}

// ---- 写入(v1 task-service.ts) ----
export const taskInput = z
  .object({
    title: text(160).min(1),
    lane: z.enum(['business', 'engineering', 'compliance', 'research']),
    ownerId: text(100).default(''),
    description: text().default(''),
    nextStep: text(1500).default(''),
    completionCriteria: text(2000).default(''),
    followUpOn: dateInput.default(''),
    dueOn: dateInput.default(''),
    visibility: visibilityInput.default('team'),
    dependencies: z.array(text(100).min(1)).max(50).default([]),
    objectIds: z.array(text(100).min(1)).max(30).default([]),
    ...reference,
  })
  .strict();
type TaskInput = z.infer<typeof taskInput>;
export const planInput = taskInput.extend({ revision: z.number().int().positive() });
export const startInput = z.object({ visibility: visibilityInput.default('team') }).strict();
export const transitionInput = z
  .object({
    revision: z.number().int().positive(),
    state: z.enum(['planned', 'active', 'waiting', 'done', 'skipped']),
    outcome: text(6000).default(''),
    ...reference,
    environment: text(300).default(''),
    codeRevision: text(200).default(''),
    followUpOn: dateInput.optional(),
    nextStep: text(1500).optional(),
    claim: z.boolean().default(false),
  })
  .strict();
export const progressInput = z
  .object({
    revision: z.number().int().positive(),
    outcome: text(6000).min(1),
    nextStep: text(1500).optional(),
    followUpOn: dateInput.optional(),
    ...reference,
  })
  .strict();

async function validateTaskLinks(
  client: Client,
  user: User,
  orgId: string,
  input: TaskInput,
  taskId: string,
  all: WorkTask[],
) {
  if (
    input.ownerId &&
    !(
      await client.query("SELECT 1 FROM omniboard.member WHERE id = $1 AND status <> 'disabled'", [
        input.ownerId,
      ])
    ).rowCount
  )
    problem(422, 'Choose a current team member.');
  checkAccess(input.visibility, user);
  await checkReference(client, input.sourceRecordId, orgId, input.visibility, user);
  for (const depId of input.dependencies) {
    const dep =
      all.find((t) => t.id === depId) ??
      problem(422, 'A prerequisite must be an accessible task in this organization.');
    if (dep.visibility === 'admin' && input.visibility === 'team')
      problem(422, 'A team task cannot depend on a restricted task.');
  }
  try {
    dependencyLayers([
      ...all.filter((t) => t.id !== taskId),
      { id: taskId, dependencies: input.dependencies },
    ]);
  } catch {
    problem(422, 'A task cannot depend on itself, directly or through other tasks.');
  }
  for (const objectId of input.objectIds) {
    const obj = await getObject(client, user, objectId);
    if (
      !obj.organizations?.some((o) => o.id === orgId) ||
      (obj.visibility === 'admin' && input.visibility === 'team')
    )
      problem(422, 'Linked objects must have compatible organization and access.');
  }
}
async function writeLinks(client: Client, taskId: string, input: TaskInput) {
  await client.query('DELETE FROM omniboard.task_dependencies WHERE task_id = $1', [taskId]);
  for (const dep of new Set(input.dependencies))
    await client.query(
      'INSERT INTO omniboard.task_dependencies (task_id, prerequisite_id) VALUES ($1, $2)',
      [taskId, dep],
    );
  await client.query('DELETE FROM omniboard.task_objects WHERE task_id = $1', [taskId]);
  for (const obj of new Set(input.objectIds))
    await client.query('INSERT INTO omniboard.task_objects (task_id, object_id) VALUES ($1, $2)', [
      taskId,
      obj,
    ]);
}

/** 启动标准接入计划(10.5):幂等;全部任务从 planned 开始,不从旧记录推断已获授权或已测试。 */
export async function startOnboarding(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  organizationId: string,
  input: z.infer<typeof startInput>,
): Promise<{ created: number }> {
  const org = await getOrganization(pool, organizationId, user.role);
  if (!tabsFor(org.tags).some((t) => t.id === 'onboarding'))
    problem(422, 'Standard onboarding is not configured for this organization type.');
  checkAccess(input.visibility, user);
  return tx(pool, async (client) => {
    await lockWork(client, org.id);
    const existing = await client.query<{ visibility: Access }>(
      `SELECT visibility FROM omniboard.work_tasks
        WHERE organization_id = $1 AND template_key IS NOT NULL`,
      [org.id],
    );
    if (existing.rowCount) {
      for (const row of existing.rows) checkAccess(row.visibility, user);
      return { created: 0 };
    }
    const ids = new Map(onboardingTemplate.map((t) => [t.key, id()]));
    const evidenceId = await saveEvidence(
      client,
      store,
      Buffer.from(
        'Omniboard standard onboarding template v1. Planning tasks only; no approvals, resources or test results are inferred.\n' +
          JSON.stringify(onboardingTemplate, null, 2),
      ),
      {
        source: 'manual',
        url: '',
        contentType: 'text/plain; charset=utf-8',
        visibility: input.visibility,
      },
    );
    for (const t of onboardingTemplate)
      await client.query(
        `INSERT INTO omniboard.work_tasks
           (id, organization_id, title, lane, state, origin, template_key, description, visibility,
            evidence_id)
         VALUES ($1,$2,$3,$4,'planned','standard',$5,$6,$7,$8)`,
        [
          ids.get(t.key),
          org.id,
          t.title,
          t.lane,
          t.key,
          t.description,
          input.visibility,
          evidenceId,
        ],
      );
    for (const t of onboardingTemplate)
      for (const dep of t.dependencies)
        await client.query(
          'INSERT INTO omniboard.task_dependencies (task_id, prerequisite_id) VALUES ($1, $2)',
          [ids.get(t.key), ids.get(dep)],
        );
    await event(
      client,
      org.id,
      ids.get('scope')!,
      'task',
      'Standard onboarding started',
      input.visibility,
      user,
      { template: 'v1', taskIds: [...ids.values()], evidenceId },
    );
    return { created: onboardingTemplate.length };
  });
}

/** 从新信息创建任务(10.6):origin 为 discovery,初始 planned。 */
export async function createTask(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  organizationId: string,
  input: TaskInput,
): Promise<{ id: string }> {
  const org = await getOrganization(pool, organizationId, user.role);
  const taskId = id();
  return tx(pool, async (client) => {
    await lockWork(client, org.id);
    await validateTaskLinks(
      client,
      user,
      org.id,
      input,
      taskId,
      await taskRows(client, user, org.id),
    );
    const evidenceId = await evidence(client, store, org.id, input.visibility, user, input);
    await client.query(
      `INSERT INTO omniboard.work_tasks
         (id, organization_id, title, lane, state, origin, owner_id, description, due_on, visibility,
          source_record_id, evidence_id, next_step, completion_criteria, follow_up_on)
       VALUES ($1,$2,$3,$4,'planned','discovery',$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        taskId,
        org.id,
        input.title,
        input.lane,
        input.ownerId || null,
        input.description,
        input.dueOn || null,
        input.visibility,
        input.sourceRecordId || null,
        evidenceId,
        input.nextStep,
        input.completionCriteria,
        input.followUpOn || null,
      ],
    );
    await writeLinks(client, taskId, input);
    await event(
      client,
      org.id,
      taskId,
      'task',
      'New information → ' + input.title,
      input.visibility,
      user,
      { ...input, evidenceId },
    );
    return { id: taskId };
  });
}

/** 在事务里取任务:先加机构锁,再读已提交的状态。 */
async function lockedTask(client: Client, user: User, taskId: string) {
  const orgId = await taskOrganization(client, user, taskId);
  await lockWork(client, orgId);
  const all = await taskRows(client, user, orgId);
  const task = all.find((t) => t.id === taskId) ?? problem(404, 'Task not found.');
  return { task, all };
}

/** 编辑任务计划(10.6):可见性不可改,已完成的不能改,非 planned 的不能新增未完成前置。 */
export async function updateTaskPlan(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  taskId: string,
  input: z.infer<typeof planInput>,
): Promise<{ ok: true }> {
  return tx(pool, async (client) => {
    const { task, all } = await lockedTask(client, user, taskId);
    if (input.revision !== task.revision) problem(409, 'This task changed. Reload before saving.');
    if (input.visibility !== task.visibility)
      problem(422, 'Task access cannot change after creation.');
    if (isFinished(task.state)) problem(422, 'Reopen this task before editing its plan.');
    await validateTaskLinks(client, user, task.organizationId, input, task.id, all);
    if (
      task.state !== 'planned' &&
      input.dependencies.some((d) => !isFinished(all.find((t) => t.id === d)!.state))
    )
      problem(409, 'Move the task back to planned before adding an unfinished prerequisite.');
    // 补了原文,或换了来源记录,就生成新的证据引用;只改标题等保留当前引用。
    const evidenceId =
      input.rawText || (input.sourceRecordId && input.sourceRecordId !== task.sourceRecordId)
        ? await evidence(client, store, task.organizationId, task.visibility, user, input)
        : task.evidenceId;
    await client.query(
      `UPDATE omniboard.work_tasks
          SET title = $1, lane = $2, owner_id = $3, description = $4, due_on = $5,
              source_record_id = $6, evidence_id = $7, next_step = $8, completion_criteria = $9,
              follow_up_on = $10, revision = revision + 1, updated_at = now()
        WHERE id = $11`,
      [
        input.title,
        input.lane,
        input.ownerId || null,
        input.description,
        input.dueOn || null,
        input.sourceRecordId || null,
        evidenceId,
        input.nextStep,
        input.completionCriteria,
        input.followUpOn || null,
        task.id,
      ],
    );
    await writeLinks(client, task.id, input);
    await event(
      client,
      task.organizationId,
      task.id,
      'task',
      'Plan updated · ' + input.title,
      task.visibility,
      user,
      { ...input, evidenceId },
    );
    return { ok: true as const };
  });
}

/** 改状态(10.4):写一条历史,返回真正解除阻塞的直接下游与仍有前置的下游。 */
export async function transitionTask(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  taskId: string,
  input: z.infer<typeof transitionInput>,
): Promise<TaskActionResult> {
  return tx(pool, async (client) => {
    const { task, all: before } = await lockedTask(client, user, taskId);
    if (input.revision !== task.revision)
      problem(409, 'This task changed. Reload before taking an action.');
    if (input.state === task.state) problem(422, 'Choose a different task state.');
    if (['active', 'waiting', 'done'].includes(input.state) && task.blockers.length)
      problem(409, 'Complete or explicitly waive the prerequisites first.');
    if (isFinished(input.state) && !input.outcome)
      problem(422, 'Record the result or the reason this task is not needed.');
    if (
      task.templateKey === 'validation' &&
      input.state === 'done' &&
      (!input.environment || !input.codeRevision)
    )
      problem(422, 'Record the tested environment and code revision.');
    if (isFinished(task.state) && !isFinished(input.state)) {
      const dependent = (
        await client.query<{ title: string; visibility: Access }>(
          `SELECT t.title, t.visibility FROM omniboard.task_dependencies d
             JOIN omniboard.work_tasks t ON t.id = d.task_id
            WHERE d.prerequisite_id = $1 AND t.state <> 'planned'
            ORDER BY t.id COLLATE "C" LIMIT 1`,
          [task.id],
        )
      ).rows[0];
      if (dependent)
        problem(
          409,
          dependent.visibility === 'admin' && !admin(user)
            ? 'An administrator must reset a dependent task before this task can be reopened.'
            : 'Reopen or reset dependent tasks first: ' + dependent.title,
        );
    }
    const evidenceId =
      isFinished(input.state) || input.rawText
        ? await evidence(client, store, task.organizationId, task.visibility, user, input)
        : task.evidenceId;
    const outcome = [
      input.outcome,
      input.environment ? 'Environment: ' + input.environment : '',
      input.codeRevision ? 'Code revision: ' + input.codeRevision : '',
    ]
      .filter(Boolean)
      .join('\n');
    await client.query(
      `UPDATE omniboard.work_tasks
          SET state = $1, outcome = $2, evidence_id = $3, next_step = $4, follow_up_on = $5,
              owner_id = $6, revision = revision + 1, updated_at = now()
        WHERE id = $7`,
      [
        input.state,
        outcome || task.outcome,
        evidenceId,
        input.nextStep ?? task.nextStep,
        input.state === 'waiting' ? (input.followUpOn ?? task.followUpOn) || null : null,
        task.ownerId || (input.claim ? user.id : null),
        task.id,
      ],
    );
    await event(
      client,
      task.organizationId,
      task.id,
      'task',
      {
        planned: 'Replanned',
        active: 'Started',
        waiting: 'Waiting for a response',
        done: 'Completed',
        skipped: 'Marked not needed',
      }[input.state] +
        ' · ' +
        task.title,
      task.visibility,
      user,
      { ...input, evidenceId, previous: task.state },
    );
    const after = await taskRows(client, user, task.organizationId);
    const dependents = after.filter(
      (t) => t.dependencies.includes(task.id) && !isFinished(t.state),
    );
    return {
      taskId: task.id,
      state: input.state,
      unlocked: isFinished(input.state)
        ? dependents
            .filter(
              (t) =>
                t.displayState === 'ready' &&
                before.find((b) => b.id === t.id)?.displayState === 'blocked',
            )
            .map((t) => ({ id: t.id, title: t.title }))
        : [],
      remaining: isFinished(input.state)
        ? dependents
            .filter((t) => t.blockers.length)
            .map((t) => ({ id: t.id, title: t.title, blockers: t.blockers }))
        : [],
    };
  });
}

/** 记录进度(10.4):状态不变,结果必填,原文另存为新证据。 */
export async function recordTaskProgress(
  pool: Pool,
  store: EvidenceStore,
  user: User,
  taskId: string,
  input: z.infer<typeof progressInput>,
): Promise<TaskActionResult> {
  return tx(pool, async (client) => {
    const { task } = await lockedTask(client, user, taskId);
    if (input.revision !== task.revision)
      problem(409, 'This task changed. Reload before recording progress.');
    if (isFinished(task.state)) problem(422, 'Reopen this task before recording more progress.');
    const evidenceId = await evidence(client, store, task.organizationId, task.visibility, user, {
      ...input,
      rawText: input.rawText || input.outcome,
    });
    await client.query(
      `UPDATE omniboard.work_tasks
          SET outcome = $1, next_step = $2, follow_up_on = $3, evidence_id = $4,
              revision = revision + 1, updated_at = now()
        WHERE id = $5`,
      [
        input.outcome,
        input.nextStep ?? task.nextStep,
        (input.followUpOn ?? task.followUpOn) || null,
        evidenceId,
        task.id,
      ],
    );
    await event(
      client,
      task.organizationId,
      task.id,
      'task',
      'Progress recorded · ' + task.title,
      task.visibility,
      user,
      { ...input, evidenceId, state: task.state },
    );
    return { taskId: task.id, state: task.state, unlocked: [], remaining: [] };
  });
}

/** 关系页「Work linked to this evidence」(7.9):本机构的任务、关联对象在图里的任务、来源记录在图里的任务。 */
export async function explorationTasks(
  pool: Pool,
  user: User,
  graph: Pick<ExplorationGraph, 'objects' | 'contextRecords' | 'organization'>,
) {
  const objectIds = new Set(graph.objects.map((o) => o.id));
  const recordIds = new Set(graph.contextRecords.map((r) => r.id));
  return (await taskRows(pool, user)).filter(
    (t) =>
      t.organizationId === graph.organization.id ||
      t.objectIds.some((objectId) => objectIds.has(objectId)) ||
      recordIds.has(t.sourceRecordId),
  );
}
