# Omniboard v2 方案

- 状态:**Proposal**。owner 已裁决 §10 所列各项(2026-09-28、09-29)。
- 用途:v2 的架构边界与需求输入,按本文生成代码。改判的条目要在本文标注,不静默改。
- 前端功能与交互:[frontend-spec.md](frontend-spec.md);表结构与授权:[data-model.md](data-model.md)。
  三份一起构成 v2 的全部需求。
- v1:<https://github.com/guiziyu/omniboard>(Neo 上 `/home/ubuntu/omniboard`,f6ebc16),
  切换前保持可打开,用于逐页对照。
- 长期方向:quant `docs/vision/product.md`(Omnitra Platform)。本文只取 v2 需要的部分,不照搬。

## 1. 前提

v1 的边界成立于这些前提:BD 只做情报与商务,不碰实盘;Omniboard 不持有凭据、不写 quant 的库;
正式库放 WSL。现在变了:

1. **BD 录入交易所 key,且 BD 与 trader 职能将合并**:界面操作要能直接影响实盘,包括改
   `hft_config` 和重启 HFT,只是权限隔离要好。
2. 代码由 AI 生成,v1 半天成形:重写的成本在需求与验收,不在代码。
3. connector 开发与 `live_test` 在 Neo 上做(出口 IP 白名单、Test key、VPC 私有端点都在那);
   以后会有别的测试机。
4. WSL 会停机,不能承载正式数据。
5. 代码只有 owner 一人维护。`management.authentication` 目前由 owner 在 DBeaver 里手工维护。

前提 1 推翻了 quant 的几处既有规则:
- 裁决 `docs/notes/records/2026-09-28-venue-facts-sor.md` 中「SQLite 不并入 quant 生产 PG」;
- 验证契约「quant 不写 Omniboard,Omniboard 不写 quant 的库」;
- HFT runbook「启停、重启须 owner 逐次确认」。

两仓同批改文档(§7)。

## 2. 真值与存储

**运行时读的控制数据只在生产 PG 存一份,v2 是它们的编辑界面,不是副本。** 两份可写副本加同步,
正是 9-28 要消除的漂移来源。

| 数据 | 位置 | v2 的权限 |
|---|---|---|
| 交易所 key、账户标签(`PortfolioGroup`、`Test`/`ReadOnly`/`Terminated`)、`ip_whitelist` | `management.authentication` | 写;密钥列只写不读。接管 DBeaver 手工维护 |
| HFT 额度 | `management.hft_config`、`hft_group_limit` | 写;进程启动时加载后冻结,重启才生效(§5) |
| 验证结果 | `verification.v_*` 三个视图 | 只读 |
| 机构、情报、合规、接入进度、任务、审计、HFT 重启请求 | 同库新 schema `omniboard` | 独占 |
| 证据原件 | 同库 `omniboard.evidence_originals`,按 sha256 寻址(2026-09-29 改判,原为 S3 私有桶) | 独占 |

- 与控制表同库,是为了**同一事务**:资源记录标 `granted` 与插入 key 行一起提交或一起失败。
- `management.authentication` 的实体注释早已写明它是「legacy projection,由 access profile 取代」。
  v2 就是那个取代者。
- 应用机器不存数据:没有 tarball、EBS 快照和本机备份脚本;备份就是 PG 备份。
- 原件放 PG 而不放 S3:v1 全部原件约 77 MB,每日采集一年约几百 MB;省去建桶与 IAM,原件与元数据同一事务写入,
  备份只有一份。代价是生产库与其备份随之变大。
- 不用 SQLite。v1 已写明「写并发或存储运维需要时迁 PostgreSQL/对象存储」,前提 1 就是这个时点。
- v2 上线后,DBeaver 只作应急通道。§4 的 DB 约束对它同样生效,但它绕过审计。

**已否决:**
- 保留 SQLite 再同步到 PG:两份可写副本。
- 在 Neo 上对公网提供服务:几十个用户走公网 HTTPS,不和实盘同机。Neo 上只跑阶段一(§3)。

## 3. 部署与开发

