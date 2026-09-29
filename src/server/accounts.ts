import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { problem, type AuthContext } from './auth';
import { audit, type AuditAction } from './audit';
import {
  quantWrite,
  requireInteractive,
  requireLiveWrite,
  requireRole,
  requireTrader,
} from './access';
import type { Client, Pool } from './db';
import { recordInput, saveRecordWith } from './records';
import { venueKeyOf } from './connector-requests';
import type { Tag } from '../shared/types';
import {
  accountStatus,
  authIdOf,
  exchanges,
  isIp,
  parseTags,
  settingsOf,
  settingsProblem,
  sortTags,
  tagName,
  tagsOf,
  tagsText,
  whitelistProblems,
  type Account,
  type AccountDetail,
  type AccountOptions,
  type AccountSettings,
  type AccountTag,
  type EgressIp,
  type OnboardingLink,
} from '../shared/accounts';
// 交易账户(frontend-spec 12.7、data-model 5.1):写 quant 的 management.authentication。密钥列只写不读;
// 影响实盘的操作要 trader 的登录会话(当场确认 12.4 暂缓,TODO),与审计、指纹、Onboarding 记录同一事务提交
// (proposal §5)。

const TABLE = 'management.authentication';
const fingerprint = (apiKey: string) =>
  createHash('sha256').update(apiKey).digest('hex').slice(0, 12);

type Row = {
  authId: string;
  exchange: string;
  accountName: string;
  accountTags: string | null;
  ipWhitelist: string[] | null;
  owner: string | null;
  keyFingerprint: string | null;
  lastChange: Date | null;
};
const accountSelect = `
  SELECT a.auth_id AS "authId", a.exchange, a.account_name AS "accountName",
         a.account_tags AS "accountTags", a.ip_whitelist AS "ipWhitelist", a.owner,
         f.api_key_fp AS "keyFingerprint",
         (SELECT max(e.at) FROM omniboard.audit_event e
           WHERE e.target_table = '${TABLE}' AND e.target_key = a.auth_id) AS "lastChange"
    FROM management.authentication a
    LEFT JOIN omniboard.credential_fingerprint f ON f.auth_id = a.auth_id`;
function toAccount(row: Row): Account {
  let tags: AccountTag[] = [];
  let tagsError: string | null = null;
  try {
    tags = parseTags(row.accountTags);
  } catch (e) {
    tagsError = (e as Error).message;
  }
  return {
    ...row,
    tags,
    tagsError,
    status: accountStatus(tags),
    lastChange: row.lastChange?.toISOString() ?? null,
  };
}

// ---- Onboarding 记录(proposal §5):录入 key 时同一事务标为 granted 并填 accountRef ----
const visibleRecords = `
  FROM omniboard.module_records r
  JOIN omniboard.organizations o ON o.id = r.organization_id
 WHERE r.tab_id = 'onboarding' AND (r.visibility = 'team' OR $1)
   AND NOT EXISTS (SELECT 1 FROM omniboard.organization_aliases x WHERE x.alias_id = o.id)
   AND NOT EXISTS (SELECT 1 FROM omniboard.record_aliases x WHERE x.alias_id = r.id)`;
const linkColumns = `r.id AS "recordId", o.id AS "organizationId", o.name AS "organizationName",
  r.title, COALESCE(r.structured->>'venueKey', '') AS "venueKey",
  COALESCE(r.structured->>'resourceStage', 'unknown') AS "resourceStage"`;
const matchesExchange = (link: OnboardingLink, exchange: string) =>
  venueKeyOf(link.venueKey) === exchange.toLowerCase();
async function linkCandidates(
  db: Pool | Client,
  admin: boolean,
  exchange: string,
): Promise<OnboardingLink[]> {
  const rows = await db.query<OnboardingLink>(
    `SELECT ${linkColumns} ${visibleRecords}
       AND r.structured->>'resourceType' = 'api_credentials'
       AND COALESCE(r.structured->>'resourceStage', '') <> 'granted'
     ORDER BY o.name, r.title, r.id`,
    [admin],
  );
  return rows.rows.filter((link) => matchesExchange(link, exchange));
}
async function markGranted(
  client: Client,
  request: FastifyRequest,
  recordId: string,
  exchange: string,
  accountName: string,
) {
  const admin = request.user.role === 'admin';
  const link = (await linkCandidates(client, admin, exchange)).find((l) => l.recordId === recordId);
  if (!link) problem(422, 'The selected onboarding record cannot be linked to this account.');
  const record = (
    await client.query(
      `SELECT title, body, scope, status, visibility, person_name AS "personName",
              person_email AS "personEmail", structured, revision
         FROM omniboard.module_records WHERE id = $1 FOR UPDATE`,
      [recordId],
    )
  ).rows[0];
  const tags = await client.query<{ tag: Tag }>(
    'SELECT tag FROM omniboard.organization_tags WHERE organization_id = $1',
    [link.organizationId],
  );
  await saveRecordWith(
    client,
    request.user,
    { id: link.organizationId, tags: tags.rows.map((t) => t.tag) },
    'onboarding',
    recordId,
    recordInput.parse({
      ...record,
      structured: { ...record.structured, resourceStage: 'granted', accountRef: accountName },
      reuseReference: true,
    }),
  );
}

