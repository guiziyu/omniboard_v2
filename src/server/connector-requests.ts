import type { Client, Pool } from './db';
import { id } from './db';
import type { User } from './auth';
import { event, lockWork } from './operation-log';
import { isConstraintKind, parseAffects, parseConstraintValue } from '../shared/constraints';
import {
  capabilityWildcards,
  constraintEnforcement,
  environments,
  faceOf,
  isStale,
  leafRequiresCredentials,
  matchesPattern,
  STALE_DAYS_DEFAULT,
  type Blocker,
  type ExportedConstraint,
  type Face,
  type RequestFile,
  type RequestedLeaf,
  type RequestStatus,
  type ResourceType,
} from '../shared/verification-contract';
import type {
  AttemptRow,
  AwaitingItem,
  CredentialColumn,
  RequestLeafView,
  RequestView,
  VerificationEvidence,
} from '../shared/integration';
import type { Access } from '../shared/operations';
// 接入请求(frontend-spec 11.1–11.5;data-model §3.6;proposal §6),从 v1 src/server/integration/
// (ledger、request、state、hooks、attempts)迁移。v1 的导出目录与 quant 投影由 proposal §6 取代:
// 请求存为 omniboard.connector_request 的不可变快照,验证结果每次直接读 verification.v_*。

type Db = Pool | Client;
export type ReadOptions = { admin: boolean; now: string; staleDays: number };
export const staleDaysSetting = () => {
  const value = Number(process.env.CONNECTOR_STALE_DAYS);
  return Number.isFinite(value) && value > 0 ? value : STALE_DAYS_DEFAULT;
};
const iso = (value: Date | string | null) =>
  value === null ? null : value instanceof Date ? value.toISOString() : value;

// ---- quant 的只读视图(契约 §5) ----
export interface DeclaredVenue {
  venueKey: string;
  sourceId: string;
  cratePath: string;
  buildRevision: string;
  buildDirty: boolean;
  observedAt: string;
  factoryFlags: Record<string, boolean>;
  declaredFeatures: { feature_key: string; declared_by: string }[];
}
const declaredSelect = `SELECT venue_key AS "venueKey", source_id AS "sourceId",
       COALESCE(crate_path, '') AS "cratePath", build_revision AS "buildRevision",
       build_dirty AS "buildDirty", observed_at AS "observedAt", factory_flags AS "factoryFlags",
       declared_features AS "declaredFeatures"
  FROM verification.v_connector_declared_latest`;
type DeclaredRow = Omit<DeclaredVenue, 'observedAt'> & { observedAt: Date };
const toVenue = (row: DeclaredRow): DeclaredVenue => ({
  ...row,
  cratePath: row.cratePath || `connector/crates/conn-${row.venueKey}`,
  observedAt: row.observedAt.toISOString(),
  factoryFlags: row.factoryFlags ?? {},
  declaredFeatures: Array.isArray(row.declaredFeatures) ? row.declaredFeatures : [],
});
export async function declaredVenue(db: Db, venueKey: string) {
  const row = (await db.query<DeclaredRow>(`${declaredSelect} WHERE venue_key = $1`, [venueKey]))
    .rows[0];
  return row ? toVenue(row) : undefined;
}
export async function declaredVenues(db: Db): Promise<DeclaredVenue[]> {
  return (await db.query<DeclaredRow>(`${declaredSelect} ORDER BY venue_key COLLATE "C"`)).rows.map(
    toVenue,
  );
}
export interface VerificationRow {
  featureKey: string;
  environment: string;
  accountKind: string;
  status: string;
  skipReason: string | null;
  errorText: string | null;
  observedAt: string;
  runId: string;
  buildRevision: string;
  buildDirty: boolean;
  requestId: string | null;
}
/** 该 venue 每个「叶子 × 环境 × 账户类型」最近一次结果,新的在前(含 dirty,调用方按需过滤)。 */
export async function verificationRows(db: Db, venueKey: string): Promise<VerificationRow[]> {
  const rows = await db.query<Omit<VerificationRow, 'observedAt'> & { observedAt: Date }>(
    `SELECT feature_key AS "featureKey", environment, account_kind AS "accountKind", status,
            skip_reason AS "skipReason", error_text AS "errorText", observed_at AS "observedAt",
            run_id::text AS "runId", build_revision AS "buildRevision", build_dirty AS "buildDirty",
            request_id::text AS "requestId"
       FROM verification.v_live_test_leaf_latest
      WHERE venue_key = $1
      ORDER BY observed_at DESC, feature_key COLLATE "C"`,
    [venueKey],
  );
  return rows.rows.map((r) => ({ ...r, observedAt: r.observedAt.toISOString() }));
}
/** 验证 run(每个 run 一行):按请求或按 venue 取,开始时间新的在前。 */
export async function attemptRows(
  db: Db,
  filter: { requestIds: string[] } | { venueKey: string },
): Promise<AttemptRow[]> {
  const byRequest = 'requestIds' in filter;
  const rows = await db.query<
    Omit<AttemptRow, 'startedAt' | 'finishedAt'> & { startedAt: Date; finishedAt: Date | null }
  >(
    `SELECT request_id::text AS "requestId", run_id::text AS "runId", venue_key AS "venueKey", suite,
            environment, account_name AS "accountName", account_kind AS "accountKind",
            build_revision AS "buildRevision", build_dirty AS "buildDirty", started_at AS "startedAt",
            finished_at AS "finishedAt", status, blockers, passed_count::int AS "passedCount",
            failed_count::int AS "failedCount", skipped_count::int AS "skippedCount"
       FROM verification.v_live_test_run_by_request
      WHERE ${byRequest ? 'request_id::text = ANY($1)' : 'venue_key = $1'}
      ORDER BY started_at DESC, run_id`,
    [byRequest ? filter.requestIds : filter.venueKey],
  );
  return rows.rows.map((r) => ({
    ...r,
    blockers: Array.isArray(r.blockers) ? (r.blockers as Blocker[]) : [],
    startedAt: r.startedAt.toISOString(),
    finishedAt: iso(r.finishedAt),
  }));
}

