// 记录、模块与机构档案的接口类型(frontend-spec 4、5)。v1 的 rawId / attachmentId 在 v2 叫 evidenceId /
// attachmentEvidenceId(data-model §3.1)。
import type { OrganizationTag } from './tags';
export type Tag = OrganizationTag;
export type Visibility = 'team' | 'admin';
export interface TabDefinition {
  id: string;
  title: string;
  shortTitle: string;
  description: string;
  order: number;
  kind: 'overview' | 'chart' | 'timeline' | 'stats' | 'records' | 'comments';
}
export interface ModuleRecord {
  id: string;
  organizationId: string;
  tabId: string;
  title: string;
  body: string;
  scope: string;
  status: string;
  visibility: Visibility;
  personName: string;
  personEmail: string;
  structured: Record<string, string>;
  reportsTo: string;
  eventDate: string;
  eventType: string;
  evidenceId: string;
  attachmentEvidenceId: string | null;
  revision: number;
  author: string;
  updatedAt: string;
}
export type ModuleStatus = 'not_applicable' | 'restricted' | 'empty' | 'ready';
export interface ModuleData {
  organizationId: string;
  tabId: string;
  status: ModuleStatus;
  records?: ModuleRecord[];
  sources?: Observation[];
}
/** 一个来源的一次采集观测(CMC / CoinGecko 排行页上的一行)。 */
export interface Observation {
  linkId: string;
  source: string;
  slug: string;
  name: string;
  url: string;
  rank: number;
  metrics: { key: string; label: string; value: string | null; unit: string }[];
  evidenceId: string;
  capturedAt: string;
}
export interface ProfileReference {
  evidenceId: string;
  sourceName: string;
  sourceUrl: string;
  capturedAt: string;
}
export interface OrganizationProfile {
  about?: { text: string } & ProfileReference;
  facts: ({ key: string; label: string; value: string; section: string } & ProfileReference)[];
  links: ({ key: string; label: string; url: string } & ProfileReference)[];
  revision: number;
  updatedAt: string;
}
export interface Organization {
  id: string;
  name: string;
  description: string;
  logoUrl: string;
  tags: Tag[];
  recordCount: number;
  createdAt: string;
  sources: Observation[];
  profile?: OrganizationProfile;
}
export interface RecordVersion {
  revision: number;
  action: string;
  author: string;
  createdAt: string;
  payload: {
    title: string;
    body: string;
    scope: string;
    personEmail?: string;
    structured?: Record<string, string>;
    evidenceId: string;
  };
}
