-- 记录、编辑历史、指标观测(data-model §3.3)。目录排名与记录数依赖这三张表,先于 §3.3 其余表建立。

CREATE TABLE omniboard.module_records (
  id                     text PRIMARY KEY,
  organization_id        text NOT NULL REFERENCES omniboard.organizations(id),
  tab_id                 text NOT NULL,
  schema_version         integer NOT NULL DEFAULT 1,
  title                  text NOT NULL,
  body                   text NOT NULL,
  scope                  text NOT NULL,
  status                 text NOT NULL,
  visibility             text NOT NULL CHECK (visibility IN ('team','admin')),
  person_name            text NOT NULL DEFAULT '',
  person_email           text NOT NULL DEFAULT '',
  reports_to             text NOT NULL DEFAULT '',
  -- 业务日期:YYYY、YYYY-MM 或 YYYY-MM-DD,不补全(frontend-spec 0.4);v1 的 '' 记为 NULL。
  event_date             text CHECK (event_date ~ '^\d{4}(-\d{2}(-\d{2})?)?$'),
  event_type             text NOT NULL DEFAULT '',
  structured             jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(structured) = 'object'),
  evidence_id            text NOT NULL REFERENCES omniboard.evidence(id),
  attachment_evidence_id text REFERENCES omniboard.evidence(id),
  revision               integer NOT NULL CHECK (revision > 0),
  author_id              text NOT NULL REFERENCES omniboard.member(id),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX module_records_org_tab ON omniboard.module_records(organization_id, tab_id);
CREATE INDEX module_records_recent ON omniboard.module_records(updated_at DESC, id DESC);
CREATE TRIGGER module_records_keep_visibility BEFORE UPDATE ON omniboard.module_records
  FOR EACH ROW EXECUTE FUNCTION omniboard.keep_visibility();

-- 业务对象的版本历史(frontend-spec 0.5、5.5)。v1 的历史不迁移,从 v2 开始写(proposal §9)。
CREATE TABLE omniboard.edit_history (
  id         text PRIMARY KEY,
  subject_id text NOT NULL,
  action     text NOT NULL,
  revision   integer NOT NULL,
  payload    jsonb NOT NULL,
  author_id  text NOT NULL REFERENCES omniboard.member(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX edit_history_subject ON omniboard.edit_history(subject_id, revision);

-- 团队录入的指标观测。value 用 numeric:保留输入的小数位,排序不经浮点。
CREATE TABLE omniboard.metric_observations (
  id              text PRIMARY KEY,
  seq             bigint GENERATED ALWAYS AS IDENTITY,
  organization_id text NOT NULL REFERENCES omniboard.organizations(id),
  column_id       text NOT NULL,
  value           numeric NOT NULL CHECK (value >= 0),
  qualifier       text NOT NULL DEFAULT 'exact'
                  CHECK (qualifier IN ('exact','at_least','at_most','more_than','approximately')),
  unit            text NOT NULL,
  period          text NOT NULL,
  source_name     text NOT NULL,
  source_url      text NOT NULL,
  assumptions     text NOT NULL,
  evidence_id     text NOT NULL REFERENCES omniboard.evidence(id),
  captured_at     timestamptz NOT NULL DEFAULT now(),
  author_id       text NOT NULL REFERENCES omniboard.member(id)
);
CREATE INDEX metric_observations_org ON omniboard.metric_observations(organization_id, column_id, period, captured_at DESC);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      omniboard.module_records, omniboard.edit_history, omniboard.metric_observations
      TO omniboard_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_read') THEN
    GRANT SELECT ON
      omniboard.module_records, omniboard.edit_history, omniboard.metric_observations
      TO omniboard_read;
  END IF;
END $$;
