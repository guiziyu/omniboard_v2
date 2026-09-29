-- 测试用:按 quant ca483b24 的实体与约束建 omniboard 会写或会读的 quant 对象。
-- 来源:core/crates/db-entity/src/authentication.rs;strategy/crates/db-entity/src/hft_config.rs、
-- hft_group_limit.rs;strategy/migration/src/schema_registry.rs;connector/docs/verification-contract.md §5。
CREATE SCHEMA management;
CREATE SCHEMA verification;

CREATE TABLE management.authentication (
  auth_id varchar PRIMARY KEY,
  account_tags varchar,
  exchange varchar NOT NULL,
  account_name varchar NOT NULL,
  ip_whitelist varchar[],
  api_key varchar NOT NULL,
  api_secret varchar NOT NULL,
  api_pass varchar,
  owner varchar,
  verified_auth_tags varchar,
  verified_auth_tags_updated_at timestamptz
);

CREATE TABLE management.hft_config (
  channel varchar PRIMARY KEY,
  portfolio_group varchar NOT NULL,
  max_active_groups integer NOT NULL,
  max_portfolio_gross_exposure_usd double precision NOT NULL,
  max_portfolio_abs_net_exposure_usd double precision NOT NULL,
  max_wallet_gross_to_assets_ratio double precision NOT NULL,
  update_at timestamptz NOT NULL,
  CONSTRAINT hft_config_channel_chk CHECK (length(btrim(channel)) > 0 AND channel = btrim(channel)),
  CONSTRAINT hft_config_portfolio_group_chk CHECK (length(btrim(portfolio_group)) > 0 AND portfolio_group = btrim(portfolio_group)),
  CONSTRAINT hft_config_max_active_groups_chk CHECK (max_active_groups > 0),
  CONSTRAINT hft_config_gross_budget_chk CHECK (max_portfolio_gross_exposure_usd > 0 AND max_portfolio_gross_exposure_usd < 'Infinity'::double precision),
  CONSTRAINT hft_config_abs_net_budget_chk CHECK (max_portfolio_abs_net_exposure_usd > 0 AND max_portfolio_abs_net_exposure_usd < 'Infinity'::double precision AND max_portfolio_abs_net_exposure_usd <= max_portfolio_gross_exposure_usd),
  CONSTRAINT hft_config_wallet_gross_ratio_chk CHECK (max_wallet_gross_to_assets_ratio > 0 AND max_wallet_gross_to_assets_ratio < 1)
);

CREATE TABLE management.hft_group_limit (
  channel varchar NOT NULL,
  prediction_group varchar NOT NULL,
  max_gross_exposure_usd double precision NOT NULL,
  max_abs_net_exposure_usd double precision NOT NULL,
  update_at timestamptz NOT NULL,
  CONSTRAINT "pk-hft_group_limit" PRIMARY KEY (channel, prediction_group),
  CONSTRAINT hft_group_limit_channel_fk FOREIGN KEY (channel) REFERENCES management.hft_config (channel) ON DELETE CASCADE,
  CONSTRAINT hft_group_limit_prediction_group_chk CHECK (length(btrim(prediction_group)) > 0 AND prediction_group = btrim(prediction_group)),
  CONSTRAINT hft_group_limit_budget_chk CHECK (max_gross_exposure_usd > 0 AND max_gross_exposure_usd < 'Infinity'::double precision AND max_abs_net_exposure_usd > 0 AND max_abs_net_exposure_usd <= max_gross_exposure_usd)
);

-- 验证结果(契约 §5):底表按 quant 实体(live_test_run、live_test_case_result;catalog 快照只建视图用到的列),
-- 三个视图的定义逐字取自 quant strategy/migration/sql/2026-09-20-verification-views-and-reader.sql。
CREATE TABLE public.connector_catalog_snapshot (
  venue_key text NOT NULL,
  source_id text NOT NULL,
  crate_path text,
  build_revision text NOT NULL,
  build_dirty boolean NOT NULL,
  observed_at timestamptz NOT NULL,
  factory_flags jsonb NOT NULL,
  descriptor_json jsonb NOT NULL,
  schema_version integer
);
CREATE TABLE verification.live_test_run (
  run_id uuid PRIMARY KEY,
  venue_key text NOT NULL,
  source_id text NOT NULL,
  crate_path text NOT NULL,
  suite text NOT NULL,
  environment text NOT NULL,
  account_name text NOT NULL,
  account_kind text NOT NULL,
  server_id text NOT NULL,
  build_revision text NOT NULL,
  build_dirty boolean NOT NULL,
  request_id uuid,
  run_mode text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  status text NOT NULL,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  schema_version integer NOT NULL,
  backfilled boolean NOT NULL DEFAULT false
);
CREATE TABLE verification.live_test_case_result (
  run_id uuid NOT NULL REFERENCES verification.live_test_run (run_id),
  feature_key text NOT NULL,
  observed_at timestamptz NOT NULL,
  status text NOT NULL,
  skip_reason text,
  error_text text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (run_id, feature_key)
);
CREATE VIEW verification.v_connector_declared_latest AS
  SELECT DISTINCT ON (s.venue_key)
      s.venue_key, s.source_id, s.crate_path, s.build_revision, s.build_dirty, s.observed_at,
      s.factory_flags, COALESCE(s.descriptor_json -> 'declared_features', '[]'::jsonb) AS declared_features,
      s.schema_version
  FROM public.connector_catalog_snapshot s
  ORDER BY s.venue_key, s.observed_at DESC;
CREATE VIEW verification.v_live_test_leaf_latest AS
  SELECT DISTINCT ON (r.venue_key, c.feature_key, r.environment, r.account_kind)
      r.venue_key, c.feature_key, r.environment, r.account_kind, c.status, c.skip_reason, c.error_text,
      c.observed_at, c.run_id, r.build_revision, r.build_dirty, r.request_id
  FROM verification.live_test_case_result c
  JOIN verification.live_test_run r ON r.run_id = c.run_id
  ORDER BY r.venue_key, c.feature_key, r.environment, r.account_kind, c.observed_at DESC;
CREATE VIEW verification.v_live_test_run_by_request AS
  SELECT r.request_id, r.run_id, r.venue_key, r.suite, r.environment, r.account_name, r.account_kind,
      r.build_revision, r.build_dirty, r.started_at, r.finished_at, r.status, r.blockers,
      COALESCE(SUM((c.status = 'passed')::int), 0)::bigint  AS passed_count,
      COALESCE(SUM((c.status = 'failed')::int), 0)::bigint  AS failed_count,
      COALESCE(SUM((c.status = 'skipped')::int), 0)::bigint AS skipped_count
  FROM verification.live_test_run r
  LEFT JOIN verification.live_test_case_result c ON c.run_id = r.run_id
  WHERE r.request_id IS NOT NULL
  GROUP BY r.run_id;
