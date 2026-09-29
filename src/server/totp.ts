import { createHmac, randomBytes } from 'node:crypto';
// RFC 6238:SHA-1、30 秒、6 位;接受前后各一个时间片以容忍手机时钟误差。
const STEP_MS = 30_000;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export const newSecret = () => randomBytes(20);
export const stepAt = (ms: number) => Math.floor(ms / STEP_MS);
export function codeAt(secret: Buffer, step: number, digits = 6): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1]! & 15;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}
/** 返回匹配的时间片;调用方负责拒绝不大于上次已用时间片的结果(防重放)。 */
export function matchStep(secret: Buffer, code: string, nowMs: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = stepAt(nowMs);
  for (const step of [current - 1, current, current + 1])
    if (codeAt(secret, step) === code) return step;
  return null;
}
export function otpauthUri(secret: Buffer, email: string): string {
  const label = encodeURIComponent(`Omniboard:${email}`);
  return `otpauth://totp/${label}?secret=${base32(secret)}&issuer=Omniboard&algorithm=SHA1&digits=6&period=30`;
}