应用无状态,能在 VPC 内任何 arm64 Linux 机器上跑(Neo 和 10.0.20.195 都是 aarch64)。
两个阶段用同一个 `deploy.sh <ref>`:从 GitHub 取指定 ref 构建,整目录切换,失败回滚。

- **阶段一,Neo**:只监听 `127.0.0.1`,owner 经 SSH 隧道访问,BD 不接入。用于功能验收、
  与 v1 逐页对照、agent 迁移(§9)。连生产 PG 的 `omniboard_app`;其凭据放 v2 自己的 env 文件,
  不进 quant 的 `.env`。
- **阶段二,正式**:10.0.20.195(t4g.large,子网 10.0.20.0/24)。Caddy 终结 HTTPS,应用只监听内网,
  开放给 BD。之后换机器同样按下列前置条件部署。

**新机器前置条件**(基础设施,owner 做,不在 `deploy.sh` 里):
- Ubuntu arm64,Node LTS;
- 安全组与 Rosseta `pg_hba` 放行到生产 PG 10.0.3.240:5433;
- 对公网提供服务时:域名、Caddy、443 入站。

`deploy.sh` 启动后自检 PG 连通和 `omniboard` schema 版本,任何一项不通就不切换。
- **开发**:两个仓库都在 Neo 上开发,改契约时一个会话同批改两边。测试用测试 PG(5432),
  不连生产库;浏览器测试用 `nice -n 19` 跑,不和 HFT 抢 CPU。
- **agent 取上下文**:Neo 上的 agent 可以读 `omniboard` schema(owner 已允许)。quant 的 agent
  在任何测试机上都用已有的 PG 连接读,不需要额外网络规则。写 Omniboard 业务数据走 HTTP API(§5)。

## 4. 权限隔离

| 层 | 规则 |
|---|---|
| 入口 | 所有账号**强制 TOTP**,不限 IP,不加网关。登录限频,连续失败锁定;session 8 小时,新登录踢掉其他设备 |
| 应用角色 | `reader` / `editor` / `trader` / `admin` 四级,按人授予,不按职位。影响实盘的操作(写 key、改账户标签、改 `hft_config`、重启 HFT)要 `trader`,并**当场重新输入 TOTP**。改前改后与操作人写入审计表,和业务写入同一事务;审计表只追加。这类操作同时发邮件通知 owner:入口不限 IP,这是低成本的发现手段(TODO,低优先级,见 data-model D5) |
| DB 角色 | schema `omniboard` 归 migrator 所有,`omniboard_app` 只有 DML(**2026-09-29 改判**,原写「`omniboard_app` 拥有 schema」与「无 DDL」冲突;data-model §2)。`omniboard_app` 对 quant 控制表**按列**授权:`api_key`/`api_secret`/`api_pass` 只授 INSERT/UPDATE,不授 SELECT。v2 被攻破也读不出已有 key。无 DDL;设连接数上限与 `statement_timeout` |
| 运行时 | 硬风控上限放在 `omniboard_app` 写不到的地方。交易 key 必须在交易所侧绑定 IP 白名单(Neo 的 EIP),且不开提现权限:这是最后一道防线,泄露的 key 在别处不可用 |

**必须先堵的坑**:authentication 快照只要有一行映射失败就整体拒收(quant `docs/context/database.md`
§Current authoritative-read behavior),界面录错一行等于停掉所有钱包。要在 DB 上加约束或改成有类型的列
(`account_tags` 合法、非 Test 账户 `ip_whitelist` 非空等),让写入端与
Rust 解析端同规则,坏行写不进去。运行时「整体拒收」的安全语义不变。`hft_config` 已有约束,照此核对。
约束 DDL 由 owner 执行。

## 5. 关键流程

**录入 key**
1. BD 在账户页填 key。
2. 同一事务里:写 `management.authentication`、资源记录标 `granted` 并填
   `accountRef = account_name`、写审计。
3. 界面此后不再显示 key。写入时算好指纹(哈希前缀)存进 `omniboard` schema,用来辨认是哪把 key。
4. 轮换就是覆盖写;停用就是打 `Terminated` 标签。

