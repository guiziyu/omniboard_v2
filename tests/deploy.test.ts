import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { openPool } from '../src/server/db';
import { expectedVersion } from '../src/server/migrate';
import { selfcheck } from '../src/server/selfcheck';
import { createTestDb } from './test-db';
// 部署自检(proposal §3):deploy.sh 用新代码跑 npm run selfcheck,不通过就不切换。

test('deploy script parses and refuses to run without a ref', () => {
  execFileSync('bash', ['-n', 'scripts/deploy.sh']);
  assert.throws(
    () => execFileSync('bash', ['scripts/deploy.sh'], { stdio: 'pipe' }),
    (e: { status: number; stderr: Buffer }) =>
      e.status === 2 && /usage: .*deploy\.sh <ref>/.test(e.stderr.toString()),
  );
});

test('self-check: schema version, application grants, secrets not readable', async (t) => {
  const db = await createTestDb();
  const admin = new pg.Client({ connectionString: db.adminUrl });
  await admin.connect();
  t.after(async () => {
    await admin.end();
    await db.drop();
  });

  assert.deepEqual(await selfcheck(db.pool), {
    schemaVersion: expectedVersion(),
    problems: [],
  });

  // owner 脚本没执行完整、密钥列被误授读权限、schema 比代码新:都要在切换前报出来。
  await admin.query('REVOKE DELETE ON management.hft_group_limit FROM omniboard_app');
  await admin.query('GRANT SELECT (api_secret) ON management.authentication TO omniboard_app');
  await admin.query(
    "INSERT INTO omniboard.schema_migrations (version, name, checksum) VALUES ($1, 'future', 'x')",
    [expectedVersion() + 1],
  );
  assert.deepEqual((await selfcheck(db.pool)).problems, [
    `Schema version ${expectedVersion() + 1} is newer than this code (${expectedVersion()}). Deploy a newer ref.`,
    'The application role must not have SELECT on management.authentication.api_secret.',
    'The application role lacks DELETE on management.hft_group_limit (db/owner/001).',
  ]);
  await admin.query('DELETE FROM omniboard.schema_migrations WHERE version > $1', [
    expectedVersion(),
  ]);
  await admin.query('DELETE FROM omniboard.schema_migrations WHERE version = $1', [
    expectedVersion(),
  ]);
  assert.match(
    (await selfcheck(db.pool)).problems[0]!,
    /needs \d+\. Run npm run migrate from this release first\./,
  );

  // 连不上 PG。
  const unreachable = openPool('postgresql://nobody@127.0.0.1:1/none', 1);
  t.after(() => unreachable.end());
  const down = await selfcheck(unreachable);
  assert.equal(down.schemaVersion, null);
  assert.match(down.problems[0]!, /^PostgreSQL is not reachable: /);
});
