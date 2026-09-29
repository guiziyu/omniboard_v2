// 浏览器用例的服务端:新测试库 + 首个管理员邀请 + 真实时钟的应用(提供 dist 静态页)。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildApp } from '../../src/server/app';
import { bootstrapAdmin } from '../../src/server/auth';
import { createTestDb } from '../test-db';
import { quantFixture } from '../connector-fixture';
import { fakeSmtp } from '../fake-smtp';
import { smtpSender } from '../../src/server/notifications';
export const port = 4319;
const origin = `http://127.0.0.1:${port}`;
const db = await createTestDb();
// quant 侧:一个已声明的 venue 和一条最新的通过结果(Connectors 页与接入请求的叶子展开)。
const quant = await quantFixture(db.adminUrl);
await quant.declare('acme', { observed_at: new Date().toISOString() });
const run = await quant.run(null, 'acme', { suite: 'market-event' });
await quant.result(run, 'market.spot.trade.ws', 'passed', new Date().toISOString());
await quant.close();
const key = Buffer.alloc(32, 5);
const invited = await bootstrapAdmin(
  { pool: db.pool, totpKey: key, now: Date.now },
  { name: 'Browser Owner', email: 'owner@example.test' },
);
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/browser-state.json', JSON.stringify({ inviteToken: invited.token }));
// 排行页用仓库里的样本页,延迟 1 秒返回,页面能看到「采集中」。
const sourceFetcher = async (url: string) => {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const source = url.includes('coingecko') ? 'coingecko_web' : 'cmc_web';
  return { bytes: readFileSync(`tests/fixtures/${source}.html`), contentType: 'text/html' };
};
// 通知邮件发到本地 SMTP 替身,收到的邮件写进 test-results/mail.json,用例从中取审计链接。
const smtp = await fakeSmtp({
  onMail: () => writeFileSync('test-results/mail.json', JSON.stringify(smtp.mails)),
});
const app = await buildApp({
  pool: db.pool,
  totpKey: key,
  origin,
  sourceFetcher,
  sender: smtpSender({
    smtpUrl: smtp.url(),
    from: 'omniboard@example.test',
    to: ['owner@example.test'],
  }),
});
const stop = async () => {
  await app.close();
  await smtp.close();
  await db.drop();
  process.exit(0);
};
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
await app.listen({ host: '127.0.0.1', port });
