# Omniboard v2 数据模型

- 状态:**Draft**,2026-09-29。与 [proposal.md](proposal.md)、[frontend-spec.md](frontend-spec.md) 一起构成 v2 需求。
- 依据:v1 `db/migrations/001–019`(f6ebc16);quant ca483b24 的 `management.authentication`、`hft_config`、
  `hft_group_limit` 实体与约束,`connector/docs/verification-contract.md` §4–§6。
- 改表先改本文,再写迁移。D1–D7 的裁决见文末。

## 1 总则

- 数据库:生产 PG `10.0.3.240:5433`;测试 PG `5432`(Neo)。v2 自己的表全部在 schema `omniboard`。
- **DDL 只由 migrator 执行**:`npm run migrate` 用 `QUANT_PG_MIGRATOR_URL`,按 `db/migrations/NNN_*.sql` 顺序执行,
  记在 `omniboard.schema_migrations(version, checksum, applied_at)`;已执行文件的 checksum 变了就拒绝执行。
  应用进程用 `omniboard_app` 连接,没有 DDL 权限。`deploy.sh` 自检时比对 `schema_migrations` 的最大版本与代码期望版本,
  不一致就不切换。
- schema `omniboard` 与其中对象归 migrator 所有(**改判** proposal §4「`omniboard_app` 拥有 schema」:拥有即可 DDL,
  与同一行的「无 DDL」冲突。待裁决 D1)。
- 类型约定(v1 SQLite → PG):
  - 系统时间:`timestamptz`,服务端 `now()` 生成,API 不接受。
  - 业务日期:`text`,`CHECK (x ~ '^\d{4}(-\d{2}(-\d{2})?)?$')`,允许 `NULL`(= v1 的 `''`)。不完整日期不补全(spec 0.4)。
  - 数值观测:`numeric`(保留输入的小数位,可排序,不经浮点)。
  - JSON:`jsonb`。布尔:`boolean`(v1 的 0/1)。
  - id:`text`,保留 v1 原值(v1 有 uuid,也有 `person-record:<id>` 这类派生 id)。新建 id 由客户端或服务端生成 uuid。
  - `workspace_id` 全部去掉(proposal §8 不做多 workspace)。
  - 可见性:`visibility text CHECK (visibility IN ('team','admin'))`,创建后不可改(spec 0.2),由触发器拒绝 UPDATE 该列。
- 单进程互斥:定时采集等后台任务用 `pg_try_advisory_lock`,取代 v1 PID 锁。
- 证据原件:S3 私有桶,对象键 `evidence/<sha256>`;库里只存元数据(3.1)。S3 接入之前,开发与测试用本地目录
  (`OMNIBOARD_EVIDENCE_DIR/evidence/<sha256>`),读取时校验 sha256。

## 2 数据库角色与授权

| 角色 | 用途 | 权限 |
|---|---|---|
| migrator(`QUANT_PG_MIGRATOR_URL`) | 执行迁移 | 拥有 `omniboard` schema 与对象;授权语句也在迁移里 |
| `omniboard_app` | 应用进程 | 见下 |
| 只读(Neo 上的 agent、quant) | 读业务数据取上下文(proposal §3) | `omniboard` 业务表与视图 `SELECT`;**不含** 4.1 的身份表 |

`omniboard_app`:
- `omniboard` 业务表:`SELECT, INSERT, UPDATE, DELETE`。`audit_event` 只有 `INSERT, SELECT`,另有触发器拒绝 UPDATE/DELETE/TRUNCATE。
- `management.authentication`(按列):
  - `SELECT (auth_id, exchange, account_name, account_tags, ip_whitelist, owner, verified_auth_tags, verified_auth_tags_updated_at)`;
  - `INSERT (auth_id, exchange, account_name, account_tags, ip_whitelist, owner, api_key, api_secret, api_pass)`;
  - `UPDATE (account_tags, ip_whitelist, owner, api_key, api_secret, api_pass)`;
  - 不授 `DELETE`,不授 `api_*` 的 `SELECT`,不碰 `verified_auth_tags*`(归 Omnitra 写)。
  - 写语句不能 `RETURNING api_*`,也不能在 `WHERE` / `SET` 表达式里引用 `api_*`,否则 PG 要求 SELECT 权限。
