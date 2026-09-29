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
- 证据原件:存 `evidence_originals`(按 sha256 寻址,3.1),与元数据在同一事务里写入(改判 proposal §2 的 S3)。

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
| `evidence` | `source_snapshots` | 原件移到 `evidence_originals`;`sha256` 建普通索引(同一原件可被多条证据引用,不唯一),外键指向原件 | ✓ |
| `evidence_originals` | `data/raw/<sha256>` 文件 | `sha256 text PK, bytes bytea`;约束核对 `sha256 = encode(sha256(bytes),'hex')`;app 只有 SELECT、INSERT | ✓ |
| `source_entity_links` | 同名 | — | ✓ |
| `collection_runs` | 同名 | 删 `process_id`;保留「同时最多一个 running」部分唯一索引 | ✗ |
| `source_observations` | 同名 | `metrics_json` → `metrics jsonb` | ✗(CMC/CoinGecko 历史不迁,proposal §9) |
| `app_setting` | `settings` | `key text PK, value jsonb`。初始键:`daily_collection`、`stale_days`(30)、`known_egress_ips`(5.1) | 按值手工设 |

所有引用 v1 `raw_id` / `attachment_id` 的列改名为 `evidence_id` / `attachment_evidence_id`,外键指向 `evidence`。

实现补充(`002_organizations.sql`):
- `evidence.visibility` 由触发器 `keep_visibility()` 拒绝修改,`module_records` 共用同一个函数。
  (002 的 `evidence.s3_key` 生成列已由 `010_evidence_originals.sql` 删除。)
- `source_observations`、`metric_observations` 各加 `seq bigint GENERATED ALWAYS AS IDENTITY`,取代 v1 的 `rowid`,
  在同一时刻的多条观测之间决定先后(frontend-spec 9.1)。
- `collection_runs.snapshot_id` 改名 `evidence_id`。
- 导入接口以 id 幂等:同 id 同内容视为已导入;同 id 不同内容返回 409。
- `source_entity_links` 经 `POST /api/import/source-links`(`{id, source, slug, organizationId, name, url, mappedBy}`)
  导入:机构按规范机构记,必须带 exchange tag(422);同一机构对同一来源只能有一个链接(409)。
- 采集运行(frontend-spec 9.7)不再记 `process_id`:服务持有单实例锁启动时,把遗留的 `running` 改为 `interrupted`;
  发布事务只在运行仍为 `running` 时把它改为 `success`,否则整批回滚。数据库错误写入 `error` 时统一替换为
  「Data processing failed. This batch was not published.」,原文只进日志。

### 3.2 机构

| v2 表 | 变化 | 迁移 |
|---|---|---|
| `organizations` | — | ✓ |
| `organization_tags` | tag 枚举取 v1 016 的 13 个;`exchange` 隐含 `company` 改为 PG 触发器 | ✓ |
| `organization_aliases`、`organization_profiles`、`organization_logos`、`organization_external_keys` | `*_json` → `jsonb`;`organization_logos.logo_path` 改为 `logo_evidence_id`(logo 原件也进 `evidence_originals`,须为 team 可见的 `image/*`),v1 `raw_id` 改为 `evidence_id`(抓取 logo 的来源页);`organization_external_keys` 主键改为 `external_key` | ✓ |

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
- 由个人履历生成的人员变动(`structured.personProfileId` 等键,frontend-spec 6.14)也经记录接口导入:这些键只在
  导入时接受(平时由履历导入生成,手工记录传了返回 422),v1 的 `previousRoleRawId` / `nextRoleRawId` 改名
  `previousRoleEvidenceId` / `nextRoleEvidenceId`;归属随 §3.4 履历导入接回。已生成的变动不能经记录接口编辑(422),
  要更新来源履历。

