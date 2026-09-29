-- 共享对象、结论、关系与跨机构身份(data-model §3.4),以及活动历史(§3.3 operation_events)。
-- 业务日期按 §1 约定:text,v1 的 '' 记为 NULL;这里的日期都精确到日。

CREATE TABLE omniboard.knowledge_objects (
  id              text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES omniboard.organizations(id),
  kind            text NOT NULL CHECK (kind IN ('person','account','capability','resource')),
  name            text NOT NULL,
  scope           text NOT NULL,
  visibility      text NOT NULL CHECK (visibility IN ('team','admin')),
  revision        integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_objects_org ON omniboard.knowledge_objects(organization_id);
CREATE TRIGGER knowledge_objects_keep_visibility BEFORE UPDATE ON omniboard.knowledge_objects
  FOR EACH ROW EXECUTE FUNCTION omniboard.keep_visibility();

CREATE TABLE omniboard.object_records (
  object_id text NOT NULL REFERENCES omniboard.knowledge_objects(id),
  record_id text NOT NULL REFERENCES omniboard.module_records(id),
  PRIMARY KEY (object_id, record_id)
);
CREATE INDEX object_records_record ON omniboard.object_records(record_id);

CREATE TABLE omniboard.knowledge_claims (
  id               text PRIMARY KEY,
  object_id        text NOT NULL REFERENCES omniboard.knowledge_objects(id),
  field            text NOT NULL,
  value            text NOT NULL,
  scope            text NOT NULL,
  valid_from       text CHECK (valid_from ~ '^\d{4}-\d{2}-\d{2}$'),
  valid_until      text CHECK (valid_until ~ '^\d{4}-\d{2}-\d{2}$'),
  observed_on      text CHECK (observed_on ~ '^\d{4}-\d{2}-\d{2}$'),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL CHECK (status IN ('reported','accepted','superseded')),
  evidence_id      text NOT NULL REFERENCES omniboard.evidence(id),
  source_record_id text REFERENCES omniboard.module_records(id),
  revision         integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  -- 结论所属的机构上下文,身份合并后不变(v1 knowledge_claim_contexts 并入本表)。
  organization_id  text NOT NULL REFERENCES omniboard.organizations(id)
);
CREATE INDEX knowledge_claims_object ON omniboard.knowledge_claims(object_id, field, scope);

CREATE TABLE omniboard.knowledge_relations (
  id          text PRIMARY KEY,
  from_id     text NOT NULL REFERENCES omniboard.knowledge_objects(id),
  to_id       text NOT NULL REFERENCES omniboard.knowledge_objects(id),
  label       text NOT NULL,
  certainty   text NOT NULL CHECK (certainty IN ('confirmed','unconfirmed')),
  valid_from  text CHECK (valid_from ~ '^\d{4}-\d{2}-\d{2}$'),
  valid_until text CHECK (valid_until ~ '^\d{4}-\d{2}-\d{2}$'),
  evidence_id text NOT NULL REFERENCES omniboard.evidence(id),
  CHECK (from_id <> to_id)
);

-- 身份合并是可撤销的重定向:原对象、证据和引用都保留。
CREATE TABLE omniboard.knowledge_identity_redirects (
  object_id text PRIMARY KEY REFERENCES omniboard.knowledge_objects(id),
  target_id text NOT NULL REFERENCES omniboard.knowledge_objects(id),
  CHECK (object_id <> target_id)
);
CREATE INDEX knowledge_identity_target ON omniboard.knowledge_identity_redirects(target_id);

CREATE TABLE omniboard.knowledge_identity_events (
  id          text PRIMARY KEY,
  object_id   text NOT NULL REFERENCES omniboard.knowledge_objects(id),
  other_id    text REFERENCES omniboard.knowledge_objects(id),
  record_id   text REFERENCES omniboard.module_records(id),
  kind        text NOT NULL CHECK (kind IN ('link','unlink','merge','undo_merge')),
  reason      text NOT NULL,
  evidence_id text NOT NULL REFERENCES omniboard.evidence(id),
  author_id   text NOT NULL REFERENCES omniboard.member(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  reverses_id text REFERENCES omniboard.knowledge_identity_events(id)
);
CREATE INDEX knowledge_identity_event_object ON omniboard.knowledge_identity_events(object_id, created_at);

-- 活动历史(frontend-spec 8.4):任务、对象、结论与身份的变更。结论采纳的理由(7.13 Decision trail)也在这里。
CREATE TABLE omniboard.operation_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id text NOT NULL REFERENCES omniboard.organizations(id),
  target_id       text NOT NULL,
  kind            text NOT NULL,
  title           text NOT NULL,
  payload         jsonb NOT NULL,
  visibility      text NOT NULL CHECK (visibility IN ('team','admin')),
  author_id       text NOT NULL REFERENCES omniboard.member(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- 迁移导入时的 v1 id,用于幂等;v2 新写入为 NULL。
  import_id       text UNIQUE
);
CREATE INDEX operation_events_org ON omniboard.operation_events(organization_id, id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      omniboard.knowledge_objects, omniboard.object_records, omniboard.knowledge_claims,
      omniboard.knowledge_relations, omniboard.knowledge_identity_redirects,
      omniboard.knowledge_identity_events, omniboard.operation_events
      TO omniboard_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_read') THEN
    GRANT SELECT ON
      omniboard.knowledge_objects, omniboard.object_records, omniboard.knowledge_claims,
      omniboard.knowledge_relations, omniboard.knowledge_identity_redirects,
      omniboard.knowledge_identity_events, omniboard.operation_events
      TO omniboard_read;
  END IF;
END $$;