- `management.hft_config`:`SELECT, INSERT, UPDATE`,不授 `DELETE`(runner 启动时找不到行就失败)。
- `management.hft_group_limit`:`SELECT, INSERT, UPDATE, DELETE`(按 channel 整体替换,见 5.2)。
- `verification.v_connector_declared_latest`、`v_live_test_leaf_latest`、`v_live_test_run_by_request`:`SELECT`。
- 角色属性:`CONNECTION LIMIT 10`;`ALTER ROLE omniboard_app SET statement_timeout = '15s'`。
- 这些授权涉及 quant 的表,由 owner 执行(proposal §4);`omniboard` 内部的授权随迁移执行。

## 3 从 v1 移植的表

表名、列与 v1 相同的只列变化。「迁移」列:✓ = agent 经 API 导入(proposal §9);✗ = 不迁移。

### 3.1 证据与来源

| v2 表 | v1 表 | 变化 | 迁移 |
|---|---|---|---|
| `evidence` | `source_snapshots` | 原件移到 S3,`s3_key` = `evidence/<sha256>`;`sha256` 建普通索引(同一原件可被多条证据引用,不唯一) | ✓ |
| `source_entity_links` | 同名 | — | ✓ |
| `collection_runs` | 同名 | 删 `process_id`;保留「同时最多一个 running」部分唯一索引 | ✗ |
| `source_observations` | 同名 | `metrics_json` → `metrics jsonb` | ✗(CMC/CoinGecko 历史不迁,proposal §9) |
| `app_setting` | `settings` | `key text PK, value jsonb`。初始键:`daily_collection`、`stale_days`(30)、`known_egress_ips`(5.1) | 按值手工设 |

所有引用 v1 `raw_id` / `attachment_id` 的列改名为 `evidence_id` / `attachment_evidence_id`,外键指向 `evidence`。

实现补充(`002_organizations.sql`):
- `evidence.s3_key` 是生成列(`'evidence/' || sha256`),不能单独写。`visibility` 由触发器 `keep_visibility()`
  拒绝修改,`module_records` 共用同一个函数。
- `source_observations`、`metric_observations` 各加 `seq bigint GENERATED ALWAYS AS IDENTITY`,取代 v1 的 `rowid`,
  在同一时刻的多条观测之间决定先后(frontend-spec 9.1)。
- `collection_runs.snapshot_id` 改名 `evidence_id`。
- 导入接口以 id 幂等:同 id 同内容视为已导入;同 id 不同内容返回 409。

### 3.2 机构

| v2 表 | 变化 | 迁移 |
|---|---|---|
| `organizations` | — | ✓ |
| `organization_tags` | tag 枚举取 v1 016 的 13 个;`exchange` 隐含 `company` 改为 PG 触发器 | ✓ |
| `organization_aliases`、`organization_profiles`、`organization_logos`、`organization_external_keys` | `*_json` → `jsonb`;`organization_logos.logo_path` 改为 `logo_evidence_id`(logo 原件也进 S3,须为 team 可见的 `image/*`),v1 `raw_id` 改为 `evidence_id`(抓取 logo 的来源页);`organization_external_keys` 主键改为 `external_key` | ✓ |

实现补充(别名导入):`organization_aliases` 经 `POST /api/import/organization-aliases`
(`{aliasId, organizationId, reason, createdAt, payload}`)写入,只在导入窗口内由 admin 令牌调用;两个机构须先导入,
别名必须直接指向规范机构(不能成链),同 alias 同目标返回 200,指向别处返回 409。