实现补充(路线图,frontend-spec 10.11、10.12):里程碑就是 `tab_id = 'roadmap'` 的 `module_records`,不新增表;
执行任务以 `work_tasks.source_record_id` 关联,状态读取时取任务本身,里程碑不存进度,也不随任务完成而改变。

实现补充(情报,`009_intelligence.sql`):`intelligence_reads` 按 成员 + 记录 存最后已读的 revision;
`organization_follows` 按 成员 + 机构。两表经 `POST /api/import/intelligence-reads`(`{ownerId, recordId, revision,
readAt}`)与 `POST /api/import/organization-follows`(`{ownerId, organizationId, createdAt}`)导入,规则同其他导入:
同一对内容相同返回 200,已读 revision 或时间不同返回 409;关注别名机构时记到规范机构上。

| v2 表 | 变化 | 迁移 |
|---|---|---|
| `module_records` | `structured_json` → `structured jsonb`;`event_date` 按业务日期约定 | ✓(保留 `revision`) |
| `record_aliases`、`org_chart_relationships` | — | ✓ |
| `metric_observations` | `value` → `numeric` | ✓(人工录入的观测) |
| `edit_history` | 新写入从 v2 开始 | ✗(proposal §9) |
| `operation_events`(活动历史) | `id bigint generated always as identity`;`payload_json` → `payload jsonb`;加 `import_id`(v1 id,导入幂等) | ✓(**改判**:结论采纳的理由只存在活动事件里,不迁就丢了 7.13 的 Decision trail;D6 已允许写入原时间) |
| `intelligence_reads`、`organization_follows` | — | ✓ |
| `capital_scenarios`、`position_drivers` | `*_json` → `jsonb`;`position_drivers` 的 `raw_id` / `attachment_id` 改名 `evidence_id` / `attachment_evidence_id`,可见性建立后不可改(触发器) | ✓ |
| `imports` | 批量导入的幂等键(附录 A) | ✓ |

### 3.4 人员、关系、任务

`knowledge_objects`、`object_records`、`knowledge_claims`、`knowledge_claim_contexts`(v1 触发器改为 PG 触发器)、
`knowledge_relations`、`knowledge_identity_redirects`、`knowledge_identity_events`、`person_source_profiles`、
`person_profile_captures`、`person_profile_positions`、`person_profile_records`、`person_duplicate_decisions`、
`work_tasks`、`task_dependencies`、`task_objects`:列不变,按 1 的类型约定转换,全部 ✓。

实现补充(共享对象、结论与身份,`005_knowledge.sql`):
- 已建:`knowledge_objects`、`object_records`、`knowledge_claims`、`knowledge_relations`、
  `knowledge_identity_redirects`、`knowledge_identity_events`、`operation_events`。任务表见 `006_work.sql`,
  人员档案表见 `008_talent.sql`。
- `knowledge_claim_contexts` 并入 `knowledge_claims.organization_id`(一对一,v1 由触发器在插入时补写)。
- 所有 `raw_id` 改名 `evidence_id`;API 字段 `rawId` 改名 `evidenceId`。日期列按 §1:`''` 记为 `NULL`,API 仍返回 `''`。
- 身份相关的写入用事务级 advisory lock 串行(合并链、重定向与记录归属的检查读到的都是已提交状态)。
- 带姓名的记录保存后自动建人员档案 `person-record:<记录 id>`(v1 `ensurePersonDossier`);**导入记录时不建**,
  v1 的档案随共享对象一起导入,避免 id 冲突。
- 导入接口(只在导入窗口内由 admin 令牌调用;以 id 为键,已存在返回 409,与记录导入相同;引用的对象、记录、证据和
  成员须先导入,否则 422):`/api/import/knowledge-objects`(带 `recordIds`)、`knowledge-claims`(带
  `organizationId`,即 v1 的 claim context)、`knowledge-relations`、`identity-redirects`(按对幂等)、
  `identity-events`、`operation-events`(以 `importId` 为键)。team 对象不能引用 admin 记录或证据。

