// 关系图谱的读模型类型(frontend-spec 7.4),从 v1 src/shared/exploration.ts 迁移;rawId 改名 evidenceId。
import type { KnowledgeGraph, ObjectKind, WorkTask } from './operations';
import type { ModuleRecord } from './types';
export interface ExplorationGraph extends KnowledgeGraph {
  organization: { id: string; name: string };
  contextRecords: ModuleRecord[];
  references: Record<string, { source: string; url: string; capturedAt: string }>;
  identityAliases?: Record<string, string>;
  tasks: WorkTask[];
}
export interface ExplorationNode {
  id: string;
  name: string;
  kind: ObjectKind | 'organization' | 'record';
  origin: 'organization' | 'object' | 'record';
  scope: string;
  recordIds: string[];
  recordContext?: { tabId: ModuleRecord['tabId']; title: string };
  visibility: 'team' | 'admin';
}
export interface ExplorationEdge {
  id: string;
  fromId: string;
  toId: string;
  label: string;
  kind: 'context' | 'reporting' | 'relationship';
  certainty: 'confirmed' | 'unconfirmed';
  current: boolean;
  evidenceId: string;
  validFrom: string;
  validUntil: string;
}