### 3.3 记录、指标、情报

`module_records`、`edit_history`、`metric_observations` 先于本节其余表建立(`003_records_metrics.sql`):
目录排名要读观测值与记录数,建机构与录入观测要写历史。

实现补充(记录与档案):
- `module_records.event_date` 为 `NULL` 时,API 仍返回 `''`(与 v1 相同)。
- `edit_history.payload`:记录为保存后的字段快照(`title`、`body`、`scope`、`status`、`visibility`、`personName`、
  `personEmail`、`structured`、`eventDate`、`eventType`、`evidenceId`、`attachmentEvidenceId`);档案为
  `{profile, previousProfile}`;来源映射为 `{from, to}`。
- `organization_profiles.profile` 里每条引用的键是 `evidenceId`(v1 为 `rawId`,导入时改名)。
- 导入记录时,以下字段只在导入窗口内由 admin 令牌写入(D6 的延伸):`evidenceId` / `attachmentEvidenceId`
  (引用已上传的证据,代替原文)、`authorId`(v1 作者,须是已导入的成员)、`importedRevision`(保留 v1 revision)、
  `updatedAt`。`id` 任何编辑者都可传。team 记录不能引用 admin 证据。

实现补充(组织架构图与人员变动,`004_org_chart.sql`):
- `org_chart_relationships.raw_id` 改名 `evidence_id`。关系理由存为独立证据(`relationship-reference.txt`,可见性同记录);
  没有这一行的上级读作 `unconfirmed`。API 的记录字段 `relationshipRawId` 改名 `relationshipEvidenceId`。
- 组织架构图记录的 `edit_history.payload` 另含 `reportsTo`、`relationshipKind`、`relationshipNote`、
  `relationshipEvidenceId`;调整汇报的 action 为 `reporting_relationship_updated`。
- 同一机构的架构图写入用事务级 advisory lock 串行,环检测读到的上级链不会被并发移动改掉。
- 导入职位时可带 `relationshipEvidenceId`(导入字段,规则同上)连同 `relationshipKind`、`relationshipNote` 写入关系;
  不带时,v1 里没有关系元数据的上级原样导入、读作 `unconfirmed`。上级须先导入(按上级在前的顺序),
  v1 里指向不存在职位的 `reportsTo` 导入为 `''`(页面同样显示为顶层)。
- `record_aliases` 经 `POST /api/import/record-aliases`(`{aliasId, recordId}`)写入,规则同机构别名。
- 由个人履历生成的人员变动(`structured.personProfileId` 等键,frontend-spec 6.14)不经记录接口导入,
  随 §3.4 人员档案一起迁移。

| v2 表 | 变化 | 迁移 |
|---|---|---|
| `module_records` | `structured_json` → `structured jsonb`;`event_date` 按业务日期约定 | ✓(保留 `revision`) |
| `record_aliases`、`org_chart_relationships` | — | ✓ |
| `metric_observations` | `value` → `numeric` | ✓(人工录入的观测) |
| `edit_history` | 新写入从 v2 开始 | ✗(proposal §9) |
| `operation_events`(活动历史) | `id bigint generated always as identity` | ✗(同上;待裁决 D6) |
| `intelligence_reads`、`organization_follows` | — | ✓ |
| `capital_scenarios`、`position_drivers` | `*_json` → `jsonb` | ✓ |
| `imports` | 批量导入的幂等键(附录 A) | ✓ |

### 3.4 人员、关系、任务

`knowledge_objects`、`object_records`、`knowledge_claims`、`knowledge_claim_contexts`(v1 触发器改为 PG 触发器)、
`knowledge_relations`、`knowledge_identity_redirects`、`knowledge_identity_events`、`person_source_profiles`、
`person_profile_captures`、`person_profile_positions`、`person_profile_records`、`person_duplicate_decisions`、
`work_tasks`、`task_dependencies`、`task_objects`:列不变,按 1 的类型约定转换,全部 ✓。

