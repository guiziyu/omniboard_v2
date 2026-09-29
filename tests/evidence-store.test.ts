import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkStore, directoryStore, evidencePreview, getEvidence } from '../src/server/evidence';
import { s3Store } from '../src/server/evidence-store';
import { startCollection } from '../src/server/collect';
import { createTestDb } from './test-db';
// S3 证据桶(data-model §1)。用一个本地的 S3 替身跑真实的 SDK 请求:路径式寻址、校验和头、条件写入与错误体。

type Stored = { body: Buffer; contentType: string };
async function fakeS3(bucket: string) {
  const objects = new Map<string, Stored>();
  const requests: { method: string; key: string; status: number }[] = [];
  let conflicts = 0;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks);
    const path = new URL(req.url!, 'http://s3.test').pathname;
    const key = decodeURIComponent(path.slice(`/${bucket}/`.length));
    const reply = (status: number, code?: string) => {
      requests.push({ method: req.method!, key, status });
      if (!code) return res.writeHead(status).end();
      res.writeHead(status, { 'content-type': 'application/xml' });
      res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`);
    };
    if (!path.startsWith(`/${bucket}/`)) return reply(404, 'NoSuchBucket');
    if (req.method === 'PUT') {
      if (conflicts > 0) {
        conflicts--;
        return reply(409, 'ConditionalRequestConflict');
      }
      if (req.headers['if-none-match'] === '*' && objects.has(key))
        return reply(412, 'PreconditionFailed');
      const digest = createHash('sha256').update(body).digest('base64');
      if (req.headers['x-amz-checksum-sha256'] !== digest) return reply(400, 'BadDigest');
      objects.set(key, { body, contentType: String(req.headers['content-type']) });
      return reply(200);
    }
    if (req.method === 'GET') {
      const object = objects.get(key);
      if (!object) return reply(404, 'NoSuchKey');
      requests.push({ method: 'GET', key, status: 200 });
      res.writeHead(200, {
        'content-type': object.contentType,
        'content-length': object.body.length,
      });
      return res.end(object.body);
    }
    return reply(405, 'MethodNotAllowed');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const store = s3Store(bucket, {
    region: 'us-east-1',
    endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    maxAttempts: 1,
  });
  return {
    store,
    objects,
    requests,
    conflictNext: (n: number) => (conflicts = n),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('S3 store: content-addressed, written once, checksummed and verified on read', async (t) => {
  const s3 = await fakeS3('evidence-bucket');
  t.after(s3.close);
  const bytes = Buffer.from('<html>original</html>');
  const key = `evidence/${sha(bytes)}`;
  await s3.store.put(sha(bytes), bytes, 'text/html');
  assert.deepEqual(s3.objects.get(key), { body: bytes, contentType: 'text/html' });
  assert.deepEqual(await s3.store.get(sha(bytes)), bytes);

  // 同内容再写:条件写入返回 412,视为已存,不产生新版本。
  await s3.store.put(sha(bytes), bytes, 'text/html');
  assert.deepEqual(
    s3.requests.filter((r) => r.method === 'PUT').map((r) => r.status),
    [200, 412],
  );
  // 同一键上并发的条件写入(409)会重试。
  const other = Buffer.from('other');
  s3.conflictNext(1);
  await s3.store.put(sha(other), other, 'text/plain');
  assert.deepEqual(s3.objects.get(`evidence/${sha(other)}`)?.body, other);

  // 声明的 sha256 与内容不符:S3 按校验和拒收。
  await assert.rejects(
    s3.store.put(sha(Buffer.from('declared')), bytes, 'text/plain'),
    /BadDigest/,
  );
  assert.equal(s3.objects.size, 2);

  await assert.rejects(s3.store.get('0'.repeat(64)), {
    statusCode: 404,
    message: 'The original file is missing from storage.',
  });
  s3.objects.set(key, { body: Buffer.from('tampered'), contentType: 'text/html' });
  await assert.rejects(s3.store.get(sha(bytes)), /failed its integrity check/);

  // selfcheck 的探测:写入并读回。
  await checkStore(s3.store);
  assert.equal(s3.objects.size, 3);
});

test('a collection stores its original page in S3 and the reference reads it back', async (t) => {
  const s3 = await fakeS3('evidence-bucket');
  const db = await createTestDb();
  t.after(async () => {
    await s3.close();
    await db.drop();
  });
  const html = readFileSync('tests/fixtures/cmc_web.html');
  const { runId, done } = await startCollection(db.pool, s3.store, 'cmc_web', {
    fetcher: async () => ({ bytes: html, contentType: 'text/html; charset=utf-8' }),
  });
  await done;
  const run = await db.pool.query(
    'SELECT status, evidence_id FROM omniboard.collection_runs WHERE id = $1',
    [runId],
  );
  assert.equal(run.rows[0].status, 'success');
  const evidence = await getEvidence(db.pool, run.rows[0].evidence_id);
  const stored = await db.pool.query('SELECT s3_key FROM omniboard.evidence WHERE id = $1', [
    evidence.id,
  ]);
  assert.equal(stored.rows[0].s3_key, `evidence/${sha(html)}`);
  assert.deepEqual(s3.objects.get(stored.rows[0].s3_key)?.body, html);
  const preview = await evidencePreview(s3.store, evidence);
  assert.equal(preview.text, html.toString('utf8').slice(0, preview.text!.length));
});

test('the local directory store passes the same self-check', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'omniboard-evidence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  await checkStore(directoryStore(dir));
});
