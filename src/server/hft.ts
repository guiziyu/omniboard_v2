import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { problem, type AuthContext } from './auth';
import { audit, type AuditAction } from './audit';
import { quantWrite, requireLiveWrite, requireTrader } from './access';
import type { Client, Pool } from './db';
import {
  hftChanges,
  identityProblem,
  settingsProblem,
  sortLimits,
  type GroupLimit,
  type HftAuditEntry,
  type HftChannel,
  type HftChannelDetail,
  type HftSettings,
} from '../shared/hft';
// HFT 配置(frontend-spec 12.8、data-model 5.2):写 quant 的 management.hft_config 与 hft_group_limit。
// 保存语义与 `sync_hft_config --apply` 相同:一个事务里 upsert 那一行、删掉该 channel 的组覆盖再按表单插入。
// HFT 启动时加载后冻结,改动在下次重启后生效(D4)。

const TABLE = 'management.hft_config';
// update_at 按微秒比较:quant 写入的时间带微秒,JS Date 只到毫秒。
const updateAt = `to_char(c.update_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const channelSelect = `
  SELECT c.channel, c.portfolio_group AS "portfolioGroup", c.max_active_groups AS "maxActiveGroups",
         c.max_portfolio_gross_exposure_usd AS "maxPortfolioGrossExposureUsd",
         c.max_portfolio_abs_net_exposure_usd AS "maxPortfolioAbsNetExposureUsd",
         c.max_wallet_gross_to_assets_ratio AS "maxWalletGrossToAssetsRatio",
         ${updateAt} AS "updateAt",
         COALESCE((SELECT json_agg(json_build_object(
                     'predictionGroup', l.prediction_group,
                     'maxGrossExposureUsd', l.max_gross_exposure_usd,
                     'maxAbsNetExposureUsd', l.max_abs_net_exposure_usd)
                   ORDER BY l.prediction_group)
                     FROM management.hft_group_limit l WHERE l.channel = c.channel), '[]') AS "groupLimits"
    FROM management.hft_config c`;
async function readChannel(db: Pool | Client, channel: string, lock = false) {
  const row = (
    await db.query<HftChannel>(
      `${channelSelect} WHERE c.channel = $1 ${lock ? 'FOR UPDATE OF c' : ''}`,
      [channel],
    )
  ).rows[0];
  if (!row) problem(404, 'Channel not found.');
  return row;
}
const settingsOf = (row: HftChannel): HftSettings => ({
  portfolioGroup: row.portfolioGroup,
  maxActiveGroups: row.maxActiveGroups,
  maxPortfolioGrossExposureUsd: row.maxPortfolioGrossExposureUsd,
  maxPortfolioAbsNetExposureUsd: row.maxPortfolioAbsNetExposureUsd,
  maxWalletGrossToAssetsRatio: row.maxWalletGrossToAssetsRatio,
  groupLimits: row.groupLimits,
});

// ---- 输入:类型在这里,取值规则与前端共用(shared/hft)----
const amount = z.number().finite();
const settingsInput = z
  .object({
    portfolioGroup: z.string().max(100),
    maxActiveGroups: z.number().int(),
    maxPortfolioGrossExposureUsd: amount,
    maxPortfolioAbsNetExposureUsd: amount,
    maxWalletGrossToAssetsRatio: amount,
    groupLimits: z
      .array(
        z
          .object({
            predictionGroup: z.string().max(100),
            maxGrossExposureUsd: amount,
            maxAbsNetExposureUsd: amount,
          })
          .strict(),
      )
      .max(500),
  })
  .strict();
function checked(input: HftSettings): HftSettings {
  const text = settingsProblem(input);
  if (text) problem(422, text);
  return { ...input, groupLimits: sortLimits(input.groupLimits) };
}

async function writeLimits(client: Client, channel: string, limits: GroupLimit[]) {
  await client.query('DELETE FROM management.hft_group_limit WHERE channel = $1', [channel]);
  for (const l of limits)
    await client.query(
      `INSERT INTO management.hft_group_limit
         (channel, prediction_group, max_gross_exposure_usd, max_abs_net_exposure_usd, update_at)
       VALUES ($1,$2,$3,$4,now())`,
      [channel, l.predictionGroup, l.maxGrossExposureUsd, l.maxAbsNetExposureUsd],
    );
}
const configValues = (s: HftSettings) => [
  s.portfolioGroup,
  s.maxActiveGroups,
  s.maxPortfolioGrossExposureUsd,
  s.maxPortfolioAbsNetExposureUsd,
  s.maxWalletGrossToAssetsRatio,
];

export function registerHftRoutes(app: FastifyInstance, ctx: AuthContext) {
  const { pool } = ctx;
  const liveWrite = (request: FastifyRequest, action: AuditAction, channel: string) => ({
    actor: request.actor,
    targetTable: TABLE,
    targetKey: channel,
    stepUp: false, // 当场确认暂缓(frontend-spec 12.4 TODO)
    notify: true,
    action,
  });

  app.get('/api/hft', async (request): Promise<HftChannel[]> => {
    requireTrader(request);
    return (await pool.query<HftChannel>(`${channelSelect} ORDER BY c.channel`)).rows;
  });

  app.get('/api/hft/:channel', async (request): Promise<HftChannelDetail> => {
    requireTrader(request);
    const { channel } = request.params as { channel: string };
    const row = await readChannel(pool, channel);
    const known = await pool.query<{ group: string }>(
      'SELECT DISTINCT prediction_group AS group FROM management.hft_group_limit ORDER BY 1',
    );
    const history = await pool.query<HftAuditEntry>(
      `SELECT e.id, e.at, m.name AS "actorName", e.action, e.before, e.after
         FROM omniboard.audit_event e JOIN omniboard.member m ON m.id = e.actor_id
        WHERE e.target_table = $1 AND e.target_key = $2
        ORDER BY e.id DESC LIMIT 100`,
      [TABLE, channel],
    );
    return { ...row, knownGroups: known.rows.map((r) => r.group), audit: history.rows };
  });

  app.post('/api/hft', async (request) => {
    requireLiveWrite(request);
    const input = z
      .object({ channel: z.string().max(100), settings: settingsInput })
      .strict()
      .parse(request.body);
    const channel = input.channel;
    const channelProblem = identityProblem(channel);
    if (channelProblem) problem(422, `Channel: ${channelProblem}`);
    const settings = checked(input.settings);
    await quantWrite(pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO management.hft_config
           (channel, portfolio_group, max_active_groups, max_portfolio_gross_exposure_usd,
            max_portfolio_abs_net_exposure_usd, max_wallet_gross_to_assets_ratio, update_at)
         VALUES ($1,$2,$3,$4,$5,$6,now()) ON CONFLICT (channel) DO NOTHING`,
        [channel, ...configValues(settings)],
      );
      if (!inserted.rowCount) problem(409, 'This channel already exists.');
      await writeLimits(client, channel, settings.groupLimits);
      await audit(client, { ...liveWrite(request, 'hft_config.create', channel), after: settings });
    });
    return { channel };
  });

  app.put('/api/hft/:channel', async (request) => {
    requireLiveWrite(request);
    const { channel } = request.params as { channel: string };
    const input = z
      // 打开时看到的 update_at:与库里不同说明别人改过(含 sync_hft_config),拒绝覆盖。
      .object({ base: z.string().max(40), settings: settingsInput })
      .strict()
      .parse(request.body);
    const settings = checked(input.settings);
    const changed = await quantWrite(pool, async (client) => {
      const current = await readChannel(client, channel, true);
      if (current.updateAt !== input.base)
        problem(409, 'This channel changed since you opened it. Reload to see the latest values.');
      const before = settingsOf(current);
      // 没有改动就不写:update_at 不动,「重启后生效」的判断(D4)不受影响。
      if (!hftChanges(before, settings).length) return false;
      await client.query(
        `UPDATE management.hft_config
            SET portfolio_group = $2, max_active_groups = $3, max_portfolio_gross_exposure_usd = $4,
                max_portfolio_abs_net_exposure_usd = $5, max_wallet_gross_to_assets_ratio = $6,
                update_at = now()
          WHERE channel = $1`,
        [channel, ...configValues(settings)],
      );
      await writeLimits(client, channel, settings.groupLimits);
      await audit(client, {
        ...liveWrite(request, 'hft_config.update', channel),
        before,
        after: settings,
      });
      return true;
    });
    return { changed };
  });
}
