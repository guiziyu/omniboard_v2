// 共享对象、结论、关系与任务的类型(data-model §3.4),从 v1 src/shared/operations.ts 与
// src/modules/operations.ts 迁移;v1 的 rawId 改名 evidenceId。
export type Access = 'team' | 'admin';
export type ObjectKind = 'person' | 'account' | 'capability' | 'resource';
export type TaskState = 'planned' | 'active' | 'waiting' | 'done' | 'skipped';
export type TaskLane = 'business' | 'engineering' | 'compliance' | 'research';
export interface WorkTask {
  id: string;
  organizationId: string;
  organizationName: string;
  title: string;
  lane: TaskLane;
  state: TaskState;
  displayState: 'ready' | 'blocked' | TaskState;
  origin: 'standard' | 'discovery';
  templateKey: string;
  ownerId: string;
  ownerName: string;
  description: string;
  nextStep: string;
  completionCriteria: string;
  followUpOn: string;
  outcome: string;
  dueOn: string;
  visibility: Access;
  revision: number;
  updatedAt: string;
  evidenceId: string;
  sourceRecordId: string;
  objectIds: string[];
  dependencies: string[];
  blockers: { id: string; title: string }[];
}
export interface WorkFeed {
  tasks: WorkTask[];
  /** 当前成员关注的机构(8.3),个人状态。 */
  followedOrganizationIds: string[];
  members: { id: string; name: string }[];
  organizations: { id: string; name: string; tags: string[] }[];
  events: {
    id: number;
    title: string;
    createdAt: string;
    author: string;
    organizationId: string;
    targetId: string;
    kind: string;
  }[];
  alerts: {
    id: string;
    title: string;
    detail: string;
    organizationId: string;
    targetId: string;
    kind: string;
  }[];
}
/** 情报收件箱的条目(frontend-spec 8.1):每条记录的最新版本。 */
export interface IntelligenceItem {
  id: string;
  organizationId: string;
  organizationName: string;
  tabId: string;
  title: string;
  summary: string;
  scope: string;
  status: string;
  /** structured.evidenceLevel,没有时为 ''。 */
  verification: string;
  revision: number;
  updatedAt: string;
  evidenceId: string;
  read: boolean;
  reasons: string[];
}
export interface IntelligenceFeed {
  items: IntelligenceItem[];
  total: number;
  hasMore: boolean;
}
export interface IntelligenceDetail {
  item: IntelligenceItem;
  body: string;
  structured: Record<string, string>;
  source: { source: string; url: string; capturedAt: string };
  changes: { field: string; before: string; after: string }[];
  hasPrevious: boolean;
  tasks: {
    id: string;
    title: string;
    state: WorkTask['displayState'];
    link: 'direct' | 'organization';
  }[];
  objects: { id: string; name: string; kind: ObjectKind }[];
  contacts: { id: string; title: string; name: string }[];
}
export interface TaskActionResult {
  taskId: string;
  state: TaskState;
  unlocked: { id: string; title: string }[];
  remaining: { id: string; title: string; blockers: { id: string; title: string }[] }[];
}
export interface TaskHistoryEvent {
  title: string;
  createdAt: string;
  author: string;
  payload: { evidenceId?: string; outcome?: string } & Record<string, unknown>;
}
export interface KnowledgeObject {
  id: string;
  organizationId: string;
  kind: ObjectKind;
  name: string;
  scope: string;
  visibility: Access;
  revision: number;
  organizations?: { id: string; name: string }[];
  aliases?: string[];
  records: {
    id: string;
    title: string;
    tabId: string;
    evidenceId: string;
    organizationId?: string;
    organizationName?: string;
  }[];
}
export interface KnowledgeClaim {
  id: string;
  objectId: string;
  organizationId?: string;
  organizationName?: string;
  field: string;
  value: string;
  scope: string;
  validFrom: string;
  validUntil: string;
  observedOn: string;
  recordedAt: string;
  status: 'reported' | 'accepted' | 'superseded';
  current: boolean;
  conflict: boolean;
  evidenceId: string;
  sourceRecordId: string;
  revision: number;
}
export interface KnowledgeRelation {
  id: string;
  fromId: string;
  toId: string;
  label: string;
  certainty: 'confirmed' | 'unconfirmed';
  validFrom: string;
  validUntil: string;
  evidenceId: string;
  current: boolean;
}
export interface KnowledgeGraph {
  decisions: { claimId: string; reason: string; author: string; createdAt: string }[];
  objects: KnowledgeObject[];
  claims: KnowledgeClaim[];
  relations: KnowledgeRelation[];
  records: { id: string; title: string; tabId: string; evidenceId: string; visibility: Access }[];
}
/** 有效期判断:任一端为空视为不限。日期是 YYYY-MM-DD 字符串,直接按字典序比较。 */
export function dateIsCurrent(
  from: string,
  until: string,
  today = new Date().toISOString().slice(0, 10),
) {
  return (!from || from <= today) && (!until || until >= today);
}

