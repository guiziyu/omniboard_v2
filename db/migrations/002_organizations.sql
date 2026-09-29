-- 证据与来源、机构(data-model §3.1、§3.2)。v1 的 workspace_id 全部去掉;raw_id / snapshot_id 改名 evidence_id。

-- 可见性创建后不能改(frontend-spec 0.2)。
CREATE FUNCTION omniboard.keep_visibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.visibility IS DISTINCT FROM OLD.visibility THEN
    RAISE EXCEPTION 'Visibility cannot change after creation. Create a new record.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- 原件在对象存储,键 = evidence/<sha256>;同一原件可被多条证据引用。
CREATE TABLE omniboard.evidence (
  id             text PRIMARY KEY,
  source         text NOT NULL CHECK (length(source) BETWEEN 1 AND 40),
  url            text NOT NULL,
  captured_at    timestamptz NOT NULL DEFAULT now(),
  sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  byte_length    bigint NOT NULL CHECK (byte_length >= 0),
  content_type   text NOT NULL,
  parser_version text NOT NULL,
  filename       text NOT NULL,
  visibility     text NOT NULL CHECK (visibility IN ('team','admin')),
  s3_key         text GENERATED ALWAYS AS ('evidence/' || sha256) STORED
);
CREATE INDEX evidence_sha256 ON omniboard.evidence(sha256);
CREATE INDEX evidence_source ON omniboard.evidence(source);
CREATE TRIGGER evidence_keep_visibility BEFORE UPDATE ON omniboard.evidence
  FOR EACH ROW EXECUTE FUNCTION omniboard.keep_visibility();

CREATE TABLE omniboard.organizations (
  id          text PRIMARY KEY,
  name        text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 3000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX organizations_name ON omniboard.organizations(lower(name), id);

CREATE TABLE omniboard.organization_tags (
  organization_id text NOT NULL REFERENCES omniboard.organizations(id),
  tag text NOT NULL CHECK (tag IN ('exchange','broker','market_maker','bank','custodian','data_provider',
    'infrastructure_provider','connectivity_provider','think_tank','trading_company','hedge_fund',
    'company','government')),
  PRIMARY KEY (organization_id, tag)
);
CREATE INDEX organization_tags_tag ON omniboard.organization_tags(tag, organization_id);
-- 交易所是带 exchange 业务标签的公司,不是另一种机构(v1 013)。
CREATE FUNCTION omniboard.exchange_implies_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tag = 'exchange' THEN
    INSERT INTO omniboard.organization_tags (organization_id, tag)
    VALUES (NEW.organization_id, 'company') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER organization_tags_exchange_company AFTER INSERT OR UPDATE ON omniboard.organization_tags
  FOR EACH ROW EXECUTE FUNCTION omniboard.exchange_implies_company();

-- 已合并的旧机构保留档案与证据,只有规范机构出现在目录里(v1 008)。
CREATE TABLE omniboard.organization_aliases (
  alias_id        text PRIMARY KEY REFERENCES omniboard.organizations(id),
  organization_id text NOT NULL REFERENCES omniboard.organizations(id),
  reason          text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  payload         jsonb NOT NULL,
  CHECK (alias_id <> organization_id)
);
CREATE INDEX organization_aliases_canonical ON omniboard.organization_aliases(organization_id);

CREATE TABLE omniboard.organization_profiles (
  organization_id text PRIMARY KEY REFERENCES omniboard.organizations(id),
  profile         jsonb NOT NULL,
  revision        integer NOT NULL CHECK (revision > 0),
  author_id       text NOT NULL REFERENCES omniboard.member(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- logo 原件也是证据;evidence_id 是抓取 logo 的来源页(v1 raw_id)。
CREATE TABLE omniboard.organization_logos (
  organization_id  text PRIMARY KEY REFERENCES omniboard.organizations(id),
  logo_evidence_id text NOT NULL REFERENCES omniboard.evidence(id),
  source_url       text NOT NULL,
  evidence_id      text REFERENCES omniboard.evidence(id)
);

CREATE TABLE omniboard.organization_external_keys (
  external_key    text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES omniboard.organizations(id)
);
CREATE INDEX organization_external_keys_org ON omniboard.organization_external_keys(organization_id);

-- CMC / CoinGecko 档案与机构的归属(frontend-spec 9.4)。mapped_by 为空 = 按名称自动匹配,未经人工复核。
CREATE TABLE omniboard.source_entity_links (
  id              text PRIMARY KEY,
  source          text NOT NULL,
  slug            text NOT NULL,
  organization_id text NOT NULL REFERENCES omniboard.organizations(id),
  name            text NOT NULL,
  url             text NOT NULL,
  mapped_by       text REFERENCES omniboard.member(id),
  UNIQUE (source, slug)
);
CREATE INDEX source_entity_links_org ON omniboard.source_entity_links(organization_id, source);

CREATE TABLE omniboard.collection_runs (
  id          text PRIMARY KEY,
  source      text NOT NULL,
  status      text NOT NULL CHECK (status IN ('running','success','failed','interrupted')),
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  row_count   integer NOT NULL DEFAULT 0,
  error       text,
  evidence_id text REFERENCES omniboard.evidence(id)
);
-- 同时最多一个采集在跑;进程互斥另用 advisory lock(data-model §1)。
CREATE UNIQUE INDEX collection_runs_one_running ON omniboard.collection_runs((1)) WHERE status = 'running';
CREATE INDEX collection_runs_source ON omniboard.collection_runs(source, status, started_at DESC);

-- metrics = [{key,label,value,unit,rawText,precision}];value 是十进制字符串或 null。
CREATE TABLE omniboard.source_observations (
  id          text PRIMARY KEY,
  seq         bigint GENERATED ALWAYS AS IDENTITY,
  link_id     text NOT NULL REFERENCES omniboard.source_entity_links(id),
  evidence_id text NOT NULL REFERENCES omniboard.evidence(id),
  run_id      text NOT NULL REFERENCES omniboard.collection_runs(id),
  rank        integer NOT NULL,
  metrics     jsonb NOT NULL CHECK (jsonb_typeof(metrics) = 'array'),
  UNIQUE (link_id, run_id)
);
CREATE INDEX source_observations_run ON omniboard.source_observations(run_id);

-- 迁移窗口(proposal §9、D6):打开时 admin 令牌可经导入接口写入系统时间;切换后由 CLI 关闭。
INSERT INTO omniboard.app_setting VALUES ('import_open', 'true');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      omniboard.evidence, omniboard.organizations, omniboard.organization_tags,
      omniboard.organization_aliases, omniboard.organization_profiles, omniboard.organization_logos,
      omniboard.organization_external_keys, omniboard.source_entity_links, omniboard.collection_runs,
      omniboard.source_observations
      TO omniboard_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_read') THEN
    GRANT SELECT ON
      omniboard.evidence, omniboard.organizations, omniboard.organization_tags,
      omniboard.organization_aliases, omniboard.organization_profiles, omniboard.organization_logos,
      omniboard.organization_external_keys, omniboard.source_entity_links, omniboard.collection_runs,
      omniboard.source_observations
      TO omniboard_read;
  END IF;
END $$;