实现补充(人才库,`008_talent.sql`,frontend-spec 6.9–6.16):
- 建 `person_source_profiles`、`person_profile_captures`、`person_profile_positions`、`person_profile_records`、
  `person_duplicate_decisions`,以及 §3.3 的 `position_drivers`。`data_json` / `payload_json` → `data` / `payload`(jsonb);
  采集加 `seq`(取代 v1 rowid,决定先后);`person_profile_records.record_id` 唯一;重复决定的无序对按字节序
  (`COLLATE "C"`)存 `left_id < right_id`;履历来源与岗位情报的可见性由触发器锁定。
- 身份索引把履历上已映射的任职机构算进人员对象的关联机构(v1 行为接回)。
- 导入接口(规则同上):`/api/import/person-profiles`(来源、按旧到新排列的 `captures`、`positions`;
  `positions[].startRecordId` / `endRecordId` 指向已导入的生成变动,变动的 `structured.careerPositionId` 须与任职 id
  一致;来源键由 `url` 重新计算)、`/api/import/person-duplicate-decisions`(须按 `leftId < rightId`)、
  `/api/import/position-drivers`(岗位须为组织架构图记录;admin 岗位只能挂 admin 情报)。导入后照常更新同一来源时,
  已导入的变动按任职 id 原地重新生成。

实现补充(工作台任务,`006_work.sql`):
- `work_tasks.raw_id` 改名 `evidence_id`;`follow_up_on`、`due_on` 按业务日期约定(`''` 记为 `NULL`,API 仍返回 `''`)。
  加约束 `origin = 'standard'` 当且仅当有 `template_key`(v1 由代码保证)。
- `task_objects` 存原对象 id;读取时按身份重定向改指规范对象,撤销合并后回到原对象(frontend-spec 7.14),不改写这张表。
- 同一机构的任务写入用事务级 advisory lock 串行:前置环检测、重开检查与标准计划的幂等读到的都是已提交状态。
- 负责人须是未停用的成员(v1 为 workspace 成员);已停用成员名下的任务保留负责人。
- 任务的 API 另带 `sourceRecordTabId`(来源记录所在的 tab):情报页(§8)移植前,「Open source information」
  直接打开来源记录。
- 导入接口 `/api/import/work-tasks`(规则同上):带 `dependencies`、`objectIds`,前置任务须先导入
  (v1 任务的依赖无环,按拓扑序即可);负责人、来源记录、证据、对象须先导入;team 任务不能引用 admin 的
  来源、证据、前置或对象;保留 v1 的 `revision` 与 `updatedAt`。

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
  reissue_of       uuid UNIQUE REFERENCES omniboard.connector_request(request_id),  -- 见下「重发」
  created_at       timestamptz NOT NULL DEFAULT now()
);
-- 每个「记录 × 版本」一个首发请求;重发的快照不占这个位置。
CREATE UNIQUE INDEX ON omniboard.connector_request(record_id, record_revision) WHERE reissue_of IS NULL;
-- 不可变:触发器拒绝 UPDATE / DELETE。
CREATE VIEW omniboard.v_connector_request AS
  SELECT request_id, created_at, request FROM omniboard.connector_request;
