import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { bootstrapAdmin } from '../src/server/auth';
import { audit } from '../src/server/audit';
import { cookieOf, harness, password, tokenOf } from './helpers';

test('team members, API tokens, security settings and the audit log', async (t) => {
  const h = await harness();
  t.after(h.close);
  const { request } = h;

  const owner = await h.activate(
    (await bootstrapAdmin(h.ctx, { name: 'Owner', email: 'owner@example.test' })).token,
  );
  const ownerId = (await request('GET', '/api/session', { cookie: owner.cookie })).json().user.id;
  const invite = async (name: string, role: string) => {
    h.tick(); // 列表按创建时间排序,时钟不动时顺序不确定
    const res = await request(
      'POST',
      '/api/members',
      { cookie: owner.cookie },
      { name, email: `${name.toLowerCase()}@example.test`, role },
    );
    assert.equal(res.statusCode, 200, res.body);
    return { id: res.json().id as string, link: res.json().inviteLink as string };
  };
  const ed = await invite('Ed', 'editor');
  const tia = await invite('Tia', 'trader');
  const ivy = await invite('Ivy', 'reader');
  const edSession = await h.activate(tokenOf(ed.link));
  let tiaSession = await h.activate(tokenOf(tia.link));

  await t.test('member list shows status and roles', async () => {
    const list = (await request('GET', '/api/members', { cookie: owner.cookie })).json();
    assert.deepEqual(
      list.map((m: { name: string; role: string; status: string }) => [m.name, m.role, m.status]),
      [
        ['Owner', 'admin', 'active'],
        ['Ed', 'editor', 'active'],
        ['Tia', 'trader', 'active'],
        ['Ivy', 'reader', 'invited'],
      ],
    );
    assert.equal(
      (await request('GET', '/api/members', { cookie: edSession.cookie })).statusCode,
      403,
    );
  });

  await t.test('role changes: not on yourself; at least one active admin remains', async () => {
    const self = await request(
      'PATCH',
      `/api/members/${ownerId}`,
      { cookie: owner.cookie },
      { role: 'editor' },
    );
    assert.equal(self.statusCode, 409);
    const promote = await request(
      'PATCH',
      `/api/members/${ed.id}`,
      { cookie: owner.cookie },
      { role: 'trader' },
    );
    assert.equal(promote.statusCode, 200, promote.body);
    const back = await request(
      'PATCH',
      `/api/members/${ed.id}`,
      { cookie: owner.cookie },
      { role: 'editor' },
    );
    assert.equal(back.statusCode, 200);
    // 唯一的 admin 重置自己的验证器会让 active admin 归零。
    const selfReset = await request(
      'POST',
      `/api/members/${ownerId}/reset-authenticator`,
      { cookie: owner.cookie },
      {},
    );
    assert.equal(selfReset.statusCode, 409);
    assert.equal(selfReset.json().message, 'At least one active administrator is required.');
    const missing = await request(
      'POST',
      '/api/members/nope/disable',
      { cookie: owner.cookie },
      {},
    );
    assert.equal(missing.statusCode, 404);
  });

  let edToken = '';
  await t.test(
    'API tokens: role cap, bearer use, no interactive actions, effective role follows the member',
    async () => {
      const tooHigh = await request(
        'POST',
        '/api/tokens',
        { cookie: edSession.cookie },
        { name: 'agent', role: 'admin' },
      );
      assert.equal(tooHigh.statusCode, 403);
      const trader = await request(
        'POST',
        '/api/tokens',
        { cookie: edSession.cookie },
        { name: 'agent', role: 'trader' },
      );
      assert.equal(trader.statusCode, 422);
      const created = await request(
        'POST',
        '/api/tokens',
        { cookie: edSession.cookie },
        { name: 'agent', role: 'editor', expiresInDays: 7 },
      );
      assert.equal(created.statusCode, 200, created.body);
      edToken = created.json().token;
      assert.match(edToken, /^obt_/);
      const mine = await request('GET', '/api/tokens', { bearer: edToken });
      assert.equal(mine.statusCode, 200);
      assert.deepEqual(
        mine.json().map((x: { name: string; state: string }) => [x.name, x.state]),
        [['agent', 'active']],
      );
      // 令牌的写请求不需要 Origin。
      const pref = await request(
        'PATCH',
        '/api/preferences',
        { bearer: edToken },
        { locale: 'ko' },
      );
      assert.equal(pref.statusCode, 200, pref.body);
      const nested = await request(
        'POST',
        '/api/tokens',
        { bearer: edToken },
        { name: 'x', role: 'reader' },
      );
      assert.equal(nested.json().message, 'This action requires an interactive session.');
      // 成员降为 reader:同一令牌按 reader 生效。
      await request('PATCH', `/api/members/${ed.id}`, { cookie: owner.cookie }, { role: 'reader' });
      const asReader = await request(
        'POST',
        '/api/members',
        { bearer: edToken },
        { name: 'Z', email: 'z@example.test', role: 'reader' },
      );
      assert.equal(asReader.json().message, 'This role has read-only access.');
      await request('PATCH', `/api/members/${ed.id}`, { cookie: owner.cookie }, { role: 'editor' });
      // 过期
      h.clock.now += 8 * 86_400_000;
      assert.equal((await request('GET', '/api/tokens', { bearer: edToken })).statusCode, 401);
      h.clock.now -= 8 * 86_400_000;
      assert.equal(
        (await request('GET', '/api/tokens', { bearer: 'obt_nonsense' })).statusCode,
        401,
      );
    },
  );

  await t.test('an admin token can invite with a client id but not manage members', async () => {
    const created = await request(
      'POST',
      '/api/tokens',
      { cookie: owner.cookie },
      { name: 'migration', role: 'admin' },
    );
    const bearer = created.json().token;
    const invited = await request(
      'POST',
      '/api/members',
      { bearer },
      { id: 'v1-member-7', name: 'Legacy', email: 'legacy@example.test', role: 'editor' },
    );
    assert.equal(invited.statusCode, 200, invited.body);
    assert.equal(invited.json().id, 'v1-member-7');
    const manage = await request('PATCH', `/api/members/${ed.id}`, { bearer }, { role: 'reader' });
    assert.equal(manage.json().message, 'This action requires an interactive session.');
    const row = await h.db.pool.query(
      "SELECT via, agent_token_id IS NOT NULL AS has_token FROM omniboard.audit_event WHERE target_key = 'v1-member-7'",
    );
    assert.deepEqual(row.rows, [{ via: 'agent_token', has_token: true }]);
    const tokenId = created.json().id;
    const revoke = await request('DELETE', `/api/tokens/${tokenId}`, { cookie: owner.cookie });
    assert.equal(revoke.statusCode, 200);
    assert.equal((await request('GET', '/api/members', { bearer })).statusCode, 401);
  });

  await t.test(
    'disable ends the session, revokes tokens and voids invites; enable restores',
    async () => {
      const ivyLink = tokenOf(ivy.link);
      const again = await request(
        'POST',
        '/api/tokens',
        { cookie: edSession.cookie },
        { name: 'agent2', role: 'reader' },
      );
      const bearer = again.json().token;
      assert.equal(
        (await request('POST', `/api/members/${ed.id}/disable`, { cookie: owner.cookie }, {}))
          .statusCode,
        200,
      );
      assert.equal(
        (await request('GET', '/api/tokens', { cookie: edSession.cookie })).statusCode,
        401,
      );
      assert.equal((await request('GET', '/api/tokens', { bearer })).statusCode, 401);
      const edLogin = await h.login('ed@example.test', edSession.secret);
      assert.equal(edLogin.statusCode, 401);
      const tokens = (
        await request('GET', `/api/members/${ed.id}/tokens`, { cookie: owner.cookie })
      ).json();
      assert.ok(tokens.every((x: { state: string }) => x.state === 'revoked'));
      assert.equal(
        (await request('POST', `/api/members/${ivy.id}/disable`, { cookie: owner.cookie }, {}))
          .statusCode,
        200,
      );
      assert.equal((await request('GET', `/api/activate/${ivyLink}`)).statusCode, 410);
      assert.equal(
        (await request('POST', `/api/members/${ed.id}/enable`, { cookie: owner.cookie }, {}))
          .statusCode,
        200,
      );
      assert.equal((await h.login('ed@example.test', edSession.secret)).statusCode, 200);
      // 从未激活的成员恢复后仍是 invited,要重发邀请。
      await request('POST', `/api/members/${ivy.id}/enable`, { cookie: owner.cookie }, {});
      const resent = await request(
        'POST',
        `/api/members/${ivy.id}/resend-invite`,
        { cookie: owner.cookie },
        {},
      );
      assert.equal(resent.statusCode, 200);
      await h.activate(tokenOf(resent.json().inviteLink));
      const notInvited = await request(
        'POST',
        `/api/members/${ivy.id}/resend-invite`,
        { cookie: owner.cookie },
        {},
      );
      assert.equal(notInvited.statusCode, 409);
    },
  );

  await t.test(
    'reset authenticator: old authenticator stops working, password is kept',
    async () => {
      const reset = await request(
        'POST',
        `/api/members/${tia.id}/reset-authenticator`,
        { cookie: owner.cookie },
        {},
      );
      assert.equal(reset.statusCode, 200, reset.body);
      assert.equal(
        (await request('GET', '/api/tokens', { cookie: tiaSession.cookie })).statusCode,
        401,
      );
      const info = await request('GET', `/api/activate/${tokenOf(reset.json().inviteLink)}`);
      assert.equal(info.json().purpose, 'reset');
      assert.equal((await h.login('tia@example.test', tiaSession.secret)).statusCode, 401);
      tiaSession = await h.activate(tokenOf(reset.json().inviteLink), false);
      assert.equal((await h.login('tia@example.test', tiaSession.secret)).statusCode, 200);
    },
  );

  await t.test('sign out everywhere ends the session', async () => {
    const tiaLogin = await h.login('tia@example.test', tiaSession.secret);
    const tiaCookie = cookieOf(tiaLogin);
    assert.equal((await request('GET', '/api/tokens', { cookie: tiaCookie })).statusCode, 200);
    assert.equal(
      (await request('POST', `/api/members/${tia.id}/sign-out`, { cookie: owner.cookie }, {}))
        .statusCode,
      200,
    );
    assert.equal((await request('GET', '/api/tokens', { cookie: tiaCookie })).statusCode, 401);
  });

  await t.test('security: change password, regenerate recovery codes with step-up', async () => {
    const wrong = await request(
      'POST',
      '/api/security/password',
      { cookie: owner.cookie },
      { current: 'nope nope nope', next: 'a brand new password' },
    );
    assert.equal(wrong.statusCode, 403);
    const ok = await request(
      'POST',
      '/api/security/password',
      { cookie: owner.cookie },
      { current: password, next: 'a brand new password' },
    );
    assert.equal(ok.statusCode, 200);
    assert.equal(
      (await request('GET', '/api/security', { cookie: owner.cookie })).json().recoveryCodesLeft,
      10,
    );
    const badCode = await request(
      'POST',
      '/api/security/recovery-codes',
      { cookie: owner.cookie },
      { code: '000000' },
    );
    assert.equal(badCode.statusCode, 403);
    h.tick();
    const regen = await request(
      'POST',
      '/api/security/recovery-codes',
      { cookie: owner.cookie },
      { code: h.code(owner.secret) },
    );
    assert.equal(regen.statusCode, 200, regen.body);
    assert.equal(regen.json().recoveryCodes.length, 10);
    const oldCode = await request(
      'POST',
      '/api/login',
      {},
      {
        email: 'owner@example.test',
        password: 'a brand new password',
        recoveryCode: owner.recoveryCodes[0],
      },
    );
    assert.equal(oldCode.statusCode, 401);
    const newLogin = await h.login('owner@example.test', owner.secret, 'a brand new password');
    assert.equal(newLogin.statusCode, 200, newLogin.body);
    owner.cookie = cookieOf(newLogin);
  });

  await t.test('audit log: filters, owner-notification flag, pagination, admin only', async () => {
    const members = (
      await request('GET', '/api/audit?category=members', { cookie: owner.cookie })
    ).json();
    assert.ok(members.length > 0);
    assert.ok(
      members.every(
        (e: { action: string }) =>
          e.action.startsWith('member.') || e.action.startsWith('session.'),
      ),
    );
    const ids = members.map((e: { id: string }) => Number(e.id));
    assert.deepEqual(
      ids,
      [...ids].sort((a, b) => b - a),
    );
    // editor↔trader 标记需通知 owner;editor↔reader 不标记(发邮件是 TODO,12.11)。
    const roleEvents = await h.db.pool.query<{ before: string; after: string; notify: boolean }>(
      `SELECT before->>'role' AS before, after->>'role' AS after, notify_required AS notify
         FROM omniboard.audit_event WHERE action = 'member.role' ORDER BY id`,
    );
    assert.deepEqual(
      roleEvents.rows.map((e) => [e.before, e.after, e.notify]),
      [
        ['editor', 'trader', true],
        ['trader', 'editor', true],
        ['editor', 'reader', false],
        ['reader', 'editor', false],
      ],
    );

    const byTarget = (
      await request('GET', `/api/audit?target=${tia.id}`, { cookie: owner.cookie })
    ).json();
    assert.ok(
      byTarget.length > 0 && byTarget.every((e: { targetKey: string }) => e.targetKey === tia.id),
    );
    const byActor = (
      await request('GET', `/api/audit?actor=${ed.id}&category=tokens`, { cookie: owner.cookie })
    ).json();
    assert.deepEqual(
      byActor.map((e: { action: string }) => e.action),
      ['agent_token.create', 'agent_token.create'],
    );
    const page = (
      await request('GET', `/api/audit?before=${ids[1]}`, { cookie: owner.cookie })
    ).json();
    assert.ok(page.every((e: { id: string }) => Number(e.id) < ids[1]));
    const future = (
      await request('GET', '/api/audit?from=2030-01-01', { cookie: owner.cookie })
    ).json();
    assert.deepEqual(future, []);
    assert.equal(
      (await request('GET', '/api/audit?category=bogus', { cookie: owner.cookie })).statusCode,
      422,
    );
    const login = await h.login('ed@example.test', edSession.secret);
    const edCookie = cookieOf(login);
    assert.equal((await request('GET', '/api/audit', { cookie: edCookie })).statusCode, 403);
  });

  await t.test('secret fields never reach the audit table', async () => {
    const client = new pg.Client({ connectionString: h.db.adminUrl });
    await client.connect();
    try {
      const eventId = await audit(client as unknown as pg.PoolClient, {
        actor: { id: ownerId, via: 'session' },
        action: 'auth.rotate_key',
        targetTable: 'management.authentication',
        targetKey: 'Binance_x',
        before: { api_key: 'AKIA-old', nested: { apiSecret: 's' } },
        after: { api_key: 'AKIA-new', api_pass: 'p', fingerprint: 'abc' },
        stepUp: true,
      });
      const row = (
        await client.query('SELECT before, after FROM omniboard.audit_event WHERE id = $1', [
          eventId,
        ])
      ).rows[0];
      assert.deepEqual(row.before, { api_key: 'changed', nested: { apiSecret: 'changed' } });
      assert.deepEqual(row.after, { api_key: 'changed', api_pass: 'changed', fingerprint: 'abc' });
    } finally {
      await client.end();
    }
  });
});