export const taskStates = {
  ready: 'Ready to start',
  active: 'In progress',
  waiting: 'Waiting for a response',
  blocked: 'Waiting for prerequisites',
  done: 'Completed',
  skipped: 'Not needed',
  planned: 'Planned',
};
export const laneNames: Record<TaskLane, string> = {
  business: 'Business',
  engineering: 'Engineering',
  compliance: 'Compliance',
  research: 'Research',
};
/** 标准接入计划 v1(frontend-spec 10.5)。改动须同时改 key 的含义说明;已建的任务不随模板变化。 */
export const onboardingTemplate: {
  key: string;
  title: string;
  lane: TaskLane;
  dependencies: string[];
  description: string;
}[] = [
  {
    key: 'scope',
    title: 'Define account and product scope',
    lane: 'business',
    dependencies: [],
    description: 'Record the legal entity, jurisdiction, account type and products we need.',
  },
  {
    key: 'contacts',
    title: 'Find the right business and technical contacts',
    lane: 'business',
    dependencies: [],
    description:
      'Identify contacts for account opening, commercial terms and API access. Preserve the source for each contact.',
  },
  {
    key: 'terms',
    title: 'Research fees, funding and special resources',
    lane: 'research',
    dependencies: [],
    description:
      'Continue gathering commercial and infrastructure information while engineering works on the connection.',
  },
  {
    key: 'eligibility',
    title: 'Confirm product and regional eligibility',
    lane: 'compliance',
    dependencies: ['scope'],
    description: 'Check whether our legal entity and jurisdiction can use the selected products.',
  },
  {
    key: 'account',
    title: 'Obtain the required account access',
    lane: 'business',
    dependencies: ['eligibility'],
    description:
      'Record account approval, scope, conditions and expiry. Store credential references, never secret values.',
  },
  {
    key: 'resources',
    title: 'Confirm API permissions and requested resources',
    lane: 'business',
    dependencies: ['account'],
    description:
      'Confirm API scope, whitelists and any special resources. Mark this task not needed with a reason if no additional approval is required.',
  },
  {
    key: 'docs',
    title: 'Review the API and connector requirements',
    lane: 'engineering',
    dependencies: ['scope'],
    description:
      'Identify supported interfaces, limits and configuration needs for the selected products.',
  },
  {
    key: 'implementation',
    title: 'Prepare the connector and configuration',
    lane: 'engineering',
    dependencies: ['docs'],
    description:
      'Link the code revision or pull request and record the checks performed. Code inspection alone does not confirm account access.',
  },
  {
    key: 'validation',
    title: 'Validate the connection for our account',
    lane: 'engineering',
    dependencies: ['resources', 'implementation'],
    description:
      'Record the environment, code revision, account scope, test result and evidence. Complete only after the actual validation.',
  },
];
export function isFinished(state: string) {
  return state === 'done' || state === 'skipped';
}
/** 拓扑分层(依赖图的列);有环时抛错。 */
export function dependencyLayers(tasks: Pick<WorkTask, 'id' | 'dependencies'>[]): string[][] {
  const remaining = new Set(tasks.map((t) => t.id));
  const layers: string[][] = [];
  while (remaining.size) {
    const ready = tasks
      .filter((t) => remaining.has(t.id) && t.dependencies.every((d) => !remaining.has(d)))
      .map((t) => t.id);
    if (!ready.length)
      throw new Error('A task cannot depend on itself, directly or through other tasks.');
    layers.push(ready);
    ready.forEach((id) => remaining.delete(id));
  }
  return layers;
}
