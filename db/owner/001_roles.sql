-- 由 owner 手工执行(proposal §4、data-model §2),不在 `npm run migrate` 里。
-- 执行记录:生产 —— 未执行。
-- 前置:本文件先于 `npm run migrate` 执行,迁移里的 omniboard 内部授权才会生效。
-- 密码单独设置:ALTER ROLE omniboard_app PASSWORD '...';(不写进仓库)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_app') THEN
    CREATE ROLE omniboard_app LOGIN CONNECTION LIMIT 10;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_read') THEN
    -- 只读:Neo 上的 agent 与 quant 通过成员关系使用(GRANT omniboard_read TO <quant 角色>)。
    CREATE ROLE omniboard_read NOLOGIN;
  END IF;
END $$;
ALTER ROLE omniboard_app SET statement_timeout = '15s';

-- management.authentication:密钥列只写不读;verified_auth_tags* 归 Omnitra,不授权。
GRANT USAGE ON SCHEMA management TO omniboard_app;
REVOKE ALL ON management.authentication FROM omniboard_app;
GRANT SELECT (auth_id, exchange, account_name, account_tags, ip_whitelist, owner,
              verified_auth_tags, verified_auth_tags_updated_at) ON management.authentication TO omniboard_app;
GRANT INSERT (auth_id, exchange, account_name, account_tags, ip_whitelist, owner,
              api_key, api_secret, api_pass) ON management.authentication TO omniboard_app;
GRANT UPDATE (account_tags, ip_whitelist, owner, api_key, api_secret, api_pass)
  ON management.authentication TO omniboard_app;

GRANT SELECT, INSERT, UPDATE ON management.hft_config TO omniboard_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON management.hft_group_limit TO omniboard_app;

GRANT USAGE ON SCHEMA verification TO omniboard_app;
GRANT SELECT ON verification.v_connector_declared_latest, verification.v_live_test_leaf_latest,
  verification.v_live_test_run_by_request TO omniboard_app;
