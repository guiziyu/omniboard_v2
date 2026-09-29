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

-- 视图形状(契约 §5);交接那一步再换成按底表计算的定义。
CREATE VIEW verification.v_connector_declared_latest AS
  SELECT NULL::text AS venue_key, NULL::text AS source_id, NULL::text AS crate_path, NULL::text AS build_revision,
         NULL::boolean AS build_dirty, NULL::timestamptz AS observed_at, NULL::jsonb AS factory_flags,
         NULL::jsonb AS declared_features, NULL::integer AS schema_version
  WHERE false;
CREATE VIEW verification.v_live_test_leaf_latest AS
  SELECT NULL::text AS venue_key, NULL::text AS feature_key, NULL::text AS environment, NULL::text AS account_kind,
         NULL::text AS status, NULL::text AS skip_reason, NULL::text AS error_text, NULL::timestamptz AS observed_at,
         NULL::uuid AS run_id, NULL::text AS build_revision, NULL::boolean AS build_dirty, NULL::uuid AS request_id
  WHERE false;
CREATE VIEW verification.v_live_test_run_by_request AS
  SELECT NULL::uuid AS request_id, NULL::uuid AS run_id, NULL::text AS venue_key, NULL::text AS suite,
         NULL::text AS environment, NULL::text AS account_name, NULL::text AS account_kind, NULL::text AS build_revision,
         NULL::boolean AS build_dirty, NULL::timestamptz AS started_at, NULL::timestamptz AS finished_at,
         NULL::text AS status, NULL::jsonb AS blockers, NULL::integer AS passed_count, NULL::integer AS failed_count,
         NULL::integer AS skipped_count
  WHERE false;
