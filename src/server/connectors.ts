import type { Pool } from './db';
import {
  accountKinds,
  environments,
  faceOf,
  faceOwnerPaths,
  faces,
  isStale,
  leafColor,
  matchesPattern,
  worstColor,
  type Face,
} from '../shared/verification-contract';
import type {
  AwaitingItem,
  BoardLeaf,
  CellView,
  ConnectorBoard,
  FaceSummary,
  LeafDetail,
  LeafState,
  VenueBoard,
  VenueSummary,
} from '../shared/integration';
import {
  attemptRows,
  awaitingFor,
  constraintRecords,
  credentialColumns,
  declaredVenue,
  declaredVenues,
  prerequisitesFor,
  resourceLedger,
  venueKeyOf,
  verificationRows,
  type DeclaredVenue,
  type ReadOptions,
  type VerificationRow,
} from './connector-requests';
import type { RequestFile } from '../shared/verification-contract';
// Connector 看板(frontend-spec 11.6–11.8),从 v1 src/server/integration/board.ts 迁移;
// 读的是 quant 的只读视图,不再经本地投影。

async function venueOrganizations(pool: Pool, venueKey: string, admin: boolean) {
  const rows = await pool.query<{ id: string; name: string; venue: string }>(
    `SELECT DISTINCT o.id, o.name, r.structured->>'venueKey' AS venue
       FROM omniboard.module_records r JOIN omniboard.organizations o ON o.id = r.organization_id
      WHERE r.tab_id = 'onboarding' AND (r.visibility = 'team' OR $1)
        AND NOT EXISTS (SELECT 1 FROM omniboard.organization_aliases a WHERE a.alias_id = o.id)
      ORDER BY o.name, o.id`,
    [admin],
  );
  const seen = new Set<string>();
  return rows.rows
    .filter((r) => venueKeyOf(r.venue || '') === venueKey && !seen.has(r.id) && seen.add(r.id))
    .map(({ id, name }) => ({ id, name }));
}
function leafState(
  latest: VerificationRow | undefined,
  awaiting: AwaitingItem[],
  options: ReadOptions,
): { state: LeafState; stale: boolean } {
  if (!latest) return { state: awaiting.length ? 'awaiting_resource' : 'no_result', stale: false };
  const stale = isStale(latest.observedAt, options.now, options.staleDays);
  if (latest.status === 'failed') return { state: 'failed', stale };
  if (latest.status === 'passed') return { state: stale ? 'stale' : 'passed', stale };
  return { state: awaiting.length ? 'awaiting_resource' : 'skipped', stale };
}
const cell = (row: VerificationRow, options: ReadOptions): CellView => ({
  status: row.status,
  observedAt: row.observedAt,
  runId: row.runId,
  requestId: row.requestId,
  stale: isStale(row.observedAt, options.now, options.staleDays),
  skipReason: row.skipReason,
  errorText: row.errorText,
});
async function evaluateVenue(pool: Pool, venue: DeclaredVenue, options: ReadOptions) {
  const rows = (await verificationRows(pool, venue.venueKey)).filter((r) => !r.buildDirty);
  const organizations = await venueOrganizations(pool, venue.venueKey, options.admin);
  const ledger = await resourceLedger(pool, venue.venueKey, '', options.admin);
  const constraints = (
    await Promise.all(organizations.map((o) => constraintRecords(pool, o.id, options.admin)))
  ).flat();
  const leaves: BoardLeaf[] = venue.declaredFeatures.map((feature) => {
    const key = feature.feature_key;
    const own = rows.filter((r) => r.featureKey === key);
    const latest = own[0];
    const prerequisites = prerequisitesFor(key, constraints);
    const awaiting = awaitingFor(prerequisites, ledger, latest?.environment || '');
    const { state, stale } = leafState(latest, awaiting, options);
    const cells: Record<string, CellView | null> = {};
    for (const environment of environments)
      for (const kind of accountKinds) {
        const found = own.find((r) => r.environment === environment && r.accountKind === kind);
        cells[environment + '/' + kind] = found ? cell(found, options) : null;
      }
    return {
      featureKey: key,
      declaredBy: feature.declared_by,
      state,
      color: leafColor({
        declared: true,
        status: latest?.status,
        observedAt: latest?.observedAt,
        awaiting: awaiting.map((a) => a.resource),
        now: options.now,
        staleDays: options.staleDays,
      }),
      prerequisites,
      awaiting,
      latest: latest ? { ...cell(latest, options), stale } : null,
      cells,
    };
  });
  const summary = {} as Record<Face, FaceSummary>;
  for (const face of faces) {
    const own = leaves.filter((l) => faceOf(l.featureKey) === face);
    const declared = !!venue.factoryFlags[face] || own.length > 0;
    summary[face] = {
      color: !declared ? 'grey' : own.length ? worstColor(own.map((l) => l.color)) : 'amber',
      declared,
      leaves: own.length,
      passed: own.filter((l) => l.state === 'passed').length,
      failed: own.filter((l) => l.state === 'failed').length,
      awaiting: own.filter((l) => l.state === 'awaiting_resource').length,
      unverified: own.filter((l) => l.state === 'no_result' || l.state === 'skipped').length,
      stale: own.filter((l) => l.state === 'stale').length,
    };
  }
  const verifiedAt = rows.reduce<string | null>(
    (max, r) => (!max || r.observedAt > max ? r.observedAt : max),
    null,
  );
  const venueSummary: VenueSummary = {
    venueKey: venue.venueKey,
    sourceId: venue.sourceId,
    cratePath: venue.cratePath,
    buildRevision: venue.buildRevision,
    buildDirty: venue.buildDirty,
    observedAt: venue.observedAt,
    verifiedAt,
    declaredCount: venue.declaredFeatures.length,
    organizations,
    faces: summary,
  };
  return { venueSummary, leaves, ledger, rows };
}
/** 总览矩阵:venue × 能力面(11.6)。告警由调用方附上。 */
export async function connectorBoard(
  pool: Pool,
  options: ReadOptions,
): Promise<Omit<ConnectorBoard, 'alerts' | 'grafanaUrl'>> {
  const venues: VenueSummary[] = [];
  for (const venue of await declaredVenues(pool))
    venues.push((await evaluateVenue(pool, venue, options)).venueSummary);
  const latest = (values: (string | null)[]) =>
    values.reduce<string | null>((max, v) => (v && (!max || v > max) ? v : max), null);
  return {
    venues,
    staleDays: options.staleDays,
    declaredAt: latest(venues.map((v) => v.observedAt)),
    verifiedAt: latest(venues.map((v) => v.verifiedAt)),
  };
}
/** Venue 详情(11.7):标题卡、按环境 × 账户类型的叶子矩阵与列头的凭据台账。 */
export async function venueBoard(
  pool: Pool,
  venueKey: string,
  options: ReadOptions,
): Promise<Omit<VenueBoard, 'grafanaUrl'> | undefined> {
  const venue = await declaredVenue(pool, venueKey);
  if (!venue) return undefined;
  const { venueSummary, leaves, ledger } = await evaluateVenue(pool, venue, options);
  return {
    venue: venueSummary,
    staleDays: options.staleDays,
    columns: credentialColumns(ledger),
    faces: faces.map((face) => ({
      face,
      color: venueSummary.faces[face].color,
      ownerPath: faceOwnerPaths[face],
      summary: venueSummary.faces[face],
      leaves: leaves.filter((l) => faceOf(l.featureKey) === face),
    })),
  };
}
/** 叶子详情(11.8):该叶子的全部验证结果,以及覆盖它的请求的 run。 */
export async function leafDetail(
  pool: Pool,
  venueKey: string,
  featureKey: string,
  options: ReadOptions,
): Promise<LeafDetail | undefined> {
  const venue = await declaredVenue(pool, venueKey);
  if (!venue) return undefined;
  const { leaves } = await evaluateVenue(pool, venue, options);
  const face = faceOf(featureKey) || null;
  const requests = (
    await pool.query<{ id: string; request: RequestFile }>(
      `SELECT q.request_id::text AS id, q.request
         FROM omniboard.connector_request q JOIN omniboard.module_records r ON r.id = q.record_id
        WHERE q.request->>'venue_key' = $1 AND (r.visibility = 'team' OR $2)`,
      [venueKey, options.admin],
    )
  ).rows.flatMap((row) => {
    const match = row.request.requested.find((l) => matchesPattern(featureKey, l.feature_key));
    return match ? [{ id: row.id, requestedAs: match.feature_key }] : [];
  });
  const byRequest = new Map(requests.map((r) => [r.id, r.requestedAs]));
  return {
    venueKey,
    featureKey,
    face,
    ownerPath: face ? faceOwnerPaths[face] : null,
    declared: venue.declaredFeatures.some((f) => f.feature_key === featureKey),
    leaf: leaves.find((l) => l.featureKey === featureKey) || null,
    rows: (await verificationRows(pool, venueKey))
      .filter((r) => r.featureKey === featureKey)
      .map((r) => ({
        ...cell(r, options),
        featureKey: r.featureKey,
        environment: r.environment,
        accountKind: r.accountKind,
        buildRevision: r.buildRevision,
        buildDirty: r.buildDirty,
      })),
    attempts: (await attemptRows(pool, { venueKey }))
      .filter((a) => byRequest.has(a.requestId))
      .map((a) => ({ ...a, requestedAs: byRequest.get(a.requestId)! })),
  };
}
