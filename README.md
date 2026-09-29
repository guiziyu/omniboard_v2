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
