-- 情报收件箱的个人状态(data-model §3.3;frontend-spec 8.1–8.3):按成员 + 记录 + revision 的已读,
-- 以及关注的机构。两者都是个人的,不改变记录的评审状态或证据等级。

CREATE TABLE omniboard.intelligence_reads (
  owner_id  text NOT NULL REFERENCES omniboard.member(id),
  record_id text NOT NULL REFERENCES omniboard.module_records(id),
  revision  integer NOT NULL CHECK (revision > 0),
  read_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, record_id)
);

CREATE TABLE omniboard.organization_follows (
  owner_id        text NOT NULL REFERENCES omniboard.member(id),
  organization_id text NOT NULL REFERENCES omniboard.organizations(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, organization_id)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      omniboard.intelligence_reads, omniboard.organization_follows
      TO omniboard_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_read') THEN
    GRANT SELECT ON
      omniboard.intelligence_reads, omniboard.organization_follows
      TO omniboard_read;
  END IF;
END $$;
