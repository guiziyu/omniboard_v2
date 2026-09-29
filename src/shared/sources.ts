// 数据来源页(frontend-spec 9.5–9.7)的接口形状。
export const webSources = ['cmc_web', 'coingecko_web'] as const;
export type WebSourceId = (typeof webSources)[number];
export type RunStatus = 'running' | 'success' | 'failed' | 'interrupted';
export type CollectionRun = {
  id: string;
  source: WebSourceId;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  rowCount: number;
  error: string | null;
  evidenceId: string | null;
};
export type SourceMapping = {
  id: string;
  source: WebSourceId;
  name: string;
  slug: string;
  organizationId: string;
  organizationName: string;
  mappedBy: string | null;
};
export type SourcesState = {
  runs: CollectionRun[];
  /** 仅 admin 返回;其他角色为空数组。 */
  mappings: SourceMapping[];
  daily: boolean;
  running: boolean;
};
/** 采集到的一个数值:value 是十进制字符串,无法解析时为 null(不当作 0)。 */
export type SourceMetric = {
  key: string;
  label: string;
  value: string | null;
  unit: string;
  rawText: string;
  precision: number | null;
};
export type SourceRow = {
  slug: string;
  name: string;
  url: string;
  rank: number;
  metrics: SourceMetric[];
};
