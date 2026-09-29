// HFT 配置(frontend-spec 12.8、data-model 5.2):management.hft_config 一行 + 该 channel 的 hft_group_limit。
// 规则与 quant `HftConfigFile::validate` 和表上的 CHECK 相同,前端与服务端共用。

export type GroupLimit = {
  predictionGroup: string;
  maxGrossExposureUsd: number;
  maxAbsNetExposureUsd: number;
};
export type HftSettings = {
  portfolioGroup: string;
  maxActiveGroups: number;
  maxPortfolioGrossExposureUsd: number;
  maxPortfolioAbsNetExposureUsd: number;
  maxWalletGrossToAssetsRatio: number;
  /** 按 prediction group 排序。 */
  groupLimits: GroupLimit[];
};
export type HftChannel = HftSettings & {
  channel: string;
  /** 微秒精度的 ISO 时间:保存时原样带回,判断别人是否改过(409)。 */
  updateAt: string;
};
export type HftAuditEntry = {
  id: string;
  at: string;
  actorName: string;
  action: string;
  before: HftSettings | null;
  after: HftSettings;
};
export type HftChannelDetail = HftChannel & {
  /** 所有 channel 里用过的 prediction group,供输入提示。 */
  knownGroups: string[];
  audit: HftAuditEntry[];
};

export type HftField = Exclude<keyof HftSettings, 'groupLimits'>;
export const fieldLabels: Record<HftField, string> = {
  portfolioGroup: 'Portfolio group',
  maxActiveGroups: 'Max active groups',
  // 列名是 max_portfolio_*,但 quant 按「每组」使用,不按组数平分(business-hft HftDispatchPolicy)。
  maxPortfolioGrossExposureUsd: 'Max gross exposure per group (USD)',
  maxPortfolioAbsNetExposureUsd: 'Max |net| exposure per group (USD)',
  maxWalletGrossToAssetsRatio: 'Max wallet gross / assets ratio',
};
/** 字段旁的约束说明(12.8)。 */
export const fieldRules: Record<HftField, string> = {
  portfolioGroup: 'Accounts tagged with this portfolio group. No surrounding spaces.',
  maxActiveGroups: 'Whole number greater than 0.',
  maxPortfolioGrossExposureUsd:
    'Greater than 0. Applies to each running group, not split across groups; group overrides below replace it.',
  maxPortfolioAbsNetExposureUsd:
    'Greater than 0 and not above the gross limit. Applies to each running group.',
  maxWalletGrossToAssetsRatio: 'Between 0 and 1, exclusive.',
};
export const MAX_ACTIVE_GROUPS = 2_147_483_647; // integer 列

/** channel、portfolio group、prediction group:非空,前后无空白。 */
export function identityProblem(value: string): string | null {
  if (!value.trim()) return 'Required.';
  if (value.trim() !== value) return 'Remove the spaces at the start or end.';
  return null;
}
/** quant `PredictionGroup::from_str`:`BaseAsset_<asset>` 或 `Beta_<name>`。库里不查,写错 HFT 启动失败。 */
export function predictionGroupProblem(value: string): string | null {
  const identity = identityProblem(value);
  if (identity) return identity;
  if (!/^(BaseAsset|Beta)_./.test(value)) return 'Use BaseAsset_<asset> or Beta_<name>.';
  return null;
}
/** 表单里的十进制数;空、非数字、Infinity 为 null。按完整精度,不做缩写。 */
export function parseDecimal(text: string): number | null {
  const t = text.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
export const decimalText = (value: number) => String(value);

const positive = (n: number) => Number.isFinite(n) && n > 0;
export function fieldProblem(field: HftField, s: HftSettings): string | null {
  switch (field) {
    case 'portfolioGroup':
      return identityProblem(s.portfolioGroup);
    case 'maxActiveGroups':
      return Number.isInteger(s.maxActiveGroups) &&
        s.maxActiveGroups > 0 &&
        s.maxActiveGroups <= MAX_ACTIVE_GROUPS
        ? null
        : 'Must be a whole number greater than 0.';
    case 'maxPortfolioGrossExposureUsd':
      return positive(s.maxPortfolioGrossExposureUsd) ? null : 'Must be greater than 0.';
    case 'maxPortfolioAbsNetExposureUsd':
      return positive(s.maxPortfolioAbsNetExposureUsd) &&
        s.maxPortfolioAbsNetExposureUsd <= s.maxPortfolioGrossExposureUsd
        ? null
        : 'Must be greater than 0 and not above the gross limit.';
    case 'maxWalletGrossToAssetsRatio':
      return Number.isFinite(s.maxWalletGrossToAssetsRatio) &&
        s.maxWalletGrossToAssetsRatio > 0 &&
        s.maxWalletGrossToAssetsRatio < 1
        ? null
        : 'Must be between 0 and 1, exclusive.';
  }
}
export function groupLimitProblem(limit: GroupLimit, others: GroupLimit[]): string | null {
  const name = predictionGroupProblem(limit.predictionGroup);
  if (name) return `Prediction group: ${name}`;
  if (others.some((o) => o.predictionGroup === limit.predictionGroup))
    return 'This prediction group is listed twice.';
  if (!positive(limit.maxGrossExposureUsd)) return 'Max gross exposure must be greater than 0.';
  if (
    !positive(limit.maxAbsNetExposureUsd) ||
    limit.maxAbsNetExposureUsd > limit.maxGrossExposureUsd
  )
    return 'Max |net| exposure must be greater than 0 and not above the gross limit.';
  return null;
}
/** 第一个问题;服务端用它返回 422。 */
export function settingsProblem(s: HftSettings): string | null {
  for (const field of Object.keys(fieldLabels) as HftField[]) {
    const p = fieldProblem(field, s);
    if (p) return `${fieldLabels[field]}: ${p}`;
  }
  for (const [i, limit] of s.groupLimits.entries()) {
    const p = groupLimitProblem(limit, s.groupLimits.slice(0, i));
    if (p) return `Group limit ${limit.predictionGroup || i + 1}: ${p}`;
  }
  return null;
}
export const sortLimits = (limits: GroupLimit[]) =>
  [...limits].sort((a, b) => (a.predictionGroup < b.predictionGroup ? -1 : 1));

/** 改前 / 改后对照(12.8 保存):组合级字段与组覆盖的新增、删除、修改。 */
export type HftChange = { field: string; before: string; after: string };
export function hftChanges(before: HftSettings, after: HftSettings): HftChange[] {
  const text = (v: string | number) => (typeof v === 'number' ? decimalText(v) : v);
  const rows: HftChange[] = (Object.keys(fieldLabels) as HftField[])
    .filter((f) => before[f] !== after[f])
    .map((f) => ({ field: fieldLabels[f], before: text(before[f]), after: text(after[f]) }));
  const limitText = (l: GroupLimit | undefined) =>
    l
      ? `gross ${decimalText(l.maxGrossExposureUsd)} · |net| ${decimalText(l.maxAbsNetExposureUsd)}`
      : '—';
  const groups = [
    ...new Set([...before.groupLimits, ...after.groupLimits].map((l) => l.predictionGroup)),
  ].sort();
  for (const group of groups) {
    const a = before.groupLimits.find((l) => l.predictionGroup === group);
    const b = after.groupLimits.find((l) => l.predictionGroup === group);
    if (limitText(a) !== limitText(b))
      rows.push({ field: `Group ${group}`, before: limitText(a), after: limitText(b) });
  }
  return rows;
}