// ---- 资源台账与约束(契约 §6;v1 ledger.ts) ----
/** Onboarding 存的是 `cex.binance` 这样的键;契约里的 venue_key 是 `binance`。 */
export function venueKeyOf(onboardingVenueKey: string): string {
  const key = (onboardingVenueKey || '').trim().toLowerCase();
  const dot = key.indexOf('.');
  return dot >= 0 ? key.slice(dot + 1) : key;
}
export interface LedgerEntry {
  recordId: string;
  organizationId: string;
  revision: number;
  visibility: Access;
  resourceType: string;
  resourceStage: string;
  accountRef: string;
  resourceRef: string;
  owner: string;
  environment: string;
  expiresOn: string;
}
type RecordRow = {
  id: string;
  organization_id: string;
  revision: number;
  visibility: Access;
  tab_id: string;
  structured: Record<string, string>;
};
async function recordRows(db: Db, tabs: string[], organizationId: string, admin: boolean) {
  return (
    await db.query<RecordRow>(
      `SELECT id, organization_id, revision, visibility, tab_id, structured
         FROM omniboard.module_records r
        WHERE tab_id = ANY($1) AND ($2 = '' OR organization_id = $2) AND (visibility = 'team' OR $3)
          AND NOT EXISTS (SELECT 1 FROM omniboard.record_aliases a WHERE a.alias_id = r.id)
        ORDER BY updated_at DESC, id COLLATE "C"`,
      [tabs, organizationId, admin],
    )
  ).rows;
}
/** 一个 venue 的资源台账就是它的 Onboarding 记录;给机构时只看该机构,看板合并所有机构。 */
export async function resourceLedger(
  db: Db,
  venueKey: string,
  organizationId = '',
  admin = true,
): Promise<LedgerEntry[]> {
  return (await recordRows(db, ['onboarding'], organizationId, admin)).flatMap((row) => {
    const s = row.structured;
    if (venueKeyOf(s.venueKey || '') !== venueKey) return [];
    return [
      {
        recordId: row.id,
        organizationId: row.organization_id,
        revision: row.revision,
        visibility: row.visibility,
        resourceType: s.resourceType || '',
        resourceStage: s.resourceStage || 'unknown',
        accountRef: s.accountRef || '',
        resourceRef: s.resourceRef || '',
        owner: s.businessOwner || s.owner || '',
        environment: s.environment || '',
        expiresOn: s.expiresOn || '',
      },
    ];
  });
}
export interface ConstraintRecord {
  recordId: string;
  organizationId: string;
  revision: number;
  visibility: Access;
  tabId: string;
  structured: Record<string, string>;
  affects: string[];
  value: Record<string, unknown> | undefined;
}
/** 带 sourceId 的 API Optimization 与 Tech Stack 记录。 */
export async function constraintRecords(
  db: Db,
  organizationId = '',
  admin = true,
): Promise<ConstraintRecord[]> {
  return (await recordRows(db, ['api_optimization', 'tech_stack'], organizationId, admin)).flatMap(
    (row) => {
      const structured = row.structured;
      if (!structured.sourceId) return [];
      const kind = structured.constraintKind || 'none';
      return [
        {
          recordId: row.id,
          organizationId: row.organization_id,
          revision: row.revision,
          visibility: row.visibility,
          tabId: row.tab_id,
          structured,
          affects: parseAffects(structured.affectsFeatureKeys),
          value: isConstraintKind(kind)
            ? parseConstraintValue(kind, structured.constraintValue).value
            : undefined,
        },
      ];
    },
  );
}
/** 两个 key 或 `.*` 子树互为前缀时重叠。 */
export function patternsOverlap(a: string, b: string): boolean {
  if (matchesPattern(a, b) || matchesPattern(b, a)) return true;
  const stripped = (p: string) => (p.endsWith('.*') ? p.slice(0, -2) : p);
  const x = stripped(a);
  const y = stripped(b);
  return x === y || x.startsWith(y + '.') || y.startsWith(x + '.');
}
function impliedResource(constraint: ConstraintRecord): ResourceType | undefined {
  const kind = constraint.structured.constraintKind;
  const value = constraint.value || {};
  const explicit = typeof value.resource_type === 'string' ? value.resource_type : '';
  if (kind === 'entitlement') return (explicit || 'vip_tier') as ResourceType;
  if (kind === 'network_route') {
    if (explicit) return explicit as ResourceType;
    const route = value.route;
    return route === 'colocation'
      ? 'colocation'
      : route === 'private_link'
        ? 'low_latency_stream'
        : 'whitelist';
  }
  return undefined;
}
/** 契约 §6:认证需要,加上命中该叶子的 entitlement / network_route 约束。 */
export function prerequisitesFor(
  featureKey: string,
  constraints: readonly ConstraintRecord[],
): ResourceType[] {
  const result: ResourceType[] = [];
  if (leafRequiresCredentials(featureKey)) result.push('api_credentials');
  for (const constraint of constraints) {
    const resource = impliedResource(constraint);
    if (!resource || !constraint.affects.some((p) => patternsOverlap(featureKey, p))) continue;
    if (!result.includes(resource)) result.push(resource);
  }
  return result;
}
/** 同一资源类型有多条记录时,先选环境相同的,再优先选 granted 的(11.1)。 */
function ledgerEntryFor(
  ledger: readonly LedgerEntry[],
  resource: string,
  environment: string,
): LedgerEntry | undefined {
  const candidates = ledger.filter((e) => e.resourceType === resource);
  const ranked = [
    ...candidates.filter((e) => environment && e.environment === environment),
    ...candidates.filter((e) => !environment || e.environment !== environment),
  ];
  return ranked.find((e) => e.resourceStage === 'granted') || ranked[0];
}
function isGranted(entry: LedgerEntry | undefined, resource: string): boolean {
  if (!entry || entry.resourceStage !== 'granted') return false;
  return resource === 'api_credentials' ? !!entry.accountRef : true;
}
/** 台账里没有、或还没 granted 的前置资源。 */
export function awaitingFor(
  prerequisites: readonly string[],
  ledger: readonly LedgerEntry[],
  environment = '',
): AwaitingItem[] {
  return prerequisites.flatMap((resource) => {
    const entry = ledgerEntryFor(ledger, resource, environment);
    if (isGranted(entry, resource)) return [];
    return [
      {
        resource,
        owner: entry?.owner || '',
        stage: entry?.resourceStage || 'missing',
        recordId: entry?.recordId || '',
      },
    ];
  });
}
/** Venue 详情的列头:每个环境的 api_credentials 台账(只跟踪 test 账户)。 */
export function credentialColumns(ledger: readonly LedgerEntry[]): CredentialColumn[] {
  return environments.flatMap((environment) =>
    (['test', 'production'] as const).map((accountKind) => {
      const entry =
        accountKind === 'test' ? ledgerEntryFor(ledger, 'api_credentials', environment) : undefined;
      return {
        environment,
        accountKind,
        credentials: entry
          ? {
              resourceStage: entry.resourceStage,
              owner: entry.owner,
              accountRefPresent: !!entry.accountRef,
              recordId: entry.recordId,
            }
          : null,
      };
    }),
  );
}

