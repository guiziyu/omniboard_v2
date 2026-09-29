-- 身份、会话、令牌、审计与设置(data-model §4.1、§4.2、§3.1 app_setting)。
-- 由 migrator 执行,对象归 migrator(D1);omniboard_app / omniboard_read 存在时才授权(角色由 owner 建,db/owner/)。

CREATE FUNCTION omniboard.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on %.% is not allowed', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TABLE omniboard.member (
  id              text PRIMARY KEY,
  name            text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  email           text NOT NULL UNIQUE CHECK (email = lower(email) AND email LIKE '%_@_%'),
  role            text NOT NULL CHECK (role IN ('reader','editor','trader','admin')),
  status          text NOT NULL CHECK (status IN ('invited','active','disabled')),
  password_hash   text,
  totp_secret_enc bytea,
  totp_last_step  bigint,
  failed_logins   integer NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz,
  CHECK (status <> 'active' OR (password_hash IS NOT NULL AND totp_secret_enc IS NOT NULL))
);

CREATE TABLE omniboard.member_invite (
  token_hash        text PRIMARY KEY,
  member_id         text NOT NULL REFERENCES omniboard.member(id),
  purpose           text NOT NULL CHECK (purpose IN ('activate','reset')),
  pending_totp_enc  bytea,
  expires_at        timestamptz NOT NULL,
  used_at           timestamptz,
  created_by        text NOT NULL REFERENCES omniboard.member(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_invite_member ON omniboard.member_invite(member_id);

CREATE TABLE omniboard.member_recovery_code (
  member_id text NOT NULL REFERENCES omniboard.member(id),
  code_hash text NOT NULL,
  used_at   timestamptz,
  PRIMARY KEY (member_id, code_hash)
);

CREATE TABLE omniboard.session (
  token_hash text PRIMARY KEY,
  member_id  text NOT NULL UNIQUE REFERENCES omniboard.member(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE omniboard.agent_token (
  id           text PRIMARY KEY,
  member_id    text NOT NULL REFERENCES omniboard.member(id),
  name         text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  role         text NOT NULL CHECK (role IN ('reader','editor','admin')),
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  last_used_at timestamptz
);
CREATE INDEX agent_token_member ON omniboard.agent_token(member_id);

CREATE TABLE omniboard.member_preference (
  member_id text PRIMARY KEY REFERENCES omniboard.member(id),
  locale    text NOT NULL DEFAULT 'en' CHECK (locale IN ('en','zh-CN','ko'))
);

CREATE TABLE omniboard.audit_event (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at             timestamptz NOT NULL DEFAULT now(),
  actor_id       text NOT NULL REFERENCES omniboard.member(id),
  via            text NOT NULL CHECK (via IN ('session','agent_token','cli','system')),
  agent_token_id text REFERENCES omniboard.agent_token(id),
  action         text NOT NULL,
  target_table   text NOT NULL,
  target_key     text NOT NULL,
  before         jsonb,
  after          jsonb,
  step_up        boolean NOT NULL,
  -- 需要通知 owner(frontend-spec 12.11);发送结果另写 action='notify_result' 的事件(outbox)。
  notify_required boolean NOT NULL,
  CHECK ((via = 'agent_token') = (agent_token_id IS NOT NULL))
);
CREATE INDEX audit_event_at ON omniboard.audit_event(at DESC);
CREATE INDEX audit_event_target ON omniboard.audit_event(target_table, target_key, at DESC);
CREATE INDEX audit_event_notify_result ON omniboard.audit_event(((after->>'eventId')::bigint))
  WHERE action = 'notify_result';
CREATE TRIGGER audit_event_append_only BEFORE UPDATE OR DELETE ON omniboard.audit_event
  FOR EACH ROW EXECUTE FUNCTION omniboard.reject_mutation();
CREATE TRIGGER audit_event_no_truncate BEFORE TRUNCATE ON omniboard.audit_event
  FOR EACH STATEMENT EXECUTE FUNCTION omniboard.reject_mutation();

CREATE TABLE omniboard.app_setting (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);
INSERT INTO omniboard.app_setting VALUES
  ('daily_collection', 'false'),
  ('stale_days', '30'),
  ('known_egress_ips', '[]');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_app') THEN
    GRANT USAGE ON SCHEMA omniboard TO omniboard_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      omniboard.member, omniboard.member_invite, omniboard.member_recovery_code, omniboard.session,
      omniboard.agent_token, omniboard.member_preference, omniboard.app_setting
      TO omniboard_app;
    GRANT SELECT, INSERT ON omniboard.audit_event TO omniboard_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_read') THEN
    -- D7:只读角色不含身份、会话、令牌表。
    GRANT USAGE ON SCHEMA omniboard TO omniboard_read;
    GRANT SELECT ON omniboard.app_setting TO omniboard_read;
  END IF;
END $$;
