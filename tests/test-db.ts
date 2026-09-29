import pg from 'pg';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { migrate } from '../src/server/migrate';
import { openPool, type Pool } from '../src/server/db';
// 每个测试文件一个新库(私有测试实例,scripts/test-db.sh)。顺序同生产:quant 形状 → owner 脚本(授权、约束)→ 迁移。
// 应用连接用 omniboard_app 角色,权限测试因此是真实的。
const serverUrl = () =>
  process.env.TEST_PG_URL ||
  execFileSync('scripts/test-db.sh', ['up'], { encoding: 'utf8' }).trim();
function withDatabase(url: string, database: string, user?: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  if (user) parsed.username = user;
  return parsed.toString();
}
export type TestDb = { pool: Pool; adminUrl: string; drop: () => Promise<void> };
export async function createTestDb(): Promise<TestDb> {
  const server = serverUrl();
  const name = `omniboard_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: server });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const adminUrl = withDatabase(server, name);
  // 角色是整个实例共享的;测试文件串行执行(package.json --test-concurrency=1),避免并发改角色。
  const setup = new pg.Client({ connectionString: adminUrl });
  await setup.connect();
  try {
    await setup.query(readFileSync('tests/fixtures/quant-shapes.sql', 'utf8'));
    for (const file of readdirSync('db/owner').sort())
      await setup.query(readFileSync(`db/owner/${file}`, 'utf8'));
  } finally {
    await setup.end();
  }
  await migrate(adminUrl);
  const pool = openPool(withDatabase(server, name, 'omniboard_app'), 4);
  return {
    pool,
    adminUrl,
    drop: async () => {
      await pool.end();
      const c = new pg.Client({ connectionString: server });
      await c.connect();
      await c.query(`DROP DATABASE ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}