### 3.5 不再存在的 v1 表

`workspaces`、`sessions`(4.1 重做)、`memberships`(4.1 重做)、`member_preferences`(并入 `member_preference`)、
`work_views`、`work_preferences`(spec「已排除」)、`connector_declared`、`connector_verification`、
`integration_attempts`、`integration_exports`(改读 `verification.v_*`)、`integration_jobs`(由 3.6 取代)。

### 3.6 接入请求

```sql
CREATE TABLE omniboard.connector_request (
  request_id       uuid PRIMARY KEY,          -- 迁移保留 v1 integration_jobs.id(已写入 verification.live_test_*)
  organization_id  text NOT NULL REFERENCES omniboard.organizations(id),
  record_id        text NOT NULL REFERENCES omniboard.module_records(id),
  record_revision  integer NOT NULL,
  action           text NOT NULL CHECK (action IN ('validate_readonly','prepare_config','propose_adapter_change')),
  declared_revision text,                      -- 创建时 venue 的声明 build_revision(spec 11.3 最后一行)
  request          jsonb NOT NULL,             -- 契约 §4 形状,创建后不改
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (record_id, record_revision)
);
-- 不可变:触发器拒绝 UPDATE / DELETE。
CREATE VIEW omniboard.v_connector_request AS
  SELECT request_id, created_at, request FROM omniboard.connector_request;
```

- 请求状态、叶子状态、阻塞项都在读取时计算(spec 11.2–11.4),不存。
- `request.account.kind` 固定 `test`;`request.schema_version` = 1。
- 视图授权给 quant 的 deliver skill 所用角色 `SELECT`(proposal §6)。

## 4 v2 新增的表

### 4.1 身份与会话(只读角色不可读)

```sql
CREATE TABLE omniboard.member (
  id              text PRIMARY KEY,           -- 迁移保留 v1 memberships.id
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  email           text NOT NULL UNIQUE CHECK (email = lower(email)),  -- 不用 citext:建扩展要额外权限
  role            text NOT NULL CHECK (role IN ('reader','editor','trader','admin')),
  status          text NOT NULL CHECK (status IN ('invited','active','disabled')),
  password_hash   text,                       -- scrypt(node:crypto,无原生依赖);invited 时为 NULL
  totp_secret_enc bytea,                      -- 用 OMNIBOARD_TOTP_KEY 加密;DB 读者不能据此生成验证码
  totp_last_step  bigint,                     -- 最近一次被接受的时间片,防止同一验证码重放
  failed_logins   integer NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_login_at   timestamptz
);
CREATE TABLE omniboard.member_invite (      -- 首次设置与重置 TOTP 共用
  token_hash  text PRIMARY KEY, member_id text NOT NULL REFERENCES omniboard.member(id),
  purpose     text NOT NULL CHECK (purpose IN ('activate','reset')),
  pending_totp_enc bytea,                   -- 激活第 2 步生成、第 3 步确认后移到 member
  expires_at  timestamptz NOT NULL, used_at timestamptz, created_by text NOT NULL REFERENCES omniboard.member(id)
);
CREATE TABLE omniboard.member_recovery_code (
  member_id text NOT NULL REFERENCES omniboard.member(id), code_hash text NOT NULL, used_at timestamptz,
  PRIMARY KEY (member_id, code_hash)
);
CREATE TABLE omniboard.session (
  token_hash text PRIMARY KEY,
  member_id  text NOT NULL UNIQUE REFERENCES omniboard.member(id),  -- 每人一个会话:新登录替换旧会话
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL                                   -- created_at + 8h,不续期
);
CREATE TABLE omniboard.agent_token (
  id text PRIMARY KEY, member_id text NOT NULL REFERENCES omniboard.member(id),
  name text NOT NULL, role text NOT NULL CHECK (role IN ('reader','editor','admin')),  -- 无 trader,见 frontend-spec 12.6
  token_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL, revoked_at timestamptz, last_used_at timestamptz
);
CREATE TABLE omniboard.member_preference (
  member_id text PRIMARY KEY REFERENCES omniboard.member(id),
  locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en','zh-CN','ko'))
);
```

