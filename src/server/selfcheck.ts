import type { Pool } from './db';
import { expectedVersion, schemaVersion } from './migrate';
// 部署自检(proposal §3):deploy.sh 切换前用新版本的代码跑一遍,任何一项不通就不切换。
// 查 PG 连通、schema 版本,以及 owner 脚本(db/owner/001_roles.sql)授给应用角色的权限是否到位——
// 缺权限的页面会在运行时才报错,密钥列可读则违反 proposal §4。

type Privilege = { object: string; column?: string; privilege: string; expected: boolean };
const authentication = 'management.authentication';
const privileges: Privilege[] = [
  ...['auth_id', 'exchange', 'account_name', 'account_tags', 'ip_whitelist', 'owner'].map(
    (column) => ({ object: authentication, column, privilege: 'SELECT', expected: true }),
  ),
  ...['account_tags', 'ip_whitelist', 'owner', 'api_key', 'api_secret', 'api_pass'].map(
    (column) => ({ object: authentication, column, privilege: 'UPDATE', expected: true }),
  ),
  { object: authentication, column: 'api_key', privilege: 'INSERT', expected: true },
  // 密钥只写不读:v2 被攻破也读不出已有 key。
  ...['api_key', 'api_secret', 'api_pass'].map((column) => ({
    object: authentication,
    column,
    privilege: 'SELECT',
    expected: false,
  })),
  ...['SELECT', 'INSERT', 'UPDATE'].map((privilege) => ({
    object: 'management.hft_config',
    privilege,
    expected: true,
  })),
  ...['SELECT', 'INSERT', 'UPDATE', 'DELETE'].map((privilege) => ({
    object: 'management.hft_group_limit',
    privilege,
    expected: true,
  })),
  ...['v_connector_declared_latest', 'v_live_test_leaf_latest', 'v_live_test_run_by_request'].map(
    (view) => ({ object: `verification.${view}`, privilege: 'SELECT', expected: true }),
  ),
];

export type SelfcheckResult = { schemaVersion: number | null; problems: string[] };
export async function selfcheck(pool: Pool): Promise<SelfcheckResult> {
  let version: number;
  try {
    version = await schemaVersion(pool);
  } catch (error) {
    return {
      schemaVersion: null,
      problems: [`PostgreSQL is not reachable: ${(error as Error).message}`],
    };
  }
  const problems: string[] = [];
  const expected = expectedVersion();
  if (version < expected)
    problems.push(
      `Schema version ${version}, this code needs ${expected}. Run npm run migrate from this release first.`,
    );
  if (version > expected)
    problems.push(
      `Schema version ${version} is newer than this code (${expected}). Deploy a newer ref.`,
    );
  // 应用角色没有 DDL(data-model §1、D1)。
  const ddl = await pool.query<{ ok: boolean }>(
    "SELECT has_schema_privilege('omniboard', 'CREATE') AS ok",
  );
  if (ddl.rows[0]?.ok)
    problems.push('The application role can create objects in schema omniboard.');
  for (const p of privileges) {
    // 没有 schema USAGE 时 to_regclass 直接报权限错误,同样算作看不到。
    const exists = await pool
      .query<{ oid: string | null }>('SELECT to_regclass($1) AS oid', [p.object])
      .catch(() => ({ rows: [{ oid: null }] }));
    if (!exists.rows[0]?.oid) {
      if (p.expected) problems.push(`${p.object} does not exist or is not visible.`);
      continue;
    }
    const granted = (
      await pool.query<{ ok: boolean }>(
        p.column
          ? 'SELECT has_column_privilege($1, $2, $3) AS ok'
          : 'SELECT has_table_privilege($1, $2) AS ok',
        p.column ? [p.object, p.column, p.privilege] : [p.object, p.privilege],
      )
    ).rows[0]!.ok;
    const target = p.column ? `${p.object}.${p.column}` : p.object;
    if (granted && !p.expected)
      problems.push(`The application role must not have ${p.privilege} on ${target}.`);
    if (!granted && p.expected)
      problems.push(`The application role lacks ${p.privilege} on ${target} (db/owner/001).`);
  }
  return { schemaVersion: version, problems: [...new Set(problems)] };
}
