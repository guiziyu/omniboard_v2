import { z } from 'zod';
import type { Pool } from './db';
import { problem, type User } from './auth';
import { identityIndex } from './knowledge';
import { profileIndex } from './person-profiles';
import { compareMovementDates } from '../shared/movement-date';
import { groupMovementRecords, personMovement } from '../shared/people-movements';
import type { TalentContact, TalentDetail, TalentDirectory, TalentRecord } from '../shared/talent';
// 人才目录(frontend-spec 6.9–6.11、6.15),从 v1 src/server/talent.ts 迁移。
// 只读模型:浏览不建身份、不写身份决定;身份决定是 knowledge.ts 里有审计的显式操作。

export const talentQuery = z.object({
  q: z.string().trim().max(200).default(''),
  organizationId: z.string().max(100).default(''),
  identity: z.enum(['all', 'linked', 'unlinked']).default('all'),
  duplicates: z.enum(['all', 'review']).default('all'),
  contact: z.enum(['all', 'available']).default('all'),
  sort: z.enum(['updated', 'name']).default('updated'),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
/** 只保留能生成有效链接的联系方式;wechat 没有链接也保留(调用方处理)。 */
function contactHref(channel: string, value: string) {
  if (channel === 'email') return z.email().safeParse(value).success ? 'mailto:' + value : '';
  if (channel === 'phone')
    return /^\+?[\d ()-]{5,40}$/.test(value) ? 'tel:' + value.replace(/[ ()-]/g, '') : '';
  return ['telegram', 'x', 'linkedin', 'website'].includes(channel) &&
    /^https:\/\//.test(value) &&
    URL.canParse(value)
    ? value
    : '';
}
const norm = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, '');

export async function talentIndex(pool: Pool, user: User) {
  const index = await identityIndex(pool, user);
  const profiles = await profileIndex(pool, user, index.canonical);
  const rows = (
    await pool.query<Omit<TalentRecord, 'updatedAt'> & { updatedAt: Date }>(
      `SELECT r.id, r.organization_id AS "organizationId", o.name AS "organizationName",
              r.tab_id AS "tabId", r.title, r.body, r.person_name AS "personName",
              r.person_email AS "personEmail", r.structured, r.event_type AS "eventType",
              COALESCE(r.event_date, '') AS "eventDate", r.evidence_id AS "evidenceId",
              r.updated_at AS "updatedAt"
         FROM omniboard.module_records r
         JOIN omniboard.organizations o ON o.id = r.organization_id
         JOIN omniboard.evidence e ON e.id = r.evidence_id
        WHERE (r.visibility = 'team' OR $1) AND (e.visibility = 'team' OR $1)
          AND NOT EXISTS (SELECT 1 FROM omniboard.record_aliases a WHERE a.alias_id = r.id)
          AND NOT EXISTS (SELECT 1 FROM omniboard.organization_aliases a WHERE a.alias_id = o.id)
          AND (btrim(r.person_name) <> '' OR EXISTS (
                SELECT 1 FROM omniboard.object_records x
                  JOIN omniboard.knowledge_objects k ON k.id = x.object_id
                 WHERE x.record_id = r.id AND k.kind = 'person'))
        ORDER BY r.updated_at DESC, r.id`,
      [user.role === 'admin'],
    )
  ).rows;
  const records: TalentRecord[] = rows.map((r) => ({
    ...r,
    updatedAt: r.updatedAt.toISOString(),
  }));
  const byId = new Map(records.map((r) => [r.id, r]));
  const linked = new Set<string>();
  const people: TalentDetail[] = [];
  const objectOf = new Map(index.objects.map((o) => [o.id, o]));
  function entry(
    id: string,
    identityId: string,
    name: string,
    aliases: string[],
    evidence: TalentRecord[],
  ) {
    const profile = profiles.get(identityId) ?? { sources: [], careers: [] };
    const organizations = [
      ...new Map([
        ...evidence.map(
          (r) => [r.organizationId, { id: r.organizationId, name: r.organizationName }] as const,
        ),
        ...profile.careers
          .filter((p) => p.organizationId)
          .map(
            (p) => [p.organizationId, { id: p.organizationId, name: p.organizationName }] as const,
          ),
      ]).values(),
    ];
    const contacts: TalentContact[] = [];
    for (const r of evidence) {
      const candidates = [
        ...(r.personEmail ? [{ channel: 'email', value: r.personEmail }] : []),
        ...(r.tabId === 'contacts' && r.structured.value
          ? [{ channel: r.structured.channel || '', value: r.structured.value }]
          : []),
      ];
      for (const c of candidates) {
        const href = contactHref(c.channel, c.value);
        if (
          (!href && !(c.channel === 'wechat' && c.value.trim())) ||
          contacts.some((saved) => saved.channel === c.channel && saved.value === c.value)
        )
          continue;
        contacts.push({
          ...c,
          href,
          role: r.structured.role || '',
          recordId: r.id,
          evidenceId: r.evidenceId,
          organizationName: r.organizationName,
        });
      }
    }
    // 先合并同一事件的多个来源,再按日期排序;晚发的公告不能盖过更晚的生效事件(6.5、6.7)。
    const movements = groupMovementRecords(
      evidence.filter((r) => ['joined', 'left', 'role_change'].includes(r.eventType)),
    )
      .map((group) => group.record)
      .toSorted(compareMovementDates);
    const latest = movements[0];
    const summary = latest ? personMovement(latest, latest.organizationName) : undefined;
    for (const source of profile.sources)
      if (!contacts.some((c) => c.href === source.url))
        contacts.push({
          channel: source.provider === 'linkedin' ? 'linkedin' : 'website',
          value: source.url,
          href: source.url,
          role: 'Personal profile',
          recordId: '',
          evidenceId: source.captures[0]!.evidenceId,
          organizationName: '',
        });
    people.push({
      id,
      identityId,
      name,
      aliases: [...new Set(aliases)],
      ...profile,
      duplicates: [],
      duplicateCount: 0,
      revision: objectOf.get(identityId)?.revision ?? 1,
      currentRoles: profile.careers
        .filter((p) => p.tenure === 'current')
        .map((p) => `${p.role} · ${p.organizationName}`),
      organizations,
      roles: [
        ...new Set([
          ...profile.careers.map((p) => p.role),
          ...evidence
            .filter((r) => ['org_chart', 'contacts'].includes(r.tabId))
            .map((r) => r.structured.role || r.title)
            .filter(Boolean),
        ]),
      ],
      contactCount: contacts.length,
      recordCount: evidence.length,
      updatedAt:
        [...evidence, ...profile.sources]
          .map((r) => r.updatedAt)
          .sort()
          .at(-1) ?? '',
      latestMovement: latest
        ? {
            id: latest.id,
            type: summary!.type,
            date: latest.eventDate,
            structured: latest.structured,
            organizationName: summary!.organizationName,
            title:
              summary!.type === 'transferred'
                ? `${summary!.fromOrganization} → ${summary!.toOrganization}`
                : latest.title,
          }
        : null,
      records: evidence,
      contacts,
    });
  }
  for (const person of index.objects.filter((o) => o.kind === 'person')) {
    const evidence = person.records
      .map((r) => byId.get(r.id))
      .filter((r): r is TalentRecord => !!r);
    if (!evidence.length && !profiles.get(person.id)?.careers.length) continue;
    evidence.forEach((r) => linked.add(r.id));
    entry('identity:' + person.id, person.id, person.name, person.aliases ?? [], evidence);
  }
  for (const record of records) {
    if (linked.has(record.id) || !record.personName.trim()) continue;
    entry('record:' + record.id, '', record.personName, [], [record]);
  }

  // 疑似重复(6.10):姓名规范化后相同且可见性相同;「不是同一人」不再出现,「稍后核对」列出但不计数。
  const decisions = (
    await pool.query<{ leftId: string; rightId: string; decision: string }>(
      `SELECT left_id AS "leftId", right_id AS "rightId", decision
         FROM omniboard.person_duplicate_decisions`,
    )
  ).rows.map((d) => ({
    pair: new Set([index.canonical.get(d.leftId), index.canonical.get(d.rightId)]),
    decision: d.decision,
  }));
  for (const person of people) {
    if (!person.identityId) continue;
    const visibility = objectOf.get(person.identityId)?.visibility;
    person.duplicates = people
      .filter(
        (other) =>
          other.identityId &&
          other.id !== person.id &&
          norm(other.name) === norm(person.name) &&
          objectOf.get(other.identityId)?.visibility === visibility,
      )
      .flatMap((other) => {
        const decision = decisions.find(
          (d) => d.pair.has(person.identityId) && d.pair.has(other.identityId),
        );
        if (decision?.decision === 'different') return [];
        return [
          {
            id: other.identityId,
            name: other.name,
            revision: other.revision,
            organizations: other.organizations.map((o) => o.name),
            roles: other.currentRoles.length ? other.currentRoles : other.roles,
            sources: other.sources.map((s) => s.url),
            recordCount: other.recordCount,
            reason: 'same_name' as const,
            deferred: decision?.decision === 'later',
          },
        ];
      });
    person.duplicateCount = person.duplicates.filter((d) => !d.deferred).length;
  }
  return { people, canonical: index.canonical };
}

export async function talentDirectory(
  pool: Pool,
  user: User,
  input: unknown,
): Promise<TalentDirectory> {
  const q = talentQuery.parse(input);
  const { people } = await talentIndex(pool, user);
  const needle = q.q.toLocaleLowerCase();
  const filtered = people
    .filter(
      (p) =>
        (!q.organizationId || p.organizations.some((o) => o.id === q.organizationId)) &&
        (q.identity === 'all' || Boolean(p.identityId) === (q.identity === 'linked')) &&
        (q.contact === 'all' || p.contactCount > 0) &&
        (q.duplicates === 'all' || p.duplicateCount > 0) &&
        [
          p.name,
          ...p.aliases,
          ...p.roles,
          ...p.organizations.map((o) => o.name),
          ...p.contacts.map((c) => c.value),
          ...p.records.flatMap((r) => [r.structured.fromRole, r.structured.toRole]),
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(needle),
    )
    .sort(
      (a, b) =>
        (q.sort === 'updated' ? b.updatedAt.localeCompare(a.updatedAt) : 0) ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
  const pages = Math.max(1, Math.ceil(filtered.length / q.pageSize));
  const page = Math.min(q.page, pages);
  return {
    people: filtered
      .slice((page - 1) * q.pageSize, page * q.pageSize)
      .map(
        ({
          records: _records,
          contacts: _contacts,
          careers: _careers,
          sources: _sources,
          duplicates: _duplicates,
          revision: _revision,
          ...person
        }) => person,
      ),
    organizations: [
      ...new Map(people.flatMap((p) => p.organizations.map((o) => [o.id, o] as const))).values(),
    ].sort((a, b) => a.name.localeCompare(b.name)),
    total: filtered.length,
    page,
    pages,
    counts: {
      identities: people.filter((p) => p.identityId).length,
      unlinkedRecords: people.filter((p) => !p.identityId).length,
      possibleDuplicates: people.filter((p) => p.duplicateCount > 0).length,
    },
  };
}
/** `identity:<旧 id>` 解析到合并后的规范身份;`record:<id>` 返回包含该记录的那一行。 */
export async function talentPerson(pool: Pool, user: User, personId: string) {
  const { people, canonical } = await talentIndex(pool, user);
  let key = personId;
  if (key.startsWith('identity:'))
    key = 'identity:' + (canonical.get(key.slice(9)) ?? key.slice(9));
  return (
    people.find(
      (p) =>
        p.id === key || (key.startsWith('record:') && p.records.some((r) => r.id === key.slice(7))),
    ) ?? problem(404, 'Person not found.')
  );
}
