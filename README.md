# Omniboard v2

需求:[docs/proposal.md](docs/proposal.md)、[docs/frontend-spec.md](docs/frontend-spec.md)、
[docs/data-model.md](docs/data-model.md)。规格与代码不一致时先改文档。

## 开发(Neo)

- Node 24:Neo 系统自带的是 18,用户目录里另装了 24,使用前 `export PATH=$HOME/.local/opt/node24/bin:$PATH`。
- 测试库:`scripts/test-db.sh up` 在 `.pgdata/` 起一个私有 PG 16 实例(只开 unix socket,不需要 sudo),
  `npm test` 会自动启动它;每个测试文件建一个新库,结束时删除。不连生产库。
- `npm run verify`:格式、测试、类型检查、构建。提交前跑。
- `npm run test:browser`:Playwright 浏览器用例(`nice -n 19`,不和 HFT 抢 CPU)。Neo 缺 Chromium 的几个系统库,
  已用 `apt-get download` 解包到 `~/.local/opt/pw-libs`(不需要 sudo),配置里自动加进 `LD_LIBRARY_PATH`。
  推送前跑 `npm run verify:push`。
- 测试被强杀留下的库:`scripts/test-db.sh clean`。

## 数据库

- `npm run migrate`:用 `QUANT_PG_MIGRATOR_URL` 执行 `db/migrations/`(schema `omniboard` 归 migrator,D1)。
- `db/owner/`:涉及 quant 表的角色与授权,由 owner 按编号手工执行,不自动跑。测试库按编号全部执行。
  交易账户(`management.authentication`)只通过 v2 维护,规则在 v2 里检查,库上不加约束(proposal §4)。
- 应用用 `QUANT_PG_URL`(`omniboard_app`),启动时结构版本不符就退出。
- 证据原件存在 `omniboard.evidence_originals`(按 sha256 寻址),与元数据在同一事务里写入;应用只能读和新增。
- 迁移期结束:`npm run cli -- close-import`,此后导入接口不再接受系统时间戳(data-model D6)。

## 首个管理员

```bash
npm run cli -- bootstrap-admin --name <name> --email <email>
```

输出一次性激活链接(72 小时)。阶段一经 SSH 隧道访问:`ssh -L 4318:127.0.0.1:4318 Neo-Apnt1a`。

## 移植进度

按 data-model 的章节从 v1 移植,每块带上对应的 v1 测试和浏览器用例。

- 已完成:认证与成员、API 令牌、审计(frontend-spec 12.5、12.6、12.10);机构目录与排名(3);机构详情页框架、
  Overview、通用记录列表与编辑器、版本历史、证据抽屉(4.1–4.4、4.7、4.9–4.11、5.1、5.2、5.4–5.7、5.10);
  数据浏览器与团队观测(9.1–9.3);组织架构图与汇报关系调整、人员变动(6.1–6.8);讨论与联系人对话记录(5.9);关系与证据页、图谱、结论与采纳、跨机构身份(7.1–7.14),
  记录详情的关联对象链接与联系人合并卡片(5.2 第 9 项、5.3);工作台、任务详情、标准接入计划、任务计划、
  依赖图与各处的「Create follow-up task」(10.1–10.7,7.9 的相关工作);Onboarding 标签页、接入请求与 Connector
  看板、Overview 的我方工作摘要(4.8、10.8–10.10、11);路线图(10.11、10.12);
  人才目录、人员详情、个人履历导入与由履历生成的人员变动、疑似重复档案、岗位目标与激励(6.9–6.16),
  图谱人员名称到人才库的链接与返回时的状态恢复(7.7、7.8);机构选择器、机构对比与字段对比矩阵、
  Compliance 规则矩阵(2.15、4.5、4.6、5.8);情报收件箱、情报详情、关注机构与活动历史(8.1–8.4),
  任务详情的「Open source information」改为打开情报详情;数据来源页、CMC / CoinGecko 排行页采集、每日采集、
  来源身份映射与机构选择器的「只查交易所」(9.4–9.7、2.15);证据原件存 PG(data-model §1);交易账户、
  key 录入 / 轮换 / 停用与 Onboarding 记录联动(12.7);HFT 配置(12.8);v2 新页面与外壳的中文、韩文译文(2.10)。
- 所有模块标签页都已可用。
- 数据来源:
  - 导入顺序:机构 → 别名 → `POST /api/import/source-links`(保留 v1 的来源档案与人工映射),然后才做第一次采集;
    先采集会为同一个 slug 建出新机构,之后导入同一档案返回 409。
  - v1 的 `npm run collect` 由 admin 令牌调用 `POST /api/sources/collect` 代替(返回 202,后台运行);
    每日采集在页面上打开,服务每分钟检查一次。
  - v1 的 `consolidate-exchanges` 是一次性合并脚本,合并结果随机构别名导入,不移植;`quant_pg` 来源按
    frontend-spec「已排除」不移植。
- `capital_scenarios`(data-model §3.3)在 v1 只有接口、没有页面,前端规格也没有对应界面,暂不移植;活动历史里
  v1 导入的 scenario 事件照常跳到 Capital Optimization 标签页。
- 其他待办:HFT 重启(12.9,依赖 quant 的 `hft-launcher`)。
- 界面语言:`tests/localization.test.ts` 检查模板里没有未经 `tr()` 的英文、`tr('…')` 都有译文、v2 新接口的错误信息
  有译文。从 v1 移植来的接口,错误信息与 v1 一样只有英文。
- TODO(低优先级):影响实盘的操作当场重输验证码(frontend-spec 12.4、proposal §4)。目前只要求 trader 的登录会话;
  登录仍强制 TOTP,重新生成恢复码仍要输验证码。
- TODO(低优先级):通知邮件(frontend-spec 12.11、data-model D5)。发送通道未定,已写好的 outbox 先移除;
  需要通知的审计事件仍标记 `notify_required`。