- 令牌、邀请码、恢复码只存 SHA-256,明文只在生成时显示一次。
- `token.role` 不得高于所属成员的当前角色;成员被降级或停用时,其令牌在请求时按较低者生效或失效。

### 4.2 审计

```sql
CREATE TABLE omniboard.audit_event (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  actor_id     text NOT NULL REFERENCES omniboard.member(id),
  via          text NOT NULL CHECK (via IN ('session','agent_token','cli','system')),  -- cli:bootstrap-admin;system:notify_result
  agent_token_id text REFERENCES omniboard.agent_token(id),
  action       text NOT NULL,     -- 枚举见下
  target_table text NOT NULL,     -- 如 management.authentication
  target_key   text NOT NULL,     -- 如 auth_id、channel
  before       jsonb,             -- 密钥列一律写成 {"changed": true} / 不出现,不写值
  after        jsonb,
  step_up      boolean NOT NULL,  -- 是否当场重新输入了 TOTP
  notify_required boolean NOT NULL  -- 需要通知 owner(frontend-spec 12.11)
);
```

- 与业务写入同一事务提交(proposal §4)。
- 通知走 outbox:需要通知的事件写 `notify_required=true`;提交后由发送器取出尚无结果的事件发送,
  结果另写一条 `action='notify_result'`、`via='system'` 的事件(`after` = `{eventId, result, error?}`),
  失败不重试。写请求结束时触发一次,服务进程每分钟补投一次。审计页把两条合并成 Sent / Failed / Pending。
- 写入前按字段名脱敏:`api_key`、`api_secret`、`api_pass`、`password`、`passphrase`(含驼峰写法)的值一律写成
  `"changed"`,即使调用方误传也不落库。
- `action` 取值:`auth.create`、`auth.update_tags`、`auth.update_whitelist`、`auth.update_owner`、`auth.rotate_key`、
  `auth.terminate`、`hft_config.update`、`hft_config.create`、`hft_restart.request`、`member.invite`、`member.role`、
  `member.disable`、`member.enable`、`member.reset_totp`、`session.revoke`、`agent_token.create`、`agent_token.revoke`、
  `login.locked`、`notify_result`。
- 业务数据(记录、任务等)的编辑历史仍在 `edit_history`,不重复进审计。

### 4.3 key 指纹

```sql
CREATE TABLE omniboard.credential_fingerprint (
  auth_id     text PRIMARY KEY,     -- = management.authentication.auth_id,不建跨 schema 外键
  api_key_fp  text NOT NULL,        -- sha256(api_key) 十六进制前 12 位
  set_at      timestamptz NOT NULL DEFAULT now(),
  set_by      text NOT NULL REFERENCES omniboard.member(id)
);
```

v2 之前录入的 key 没有指纹,界面显示「录入早于 v2」(frontend-spec 12.7)。只对 `api_key` 算指纹,不对 secret / pass 算。

### 4.4 HFT 重启请求(第二批)

```sql
CREATE TABLE omniboard.hft_restart_request (
  id            uuid PRIMARY KEY,
  channel       text NOT NULL,
  action        text NOT NULL CHECK (action IN ('restart','stop')),
  run_mode      text CHECK (run_mode IN ('read-only','live','de-risk-only')),  -- restart 时必填
  requested_by  text NOT NULL REFERENCES omniboard.member(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  state         text NOT NULL CHECK (state IN ('pending','running','done','rejected','failed')),
  reason        text,                -- rejected / failed 的原因
  pid           integer, build_revision text, build_dirty boolean, started_at timestamptz, finished_at timestamptz,
  CHECK ((action = 'restart') = (run_mode IS NOT NULL))
);
CREATE UNIQUE INDEX one_open_restart_per_channel
  ON omniboard.hft_restart_request(channel) WHERE state IN ('pending','running');
```

