// 人才目录的读模型类型(frontend-spec 6.9–6.11),从 v1 src/shared/talent.ts 迁移;rawId 改名 evidenceId。
import type { PersonCareer, PersonSourceProfile, PersonDuplicate } from './person-profile';
export interface TalentOrganization {
  id: string;
  name: string;
}
export interface TalentRecord {
  id: string;
  organizationId: string;
  organizationName: string;
  tabId: string;
  title: string;
  body: string;
  personName: string;
  personEmail: string;
  structured: Record<string, string>;
  eventType: string;
  eventDate: string;
  evidenceId: string;
  updatedAt: string;
}
export interface TalentMovement {
  id: string;
  type: string;
  date: string;
  structured: Record<string, string>;
  organizationName: string;
  title: string;
}
export interface TalentContact {
  channel: string;
  value: string;
  href: string;
  role: string;
  recordId: string;
  evidenceId: string;
  organizationName: string;
}
export interface TalentEntry {
  id: string;
  identityId: string;
  name: string;
  aliases: string[];
  organizations: TalentOrganization[];
  roles: string[];
  contactCount: number;
  recordCount: number;
  updatedAt: string;
  latestMovement: TalentMovement | null;
  duplicateCount: number;
  currentRoles: string[];
}
export interface TalentDetail extends TalentEntry {
  records: TalentRecord[];
  contacts: TalentContact[];
  careers: PersonCareer[];
  sources: PersonSourceProfile[];
  duplicates: PersonDuplicate[];
  revision: number;
}
export interface TalentDirectory {
  people: TalentEntry[];
  organizations: TalentOrganization[];
  total: number;
  page: number;
  pages: number;
  counts: { identities: number; unlinkedRecords: number; possibleDuplicates: number };
}