```

- 请求状态、叶子状态、阻塞项都在读取时计算(spec 11.2–11.4),不存。
- **重发**(补充,`007_connector_request.sql`):v1 在资源获批后原地改写同一 request_id 的 request.json(契约 §6
  「重新导出被卡的请求」)。v2 的快照不可变,改为按新台账写一行新请求(新 request_id,`reissue_of` 指向旧请求),
  旧快照原样保留;一个请求最多被重发一次。记录当前的请求 = 当前版本、且没有被重发取代的那一行。生成的
  engineering 任务在描述里列出新的 request_id,quant 用新 id 跑。
- 读 quant 的视图:`verification.v_*` 每次请求时直接查,不落本地副本;`build_dirty=true` 的结果不进派生状态。
  v1 在投影时把通过的 run 存成证据并改写标准 validation 任务的下一步(spec 11.5 第 3 条);v2 没有投影这一步,
  改为任务详情直接列出可用的 run,一键完成时 run 的 JSON 存为任务的证据。
- 授权:`omniboard_app` 只有 `SELECT, INSERT`(触发器另外拒绝 UPDATE / DELETE);quant 经 `omniboard_read` 的
  成员关系读 `v_connector_request`(db/owner/001_roles.sql)。
- 导入 `/api/import/connector-requests`(导入窗口内、admin 令牌):`requestId`、`organizationId`、`recordId`、
  `recordRevision`、`action`、`declaredRevision`、`request`(按契约 §4 校验,`request_id` 须一致)、`createdAt`。
  导入的记录不自动生成请求(只有 v2 里保存的新版本才生成)。
- 测试夹具 `tests/fixtures/quant-shapes.sql` 按契约 §5 建 `verification.live_test_run`、`live_test_case_result` 与
  catalog 快照表,三个视图的定义逐字取自 quant 的迁移(`strategy/migration/sql/2026-09-20-verification-views-and-reader.sql`)。
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
  via          text NOT NULL CHECK (via IN ('session','agent_token','cli','system')),  -- cli:bootstrap-admin;system:留给通知结果
  agent_token_id text REFERENCES omniboard.agent_token(id),
  action       text NOT NULL,     -- 枚举见下
  target_table text NOT NULL,     -- 如 management.authentication
  target_key   text NOT NULL,     -- 如 auth_id、channel
  before       jsonb,             -- 密钥列一律写成 {"changed": true} / 不出现,不写值
  after        jsonb,
  step_up      boolean NOT NULL,  -- 是否当场重新输入了 TOTP(影响实盘的操作暂不要求,目前写 false;frontend-spec 12.4)
  notify_required boolean NOT NULL  -- 需要通知 owner(frontend-spec 12.11;发送是 TODO,目前只标记)
);
```

- 与业务写入同一事务提交(proposal §4)。
- 需要通知 owner 的事件写 `notify_required=true`(与业务同事务)。
- **TODO(低优先级):通知邮件的发送。** 2026-09-29 移除了已写好的 outbox 与发送器:发送通道没定(D5),
  又不想绑定某家云的服务。做的时候按 outbox 来:提交后取出尚无结果的 `notify_required` 事件发送,结果另写
  一条 `action='notify_result'`、`via='system'` 的事件(`after` = `{eventId, result, error?}`),失败不重试;
  审计页加 Notification 列(Sent / Failed / Pending)。只投递功能上线之后的事件,不补发历史。
  `001` 里的 `audit_event_notify_result` 索引就是给它留的。
- 写入前按字段名脱敏:`api_key`、`api_secret`、`api_pass`、`password`、`passphrase`(含驼峰写法)的值一律写成
  `"changed"`,即使调用方误传也不落库。
- `action` 取值:`auth.create`、`auth.update_tags`、`auth.update_whitelist`、`auth.update_owner`、`auth.rotate_key`、
  `auth.terminate`、`hft_config.update`、`hft_config.create`、`hft_restart.request`、`member.invite`、`member.role`、
  `member.disable`、`member.enable`、`member.reset_totp`、`session.revoke`、`agent_token.create`、`agent_token.revoke`、
  `login.locked`(通知结果的 `notify_result` 随上面的 TODO 一起加)。
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
| `account_tags` | 非 NULL;`Vec<AccountTag>` 的 serde JSON 文本,如 `["Test",{"PortfolioGroup":"lp-gavin-cross"},{"VipLevel":3}]` |
| `ip_whitelist` | 每项能解析为 IPv4 或 IPv6 地址(`std::net::IpAddr`,不接受 CIDR) |
| `api_pass` | 非 NULL;没有 passphrase 的交易所写 `''` |