含 key 的合同原件只上传遮掉 key 的版本。

**改 `hft_config` 与重启 HFT**

应用机器不 SSH 到 Neo,也不接收来自 Neo 的调用。重启由 Neo 上的 quant 小服务 `hft-launcher` 拉取执行:

1. trader 改额度,v2 写 `management.hft_config`。界面比较这一行的 `update_at` 与当前进程启动时间,
   标出「已改,重启后生效」。
2. trader 发起重启,v2 往 `omniboard.hft_restart_request` 写一行(`channel`、`HFT_RUN_MODE`、发起人)。
3. `hft-launcher` 用 LISTEN/NOTIFY 或轮询取到请求,按 runbook 执行:
   1. 检查能机器判定的前置条件:Guardian 心跳新鲜、配置行有效。「上一轮 De-Risk 已完成」
      不是硬门槛,只在界面上提示 trader;
   2. 按记录的 PID 发 SIGTERM,等进程退出;
   3. 启动预先构建的 release 二进制;
   4. 把结果、PID、`build_revision`、启动时间写回同一行。
   前置条件不满足就拒绝执行,并写明原因。
4. launcher 只接受枚举动作(重启/停止)和枚举模式,没有执行任意命令的入口。

**启动的必须是按 commit 构建好的二进制。** 现在的启动方式是在 `/home/ubuntu/quant` 下
`cargo run`,而 Neo 同时是开发机:工作区里未提交的改动会被编进实盘。launcher 上线前,
先把启动方式改成固定目录下的 release 构建,并记下 `build_revision`、`build_dirty`。

**agent API**
- token 绑定某个成员与角色,权限、审计和人一样。
- 创建接口接受客户端传入的 id:重试幂等,迁移时也能保留原 id。
- 业务日期(采集时间、事件日期、证据时间)是普通字段,可以写入;系统时间戳由服务端生成。
- 证据上传返回 sha256,调用方自己核对。
- 错误返回结构化原因。agent 用起来卡在哪,记下来,作为 API 迭代的输入。

## 6. 与 quant 的交接

- **请求**:视图 `omniboard.v_connector_request`,每行是一个 `request_id` 的不可变快照
  (形状同验证契约 §4 的 request JSON)。deliver skill 改为接收 `request_id`,从 PG 读出后写到本地文件,
  再照旧跑 `live_test --request-file`。不再有导出目录。
- **结果**:v2 直接读 `verification.v_*`,不再定时投影进本地库。`omniboard_reader` 由
  `omniboard_app` 取代。
- **`request_id`** 仍是 uuid。v1 `integration_jobs.id` 已写进生产 `verification.live_test_*`,
  迁移必须原样保留。

## 7. 两仓同批改动

**quant 仓库**
- `connector/docs/verification-contract.md`:改方向规则;§4 删掉导出目录与同机前提;
  §6 写明 `accountRef` = `management.authentication.account_name`;§8 改 skill 输入。
- deliver skill。
- 9-28 裁决的改判记录。
- `docs/hft-config-rollout.md` 与 `docs/production-ssh.md`:trader 经 v2 发起即为授权;
  启动改用 release 二进制。
- `hft_config` 真值改为数据库:YAML(`hft-lp-gavin-cross.yaml`)退役,`sync_hft_config` 改为只读对比
  (不再 `--apply`),否则会覆盖界面改动(data-model D2)。
- `hft-launcher`。
- authentication 约束 DDL,由 owner 执行。

**v2 仓库**:本文涉及的全部代码。

## 8. 范围

**第一批**:
- [frontend-spec.md](frontend-spec.md) 列出的全部功能与交互(从 v1 的代码、文档和测试提炼,
  已剔除被推翻的部分);每个页面至少一条浏览器用例;
- §4 的认证、角色与审计;
- §5 的录入 key、`hft_config` 编辑、agent API;
- §6 的交接。

**第二批**:
- HFT 重启(依赖 quant 侧改用 release 二进制和 `hft-launcher`);
- 审批工单(大额划转等)。

