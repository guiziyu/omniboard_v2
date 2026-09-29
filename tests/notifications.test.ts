import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapAdmin } from '../src/server/auth';
import { notifyConfig } from '../src/server/config';
import { deliverPending, smtpSender, type NotifyConfig } from '../src/server/notifications';
import { fakeSmtp } from './fake-smtp';
import { harness, origin } from './helpers';
// 通知邮件(frontend-spec 12.11、D5):标准 SMTP,不绑定邮件服务商。

test('notification settings: unset means not configured, half-set is an error', () => {
  assert.equal(notifyConfig({}), undefined);
  assert.equal(notifyConfig({ OMNIBOARD_NOTIFY_TO: ' , ' }), undefined);
  assert.deepEqual(
    notifyConfig({
      OMNIBOARD_NOTIFY_TO: 'owner@example.test, ops@example.test',
      OMNIBOARD_NOTIFY_FROM: 'Omniboard <omniboard@example.test>',
      OMNIBOARD_SMTP_URL: 'smtps://user:pass@smtp.example.test',
    }),
    {
      to: ['owner@example.test', 'ops@example.test'],
      from: 'Omniboard <omniboard@example.test>',
      smtpUrl: 'smtps://user:pass@smtp.example.test',
    },
  );
  assert.throws(
    () => notifyConfig({ OMNIBOARD_NOTIFY_TO: 'owner@example.test' }),
    /OMNIBOARD_SMTP_URL and OMNIBOARD_NOTIFY_FROM are required/,
  );
  const base = { OMNIBOARD_NOTIFY_FROM: 'omniboard@example.test' };
  assert.throws(
    () =>
      notifyConfig({
        ...base,
        OMNIBOARD_NOTIFY_TO: 'owner@example.test',
        OMNIBOARD_SMTP_URL: 'https://api.example.test',
      }),
    /must start with smtp:\/\/ or smtps:\/\//,
  );
  assert.throws(
    () =>
      notifyConfig({
        ...base,
        OMNIBOARD_NOTIFY_TO: 'owner@example.test, owner',
        OMNIBOARD_SMTP_URL: 'smtp://127.0.0.1',
      }),
    /invalid address: owner$/,
  );
});

test('outbox delivers over SMTP; rejections and timeouts are recorded as failed', async (t) => {
  const smtp = await fakeSmtp();
  const config: NotifyConfig = {
    smtpUrl: smtp.url(),
    from: 'Omniboard <omniboard@example.test>',
    to: ['owner@example.test', 'ops@example.test'],
  };
  const h = await harness();
  t.after(async () => {
    await h.close();
    await smtp.close();
  });
  const owner = await h.activate(
    (await bootstrapAdmin(h.ctx, { name: 'Owner', email: 'owner@example.test' })).token,
  );
  const invite = await h.request(
    'POST',
    '/api/members',
    { cookie: owner.cookie },
    { name: 'Ed', email: 'ed@example.test', role: 'editor' },
  );
  const ed = invite.json().id as string;
  const promote = (role: string) =>
    h.request('PATCH', `/api/members/${ed}`, { cookie: owner.cookie }, { role });
  const notifications = async () =>
    (await h.request('GET', `/api/audit?target=${ed}`, { cookie: owner.cookie }))
      .json()
      .filter((e: { action: string }) => e.action === 'member.role')
      .map((e: { notification: string }) => e.notification);

  assert.equal((await promote('trader')).statusCode, 200);
  assert.equal(await deliverPending(h.db.pool, smtpSender(config), origin), 1);
  assert.deepEqual(await notifications(), ['sent']);
  const [mail] = smtp.mails;
  assert.equal(mail!.auth, 'mailer:s3cret');
  assert.equal(mail!.from, 'omniboard@example.test');
  assert.deepEqual(mail!.to, ['owner@example.test', 'ops@example.test']);
  assert.equal(mail!.subject, `[Omniboard] member.role · ${ed}`);
  const lines = mail!.text.split('\n');
  assert.ok(lines.includes('Actor: Owner'), mail!.text);
  assert.ok(lines.includes('Before: {"role":"editor"}'), mail!.text);
  assert.ok(lines.includes('After: {"role":"trader"}'), mail!.text);
  assert.match(
    lines.at(-1)!,
    /^Audit log: http:\/\/127\.0\.0\.1:4318\/w\/internal\/audit\?event=\d+$/,
  );

  // 收件人被拒:记为 failed,附服务器的回复;不重试。
  smtp.state.rejectRecipients = true;
  await promote('editor');
  await deliverPending(h.db.pool, smtpSender(config), origin);
  assert.deepEqual(await notifications(), ['failed', 'sent']);
  const error = await h.db.pool.query<{ error: string }>(
    "SELECT after->>'error' AS error FROM omniboard.audit_event WHERE action = 'notify_result' ORDER BY id DESC LIMIT 1",
  );
  assert.match(error.rows[0]!.error, /550 5\.1\.1 Mailbox unavailable/);
  assert.equal(await deliverPending(h.db.pool, smtpSender(config), origin), 0);
  smtp.state.rejectRecipients = false;

  // 默认要求 TLS:服务器不支持 STARTTLS 时不以明文发送账号。
  await promote('trader');
  await deliverPending(h.db.pool, smtpSender({ ...config, smtpUrl: smtp.url('') }), origin);
  assert.deepEqual(await notifications(), ['failed', 'failed', 'sent']);
  assert.equal(smtp.mails.length, 1);

  // 服务器不应答:按问候超时失败,不会一直占着投递事务。
  smtp.state.silent = true;
  await promote('editor');
  const started = Date.now();
  await deliverPending(h.db.pool, smtpSender(config), origin);
  assert.ok(Date.now() - started < 8_000);
  assert.deepEqual(await notifications(), ['failed', 'failed', 'failed', 'sent']);
  assert.equal(smtp.mails.length, 1);
});
