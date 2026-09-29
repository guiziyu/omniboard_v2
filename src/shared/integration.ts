// 接入请求与 Connector 看板的读模型类型(frontend-spec 11),从 v1 src/server/integration/(state、board、
// ledger)的类型迁移。请求状态、叶子状态与阻塞项都在读取时计算,不存(data-model §3.6)。
import type { Face, LeafColor, RequestFile, RequestStatus, Blocker } from './verification-contract';
import type { ModuleData } from './types';
import type { WorkTask } from './operations';

/** `verification.v_live_test_run_by_request` 的一行。 */
export interface AttemptRow {
  runId: string;
  requestId: string;
  venueKey: string;
  suite: string;
  environment: string;
  accountName: string;
  accountKind: string;
  buildRevision: string;
  buildDirty: boolean;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  blockers: Blocker[];
  passedCount: number;
  failedCount: number;
  skippedCount: number;
}
export interface AwaitingItem {
  resource: string;
  owner: string;
  stage: string;
  recordId: string;
}
/** 请求里一片叶子的当前状态(11.2)。 */
export interface RequestLeafView {
  featureKey: string;
  prerequisites: string[];
  awaiting: AwaitingItem[];
  status: string;
  observedAt: string | null;
  runId: string | null;
  skipReason: string | null;
  errorText: string | null;
  stale: boolean;
}
/** 一条记录当前版本的接入请求(11.2–11.4)。 */
export interface RequestView {
  id: string;
  recordId: string;
  recordRevision: number;
  /** Onboarding 记录里的 Provider connection ID,例如 `cex.bitget`。 */
  venueKey: string;
  action: string;
  declaredRevision: string | null;
  /** 资源获批后重发时,被取代的旧请求 id(11.5)。 */
  reissueOf: string | null;
  createdAt: string;
  state: RequestStatus;
  blockers: string[];
  request: RequestFile;
  leaves: RequestLeafView[];
  attempts: AttemptRow[];
}
/** 可用于一键完成标准 validation 任务的 run(10.4 第 11 项)。 */
export interface VerificationEvidence extends AttemptRow {
  requestRecordId: string;
}
/** Overview 的我方工作摘要(4.8)。 */
export interface WorkRequest {
  id: string;
  recordId: string;
  state: string;
  blockers: string[];
  awaiting: string[];
  createdAt: string;
}
export interface OrganizationWork {
  organizationId: string;
  asOf: string;
  tasks: WorkTask[];
  onboarding: ModuleData;
  contacts: ModuleData;
  compliance: ModuleData;
  requests: WorkRequest[];
}

// ---- Connector 看板(11.6–11.8) ----
export type LeafState =
  'passed' | 'failed' | 'skipped' | 'no_result' | 'stale' | 'awaiting_resource';
export interface FaceSummary {
  color: LeafColor;
  declared: boolean;
  leaves: number;
  passed: number;
  failed: number;
  awaiting: number;
  unverified: number;
  stale: number;
}
export interface VenueSummary {
  venueKey: string;
  sourceId: string;
  cratePath: string;
  buildRevision: string;
  buildDirty: boolean;
  observedAt: string;
  verifiedAt: string | null;
  declaredCount: number;
  organizations: { id: string; name: string }[];
  faces: Record<Face, FaceSummary>;
}
export interface CellView {
  status: string;
  observedAt: string;
  runId: string;
  requestId: string | null;
  stale: boolean;
  skipReason: string | null;
  errorText: string | null;
}
export interface BoardLeaf {
  featureKey: string;
  declaredBy: string;
  state: LeafState;
  color: LeafColor;
  prerequisites: string[];
  awaiting: AwaitingItem[];
  latest: CellView | null;
  cells: Record<string, CellView | null>;
}
export interface CredentialColumn {
  environment: string;
  accountKind: 'test' | 'production';
  credentials: {
    resourceStage: string;
    owner: string;
    accountRefPresent: boolean;
    recordId: string;
  } | null;
}
export interface ConnectorBoard {
  venues: VenueSummary[];
  staleDays: number;
  grafanaUrl: string;
  /** 数据截至何时(11.6):最新的声明与最新的非 dirty 验证结果。 */
  declaredAt: string | null;
  verifiedAt: string | null;
  alerts: { id: string; title: string; detail: string; kind: string }[];
}
export interface VenueBoard {
  venue: VenueSummary;
  staleDays: number;
  grafanaUrl: string;
  columns: CredentialColumn[];
  faces: {
    face: Face;
    color: LeafColor;
    ownerPath: string;
    summary: FaceSummary;
    leaves: BoardLeaf[];
  }[];
}
export interface VerificationRowView extends CellView {
  featureKey: string;
  environment: string;
  accountKind: string;
  buildRevision: string;
  buildDirty: boolean;
}
export interface LeafDetail {
  venueKey: string;
  featureKey: string;
  face: Face | null;
  ownerPath: string | null;
  declared: boolean;
  leaf: BoardLeaf | null;
  rows: VerificationRowView[];
  attempts: (AttemptRow & { requestedAs: string })[];
}
