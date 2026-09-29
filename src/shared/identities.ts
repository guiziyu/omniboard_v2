// 从 v1 src/shared/identities.ts 迁移;rawId 改名 evidenceId。
import type { KnowledgeObject } from './operations';
export interface IdentityCandidateRecord {
  id: string;
  title: string;
  personName: string;
  tabId: string;
  organizationId: string;
  organizationName: string;
  evidenceId: string;
  visibility: 'team' | 'admin';
  objectIds: string[];
}
export interface IdentitySearch {
  objects: KnowledgeObject[];
  records: IdentityCandidateRecord[];
}
export interface IdentityHistory {
  id: string;
  kind: 'link' | 'unlink' | 'merge' | 'undo_merge';
  reason: string;
  evidenceId: string;
  author: string;
  createdAt: string;
  otherName: string;
  recordTitle: string;
  canUndo: boolean;
}