**v2 另加的规则**(比 quant 解析更严,DB 约束同样执行,proposal §4「必须先堵的坑」):
- 非 `Test` 账户 `ip_whitelist` 非空。
- `PortfolioGroup`、`VipLevel`、`MarketMakerLevel`、`Client` 各最多一个(quant 的 `portfolio_group()` 只取第一个)。
- `account_tags` 顶层标签只允许 `AccountTag` 已有的 14 种。结构复杂的 `ListingTagBlocklist`、`WalletBlocked`
  第一批不提供编辑,已有值原样保留。
- `ip_whitelist` 的快捷填充来自 `app_setting.known_egress_ips`(`[{ip, label}]`,如 Neo 的 EIP),由 admin 维护。
- 实现:约束在 `db/owner/002_authentication_rules.sql`(owner 执行);2026-09-29 核对生产 29 行全部满足。
  前端与服务端共用 `src/shared/accounts.ts` 的同一套规则。

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
| `prediction_group` | `BaseAsset_<asset>` 或 `Beta_<name>`(quant `PredictionGroup::from_str`)。库里不检查,写错时 HFT 启动加载配置失败,v2 在前端与服务端检查 |
| `max_active_groups` | 整数 > 0 |
| `max_portfolio_gross_exposure_usd` | 有限且 > 0 |
| `max_portfolio_abs_net_exposure_usd` | 有限、> 0、≤ gross |
| `max_wallet_gross_to_assets_ratio` | 0 < r < 1 |
| `max_gross_exposure_usd`(组) | 有限且 > 0 |
| `max_abs_net_exposure_usd`(组) | > 0 且 ≤ 组 gross |

- `max_portfolio_gross_exposure_usd`、`max_portfolio_abs_net_exposure_usd` 虽叫 portfolio,quant 按每个运行中的组
  使用(组合合计 = 每组上限 × 运行组数);没有覆盖行的组用这两个值。
- 保存语义与 `sync_hft_config --apply` 相同:同一事务里 upsert `hft_config` 那一行、删掉该 channel 的全部
  `hft_group_limit` 再按表单插入,`update_at = now()`。没有改动时不写。
- 并发:保存时带上打开时的 `update_at`(微秒精度文本),与库里不同返回 409;行在事务里 `FOR UPDATE`。
- 审计:`hft_config.create` / `hft_config.update`,`target_key` = channel,before / after 为整份设置(含组覆盖)。
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
| D3 | 「恰有一个 `TradingSystem`」是否适用于 Test / ReadOnly / Terminated 账户(quant 只在交易入口要求,解析不要求) | 作废(2026-09-29):quant 已删除 `TradingSystem` 标签 |
| D4 | 第一批还没有 `hft-launcher`,不知道当前 HFT 进程的启动时间,无法判断「已改,重启后生效」 | 第一批只显示 `update_at` 和固定提示「改动在下次重启后生效」;第二批按 4.4 比较 |
| D5 | 给 owner 发通知邮件的通道 | **待定(TODO,低优先级)**。原裁决 AWS SES,2026-09-29 撤回:不让应用依赖某家云的服务;标准 SMTP 是候选。发送功能先移除,事件只标记 `notify_required`(4.2) |
| D6 | proposal §9 不迁移系统时间戳,导入后所有记录的 `updated_at` 都是导入时刻,「按更新时间排序」「最近变化」会失真 | 允许导入接口在 admin 令牌下写入 `created_at` / `updated_at`,仅迁移期开放。实现:同样适用于证据与观测的 `captured_at`;窗口是 `app_setting.import_open`,切换后 `npm run cli -- close-import` 关闭;窗口外或非 admin 令牌传入时间戳返回 403,不静默忽略 |
| D7 | 只读角色的范围:proposal 说 agent 可读 `omniboard` schema,但其中有会话、TOTP、令牌表 | 只读角色排除 4.1 的表 |
