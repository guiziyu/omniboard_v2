-- 工作台任务、前置与关联对象(data-model §3.4;frontend-spec 10)。
-- 业务日期按 §1 约定:text,v1 的 '' 记为 NULL;这里的日期都精确到日。

CREATE TABLE omniboard.work_tasks (
  id                  text PRIMARY KEY,
  organization_id     text NOT NULL REFERENCES omniboard.organizations(id),
  title               text NOT NULL,
  lane                text NOT NULL CHECK (lane IN ('business','engineering','compliance','research')),
  state               text NOT NULL CHECK (state IN ('planned','active','waiting','done','skipped')),
  origin              text NOT NULL CHECK (origin IN ('standard','discovery')),
  template_key        text,
  owner_id            text REFERENCES omniboard.member(id),
  description         text NOT NULL DEFAULT '',
  next_step           text NOT NULL DEFAULT '',
  completion_criteria text NOT NULL DEFAULT '',
  follow_up_on        text CHECK (follow_up_on ~ '^\d{4}-\d{2}-\d{2}$'),
  outcome             text NOT NULL DEFAULT '',
  due_on              text CHECK (due_on ~ '^\d{4}-\d{2}-\d{2}$'),
  visibility          text NOT NULL CHECK (visibility IN ('team','admin')),
  source_record_id    text REFERENCES omniboard.module_records(id),
  -- 任务当前的证据引用;每次改动的旧引用留在 operation_events.payload 里。
  evidence_id         text NOT NULL REFERENCES omniboard.evidence(id),
  revision            integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, template_key),
  CHECK ((origin = 'standard') = (template_key IS NOT NULL))
);
CREATE INDEX work_tasks_org_state ON omniboard.work_tasks(organization_id, state);
CREATE INDEX work_tasks_owner ON omniboard.work_tasks(owner_id, state);
CREATE INDEX work_tasks_source ON omniboard.work_tasks(source_record_id);
CREATE TRIGGER work_tasks_keep_visibility BEFORE UPDATE ON omniboard.work_tasks
  FOR EACH ROW EXECUTE FUNCTION omniboard.keep_visibility();

CREATE TABLE omniboard.task_dependencies (
  task_id         text NOT NULL REFERENCES omniboard.work_tasks(id),
  prerequisite_id text NOT NULL REFERENCES omniboard.work_tasks(id),
  PRIMARY KEY (task_id, prerequisite_id),
  CHECK (task_id <> prerequisite_id)
);
CREATE INDEX task_dependencies_prerequisite ON omniboard.task_dependencies(prerequisite_id);

-- 关联到原对象 id;身份合并后读取时按重定向改指规范对象,撤销合并后自动回到原对象(frontend-spec 7.14)。
CREATE TABLE omniboard.task_objects (
  task_id   text NOT NULL REFERENCES omniboard.work_tasks(id),
  object_id text NOT NULL REFERENCES omniboard.knowledge_objects(id),
  PRIMARY KEY (task_id, object_id)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      omniboard.work_tasks, omniboard.task_dependencies, omniboard.task_objects
      TO omniboard_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_read') THEN
    GRANT SELECT ON omniboard.work_tasks, omniboard.task_dependencies, omniboard.task_objects
      TO omniboard_read;
  END IF;
END $$;
