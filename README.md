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
- `db/owner/`:涉及 quant 表的角色与授权,由 owner 手工执行,不自动跑。
- 应用用 `QUANT_PG_URL`(`omniboard_app`),启动时结构版本不符就退出。
- 证据原件暂存本地目录 `OMNIBOARD_EVIDENCE_DIR`(默认 `data/`,不进 git);S3 接入后改为私有桶。
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
  Compliance 规则矩阵(2.15、4.5、4.6、5.8)。
- 所有模块标签页都已可用。后续批次要一并接上的 v1 行为:
  - 任务详情里「Open source information」在情报页(§8)移植前打开来源记录本身。
  - 机构选择器的「只查交易所」(2.15)随数据来源页的映射对话框(9.6)一起接上。
- 其他待办:情报收件箱与活动历史(§8)、数据来源页与采集(9.4–9.7)、S3 证据存储、SES 通知、交易账户与 HFT(12.7–12.9)、
  v2 新页面的中文与韩文译文。
