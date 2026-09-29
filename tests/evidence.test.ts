import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { tx } from '../src/server/db';
import { evidencePreview, getEvidence, readOriginal, saveEvidence } from '../src/server/evidence';
import { createTestDb } from './test-db';
// 证据原件存 PG(data-model §1、3.1):内容寻址、与元数据同一事务、库约束兜底。

test('evidence originals are content-addressed, transactional and immutable', async (t) => {
  const db = await createTestDb();
  t.after(db.drop);
  const { pool } = db;
  const info = { source: 'manual', url: '', contentType: 'text/plain' };
  const count = async () =>
    Number((await pool.query('SELECT count(*) AS n FROM omniboard.evidence_originals')).rows[0].n);
  const bytes = Buffer.from('Original reference text.');
  const sha = createHash('sha256').update(bytes).digest('hex');

  // 同内容两条证据共用一份原件。
  const first = await tx(pool, (c) => saveEvidence(c, bytes, info));
  const second = await tx(pool, (c) => saveEvidence(c, bytes, { ...info, url: 'https://x.test' }));
  assert.notEqual(first, second);
  assert.equal(await count(), 1);
  assert.deepEqual(await readOriginal(pool, sha), bytes);
  const preview = await evidencePreview(pool, await getEvidence(pool, second));
  assert.equal(preview.text, 'Original reference text.');

  // 事务回滚时原件与元数据一起消失,不留孤儿原件。
  await assert.rejects(
    tx(pool, async (c) => {
      await saveEvidence(c, Buffer.from('rolled back'), info);
      throw new Error('abort');
    }),
    /abort/,
  );
  assert.equal(await count(), 1);

  // 库约束:内容与 sha256 必须一致;证据必须有原件;应用角色不能改或删原件。
  const code = async (sql: string, values: unknown[] = []) =>
    (await pool.query(sql, values).then(
      () => 'ok',
      (e: { code: string }) => e.code,
    )) as string;
  assert.equal(
    await code('INSERT INTO omniboard.evidence_originals (sha256, bytes) VALUES ($1,$2)', [
      '0'.repeat(64),
      Buffer.from('x'),
    ]),
    '23514',
  );
  assert.equal(
    await code(
      `INSERT INTO omniboard.evidence (id, source, url, sha256, byte_length, content_type, parser_version, filename, visibility)
       VALUES ('orphan','manual','',$1,0,'text/plain','manual-v1','reference.txt','team')`,
      ['1'.repeat(64)],
    ),
    '23503',
  );
  assert.equal(
    await code("UPDATE omniboard.evidence_originals SET bytes = 'x'::bytea WHERE sha256 = $1", [
      sha,
    ]),
    '42501',
  );
  assert.equal(
    await code('DELETE FROM omniboard.evidence_originals WHERE sha256 = $1', [sha]),
    '42501',
  );
  await assert.rejects(readOriginal(pool, '2'.repeat(64)), { statusCode: 404 });
});
