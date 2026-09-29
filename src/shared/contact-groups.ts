// 从 v1 src/modules/contact-groups.ts 迁移,内容保持一致。
import type { ModuleRecord } from './types';
import type { KnowledgeObject } from './operations';

/** Group only explicitly linked identities; equal names alone are not identity evidence. */
export function groupContacts(records: ModuleRecord[], objects: KnowledgeObject[]) {
  const owners = new Map<string, string>();
  for (const object of objects.filter((o) => o.kind === 'person'))
    for (const record of object.records) {
      const previous = owners.get(record.id);
      owners.set(record.id, previous && previous !== object.id ? '' : object.id);
    }
  const groups = new Map<string, { id: string; records: ModuleRecord[] }>();
  for (const record of records) {
    const key = owners.get(record.id) || 'record:' + record.id;
    if (!groups.has(key)) groups.set(key, { id: key, records: [] });
    groups.get(key)!.records.push(record);
  }
  return [...groups.values()];
}