- `omniboard_app` 只能 `INSERT` 与 `SELECT`;`state` 之后的列由 `hft-launcher` 的角色更新(授权由 owner 执行)。
- 最新一行 `state='done' AND action='restart'` 的 `started_at` 就是「当前进程启动时间」(proposal §5 第 1 步)。

## 5 v2 写入的 quant 控制表

### 5.1 `management.authentication`

列(quant `core/crates/db-entity/src/authentication.rs`):`auth_id` PK、`exchange`、`account_name`、`account_tags`、
`ip_whitelist text[]`、`api_key`、`api_secret`、`api_pass`、`owner`、`verified_auth_tags`、`verified_auth_tags_updated_at`。

**写入规则**(与 quant `auth_model_to_auth` 相同;任一不满足,quant 读取时整张快照拒收):

| 列 | 规则 |
|---|---|
| `exchange` | `ExchangeName` 的变体名,大小写精确:`Aster Binance BinanceUS Bitget Bithumb Bybit Coinbase Deribit Gate HTX Hyperliquid Kalshi KuCoin Lighter Okx Polymarket Upbit XT`(传统交易所与 `Unknown` 不开放;`CoinEx` 已退役,不开放新建) |
| `auth_id` | 恒等于 `exchange || '_' || account_name`;v2 生成,不接受输入 |
| `account_name` | 非空,前后无空白;创建后不可改(改名等于换身份) |
| `account_tags` | 非 NULL;`Vec<AccountTag>` 的 serde JSON 文本,如 `["Test",{"TradingSystem":"Hft"},{"VipLevel":3}]` |
| `ip_whitelist` | 每项能解析为 IPv4 或 IPv6 地址(`std::net::IpAddr`,不接受 CIDR) |
| `api_pass` | 非 NULL;没有 passphrase 的交易所写 `''` |

**v2 另加的规则**(比 quant 解析更严,DB 约束同样执行,proposal §4「必须先堵的坑」):
- `TradingSystem` 标签最多一个;非 `Test`、非 `ReadOnly`、非 `Terminated` 的账户恰好一个(待裁决 D3)。
- 非 `Test` 账户 `ip_whitelist` 非空。
- `account_tags` 顶层标签只允许 `AccountTag` 已有的 14 种。结构复杂的 `ListingTagBlocklist`、`WalletBlocked`
  第一批不提供编辑,已有值原样保留。
- `ip_whitelist` 的快捷填充来自 `app_setting.known_egress_ips`(如 Neo 的 EIP),由 admin 维护。

**写法**:
- 新建:`INSERT`,`auth_id` 冲突时返回 409「This account already exists.」,不用 `ON CONFLICT DO UPDATE`。
- 改标签、白名单、负责人:`UPDATE … WHERE auth_id = $1`。
- 轮换:`UPDATE … SET api_key, api_secret, api_pass`,三列一起写。
- 停用:在 `account_tags` 里加 `"Terminated"`,不删行。
- 同一事务:控制表写入 + `credential_fingerprint` + `audit_event` + (录入时)Onboarding 记录新版本
  (`resourceStage=granted`、`accountRef=account_name`,proposal §5)。

### 5.2 `management.hft_config` 与 `hft_group_limit`

列与约束见 quant `strategy/migration/src/schema_registry.rs`,v2 前端与服务端重复同样的检查:

