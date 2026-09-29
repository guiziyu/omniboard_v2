import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { mkdtempSync, readdirSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { buildApp } from '../src/server/app';
import { bootstrapAdmin, stepUp } from '../src/server/auth';
import { expectedVersion, migrate, schemaVersion } from '../src/server/migrate';
import { codeAt, stepAt } from '../src/server/totp';
import { createTestDb } from './test-db';
const origin = 'http://127.0.0.1:4318';
const key = Buffer.alloc(32, 9);
const decodeBase32 = (s: string) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0,
    value = 0;
  const out: number[] = [];
  for (const ch of s) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};
const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
  `omniboard_session=${res.cookies.find((c) => c.name === 'omniboard_session')!.value}`;

test('migrations, activation, TOTP login, sessions, lockout, step-up and audit', async (t) => {
  const db = await createTestDb();
  let clock = Date.parse('2026-09-29T00:00:00Z');
  const tick = () => (clock += 30_000);
  const ctx = { pool: db.pool, totpKey: key, now: () => clock };
  const app = await buildApp({
    pool: db.pool,
    totpKey: key,
    origin,
    now: () => clock,
    serveStatic: false,
  });
  t.after(async () => {
    await app.close();
    await db.drop();
  });
  const post = (url: string, payload: unknown, cookie?: string, o: string | null = origin) =>
    app.inject({
      method: 'POST',
      url,
      payload: payload as object,
      headers: { ...(o ? { origin: o } : {}), ...(cookie ? { cookie } : {}) },
    });

  await t.test('schema version matches the migration files and re-running is a no-op', async () => {
    assert.equal(await schemaVersion(db.pool), expectedVersion());
    assert.deepEqual(await migrate(db.adminUrl), []);
    const health = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(health.json().status, 'ok');
  });

  await t.test('an applied migration that changed is refused', async () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'ob-mig-'));
    for (const f of readdirSync('db/migrations'))
      copyFileSync(resolve('db/migrations', f), resolve(dir, f));
    const first = readdirSync(dir).sort()[0]!;
    writeFileSync(resolve(dir, first), readFileSync(resolve(dir, first), 'utf8') + '\n-- edited\n');
    await assert.rejects(migrate(db.adminUrl, dir), /changed after it was applied/);
  });

  let secret = Buffer.alloc(0);
  let adminCookie = '';
  const password = 'correct horse battery staple';
  await t.test('bootstrap admin activates with password and authenticator', async () => {
    const invited = await bootstrapAdmin(ctx, { name: 'Owner', email: 'Owner@Example.test' });
    await assert.rejects(
      bootstrapAdmin(ctx, { name: 'Other', email: 'other@example.test' }),
      /already exists/,
    );
    const info = await app.inject({ method: 'GET', url: `/api/activate/${invited.token}` });
    assert.deepEqual(info.json(), {
      name: 'Owner',
      email: 'owner@example.test',
      purpose: 'activate',
    });
    const setup = await post(`/api/activate/${invited.token}/authenticator`, {});
    secret = decodeBase32(setup.json().secret);
    const wrong = await post(`/api/activate/${invited.token}/complete`, {
      password,
      code: '000000',
    });
    assert.equal(wrong.statusCode, 422);
    const done = await post(`/api/activate/${invited.token}/complete`, {
      password,
      code: codeAt(secret, stepAt(clock)),
    });
    assert.equal(done.statusCode, 200, done.body);
    assert.equal(done.json().recoveryCodes.length, 10);
    assert.equal(done.json().user.role, 'admin');
    adminCookie = cookieOf(done);
    const again = await app.inject({ method: 'GET', url: `/api/activate/${invited.token}` });
    assert.equal(again.statusCode, 410);
  });

  await t.test('login needs password and an unused code; failures are generic', async () => {
    const noCode = await post('/api/login', { email: 'owner@example.test', password });
    assert.equal(noCode.statusCode, 401);
    assert.equal(noCode.json().message, 'Email, password or code is incorrect.');
    // 激活时用过的时间片不能再用来登录。
    const replay = await post('/api/login', {
      email: 'owner@example.test',
      password,
      code: codeAt(secret, stepAt(clock)),
    });
    assert.equal(replay.statusCode, 401);
    tick();
    const ok = await post('/api/login', {
      email: 'OWNER@example.test',
      password,
      code: codeAt(secret, stepAt(clock)),
    });
    assert.equal(ok.statusCode, 200, ok.body);
    // 新登录替换旧会话。
    const old = await app.inject({
      method: 'GET',
      url: '/api/members',
      headers: { cookie: adminCookie },
    });
    assert.equal(old.statusCode, 401);
    adminCookie = cookieOf(ok);
    const members = await app.inject({
      method: 'GET',
      url: '/api/members',
      headers: { cookie: adminCookie },
    });
    assert.equal(members.statusCode, 200);
    const unknown = await post('/api/login', {
      email: 'nobody@example.test',
      password,
      code: '123456',
    });
    assert.equal(unknown.json().message, 'Email, password or code is incorrect.');
  });

  await t.test('writes need an allowed Origin', async () => {
    const res = await post(
      '/api/members',
      { name: 'X', email: 'x@example.test', role: 'reader' },
      adminCookie,
      null,
    );
    assert.equal(res.statusCode, 403);
  });

  let readerCookie = '';
  await t.test('admin invites a reader; the reader cannot write', async () => {
    const invite = await post(
      '/api/members',
      { name: 'Reader', email: 'reader@example.test', role: 'reader' },
      adminCookie,
    );
    assert.equal(invite.statusCode, 200, invite.body);
    const token = new URL(invite.json().inviteLink).searchParams.get('token')!;
    const dup = await post(
      '/api/members',
      { name: 'R2', email: 'READER@example.test', role: 'reader' },
      adminCookie,
    );
    assert.equal(dup.statusCode, 409);
    const setup = await post(`/api/activate/${token}/authenticator`, {});
    const readerSecret = decodeBase32(setup.json().secret);
    const done = await post(`/api/activate/${token}/complete`, {
      password,
      code: codeAt(readerSecret, stepAt(clock)),
    });
    readerCookie = cookieOf(done);
    const write = await post(
      '/api/members',
      { name: 'Y', email: 'y@example.test', role: 'reader' },
      readerCookie,
    );
    assert.equal(write.statusCode, 403);
    assert.equal(write.json().message, 'This role has read-only access.');
    const list = await app.inject({
      method: 'GET',
      url: '/api/members',
      headers: { cookie: readerCookie },
    });
    assert.equal(list.statusCode, 403);
    const logout = await post('/api/logout', {}, readerCookie);
    assert.equal(logout.statusCode, 200);
  });

  await t.test('recovery codes work once', async () => {
    // 用管理员的恢复码:重新激活拿不到,所以直接改库造一个已知恢复码。
    const admin = new pg.Client({ connectionString: db.adminUrl });
    await admin.connect();
    const { sha256, normalizeRecoveryCode } = await import('../src/server/crypto');
    await admin.query(
      "INSERT INTO omniboard.member_recovery_code (member_id, code_hash) SELECT id, $1 FROM omniboard.member WHERE email='owner@example.test'",
      [sha256(normalizeRecoveryCode('AAAA-BBBB-CCCC'))],
    );
    await admin.end();
    const first = await post('/api/login', {
      email: 'owner@example.test',
      password,
      recoveryCode: 'aaaa bbbb cccc',
    });
    assert.equal(first.statusCode, 200, first.body);
    assert.equal(first.json().recoveryCodesLeft, 10);
    const second = await post('/api/login', {
      email: 'owner@example.test',
      password,
      recoveryCode: 'AAAA-BBBB-CCCC',
    });
    assert.equal(second.statusCode, 401);
    tick();
    adminCookie = cookieOf(
      await post('/api/login', {
        email: 'owner@example.test',
        password,
        code: codeAt(secret, stepAt(clock)),
      }),
    );
  });

  await t.test('step-up consumes the code once', async () => {
    const adminId = (
      await db.pool.query("SELECT id FROM omniboard.member WHERE email='owner@example.test'")
    ).rows[0].id;
    tick();
    const code = codeAt(secret, stepAt(clock));
    await stepUp(ctx, adminId, code);
    await assert.rejects(stepUp(ctx, adminId, code), /The code is incorrect/);
  });

  await t.test('five failures lock the account, end its session and are audited', async () => {
    // 成功登录清零失败计数(上一步的 step-up 失败记了一次)。
    tick();
    adminCookie = cookieOf(
      await post('/api/login', {
        email: 'owner@example.test',
        password,
        code: codeAt(secret, stepAt(clock)),
      }),
    );
    for (let i = 0; i < 4; i++)
      assert.equal(
        (
          await post('/api/login', {
            email: 'owner@example.test',
            password: 'wrong password!',
            code: '000000',
          })
        ).statusCode,
        401,
      );
    const fifth = await post('/api/login', {
      email: 'owner@example.test',
      password: 'wrong password!',
      code: '000000',
    });
    assert.equal(fifth.statusCode, 429);
    assert.match(fifth.json().message, /Too many attempts/);
    tick();
    const locked = await post('/api/login', {
      email: 'owner@example.test',
      password,
      code: codeAt(secret, stepAt(clock)),
    });
    assert.equal(locked.statusCode, 429);
    const session = await app.inject({
      method: 'GET',
      url: '/api/members',
      headers: { cookie: adminCookie },
    });
    assert.equal(session.statusCode, 401);
    clock += 15 * 60_000;
    const after = await post('/api/login', {
      email: 'owner@example.test',
      password,
      code: codeAt(secret, stepAt(clock)),
    });
    assert.equal(after.statusCode, 200, after.body);
    const events = await db.pool.query('SELECT action FROM omniboard.audit_event ORDER BY id');
    assert.deepEqual(
      events.rows.map((r) => r.action),
      ['member.invite', 'member.invite', 'login.locked'],
    );
  });

  await t.test('omniboard_app: audit is append-only; key columns are write-only', async () => {
    await assert.rejects(
      db.pool.query("UPDATE omniboard.audit_event SET action='x'"),
      /permission denied|not allowed/,
    );
    await assert.rejects(
      db.pool.query('DELETE FROM omniboard.audit_event'),
      /permission denied|not allowed/,
    );
    await db.pool.query(
      `INSERT INTO management.authentication (auth_id, exchange, account_name, account_tags, ip_whitelist, api_key, api_secret, api_pass)
       VALUES ('Binance_t1','Binance','t1','["Test"]','{}','k','s','')`,
    );
    await assert.rejects(
      db.pool.query('SELECT api_secret FROM management.authentication'),
      /permission denied/,
    );
    await assert.rejects(
      db.pool.query('SELECT * FROM management.authentication'),
      /permission denied/,
    );
    const visible = await db.pool.query(
      'SELECT auth_id, account_tags FROM management.authentication',
    );
    assert.deepEqual(visible.rows, [{ auth_id: 'Binance_t1', account_tags: '["Test"]' }]);
    await db.pool.query(
      "UPDATE management.authentication SET api_secret='s2' WHERE auth_id='Binance_t1'",
    );
    await assert.rejects(
      db.pool.query('DELETE FROM management.authentication'),
      /permission denied/,
    );
    await assert.rejects(
      db.pool.query('UPDATE management.authentication SET verified_auth_tags = NULL'),
      /permission denied/,
    );
    await assert.rejects(db.pool.query('CREATE TABLE omniboard.x (id int)'), /permission denied/);
  });
});
