// 浏览器用例的服务端:新测试库 + 首个管理员邀请 + 真实时钟的应用(提供 dist 静态页)。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/server/app';
import { bootstrapAdmin } from '../../src/server/auth';
import { directoryStore } from '../../src/server/evidence';
import { createTestDb } from '../test-db';
export const port = 4319;
const origin = `http://127.0.0.1:${port}`;
const db = await createTestDb();
const key = Buffer.alloc(32, 5);
const invited = await bootstrapAdmin(
  { pool: db.pool, totpKey: key, now: Date.now },
  { name: 'Browser Owner', email: 'owner@example.test' },
);
mkdirSync('test-results', { recursive: true });
writeFileSync('test-results/browser-state.json', JSON.stringify({ inviteToken: invited.token }));
const evidenceDir = mkdtempSync(join(tmpdir(), 'omniboard-evidence-'));
const app = await buildApp({
  pool: db.pool,
  totpKey: key,
  origin,
  evidence: directoryStore(evidenceDir),
});
const stop = async () => {
  await app.close();
  await db.drop();
  rmSync(evidenceDir, { recursive: true, force: true });
  process.exit(0);
};
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
await app.listen({ host: '127.0.0.1', port });