// ---- 输入 ----
const secret = z.string().trim().min(1).max(10000);
const settingsInput = z
  .object({
    type: z.enum(['live', 'test', 'read-only']),
    portfolioGroup: z.string().max(100),
    initializing: z.boolean(),
    unified: z.boolean(),
    lowLatency: z.boolean(),
    arbitrage: z.boolean(),
    additionalLeverage: z.boolean(),
    vipLevel: z.number().int().min(0).max(255).nullable(),
    marketMakerLevel: z.number().int().min(0).max(255).nullable(),
    clientName: z.string().max(100),
  })
  .strict();
const whitelistInput = z.array(z.string().trim().min(1).max(64)).max(50);
const ownerInput = z.string().trim().max(100);
/** 与前端相同的规则。 */
function checkSettings(settings: AccountSettings, whitelist: string[]) {
  const problemText = settingsProblem(settings);
  if (problemText) problem(422, problemText);
  const ips = whitelistProblems(whitelist, settings.type);
  if (ips.lines.size)
    problem(422, `IP whitelist line ${[...ips.lines.keys()][0]! + 1}: Not a valid IP address.`);
  if (ips.empty) problem(422, ips.empty);
}
const unique = (ips: string[]) => [...new Set(ips)];
const nullable = (value: string) => value || null;
/** 同一组标签(忽略顺序与 JSON 空白)。 */
const sameTags = (a: AccountTag[], b: AccountTag[]) =>
  JSON.stringify(a.map((t) => JSON.stringify(t)).sort()) ===
  JSON.stringify(b.map((t) => JSON.stringify(t)).sort());
const sameList = (a: string[] | null, b: string[] | null) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** 读出并锁住一个账户;不存在 404,已停用 409。 */
async function lockAccount(client: Client, authId: string, allowTerminated = false) {
  const row = (
    await client.query<{
      accountName: string;
      exchange: string;
      accountTags: string | null;
      ipWhitelist: string[] | null;
      owner: string | null;
    }>(
      `SELECT account_name AS "accountName", exchange, account_tags AS "accountTags",
              ip_whitelist AS "ipWhitelist", owner
         FROM management.authentication WHERE auth_id = $1 FOR UPDATE`,
      [authId],
    )
  ).rows[0];
  if (!row) problem(404, 'Account not found.');
  let tags: AccountTag[];
  try {
    tags = parseTags(row.accountTags);
  } catch {
    problem(409, 'This account has invalid tags. Fix them in the database first.');
  }
  if (!allowTerminated && tags.some((t) => tagName(t) === 'Terminated'))
    problem(409, 'This account is terminated.');
  return { ...row, tags };
}
async function setFingerprint(client: Client, authId: string, apiKey: string, memberId: string) {
  const previous = await client.query<{ fp: string }>(
    'SELECT api_key_fp AS fp FROM omniboard.credential_fingerprint WHERE auth_id = $1',
    [authId],
  );
  const fp = fingerprint(apiKey);
  await client.query(
    `INSERT INTO omniboard.credential_fingerprint (auth_id, api_key_fp, set_by) VALUES ($1,$2,$3)
     ON CONFLICT (auth_id) DO UPDATE SET api_key_fp = EXCLUDED.api_key_fp, set_at = now(),
       set_by = EXCLUDED.set_by`,
    [authId, fp, memberId],
  );
  return { before: previous.rows[0]?.fp ?? null, after: fp };
}

async function egressIps(pool: Pool): Promise<EgressIp[]> {
  const row = await pool.query<{ value: EgressIp[] }>(
    "SELECT value FROM omniboard.app_setting WHERE key = 'known_egress_ips'",
  );
  return row.rows[0]?.value ?? [];
}

