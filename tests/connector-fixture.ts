import pg from 'pg';
// 按 quant 契约 §5 的底表写合成的声明与验证结果(没有真实 venue 数据),经三个视图读出。
// 从 v1 tests/connector-fixture.ts 迁移;v1 伪造查询结果,这里直接写 tests/fixtures/quant-shapes.sql 的底表。
export const fixtureVenues = ['binance', 'okx', 'bybit', 'bitget', 'gate'];
export const fixtureLeaves = [
  'market.linear_perpetual.order_book.ws',
  'market.spot.trade.ws',
  'wallet.unified.balance.ws',
  'wallet_action.unified.set_leverage',
  'trading.unified.linear_perpetual.advanced.place_order.gtc',
  'trading.unified.linear_perpetual.advanced.request_limit.burst',
  'transfer.spot.unified',
  'asset_network.catalog',
];
export const fixtureBuild = '43c9b23a43c9b23a43c9b23a43c9b23a43c9b23a';
/** 固定的 run id(uuid),便于断言。 */
export const runId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export async function quantFixture(adminUrl: string) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  return {
    close: () => client.end(),
    async declare(venue: string, overrides: Record<string, unknown> = {}) {
      const row = {
        venue_key: venue,
        source_id: 'cex.' + venue,
        crate_path: 'connector/crates/conn-' + venue,
        build_revision: fixtureBuild,
        build_dirty: false,
        observed_at: '2026-09-19T10:00:00Z',
        factory_flags: {
          market: true,
          wallet: true,
          wallet_action: true,
          trading: true,
          transfer: true,
          asset_network: true,
        },
        descriptor_json: {
          declared_features: fixtureLeaves.map((feature_key) => ({
            feature_key,
            declared_by: 'descriptor',
          })),
        },
        schema_version: 1,
        ...overrides,
      };
      await client.query(
        `INSERT INTO public.connector_catalog_snapshot
           (venue_key, source_id, crate_path, build_revision, build_dirty, observed_at, factory_flags,
            descriptor_json, schema_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          row.venue_key,
          row.source_id,
          row.crate_path,
          row.build_revision,
          row.build_dirty,
          row.observed_at,
          row.factory_flags,
          row.descriptor_json,
          row.schema_version,
        ],
      );
    },
    /** 写一个 run(已存在则更新状态、完成时间与阻塞项,模拟 quant 的 upsert)。 */
    async run(requestId: string | null, venue: string, overrides: Record<string, unknown> = {}) {
      const row = {
        run_id: runId(1),
        suite: 'place-order',
        environment: 'dev-cred',
        account_name: venue + '-test-01',
        account_kind: 'test',
        build_revision: fixtureBuild,
        build_dirty: false,
        started_at: '2026-09-19T10:30:00Z',
        finished_at: '2026-09-19T11:00:00Z' as string | null,
        status: 'passed',
        blockers: [] as unknown[],
        ...overrides,
      };
      await client.query(
        `INSERT INTO verification.live_test_run
           (run_id, venue_key, source_id, crate_path, suite, environment, account_name, account_kind,
            server_id, build_revision, build_dirty, request_id, run_mode, started_at, finished_at,
            status, blockers, schema_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'fixture',$9,$10,$11,'overwrite',$12,$13,$14,$15,1)
         ON CONFLICT (run_id) DO UPDATE SET finished_at = EXCLUDED.finished_at,
           status = EXCLUDED.status, blockers = EXCLUDED.blockers`,
        [
          row.run_id,
          venue,
          'cex.' + venue,
          'connector/crates/conn-' + venue,
          row.suite,
          row.environment,
          row.account_name,
          row.account_kind,
          row.build_revision,
          row.build_dirty,
          requestId,
          row.started_at,
          row.finished_at,
          row.status,
          JSON.stringify(row.blockers),
        ],
      );
      return row.run_id;
    },
    async result(
      run: string,
      featureKey: string,
      status: 'passed' | 'failed' | 'skipped',
      observedAt = '2026-09-19T11:00:00Z',
    ) {
      await client.query(
        `INSERT INTO verification.live_test_case_result
           (run_id, feature_key, observed_at, status, skip_reason, error_text)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          run,
          featureKey,
          observedAt,
          status,
          status === 'skipped' ? 'awaiting_resource:vip_tier' : null,
          status === 'failed' ? 'synthetic failure' : null,
        ],
      );
    },
  };
}
