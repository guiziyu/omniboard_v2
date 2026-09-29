-- 交易账户 key 指纹(data-model 4.3、frontend-spec 12.7):sha256(api_key) 十六进制前 12 位,用来辨认是哪把 key。
-- 密钥列应用只写不读(db/owner/001_roles.sql),指纹在写入时算好。v2 之前录入的 key 没有指纹。

CREATE TABLE omniboard.credential_fingerprint (
  auth_id    text PRIMARY KEY,  -- = management.authentication.auth_id,不建跨 schema 外键
  api_key_fp text NOT NULL CHECK (api_key_fp ~ '^[0-9a-f]{12}$'),
  set_at     timestamptz NOT NULL DEFAULT now(),
  set_by     text NOT NULL REFERENCES omniboard.member(id)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON omniboard.credential_fingerprint TO omniboard_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_read') THEN
    GRANT SELECT ON omniboard.credential_fingerprint TO omniboard_read;
  END IF;
END $$;