// ---- 请求的内容(契约 §4;v1 request.ts) ----
/** Onboarding 的能力码 → 契约的面。 */
export const capabilityFace: Record<string, Face> = {
  market: 'market',
  wallet: 'wallet',
  trading: 'trading',
  wallet_actions: 'wallet_action',
  transfer: 'transfer',
  asset_network: 'asset_network',
};
export const declaredFaces = (venue: DeclaredVenue | undefined): Face[] =>
  venue
    ? Object.values(capabilityFace).filter(
        (face) =>
          venue.factoryFlags[face] ||
          venue.declaredFeatures.some((f) => faceOf(f.feature_key) === face),
      )
    : [];
const codesOf = (capabilities: string) => [
  ...new Set(
    capabilities
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];
/** 约束载荷只含枚举、数字、URL、id;不可导出或 NDA 的只留 id、kind、origin。 */
export function exportConstraints(
  records: readonly ConstraintRecord[],
  today: string,
): ExportedConstraint[] {
  return records.flatMap((record) => {
    const s = record.structured;
    const kind = s.constraintKind || 'none';
    if (!isConstraintKind(kind) || !record.value) return [];
    const origin = { record_id: record.recordId, revision: record.revision };
    const exportable = s.constraintExportable !== 'no' && s.sensitivity !== 'NDA';
    if (!exportable) return [{ id: s.sourceId!, kind, origin }];
    const scope: Record<string, string | string[]> = {};
    if (s.accountModel && s.accountModel !== 'unknown') scope.account_model = s.accountModel;
    if (s.route && s.route !== 'unknown') scope.route = s.route;
    if (s.layer && s.layer !== 'unknown') scope.layer = s.layer;
    return [
      {
        id: s.sourceId!,
        kind,
        scope,
        value: record.value,
        evidence: (s.evidenceLevel || 'REPORTED') as 'REPORTED',
        sensitivity: (s.sensitivity || 'INTERNAL') as 'INTERNAL',
        collected_at: s.reviewedOn || today,
        origin,
        affects: { feature_keys: record.affects, files: [] },
        enforcement: constraintEnforcement[kind],
        exportable: true,
      },
    ];
  });
}
/** 请求的叶子:能力码的通配符;venue 声明了该面时展开为具体叶子。 */
function requestedLeaves(
  codes: readonly string[],
  venue: DeclaredVenue | undefined,
  constraints: readonly ConstraintRecord[],
  ledger: readonly LedgerEntry[],
  environment: string,
): RequestedLeaf[] {
  const leaves: RequestedLeaf[] = [];
  for (const code of codes) {
    const wildcard = capabilityWildcards[code];
    if (!wildcard) continue;
    const declared = (venue?.declaredFeatures || [])
      .map((f) => f.feature_key)
      .filter((key) => matchesPattern(key, wildcard));
    for (const key of declared.length ? declared : [wildcard]) {
      if (leaves.some((l) => l.feature_key === key)) continue;
      const prerequisites = prerequisitesFor(key, constraints);
      const awaiting = awaitingFor(prerequisites, ledger, environment);
      leaves.push({
        feature_key: key,
        prerequisites,
        awaiting: awaiting.map((a) => a.resource as ResourceType),
      });
    }
  }
  return leaves;
}
const environmentOf = (data: Record<string, string>) =>
  (environments as readonly string[]).includes(data.environment || '')
    ? (data.environment as RequestFile['environment'])
    : 'dev-cred';
async function buildRequest(
  db: Db,
  input: { organizationId: string; requestId: string; data: Record<string, string>; today: string },
): Promise<{ request: RequestFile; venue: DeclaredVenue | undefined }> {
  const { data } = input;
  const venueKey = venueKeyOf(data.venueKey || '');
  const venue = await declaredVenue(db, venueKey);
  const environment = environmentOf(data);
  const ledger = await resourceLedger(db, venueKey, input.organizationId);
  const constraints = await constraintRecords(db, input.organizationId);
  return {
    venue,
    request: {
      schema_version: 1,
      request_id: input.requestId,
      venue_key: venueKey,
      crate_path: venue?.cratePath || `connector/crates/conn-${venueKey}`,
      environment,
      account: { name: data.accountRef || 'unassigned', kind: 'test' },
      requested: requestedLeaves(
        codesOf(data.capabilities || ''),
        venue,
        constraints,
        ledger,
        environment,
      ),
      constraints: exportConstraints(constraints, input.today),
    },
  };
}
/**
 * 阻塞项(11.3),读取时按记录当前版本的字段与 venue 当前的声明计算;文案由界面转成可读说法
 * (web/presentation.ts readableBlocker)。
 */
export function requestBlockers(
  data: Record<string, string>,
  venue: DeclaredVenue | undefined,
  declaredRevision: string | null,
  today: string,
): string[] {
  const codes = codesOf(data.capabilities || '');
  const declared = declaredFaces(venue);
  const missing = venue ? codes.filter((code) => !declared.includes(capabilityFace[code]!)) : [];
  const blockers: string[] = [];
  if (!venue) blockers.push('No imported connector implementation for this venue.');
  if (missing.length) blockers.push('Missing declared capabilities: ' + missing.join(', '));
  if (!['CONTRACTED', 'VERIFIED', 'ENFORCED'].includes(data.evidenceLevel || ''))
    blockers.push('Resource evidence is not contracted or verified.');
  if (data.resourceStage !== 'granted') blockers.push('The resource has not been granted.');
  if (!data.resourceRef) blockers.push('A provider approval / resource reference is required.');
  if (data.expiresOn && data.expiresOn < today)
    blockers.push('The resource review or entitlement has expired.');
  if (data.nextAction !== 'propose_adapter_change' && !data.accountRef)
    blockers.push('An account reference is required.');
  if (codes.some((c) => c !== 'market') && !data.credentialRef)
    blockers.push('A secret-store reference is required for private capabilities.');
  if (venue && (venue.buildRevision || null) !== (declaredRevision || null))
    blockers.push('Connector inventory changed; save a new validation request.');
  return blockers;
}
/** 同一机构的请求写入串行:「每个记录 × 版本一个请求」与重发的检查读到的都是已提交状态。 */
async function lockRequests(client: Client, organizationId: string) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('requests:' || $1, 0))", [
    organizationId,
  ]);
}
async function insertRequest(
  client: Client,
  input: {
    organizationId: string;
    recordId: string;
    revision: number;
    data: Record<string, string>;
    today: string;
    reissueOf?: string;
  },
): Promise<{ id: string; request: RequestFile } | undefined> {
  const requestId = id();
  const { request, venue } = await buildRequest(client, { ...input, requestId });
  const inserted = await client.query(
    `INSERT INTO omniboard.connector_request
       (request_id, organization_id, record_id, record_revision, action, declared_revision, request,
        reissue_of)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
    [
      requestId,
      input.organizationId,
      input.recordId,
      input.revision,
      input.data.nextAction,
      venue?.buildRevision ?? null,
      request,
      input.reissueOf ?? null,
    ],
  );
  return inserted.rowCount ? { id: requestId, request } : undefined;
}

// ---- 读取时的状态(11.2–11.4;v1 state.ts) ----
/**
 * 契约 §2:queued(没有非 dirty 的 run)、running(有 run 没有完成时间)、passed、failed。
 * 每个 suite 以开始时间最新的 run 为准;dirty 构建只进开发视图。
 */
export function deriveRequestState(attempts: readonly AttemptRow[]): RequestStatus {
  const clean = attempts.filter((a) => !a.buildDirty);
  if (!clean.length) return 'queued';
  if (clean.some((a) => !a.finishedAt)) return 'running';
  const latestPerSuite = new Map<string, AttemptRow>();
  for (const attempt of clean) {
    const current = latestPerSuite.get(attempt.suite);
    if (!current || attempt.startedAt > current.startedAt)
      latestPerSuite.set(attempt.suite, attempt);
  }
  for (const attempt of latestPerSuite.values())
    if (attempt.status !== 'passed' || attempt.failedCount > 0) return 'failed';
  return 'passed';
}
/**
 * 请求内叶子的状态(11.2):只看本请求环境、test 账户、非 dirty 的结果;本请求自己的结果优先。
 * 有 failed 取 failed;通配符取最差,具体叶子取最新;没有结果时按是否待资源区分。
 */
function leafViews(
  request: RequestFile,
  requestId: string,
  rows: readonly VerificationRow[],
  ledger: readonly LedgerEntry[],
  options: ReadOptions,
): RequestLeafView[] {
  const pool = rows.filter(
    (r) => r.environment === request.environment && r.accountKind === 'test' && !r.buildDirty,
  );
  const worst = ['failed', 'skipped', 'passed'];
  return request.requested.map((leaf) => {
    const matching = pool.filter((r) => matchesPattern(r.featureKey, leaf.feature_key));
    const own = matching.filter((r) => r.requestId === requestId);
    const latest = [...(own.length ? own : matching)].sort((a, b) =>
      b.observedAt.localeCompare(a.observedAt),
    );
    const pick =
      latest.find((r) => r.status === 'failed') ||
      (leaf.feature_key.endsWith('.*')
        ? [...latest].sort((a, b) => worst.indexOf(a.status) - worst.indexOf(b.status))[0]
        : latest[0]);
    return {
      featureKey: leaf.feature_key,
      prerequisites: leaf.prerequisites,
      awaiting: leaf.awaiting.map((resource) => {
        const entry = ledgerEntryFor(ledger, resource, request.environment);
        return {
          resource,
          owner: entry?.owner || '',
          stage: entry?.resourceStage || 'missing',
          recordId: entry?.recordId || '',
        };
      }),
      status: pick ? pick.status : leaf.awaiting.length ? 'awaiting_resource' : 'no_result',
      observedAt: pick?.observedAt || null,
      runId: pick?.runId || null,
      skipReason: pick?.skipReason || null,
      errorText: pick?.errorText || null,
      stale: !!pick && isStale(pick.observedAt, options.now, options.staleDays),
    };
  });
}
type CurrentRow = {
  id: string;
  recordId: string;
  recordRevision: number;
  action: string;
  declaredRevision: string | null;
  reissueOf: string | null;
  createdAt: Date;
  request: RequestFile;
  structured: Record<string, string>;
};
/** 各记录当前版本的请求;重发过的只留最新一份。 */
async function currentRequests(db: Db, organizationId: string, admin: boolean) {
  return (
    await db.query<CurrentRow>(
      `SELECT q.request_id::text AS id, q.record_id AS "recordId", q.record_revision AS "recordRevision",
              q.action, q.declared_revision AS "declaredRevision", q.reissue_of::text AS "reissueOf",
              q.created_at AS "createdAt", q.request, r.structured
         FROM omniboard.connector_request q
         JOIN omniboard.module_records r ON r.id = q.record_id AND r.revision = q.record_revision
        WHERE q.organization_id = $1 AND (r.visibility = 'team' OR $2)
          AND NOT EXISTS (SELECT 1 FROM omniboard.connector_request n WHERE n.reissue_of = q.request_id)
        ORDER BY q.created_at DESC, q.request_id LIMIT 50`,
      [organizationId, admin],
    )
  ).rows;
}
/** 机构的当前请求与派生状态(只读)。 */
export async function integrationPlans(
  db: Db,
  organizationId: string,
  options: ReadOptions,
): Promise<RequestView[]> {
  const rows = await currentRequests(db, organizationId, options.admin);
  if (!rows.length) return [];
  const attempts = await attemptRows(db, { requestIds: rows.map((r) => r.id) });
  const venues = new Map<string, DeclaredVenue | undefined>();
  const results = new Map<string, VerificationRow[]>();
  const ledgers = new Map<string, LedgerEntry[]>();
  const today = options.now.slice(0, 10);
  const views: RequestView[] = [];
  for (const row of rows) {
    const venueKey = row.request.venue_key;
    if (!venues.has(venueKey)) {
      venues.set(venueKey, await declaredVenue(db, venueKey));
      results.set(venueKey, await verificationRows(db, venueKey));
      ledgers.set(venueKey, await resourceLedger(db, venueKey, organizationId, options.admin));
    }
    const own = attempts.filter((a) => a.requestId === row.id);
    views.push({
      id: row.id,
      recordId: row.recordId,
      recordRevision: row.recordRevision,
      venueKey: row.structured.venueKey || venueKey,
      action: row.action,
      declaredRevision: row.declaredRevision,
      reissueOf: row.reissueOf,
      createdAt: row.createdAt.toISOString(),
      state: deriveRequestState(own),
      blockers: requestBlockers(row.structured, venues.get(venueKey), row.declaredRevision, today),
      request: row.request,
      leaves: leafViews(
        row.request,
        row.id,
        results.get(venueKey)!,
        ledgers.get(venueKey)!,
        options,
      ),
      attempts: own,
    });
  }
  return views;
}
export interface VerificationAlert {
  id: string;
  title: string;
  detail: string;
  organizationId: string;
  targetId: string;
  kind: string;
}
/** "Needs attention"(11.5):失败的请求带上 run 阻塞项的下一步,以及已通过但过期的叶子。 */
export async function verificationAlerts(
  db: Db,
  organizationId: string,
  options: ReadOptions,
): Promise<VerificationAlert[]> {
  const alerts: VerificationAlert[] = [];
  const venues = new Set<string>();
  for (const plan of await integrationPlans(db, organizationId, options)) {
    venues.add(plan.request.venue_key);
    if (plan.state !== 'failed') continue;
    const steps = plan.attempts
      .filter((a) => !a.buildDirty && a.status !== 'passed')
      .flatMap((a) => a.blockers.map((b) => b.next_step).filter(Boolean));
    alerts.push({
      id: 'request:' + plan.id,
      targetId: plan.id,
      kind: 'request',
      organizationId,
      title: plan.request.venue_key + ' · Verification failed',
      detail: steps.length
        ? [...new Set(steps)].join(' · ')
        : 'Open the request for the failed run.',
    });
  }
  for (const venue of venues) {
    const stale = (await verificationRows(db, venue)).filter(
      (r) =>
        r.status === 'passed' &&
        !r.buildDirty &&
        isStale(r.observedAt, options.now, options.staleDays),
    );
    if (stale.length)
      alerts.push({
        id: 'stale:' + venue,
        targetId: venue,
        kind: 'connector',
        organizationId,
        title: venue + ' · ' + stale.length + ' verified leaves are stale',
        detail: 'Re-test: evidence is older than ' + options.staleDays + ' days.',
      });
  }
  return alerts;
}
/** 机构当前请求里已完成、非 dirty 的通过 run:标准 validation 任务可以一键完成(10.4 第 11 项)。 */
export async function verificationEvidence(
  db: Db,
  organizationId: string,
  admin: boolean,
): Promise<VerificationEvidence[]> {
  const rows = await currentRequests(db, organizationId, admin);
  if (!rows.length) return [];
  const record = new Map(rows.map((r) => [r.id, r.recordId]));
  return (await attemptRows(db, { requestIds: rows.map((r) => r.id) }))
    .filter((a) => a.status === 'passed' && a.finishedAt && !a.buildDirty)
    .map((a) => ({ ...a, requestRecordId: record.get(a.requestId)! }));
}

// ---- 记录保存后的钩子(11.1、11.5;v1 hooks.ts) ----
export type SavedRecord = {
  organizationId: string;
  tabId: string;
  recordId: string;
  revision: number;
  visibility: Access;
  evidenceId: string;
  structured: Record<string, string>;
  previous?: Record<string, string>;
};
/** 由验证结果与台账产生的 engineering 任务;同标题的任务还没完成时不重复建。 */
async function createFollowTask(
  client: Client,
  user: User,
  record: SavedRecord,
  title: string,
  description: string,
  nextStep: string,
) {
  await lockWork(client, record.organizationId);
  const open = await client.query(
    `SELECT 1 FROM omniboard.work_tasks
      WHERE organization_id = $1 AND title = $2 AND state NOT IN ('done','skipped')`,
    [record.organizationId, title],
  );
  if (open.rowCount) return undefined;
  const taskId = id();
  await client.query(
    `INSERT INTO omniboard.work_tasks
       (id, organization_id, title, lane, state, origin, description, visibility, source_record_id,
        evidence_id, next_step)
     VALUES ($1,$2,$3,'engineering','planned','discovery',$4,$5,$6,$7,$8)`,
    [
      taskId,
      record.organizationId,
      title,
      description,
      record.visibility,
      record.recordId,
      record.evidenceId,
      nextStep,
    ],
  );
  await event(
    client,
    record.organizationId,
    taskId,
    'task',
    'New information → ' + title,
    record.visibility,
    user,
    { sourceRecordId: record.recordId, revision: record.revision, evidenceId: record.evidenceId },
  );
  return taskId;
}
const grantedWithRefs = (s: Record<string, string> | undefined) =>
  !!s && s.resourceStage === 'granted' && !!(s.accountRef || s.resourceRef);
/**
 * 资源首次获批且填了引用(11.5):本机构当前还在等这个资源类型的请求按新台账重发(新 request_id,
 * 旧快照保留并标为被取代),并生成一条 ready 的 engineering 任务。
 */
async function reissueAwaiting(client: Client, user: User, record: SavedRecord, today: string) {
  const resource = record.structured.resourceType || '';
  const reissued: string[] = [];
  let unlocked = 0;
  for (const row of await currentRequests(client, record.organizationId, true)) {
    const waiting = row.request.requested.filter((leaf) =>
      (leaf.awaiting as string[]).includes(resource),
    );
    if (!waiting.length) continue;
    const fresh = await insertRequest(client, {
      organizationId: record.organizationId,
      recordId: row.recordId,
      revision: row.recordRevision,
      data: { ...row.structured, nextAction: row.action },
      today,
      reissueOf: row.id,
    });
    if (!fresh) continue;
    for (const leaf of waiting)
      if (
        fresh.request.requested.find((l) => l.feature_key === leaf.feature_key)?.awaiting.length ===
        0
      )
        unlocked++;
    reissued.push(fresh.id);
  }
  if (!reissued.length) return undefined;
  const venue = venueKeyOf(record.structured.venueKey || '');
  return createFollowTask(
    client,
    user,
    record,
    `${venue} ${resource.replaceAll('_', ' ')} granted · ${unlocked} leaves can be verified`,
    `Requests reissued after the resource was granted: ${reissued.join(', ')}.\nRun the quant skill deliver-connector-request with each request id to verify the unlocked leaves.`,
    'Run the reissued request(s) in quant and wait for the verification results.',
  );
}
/**
 * 约束漂移(11.5):带 sourceId 的记录出了新版本,而这个约束曾进过某个请求 → 一条 engineering 任务,
 * 列出受影响的叶子与请求。
 */
async function onConstraintSaved(client: Client, user: User, record: SavedRecord) {
  const sourceId = record.structured.sourceId;
  if (!sourceId || record.revision < 2) return undefined;
  const requests = (
    await client.query<{ id: string; request: RequestFile }>(
      `SELECT request_id::text AS id, request FROM omniboard.connector_request
        WHERE organization_id = $1 AND request->'constraints' @> $2::jsonb
        ORDER BY created_at, request_id`,
      [record.organizationId, JSON.stringify([{ id: sourceId }])],
    )
  ).rows;
  if (!requests.length) return undefined;
  const oldRevision = Math.max(
    ...requests.flatMap((q) =>
      q.request.constraints.filter((c) => c.id === sourceId).map((c) => c.origin.revision),
    ),
  );
  const patterns = parseAffects(record.structured.affectsFeatureKeys);
  const affected = new Set<string>();
  for (const q of requests)
    for (const leaf of q.request.requested)
      if (
        patterns.some((p) =>
          leaf.feature_key.endsWith('.*')
            ? patternsOverlap(leaf.feature_key, p)
            : matchesPattern(leaf.feature_key, p),
        )
      )
        affected.add(leaf.feature_key);
  const affectedList = affected.size ? [...affected] : patterns;
  return createFollowTask(
    client,
    user,
    record,
    `Constraint ${sourceId} changed · rev ${oldRevision} → ${record.revision}`,
    `The exported constraint ${sourceId} has a new revision (${record.revision}); quant code and sources.md still reference rev ${oldRevision}.\nAffected feature keys: ${affectedList.join(', ') || 'none listed'}.\nRequests carrying the constraint: ${requests.map((q) => q.id).join(', ')}.`,
    `Update the SRC: ${sourceId} references in quant to rev ${record.revision} and re-test the affected leaves.`,
  );
}
/** 记录保存事务里调用:Onboarding 生成本版本的请求并解锁等待中的请求;约束记录检查漂移。 */
export async function onRecordSaved(
  client: Client,
  user: User,
  record: SavedRecord,
  today: string,
) {
  if (record.tabId === 'onboarding') {
    await lockRequests(client, record.organizationId);
    const action = record.structured.nextAction;
    const created =
      action && action !== 'none'
        ? await insertRequest(client, {
            organizationId: record.organizationId,
            recordId: record.recordId,
            revision: record.revision,
            data: record.structured,
            today,
          })
        : undefined;
    const unlockTask =
      grantedWithRefs(record.structured) && !grantedWithRefs(record.previous)
        ? await reissueAwaiting(client, user, record, today)
        : undefined;
    return { requestId: created?.id, unlockTask };
  }
  if (record.tabId === 'api_optimization' || record.tabId === 'tech_stack') {
    await lockRequests(client, record.organizationId);
    return { driftTask: await onConstraintSaved(client, user, record) };
  }
  return undefined;
}
