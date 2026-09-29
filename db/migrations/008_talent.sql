-- 人才库:个人履历来源、采集、任职、由任职生成的人员变动、疑似重复决定(data-model §3.4),
-- 以及岗位目标与激励(§3.3 position_drivers)。v1 017、019。

-- 一个个人主页(provider + 规范化键)始终对应一个人员对象(frontend-spec 6.13)。
CREATE TABLE omniboard.person_source_profiles (
  id           text PRIMARY KEY,
  object_id    text NOT NULL REFERENCES omniboard.knowledge_objects(id),
  provider     text NOT NULL,
  external_key text NOT NULL,
  url          text NOT NULL,
  visibility   text NOT NULL CHECK (visibility IN ('team','admin')),
  revision     integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, external_key)
);
CREATE INDEX person_source_profiles_object ON omniboard.person_source_profiles(object_id);
CREATE TRIGGER person_source_profiles_keep_visibility BEFORE UPDATE ON omniboard.person_source_profiles
  FOR EACH ROW EXECUTE FUNCTION omniboard.keep_visibility();

-- 每次采集一行,不可变;payload 是提交的完整输入(含原文),fingerprint 用于判断「无变化」。
-- seq 取代 v1 的 rowid,决定同一时刻多次采集的先后。
CREATE TABLE omniboard.person_profile_captures (
  id          text PRIMARY KEY,
  profile_id  text NOT NULL REFERENCES omniboard.person_source_profiles(id),
  evidence_id text NOT NULL REFERENCES omniboard.evidence(id),
  payload     jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  fingerprint text NOT NULL,
  observed_on text NOT NULL CHECK (observed_on ~ '^\d{4}-\d{2}-\d{2}$'),
  author_id   text NOT NULL REFERENCES omniboard.member(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  seq         bigint GENERATED ALWAYS AS IDENTITY
);
CREATE INDEX person_profile_captures_profile ON omniboard.person_profile_captures(profile_id, seq);

-- 任职条目按来源里的 key 稳定:改日期或职位不新增经历,本次没提交的旧条目保留。
CREATE TABLE omniboard.person_profile_positions (
  id          text PRIMARY KEY,
  profile_id  text NOT NULL REFERENCES omniboard.person_source_profiles(id),
  source_key  text NOT NULL,
  data        jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  evidence_id text NOT NULL REFERENCES omniboard.evidence(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, source_key)
);

-- 由任职生成的人员变动记录(frontend-spec 6.14):每个任职最多一条开始、一条结束事件,id 稳定。
CREATE TABLE omniboard.person_profile_records (
  position_id text NOT NULL REFERENCES omniboard.person_profile_positions(id),
  kind        text NOT NULL CHECK (kind IN ('start','end')),
  record_id   text NOT NULL UNIQUE REFERENCES omniboard.module_records(id),
  PRIMARY KEY (position_id, kind)
);

-- 同名档案的人工决定,按无序对存储(left < right,按字节序),可覆盖(frontend-spec 6.15)。
CREATE TABLE omniboard.person_duplicate_decisions (
  left_id     text NOT NULL REFERENCES omniboard.knowledge_objects(id),
  right_id    text NOT NULL REFERENCES omniboard.knowledge_objects(id),
  decision    text NOT NULL CHECK (decision IN ('different','later')),
  reason      text NOT NULL,
  evidence_id text NOT NULL REFERENCES omniboard.evidence(id),
  author_id   text NOT NULL REFERENCES omniboard.member(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (left_id, right_id),
  CHECK (left_id COLLATE "C" < right_id COLLATE "C")
);

-- 岗位目标与激励(frontend-spec 6.16):绑定组织架构图的一个职位,不随姓名跟到另一雇主。
CREATE TABLE omniboard.position_drivers (
  id                     text PRIMARY KEY,
  position_id            text NOT NULL REFERENCES omniboard.module_records(id),
  data                   jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  visibility             text NOT NULL CHECK (visibility IN ('team','admin')),
  evidence_id            text NOT NULL REFERENCES omniboard.evidence(id),
  attachment_evidence_id text REFERENCES omniboard.evidence(id),
  revision               integer NOT NULL CHECK (revision > 0),
  author_id              text NOT NULL REFERENCES omniboard.member(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX position_drivers_position ON omniboard.position_drivers(position_id, updated_at);
CREATE TRIGGER position_drivers_keep_visibility BEFORE UPDATE ON omniboard.position_drivers
  FOR EACH ROW EXECUTE FUNCTION omniboard.keep_visibility();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      omniboard.person_source_profiles, omniboard.person_profile_captures,
      omniboard.person_profile_positions, omniboard.person_profile_records,
      omniboard.person_duplicate_decisions, omniboard.position_drivers
      TO omniboard_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_read') THEN
    GRANT SELECT ON
      omniboard.person_source_profiles, omniboard.person_profile_captures,
      omniboard.person_profile_positions, omniboard.person_profile_records,
      omniboard.person_duplicate_decisions, omniboard.position_drivers
      TO omniboard_read;
  END IF;
END $$;
