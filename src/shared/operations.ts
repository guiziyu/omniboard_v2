// 共享对象、结论与关系的类型(data-model §3.4),从 v1 src/shared/operations.ts 迁移;
// v1 的 rawId 改名 evidenceId。任务与情报的类型随工作台(§10)、情报(§8)一起迁移。
export type Access = 'team' | 'admin';
export type ObjectKind = 'person' | 'account' | 'capability' | 'resource';
export interface KnowledgeObject {
  id: string;
  organizationId: string;
  kind: ObjectKind;
  name: string;
  scope: string;
  visibility: Access;
  revision: number;
  organizations?: { id: string; name: string }[];
  aliases?: string[];
  records: {
    id: string;
    title: string;
    tabId: string;
    evidenceId: string;
    organizationId?: string;
    organizationName?: string;
  }[];
}
export interface KnowledgeClaim {
  id: string;
  objectId: string;
  organizationId?: string;
  organizationName?: string;
  field: string;
  value: string;
  scope: string;
  validFrom: string;
  validUntil: string;
  observedOn: string;
  recordedAt: string;
  status: 'reported' | 'accepted' | 'superseded';
  current: boolean;
  conflict: boolean;
  evidenceId: string;
  sourceRecordId: string;
  revision: number;
}
export interface KnowledgeRelation {
  id: string;
  fromId: string;
  toId: string;
  label: string;
  certainty: 'confirmed' | 'unconfirmed';
  validFrom: string;
  validUntil: string;
  evidenceId: string;
  current: boolean;
}
export interface KnowledgeGraph {
  decisions: { claimId: string; reason: string; author: string; createdAt: string }[];
  objects: KnowledgeObject[];
  claims: KnowledgeClaim[];
  relations: KnowledgeRelation[];
  records: { id: string; title: string; tabId: string; evidenceId: string; visibility: Access }[];
}
/** 有效期判断:任一端为空视为不限。日期是 YYYY-MM-DD 字符串,直接按字典序比较。 */
export function dateIsCurrent(
  from: string,
  until: string,
  today = new Date().toISOString().slice(0, 10),
) {
  return (!from || from <= today) && (!until || until >= today);
}
