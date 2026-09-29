-- 接入请求(data-model §3.6;proposal §6;frontend-spec 11)。每行是契约 §4 请求 JSON 的不可变快照,
-- quant 的 deliver skill 按 request_id 经 omniboard.v_connector_request 读取。

CREATE TABLE omniboard.connector_request (
  request_id        uuid PRIMARY KEY,          -- 迁移保留 v1 integration_jobs.id(已写入 verification.live_test_*)
  organization_id   text NOT NULL REFERENCES omniboard.organizations(id),
  record_id         text NOT NULL REFERENCES omniboard.module_records(id),
  record_revision   integer NOT NULL CHECK (record_revision > 0),
  action            text NOT NULL CHECK (action IN ('validate_readonly','prepare_config','propose_adapter_change')),
  declared_revision text,                      -- 创建时 venue 的声明 build_revision(spec 11.3 最后一行)
  request           jsonb NOT NULL,            -- 契约 §4 形状,创建后不改
  -- 资源获批后按新台账重发同一版本的请求(spec 11.5):新快照指向被取代的旧快照,旧快照保留。
  reissue_of        uuid UNIQUE REFERENCES omniboard.connector_request(request_id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (request->>'request_id' = request_id::text)
);
-- 每个「记录 × 版本」只有一个首发请求;重发的快照不占这个位置。
CREATE UNIQUE INDEX connector_request_record_revision ON omniboard.connector_request(record_id, record_revision)
  WHERE reissue_of IS NULL;
CREATE INDEX connector_request_org ON omniboard.connector_request(organization_id, created_at DESC);

CREATE FUNCTION omniboard.connector_request_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Connector requests cannot be changed. Save a new record version instead.'
    USING ERRCODE = 'check_violation';
END $$;
CREATE TRIGGER connector_request_immutable BEFORE UPDATE OR DELETE ON omniboard.connector_request
  FOR EACH ROW EXECUTE FUNCTION omniboard.connector_request_immutable();

CREATE VIEW omniboard.v_connector_request AS
  SELECT request_id, created_at, request FROM omniboard.connector_request;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_app') THEN
    GRANT SELECT, INSERT ON omniboard.connector_request TO omniboard_app;
    GRANT SELECT ON omniboard.v_connector_request TO omniboard_app;
  END IF;
  -- quant 经 omniboard_read 的成员关系读取(db/owner/001_roles.sql)。
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_read') THEN
    GRANT SELECT ON omniboard.connector_request, omniboard.v_connector_request TO omniboard_read;
  END IF;
END $$;
