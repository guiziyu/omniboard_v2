import type { Client, Pool } from './db';
import { id } from './db';
import { problem, type Role } from './auth';
import { sha256 } from './crypto';
// 证据(data-model §3.1,frontend-spec 5.10):原件按 sha256 内容寻址存在 evidence_originals,
// 同一原件可被多条证据引用。
export type Visibility = 'team' | 'admin';
export type EvidenceInfo = {
  source: string;
  url: string;
  contentType: string;
  filename?: string;
  parserVersion?: string;
  visibility?: Visibility;
};
export type Evidence = {
  id: string;
  source: string;
  url: string;
  capturedAt: Date;
  sha256: string;
  byteLength: number;
  contentType: string;
  parserVersion: string;
  filename: string;
  visibility: Visibility;
};
/** 保存一条证据:原件(同内容复用)与元数据在调用方的同一事务里写入,一起提交或一起回滚。 */
export async function saveEvidence(
  client: Client,
  bytes: Buffer,
  info: EvidenceInfo,
  options: { id?: string; capturedAt?: Date; sha256?: string } = {},
): Promise<string> {
  const sha = sha256(bytes);
  if (options.sha256 && options.sha256 !== sha)
    problem(422, 'The uploaded content does not match the declared SHA-256.');
  await client.query(
    `INSERT INTO omniboard.evidence_originals (sha256, bytes) VALUES ($1,$2)
     ON CONFLICT (sha256) DO NOTHING`,
    [sha, bytes],
  );
  const evidenceId = options.id ?? id();
  const inserted = await client.query(
    `INSERT INTO omniboard.evidence
       (id, source, url, captured_at, sha256, byte_length, content_type, parser_version, filename, visibility)
     VALUES ($1,$2,$3,COALESCE($4, now()),$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
    [
      evidenceId,
      info.source,
      info.url,
      options.capturedAt ?? null,
      sha,
      bytes.length,
      info.contentType,
      info.parserVersion ?? 'manual-v1',
      info.filename ?? 'reference.txt',
      info.visibility ?? 'team',
    ],
  );
  if (!inserted.rowCount) {
    // 导入重放:同 id 同内容视为已导入,内容不同则拒绝。
    const existing = await client.query<{ sha256: string }>(
      'SELECT sha256 FROM omniboard.evidence WHERE id = $1',
      [evidenceId],
    );
    if (existing.rows[0]?.sha256 !== sha)
      problem(409, 'Evidence with this id already exists with different content.');
  }
  return evidenceId;
}
export async function getEvidence(pool: Pool | Client, evidenceId: string): Promise<Evidence> {
  const result = await pool.query<Evidence>(
    `SELECT id, source, url, captured_at AS "capturedAt", sha256, byte_length::int AS "byteLength",
            content_type AS "contentType", parser_version AS "parserVersion", filename, visibility
       FROM omniboard.evidence WHERE id = $1`,
    [evidenceId],
  );
  const evidence = result.rows[0];
  if (!evidence) problem(404, 'Reference not found.');
  return evidence;
}
/** admin 证据对非 admin 返回 403(frontend-spec 2.2)。 */
export function assertCanRead(evidence: Evidence, role: Role): void {
  if (evidence.visibility === 'admin' && role !== 'admin')
    problem(403, 'Administrator access is required.');
}
export const PREVIEW_LIMIT = 500_000;
/** 原件内容。外键保证每条证据都有原件,约束保证内容与 sha256 一致。 */
export async function readOriginal(db: Pool | Client, sha: string): Promise<Buffer> {
  const result = await db.query<{ bytes: Buffer }>(
    'SELECT bytes FROM omniboard.evidence_originals WHERE sha256 = $1',
    [sha],
  );
  if (!result.rows[0]) problem(404, 'Reference not found.');
  return result.rows[0].bytes;
}
export async function evidencePreview(db: Pool | Client, evidence: Evidence) {
  const bytes = await readOriginal(db, evidence.sha256);
  return {
    evidence,
    text: evidence.contentType.startsWith('text/')
      ? bytes.toString('utf8').slice(0, PREVIEW_LIMIT)
      : null,
    truncated: bytes.length > PREVIEW_LIMIT,
  };
}