| 字段 | 规则 |
|---|---|
| `channel`、`portfolio_group`、`prediction_group` | 非空,前后无空白 |
| `max_active_groups` | 整数 > 0 |
| `max_portfolio_gross_exposure_usd` | 有限且 > 0 |
| `max_portfolio_abs_net_exposure_usd` | 有限、> 0、≤ gross |
| `max_wallet_gross_to_assets_ratio` | 0 < r < 1 |
| `max_gross_exposure_usd`(组) | 有限且 > 0 |
| `max_abs_net_exposure_usd`(组) | > 0 且 ≤ 组 gross |

- 保存语义与 `sync_hft_config --apply` 相同:同一事务里 upsert `hft_config` 那一行、删掉该 channel 的全部
  `hft_group_limit` 再按表单插入,`update_at = now()`。
- 不删 `hft_config` 行。
- YAML(`hft-lp-gavin-cross.yaml`)目前写明是这些值的真值,v2 上线后它和库会分叉(待裁决 D2)。

### 5.3 只读:`verification.v_*`

三个视图的列见验证契约 §5。v2 按请求读,不落本地副本;`build_dirty=true` 的行只进开发视图(spec 11.4)。

## 6 迁移与测试

- 迁移文件:`db/migrations/NNN_<name>.sql`,只前进,不写 down。涉及 quant 表的授权与约束放在
  `db/owner/NNN_<name>.sql`,不自动执行,由 owner 手工执行并在文件头记录执行日期。
- 测试 PG:同一套迁移;另有 `tests/fixtures/quant-shapes.sql` 按 quant 实体建 `management.authentication`、
  `hft_config`、`hft_group_limit` 与 `verification` 三个视图的底表,并建 `omniboard_app` 角色和同样的按列授权,
  用来测「密钥列读不出」。
- 必须有的测试:`omniboard_app` 执行 `SELECT api_secret` 失败;坏的 `account_tags` / 白名单写不进去;
  `audit_event` 不能 UPDATE / DELETE;`connector_request` 不能 UPDATE;同一 TOTP 验证码不能用两次。

## 已裁决(2026-09-29)

以下各项 owner 已裁决:全部按「建议」执行。正文中「待裁决 Dn」均按此理解。

| # | 问题 | 裁决 |
|---|---|---|
| D1 | `omniboard` schema 归谁:proposal §4 写 `omniboard_app` 拥有,但同一行又写「无 DDL」 | 归 migrator,`omniboard_app` 只有 DML;改 proposal §4 |
| D2 | `hft_config` 真值:quant 文档写 YAML 是真值、`sync_hft_config` 是唯一写入方;v2 直接改库后两者分叉,下一次 `sync --apply` 会覆盖界面改动 | v2 上线后库为真值;`sync_hft_config` 改为只读对比(或删除),YAML 退役;列入 proposal §7 quant 改动 |
| D3 | 「恰有一个 `TradingSystem`」是否适用于 Test / ReadOnly / Terminated 账户(quant 只在交易入口要求,解析不要求) | 只对可交易账户要求恰好一个,其余最多一个 |
| D4 | 第一批还没有 `hft-launcher`,不知道当前 HFT 进程的启动时间,无法判断「已改,重启后生效」 | 第一批只显示 `update_at` 和固定提示「改动在下次重启后生效」;第二批按 4.4 比较 |
| D5 | 给 owner 发通知邮件的通道 | AWS SES,应用机器的实例角色授权;没配置时通知记为 `failed`,不阻塞操作 |
| D6 | proposal §9 不迁移系统时间戳,导入后所有记录的 `updated_at` 都是导入时刻,「按更新时间排序」「最近变化」会失真 | 允许导入接口在 admin 令牌下写入 `created_at` / `updated_at`,仅迁移期开放。实现:同样适用于证据与观测的 `captured_at`;窗口是 `app_setting.import_open`,切换后 `npm run cli -- close-import` 关闭;窗口外或非 admin 令牌传入时间戳返回 403,不静默忽略 |
| D7 | 只读角色的范围:proposal 说 agent 可读 `omniboard` schema,但其中有会话、TOTP、令牌表 | 只读角色排除 4.1 的表 |
