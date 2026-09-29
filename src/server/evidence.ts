import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Client, Pool } from './db';
import { id } from './db';
import { problem, type Role } from './auth';
import { randomToken, sha256 } from './crypto';
// 证据(data-model §3.1,frontend-spec 5.10):原件按 sha256 内容寻址,库里只存元数据。
/** 原件存储。生产用 S3 私有桶,键 evidence/<sha256>;开发与测试用本地目录。 */
export interface EvidenceStore {
  put(sha: string, bytes: Buffer, contentType: string): Promise<void>;
  get(sha: string): Promise<Buffer>;
}
export function directoryStore(dir: string): EvidenceStore {
  const path = (sha: string) => resolve(dir, 'evidence', sha);
  return {
    async put(sha, bytes) {
      await mkdir(resolve(dir, 'evidence'), { recursive: true, mode: 0o700 });
      // 先写临时文件再改名:并发写同一原件时不会读到半个文件。
      const temp = `${path(sha)}.${randomToken().slice(0, 12)}.tmp`;
      await writeFile(temp, bytes, { mode: 0o600 });
      await rename(temp, path(sha));
    },
    async get(sha) {
      const bytes = await readFile(path(sha)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') problem(404, 'The original file is missing from storage.');
        throw error;
      });
      if (sha256(bytes) !== sha) throw new Error(`Evidence ${sha} failed its integrity check.`);
      return bytes;
    },
  };
}
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
/**
 * 保存一条证据:先写原件(幂等),再在调用方事务里写元数据。
 * 事务回滚时原件留在存储里,没有元数据引用它;同内容再次保存会复用。
 */
export async function saveEvidence(
  client: Client,
  store: EvidenceStore,
  bytes: Buffer,
  info: EvidenceInfo,
  options: { id?: string; capturedAt?: Date; sha256?: string } = {},
): Promise<string> {
  const sha = sha256(bytes);
  if (options.sha256 && options.sha256 !== sha)
    problem(422, 'The uploaded content does not match the declared SHA-256.');
  await store.put(sha, bytes, info.contentType);
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
export async function evidencePreview(store: EvidenceStore, evidence: Evidence) {
  const bytes = await store.get(evidence.sha256);
  return {
    evidence,
    text: evidence.contentType.startsWith('text/')
      ? bytes.toString('utf8').slice(0, PREVIEW_LIMIT)
      : null,
    truncated: bytes.length > PREVIEW_LIMIT,
  };
}
