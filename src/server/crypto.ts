import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
// 密码:scrypt(N=2^15),格式 scrypt$<salt hex>$<hash hex>。
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64, SCRYPT).toString('hex')}`;
}
export function verifyPassword(password: string, stored: string | null): boolean {
  const [kind, salt, hash] = (stored ?? '').split('$');
  // 没有密码的成员也跑一次 scrypt,响应时间不暴露账号状态。
  const actual = scryptSync(password, Buffer.from(salt || '00', 'hex'), 64, SCRYPT);
  const expected = Buffer.from(hash || '', 'hex');
  return (
    kind === 'scrypt' && expected.length === actual.length && timingSafeEqual(actual, expected)
  );
}
export const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
/** 恢复码:12 位小写 base32,显示为 xxxx-xxxx-xxxx;比较时忽略连字符与大小写。 */
export function recoveryCode(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  const raw = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
}
export const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');
// TOTP 密钥用 OMNIBOARD_TOTP_KEY 做 AES-256-GCM 加密:iv(12) | tag(16) | 密文。
export function totpKey(base64: string | undefined): Buffer {
  const key = Buffer.from(base64 ?? '', 'base64');
  if (key.length !== 32) throw new Error('OMNIBOARD_TOTP_KEY must be 32 bytes in base64.');
  return key;
}
export function seal(key: Buffer, plain: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
export function open(key: Buffer, sealed: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]);
}
