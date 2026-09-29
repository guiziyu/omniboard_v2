import pg from 'pg';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Pool } from './db';
// 只前进的 SQL 迁移(data-model §1、§6)。文件名 NNN_<name>.sql,版本号 = NNN。
const pattern = /^(\d{3})_[a-z0-9_]+\.sql$/;
type Migration = { version: number; name: string; sql: string; checksum: string };
export function migrations(dir = resolve('db/migrations')): Migration[] {
  const files = readdirSync(dir)
    .filter((n) => n.endsWith('.sql'))
    .sort();
  return files.map((name, index) => {
    const match = pattern.exec(name);
    if (!match) throw new Error(`Migration file name must be NNN_name.sql: ${name}`);
    const version = Number(match[1]);
    if (version !== index + 1)
      throw new Error(`Migration versions must be contiguous from 001: ${name}`);
    const sql = readFileSync(resolve(dir, name), 'utf8');
    return { version, name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  });
}
export const expectedVersion = (dir?: string) => migrations(dir).at(-1)?.version ?? 0;
export async function schemaVersion(pool: Pool): Promise<number> {
  const result = await pool.query<{ version: number | null }>(
    "SELECT CASE WHEN to_regclass('omniboard.schema_migrations') IS NULL THEN NULL ELSE (SELECT max(version) FROM omniboard.schema_migrations) END AS version",
  );
  return result.rows[0]?.version ?? 0;
}
/** 用 migrator 连接执行。已执行文件的内容变了就拒绝,不做任何改动。 */
export async function migrate(url: string, dir?: string): Promise<string[]> {
  const all = migrations(dir);
  const client = new pg.Client({ connectionString: url, application_name: 'omniboard-migrate' });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('omniboard.migrate'))");
    await client.query('CREATE SCHEMA IF NOT EXISTS omniboard');
    await client.query(
      'CREATE TABLE IF NOT EXISTS omniboard.schema_migrations (version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    // 应用启动与 deploy.sh 自检要读版本号。
    await client.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'omniboard_app') THEN
        GRANT USAGE ON SCHEMA omniboard TO omniboard_app;
        GRANT SELECT ON omniboard.schema_migrations TO omniboard_app;
      END IF; END $$`);
    const done = new Map(
      (
        await client.query<{ version: number; checksum: string }>(
          'SELECT version, checksum FROM omniboard.schema_migrations',
        )
      ).rows.map((r) => [r.version, r.checksum]),
    );
    for (const [version, checksum] of done) {
      const file = all.find((m) => m.version === version);
      if (!file)
        throw new Error(`Database has migration ${version}, which this code does not know.`);
      if (file.checksum !== checksum)
        throw new Error(
          `Migration ${file.name} changed after it was applied. Add a new migration instead.`,
        );
    }
    const applied: string[] = [];
    for (const m of all.filter((m) => !done.has(m.version))) {
      await client.query('BEGIN');
      try {
        await client.query(m.sql);
        await client.query(
          'INSERT INTO omniboard.schema_migrations (version, name, checksum) VALUES ($1,$2,$3)',
          [m.version, m.name, m.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${m.name} failed: ${(error as Error).message}`, {
          cause: error,
        });
      }
      applied.push(m.name);
    }
    return applied;
  } finally {
    await client.end();
  }
}
