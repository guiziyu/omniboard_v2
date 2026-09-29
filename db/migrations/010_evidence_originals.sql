-- 证据原件改存 PG(改判 proposal §2 的 S3 私有桶):按 sha256 内容寻址,同一原件可被多条证据引用。
-- 原件与元数据在同一事务里写入;约束核对内容与 sha256,外键保证每条证据都有原件。
-- 应用只能读和新增,不能改或删原件。

CREATE TABLE omniboard.evidence_originals (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  bytes  bytea NOT NULL,
  CHECK (sha256 = encode(pg_catalog.sha256(bytes), 'hex'))
);

ALTER TABLE omniboard.evidence DROP COLUMN s3_key;
ALTER TABLE omniboard.evidence ADD CONSTRAINT evidence_original
  FOREIGN KEY (sha256) REFERENCES omniboard.evidence_originals(sha256);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_app') THEN
    GRANT SELECT, INSERT ON omniboard.evidence_originals TO omniboard_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_read') THEN
    GRANT SELECT ON omniboard.evidence_originals TO omniboard_read;
  END IF;
END $$;
