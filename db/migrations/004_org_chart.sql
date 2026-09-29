-- 组织架构图的汇报关系与记录别名(data-model §3.3)。

-- 汇报线的确定性与它自己的证据,与人员记录的原文分开(frontend-spec 6.2)。没有这一行的上级读作 unconfirmed。
CREATE TABLE omniboard.org_chart_relationships (
  record_id   text PRIMARY KEY REFERENCES omniboard.module_records(id),
  kind        text NOT NULL CHECK (kind IN ('confirmed','unconfirmed')),
  note        text NOT NULL,
  evidence_id text NOT NULL REFERENCES omniboard.evidence(id)
);

-- 合并机构时被归并的重复记录 → 保留的记录。旧记录留在别名机构下,不删除。
CREATE TABLE omniboard.record_aliases (
  alias_id  text PRIMARY KEY REFERENCES omniboard.module_records(id),
  record_id text NOT NULL REFERENCES omniboard.module_records(id),
  CHECK (alias_id <> record_id)
);
CREATE INDEX record_aliases_record ON omniboard.record_aliases(record_id);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      omniboard.org_chart_relationships, omniboard.record_aliases
      TO omniboard_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_read') THEN
    GRANT SELECT ON omniboard.org_chart_relationships, omniboard.record_aliases TO omniboard_read;
  END IF;
END $$;
