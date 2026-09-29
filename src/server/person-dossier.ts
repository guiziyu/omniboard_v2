import { id, type Client } from './db';
// 人员档案(frontend-spec 6.4、7.10),从 v1 src/server/person-profiles.ts ensurePersonDossier 迁移。

/**
 * 带姓名的记录保存后自动得到一个独立的人员对象 `person-record:<记录 id>`(范围 "Personnel dossier");
 * 已经关联了人员对象的记录不再新建,同名记录不合并。返回人员对象 id,记录没有姓名时返回 ''。
 */
export async function ensurePersonDossier(client: Client, recordId: string): Promise<string> {
  const linked = await client.query<{ id: string }>(
    `SELECT k.id FROM omniboard.object_records x
       JOIN omniboard.knowledge_objects k ON k.id = x.object_id
      WHERE x.record_id = $1 AND k.kind = 'person' LIMIT 1`,
    [recordId],
  );
  if (linked.rows[0]) return linked.rows[0].id;
  const record = (
    await client.query<{ organization_id: string; person_name: string; visibility: string }>(
      'SELECT organization_id, person_name, visibility FROM omniboard.module_records WHERE id = $1',
      [recordId],
    )
  ).rows[0];
  if (!record?.person_name.trim()) return '';
  const initialId = `person-record:${recordId}`;
  const taken = await client.query('SELECT 1 FROM omniboard.knowledge_objects WHERE id = $1', [
    initialId,
  ]);
  const objectId = taken.rowCount ? id() : initialId;
  await client.query(
    `INSERT INTO omniboard.knowledge_objects (id, organization_id, kind, name, scope, visibility)
     VALUES ($1, $2, 'person', $3, 'Personnel dossier', $4)`,
    [objectId, record.organization_id, record.person_name.trim(), record.visibility],
  );
  await client.query(
    'INSERT INTO omniboard.object_records (object_id, record_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [objectId, recordId],
  );
  return objectId;
}
