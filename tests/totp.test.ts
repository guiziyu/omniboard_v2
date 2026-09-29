import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32, codeAt, matchStep, stepAt } from '../src/server/totp';
import { open, seal, totpKey } from '../src/server/crypto';
// RFC 6238 附录 B(SHA-1)的 8 位结果取后 6 位。
const secret = Buffer.from('12345678901234567890');
test('TOTP matches RFC 6238 vectors', () => {
  for (const [seconds, code] of [
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ] as const)
    assert.equal(codeAt(secret, stepAt(seconds * 1000)), code, `t=${seconds}`);
  assert.equal(base32(secret), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
});
test('matchStep accepts one step of clock drift and rejects malformed codes', () => {
  const now = 1234567890_000;
  const step = stepAt(now);
  assert.equal(matchStep(secret, codeAt(secret, step - 1), now), step - 1);
  assert.equal(matchStep(secret, codeAt(secret, step + 1), now), step + 1);
  assert.equal(matchStep(secret, codeAt(secret, step - 2), now), null);
  assert.equal(matchStep(secret, '12345', now), null);
  assert.equal(matchStep(secret, 'abcdef', now), null);
});
test('TOTP secrets round-trip through AES-GCM and reject tampering', () => {
  const key = totpKey(Buffer.alloc(32, 7).toString('base64'));
  const sealed = seal(key, secret);
  assert.deepEqual(open(key, sealed), secret);
  sealed[sealed.length - 1]! ^= 1;
  assert.throws(() => open(key, sealed));
  assert.throws(() => totpKey('short'));
});