export function registerAccountRoutes(app: FastifyInstance, ctx: AuthContext) {
  const { pool } = ctx;
  const liveWrite = (request: FastifyRequest, action: AuditAction) => ({
    actor: request.actor,
    targetTable: TABLE,
    stepUp: false, // 当场确认暂缓(frontend-spec 12.4 TODO)
    notify: true,
    action,
  });

  app.get('/api/accounts', async (request): Promise<Account[]> => {
    requireTrader(request);
    const rows = await pool.query<Row>(`${accountSelect} ORDER BY a.exchange, a.account_name`);
    return rows.rows.map(toAccount);
  });

  app.get('/api/accounts/options', async (request): Promise<AccountOptions> => {
    requireTrader(request);
    const { exchange } = z.object({ exchange: z.string().max(40).optional() }).parse(request.query);
    // 已有账户与 HFT 配置里用过的分组;标签在 JS 里解析,旧的坏行不会让整个查询失败。
    const accounts = await pool.query<{ tags: string | null }>(
      'SELECT account_tags AS tags FROM management.authentication',
    );
    const hft = await pool.query<{ group: string }>(
      'SELECT portfolio_group AS group FROM management.hft_config',
    );
    const groups = new Set(hft.rows.map((r) => r.group));
    for (const row of accounts.rows) {
      try {
        const group = settingsOf(parseTags(row.tags)).portfolioGroup;
        if (group) groups.add(group);
      } catch {
        // 解析失败的行在列表里单独提示(tagsError)
      }
    }
    return {
      egressIps: await egressIps(pool),
      portfolioGroups: [...groups].sort(),
      onboarding: exchange
        ? await linkCandidates(pool, request.user.role === 'admin', exchange)
        : [],
    };
  });

  app.get('/api/accounts/:authId', async (request): Promise<AccountDetail> => {
    requireTrader(request);
    const { authId } = request.params as { authId: string };
    const row = (
      await pool.query<Row & { verifiedAuthTags: string | null; verifiedAt: Date | null }>(
        `SELECT s.*, a.verified_auth_tags AS "verifiedAuthTags",
                a.verified_auth_tags_updated_at AS "verifiedAt"
           FROM (${accountSelect}) s JOIN management.authentication a ON a.auth_id = s."authId"
          WHERE s."authId" = $1`,
        [authId],
      )
    ).rows[0];
    if (!row) problem(404, 'Account not found.');
    const { verifiedAuthTags, verifiedAt, ...base } = row;
    const history = await pool.query(
      `SELECT e.id, e.at, m.name AS "actorName", e.action, e.before, e.after
         FROM omniboard.audit_event e JOIN omniboard.member m ON m.id = e.actor_id
        WHERE e.target_table = $1 AND e.target_key = $2
        ORDER BY e.id DESC LIMIT 100`,
      [TABLE, authId],
    );
    const onboarding = await pool.query<OnboardingLink>(
      `SELECT ${linkColumns} ${visibleRecords} AND r.structured->>'accountRef' = $2
        ORDER BY o.name, r.title, r.id`,
      [request.user.role === 'admin', row.accountName],
    );
    return {
      ...toAccount(base),
      verifiedAuthTags,
      verifiedAt: verifiedAt?.toISOString() ?? null,
      onboarding: onboarding.rows,
      audit: history.rows,
    };
  });

  app.post('/api/accounts', async (request) => {
    requireLiveWrite(request);
    const input = z
      .object({
        exchange: z.enum(exchanges),
        accountName: z.string().trim().min(1).max(100),
        settings: settingsInput,
        ipWhitelist: whitelistInput,
        owner: ownerInput,
        apiKey: secret,
        apiSecret: secret,
        apiPass: z.string().trim().max(10000),
        onboardingRecordId: z.string().min(1).max(100).optional(),
      })
      .strict()
      .parse(request.body);
    checkSettings(input.settings, input.ipWhitelist);
    const authId = authIdOf(input.exchange, input.accountName);
    const tags = tagsOf(input.settings);
    const whitelist = unique(input.ipWhitelist);
    await quantWrite(pool, async (client) => {
      const inserted = await client.query(
        `INSERT INTO management.authentication
           (auth_id, exchange, account_name, account_tags, ip_whitelist, owner, api_key, api_secret, api_pass)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (auth_id) DO NOTHING`,
        [
          authId,
          input.exchange,
          input.accountName,
          tagsText(tags),
          whitelist,
          nullable(input.owner),
          input.apiKey,
          input.apiSecret,
          input.apiPass,
        ],
      );
      if (!inserted.rowCount) problem(409, 'This account already exists.');
      const fp = await setFingerprint(client, authId, input.apiKey, request.user.id);
      if (input.onboardingRecordId)
        await markGranted(
          client,
          request,
          input.onboardingRecordId,
          input.exchange,
          input.accountName,
        );
      await audit(client, {
        ...liveWrite(request, 'auth.create'),
        targetKey: authId,
        after: {
          exchange: input.exchange,
          accountName: input.accountName,
          accountTags: tags,
          ipWhitelist: whitelist,
          owner: nullable(input.owner),
          apiKeyFingerprint: fp.after,
          ...(input.onboardingRecordId ? { onboardingRecordId: input.onboardingRecordId } : {}),
        },
      });
    });
    return { authId };
  });

  app.patch('/api/accounts/:authId', async (request) => {
    requireLiveWrite(request);
    const { authId } = request.params as { authId: string };
    const input = z
      .object({
        // 打开编辑时看到的值:与库里不同说明别人改过,拒绝覆盖。
        base: z
          .object({
            accountTags: z.string().nullable(),
            ipWhitelist: z.array(z.string()).nullable(),
            owner: z.string().nullable(),
          })
          .strict(),
        settings: settingsInput,
        ipWhitelist: whitelistInput,
        owner: ownerInput,
      })
      .strict()
      .parse(request.body);
    checkSettings(input.settings, input.ipWhitelist);
    await quantWrite(pool, async (client) => {
      const current = await lockAccount(client, authId);
      if (
        current.accountTags !== input.base.accountTags ||
        !sameList(current.ipWhitelist, input.base.ipWhitelist) ||
        current.owner !== input.base.owner
      )
        problem(409, 'This account has changed. Reopen it and try again.');
      const tags = tagsOf(input.settings, current.tags);
      const whitelist = unique(input.ipWhitelist);
      const owner = nullable(input.owner);
      const changes: { action: AuditAction; before: unknown; after: unknown }[] = [];
      if (!sameTags(current.tags, tags))
        changes.push({
          action: 'auth.update_tags',
          before: { accountTags: current.tags },
          after: { accountTags: tags },
        });
      if (!sameList(current.ipWhitelist, whitelist))
        changes.push({
          action: 'auth.update_whitelist',
          before: { ipWhitelist: current.ipWhitelist },
          after: { ipWhitelist: whitelist },
        });
      if (current.owner !== owner)
        changes.push({
          action: 'auth.update_owner',
          before: { owner: current.owner },
          after: { owner },
        });
      if (!changes.length) return;
      // 标签没变就保留原文,不因为 JSON 空白改写别人录入的行。
      await client.query(
        `UPDATE management.authentication SET account_tags = $2, ip_whitelist = $3, owner = $4
          WHERE auth_id = $1`,
        [
          authId,
          sameTags(current.tags, tags) ? current.accountTags : tagsText(tags),
          whitelist,
          owner,
        ],
      );
      for (const change of changes)
        await audit(client, { ...liveWrite(request, change.action), targetKey: authId, ...change });
    });
    return { ok: true };
  });

  app.post('/api/accounts/:authId/rotate', async (request) => {
    requireLiveWrite(request);
    const { authId } = request.params as { authId: string };
    const input = z
      .object({ apiKey: secret, apiSecret: secret, apiPass: z.string().trim().max(10000) })
      .strict()
      .parse(request.body);
    await quantWrite(pool, async (client) => {
      await lockAccount(client, authId);
      await client.query(
        `UPDATE management.authentication SET api_key = $2, api_secret = $3, api_pass = $4
          WHERE auth_id = $1`,
        [authId, input.apiKey, input.apiSecret, input.apiPass],
      );
      const fp = await setFingerprint(client, authId, input.apiKey, request.user.id);
      await audit(client, {
        ...liveWrite(request, 'auth.rotate_key'),
        targetKey: authId,
        before: { apiKeyFingerprint: fp.before },
        after: { apiKeyFingerprint: fp.after },
      });
    });
    return { ok: true };
  });

  app.post('/api/accounts/:authId/terminate', async (request) => {
    requireLiveWrite(request);
    const { authId } = request.params as { authId: string };
    const input = z
      .object({ accountName: z.string().max(100) })
      .strict()
      .parse(request.body);
    await quantWrite(pool, async (client) => {
      const current = await lockAccount(client, authId);
      if (input.accountName !== current.accountName)
        problem(422, 'Type the account name exactly to confirm.');
      const tags = sortTags([...current.tags, 'Terminated']);
      await client.query(
        'UPDATE management.authentication SET account_tags = $2 WHERE auth_id = $1',
        [authId, tagsText(tags)],
      );
      await audit(client, {
        ...liveWrite(request, 'auth.terminate'),
        targetKey: authId,
        before: { accountTags: current.tags },
        after: { accountTags: tags },
      });
    });
    return { ok: true };
  });

  // 白名单的快捷填充(data-model 5.1),admin 维护。
  app.put('/api/accounts/egress-ips', async (request) => {
    requireRole(request, 'admin');
    requireInteractive(request);
    const { egressIps: ips } = z
      .object({
        egressIps: z
          .array(
            z
              .object({
                ip: z.string().trim().refine(isIp, 'Not a valid IP address.'),
                label: z.string().trim().max(80),
              })
              .strict(),
          )
          .max(50),
      })
      .strict()
      .parse(request.body);
    await pool.query(
      "UPDATE omniboard.app_setting SET value = $1::jsonb WHERE key = 'known_egress_ips'",
      [JSON.stringify(ips)],
    );
    return { ok: true };
  });
}
