import { z } from 'zod';
import type { Client, Pool } from './db';
import { id, tx } from './db';
import { problem, type Role, type User } from './auth';
import type { OrganizationProfile, ProfileReference } from '../shared/types';
// 机构简介、事实与链接(frontend-spec 4.7、4.10),从 v1 src/server/organization-profile.ts 迁移。
// 只能经导入接口写入,界面没有编辑入口。每条都引用一条证据,按证据可见性逐条过滤。
const text = (max: number) => z.string().trim().min(1).max(max);
const key = text(80).regex(/^[a-z][a-z0-9_-]*$/);
const evidenceId = text(100);
const webUrl = text(2000).refine((value) => {
  try {
    const parsed = new URL(value);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}, 'Use a public HTTP or HTTPS URL.');
export const organizationProfileInput = z
  .object({
    about: z
      .object({ text: text(12000), evidenceId })
      .strict()
      .optional(),
    facts: z
      .array(
        z
          .object({
            key,
            label: text(100),
            value: text(3000),
            section: text(100).default('Key facts'),
            evidenceId,
          })
          .strict(),
      )
      .max(80)
      .default([]),
    links: z
      .array(z.object({ key, label: text(100), url: webUrl, evidenceId }).strict())
      .max(40)
      .default([]),
  })
  .strict()
  .superRefine((profile, context) => {
    for (const collection of ['facts', 'links'] as const) {
      const keys = new Set<string>();
      profile[collection].forEach((entry, index) => {
        if (keys.has(entry.key))
          context.addIssue({
            code: 'custom',
            path: [collection, index, 'key'],
            message: 'Keys must be unique within each collection.',
          });
        keys.add(entry.key);
      });
    }
  });
type StoredProfile = z.output<typeof organizationProfileInput>;
const sourceLabels: Record<string, string> = {
  cmc_web: 'CoinMarketCap',
  coingecko_web: 'CoinGecko',
  official_website: 'Official website',
  public_profile: 'Public profile',
  the_org: 'The Org',
  x: 'X',
  user_report: 'Team report',
  manual: 'Team note',
};
type Reference = { source: string; url: string; captured_at: Date; visibility: string };
async function references(pool: Pool | Client, ids: string[]): Promise<Map<string, Reference>> {
  const result = await pool.query<Reference & { id: string }>(
    'SELECT id, source, url, captured_at, visibility FROM omniboard.evidence WHERE id = ANY($1::text[])',
    [ids],
  );
  return new Map(result.rows.map((r) => [r.id, r]));
}
const cited = (profile: StoredProfile) => [
  ...(profile.about ? [profile.about] : []),
  ...profile.facts,
  ...profile.links,
];
/** 只返回当前成员能读到原证据的条目;全部受限时既不显示内容也不暴露元数据。 */
export async function getOrganizationProfile(
  pool: Pool | Client,
  organizationId: string,
  role: Role,
): Promise<OrganizationProfile | undefined> {
  const row = (
    await pool.query<{ profile: StoredProfile; revision: number; updated_at: Date }>(
      'SELECT profile, revision, updated_at FROM omniboard.organization_profiles WHERE organization_id = $1',
      [organizationId],
    )
  ).rows[0];
  if (!row) return;
  const stored = organizationProfileInput.parse(row.profile);
  const refs = await references(
    pool,
    cited(stored).map((item) => item.evidenceId),
  );
  const cite = <T extends { evidenceId: string }>(item: T): (T & ProfileReference) | undefined => {
    const source = refs.get(item.evidenceId);
    if (!source || (source.visibility === 'admin' && role !== 'admin')) return;
    return {
      ...item,
      sourceName: sourceLabels[source.source] || source.source,
      sourceUrl: source.url,
      capturedAt: source.captured_at.toISOString(),
    };
  };
  const about = stored.about ? cite(stored.about) : undefined;
  const facts = stored.facts.flatMap((fact) => cite(fact) ?? []);
  const links = stored.links.flatMap((link) => cite(link) ?? []);
  if (!about && !facts.length && !links.length) return;
  return {
    ...(about ? { about } : {}),
    facts,
    links,
    revision: row.revision,
    updatedAt: row.updated_at.toISOString(),
  };
}
/**
 * 保存档案:带 revision 乐观并发;相同内容不增加 revision;编辑者不能覆盖含有自己看不到的证据的档案。
 * 档案不产生排名观测。
 */
export async function saveOrganizationProfile(
  pool: Pool,
  user: User,
  organizationId: string,
  input: unknown,
  expectedRevision: number,
): Promise<OrganizationProfile | undefined> {
  const profile = organizationProfileInput.parse(input);
  return tx(pool, async (client) => {
    const org = await client.query('SELECT 1 FROM omniboard.organizations WHERE id = $1', [
      organizationId,
    ]);
    if (!org.rowCount) problem(404, 'Organization not found.');
    const refs = await references(
      client,
      cited(profile).map((item) => item.evidenceId),
    );
    for (const item of cited(profile)) {
      const source = refs.get(item.evidenceId);
      if (!source) problem(422, 'Each profile value must reference saved evidence.');
      if (source.visibility === 'admin' && user.role !== 'admin')
        problem(403, 'This evidence is only available to an administrator.');
    }
    const previous = (
      await client.query<{ profile: StoredProfile; revision: number }>(
        `SELECT profile, revision FROM omniboard.organization_profiles
          WHERE organization_id = $1 FOR UPDATE`,
        [organizationId],
      )
    ).rows[0];
    if (previous && user.role !== 'admin') {
      const old = await references(
        client,
        cited(organizationProfileInput.parse(previous.profile)).map((item) => item.evidenceId),
      );
      if ([...old.values()].some((r) => r.visibility === 'admin'))
        problem(403, 'An administrator must update a profile that contains restricted evidence.');
    }
    if ((previous?.revision ?? 0) !== expectedRevision)
      problem(409, 'This profile changed. Reload it before saving.');
    // jsonb 不保留键顺序:两边都经同一 schema 解析后再比较。
    if (
      previous &&
      JSON.stringify(organizationProfileInput.parse(previous.profile)) === JSON.stringify(profile)
    )
      return getOrganizationProfile(client, organizationId, user.role);
    const revision = (previous?.revision ?? 0) + 1;
    await client.query(
      `INSERT INTO omniboard.organization_profiles (organization_id, profile, revision, author_id)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (organization_id) DO UPDATE
         SET profile = EXCLUDED.profile, revision = EXCLUDED.revision,
             author_id = EXCLUDED.author_id, updated_at = now()`,
      [organizationId, profile, revision, user.id],
    );
    await client.query(
      `INSERT INTO omniboard.edit_history (id, subject_id, action, revision, payload, author_id)
       VALUES ($1,$2,'organization_profile',$3,$4,$5)`,
      [
        id(),
        organizationId,
        revision,
        { profile, previousProfile: previous?.profile ?? null },
        user.id,
      ],
    );
    return getOrganizationProfile(client, organizationId, user.role);
  });
}
