import { buildApp } from '../src/server/app';
import { codeAt, stepAt } from '../src/server/totp';
import type { Sender } from '../src/server/notifications';
import type { Fetcher } from '../src/server/collect';
import { createHash } from 'node:crypto';
import type { Pool } from '../src/server/db';
import { createTestDb } from './test-db';
export const origin = 'http://127.0.0.1:4318';
export const password = 'correct horse battery staple';
export function decodeBase32(s: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
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
}
type Injected = { cookies: { name: string; value: string }[] };
export const cookieOf = (res: Injected) =>
  `omniboard_session=${res.cookies.find((c) => c.name === 'omniboard_session')!.value}`;
export const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;
/** 测试环境:新库 + 可拨动的时钟 + 关闭自动通知的应用。 */
export async function harness(options: { sender?: Sender; sourceFetcher?: Fetcher } = {}) {
  const db = await createTestDb();
  const key = Buffer.alloc(32, 9);
  const clock = { now: Date.parse('2026-09-29T00:00:00Z') };
  const now = () => clock.now;
  const app = await buildApp({
    pool: db.pool,
    totpKey: key,
    origin,
    now,
    serveStatic: false,
    autoNotify: false,
    logger: process.env.TEST_LOG === '1',
    sender: options.sender,
    sourceFetcher: options.sourceFetcher,
  });
  const ctx = { pool: db.pool, totpKey: key, now };
  const tick = () => (clock.now += 30_000);
  const code = (secret: Buffer) => codeAt(secret, stepAt(clock.now));
  const request = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    auth: { cookie?: string; bearer?: string } = {},
    payload?: unknown,
    withOrigin = !auth.bearer,
  ) =>
    app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: payload as object }),
      headers: {
        ...(withOrigin ? { origin } : {}),
        ...(auth.cookie ? { cookie: auth.cookie } : {}),
        ...(auth.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}),
      },
    });
  /** 走完激活:返回会话 Cookie 与 TOTP 密钥。reset 链接不需要密码。 */
  async function activate(token: string, withPassword = true) {
    const setup = await request('POST', `/api/activate/${token}/authenticator`, {}, {});
    const secret = decodeBase32(setup.json().secret);
    const done = await request(
      'POST',
      `/api/activate/${token}/complete`,
      {},
      { ...(withPassword ? { password } : {}), code: code(secret) },
    );
    if (done.statusCode !== 200) throw new Error(`activation failed: ${done.body}`);
    return { cookie: cookieOf(done), secret, recoveryCodes: done.json().recoveryCodes as string[] };
  }
  async function login(email: string, secret: Buffer, pw = password) {
    tick();
    return request('POST', '/api/login', {}, { email, password: pw, code: code(secret) });
  }
  const close = async () => {
    await app.close();
    await db.drop();
  };
  return { db, app, ctx, clock, tick, code, request, activate, login, close };
}
/** 直接插入证据行的测试夹具先放原件(外键),返回它的 sha256。 */
export async function original(pool: Pool, content: string | Buffer = ''): Promise<string> {
  const bytes = Buffer.from(content);
  const sha = createHash('sha256').update(bytes).digest('hex');
  await pool.query(
    `INSERT INTO omniboard.evidence_originals (sha256, bytes) VALUES ($1,$2)
     ON CONFLICT (sha256) DO NOTHING`,
    [sha, bytes],
  );
  return sha;
}