**不做**:知识图谱、Chatbot、多 workspace。

**v1 里不再需要的**:SQLite 备份/恢复工具、PID 锁(改用 PG advisory lock)、导出目录、
quant 投影与拒收规则。

## 9. 迁移

owner 已定:由 agent 经 API 逐条导入,顺便实测 agent 交互。

1. **冻结 WSL**:在线备份打成 tarball,传一份到别处存档。此后 WSL 只读。
   这份 tarball 就是迁移来源和最后一份存档。
2. **导入**:agent 读 tarball 里的 v1 SQLite 和原件,经 v2 API 逐条写入。
   - 按依赖顺序:成员 → 机构与来源映射 → 记录 → 关系与人员变动 → 任务 → 接入请求;
   - 所有 id 由客户端传入,保留 v1 原值;
   - 原件先上传并核对 sha256,再写引用它的记录。
3. **明确不迁移的内容**:
   - 机器采集的 CMC/CoinGecko 排名历史(原始 HTML 与各批观测):v2 重新采集,历史留在 tarball 存档;
   - v1 的编辑历史与审计;
   - 系统时间戳原则上不迁移。例外:迁移期内 admin 令牌可经导入接口写入 `created_at` / `updated_at`,
     保住「按更新时间排序」(2026-09-29,data-model D6);切换后关闭。
   - session;
   - 密码哈希:成员在 v2 重新设密码并绑定 TOTP。
4. **对账**:脚本按表比对 v1 快照与 v2 的行数和关键字段,差异为零才切换。对账结果不以 agent 的自述为准。
5. **交付物**:除数据外,agent 交一份卡点清单(找不到的接口、看不懂的报错、缺的批量能力),
   作为 API 迭代输入。
6. **逐页对照**:阶段一在 Neo 上,用同一份数据把 v2 与 v1 并排逐页核对。规格漏写的差异补进
   frontend-spec.md 再修,不只改代码。
7. **切换**:部署阶段二;v1 仓库设为 archived。

## 10. 已裁决(2026-09-28)

- Neo 上的 agent 可以读 `omniboard` schema。
- 入口只用 TOTP 登录,不限 IP,不加网关。
- 数据迁移由 agent 经 API 逐条导入。
- trader 可以重启 HFT;`hft_config` 可以在界面直接改。
- 重启前「上一轮 De-Risk 已完成」不作硬门槛,只在界面提示。
- 不迁移 CMC/CoinGecko 采集历史。
- `public.resource_access_snapshot` 为空、无写入方,不纳入 v2;quant 侧删除读取代码后由 owner 删表。
  行情凭据(OKX VIP、Databento)仍走 Neo 的 `.env`。

**2026-09-29**
- data-model.md D1–D7 全部按建议执行:schema 归 migrator;`hft_config` 以库为真值、YAML 退役;
  `TradingSystem` 只对可交易账户要求恰好一个;第一批 HFT 页只给固定的「重启后生效」提示;通知走 AWS SES;
  迁移期允许写系统时间戳;只读角色不含身份与会话表。
- 前端功能与交互写成 frontend-spec.md,之后按文档生成代码。
- quant 删除 `TradingSystem` 账户标签(全系统只有 HFT 一个交易系统),D3 作废;HFT 成员只看
  `PortfolioGroup` + 账户可交易。
- 先在 Neo 上跑(只监听本机,SSH 隧道访问),再部署到正式机;应用须能在任何满足前置条件的 arm64 机器上跑。
- 应用不依赖任何云厂商的服务:证据原件改存 PG(§2);通知邮件不用 SES,发送功能暂缓(低优先级 TODO,D5)。

## 11. 翻案条件

- Omniboard 的查询影响交易库:`omniboard` schema 迁到独立的 PG 实例,控制表写入改为经 quant 侧服务。
- 界面操作出现未授权的实盘改动:入口加 IP 限制或零信任网关。
- 出现外部客户或多租户:另立隔离方案。
- 维护者不再是一人:重新评估角色模型与审批流程。
