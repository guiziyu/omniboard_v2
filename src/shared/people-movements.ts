// 从 v1 src/modules/people-movements.ts 迁移,内容保持一致。
import type { ModuleRecord } from './types';
import { compareMovementDates } from './movement-date';
export const movementTypes = {
  joined: { label: 'Joined', icon: 'arrival', description: 'Joined an organization' },
  left: { label: 'Departed', icon: 'departure', description: 'Left an organization' },
  role_change: {
    label: 'Role change',
    icon: 'compare',
    description: 'Changed role within this organization',
  },
  related: {
    label: 'Other updates',
    icon: 'info',
    description: 'Not classified as a join, departure or role change for this organization',
  },
} as const;
export type MovementType = keyof typeof movementTypes;
export function movementType(type: string) {
  if (type === 'transferred')
    return {
      label: 'Moved organizations',
      icon: 'compare',
      description: 'Moved from one organization to another',
    };
  return (
    movementTypes[type as MovementType] || {
      label: 'Type not recorded',
      icon: 'info',
      description: 'Type not recorded',
    }
  );
}
type MovementRecord = Pick<ModuleRecord, 'eventType' | 'structured'>;
const organizationKey = (name: string) =>
  name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export function sameMovementOrganization(a: string, b: string) {
  return !!organizationKey(a) && organizationKey(a) === organizationKey(b);
}
export function movementTransition(record: MovementRecord, organizationName: string) {
  const s = record.structured;
  const from = s.fromOrganization?.trim() || '';
  const to = s.toOrganization?.trim() || '';
  // Legacy event types describe their dossier only when no explicit endpoint contradicts it.
  const fromDefault =
    (record.eventType === 'left' && !sameMovementOrganization(to, organizationName)) ||
    (record.eventType === 'role_change' && (!to || sameMovementOrganization(to, organizationName)));
  const toDefault =
    (record.eventType === 'joined' && !sameMovementOrganization(from, organizationName)) ||
    (record.eventType === 'role_change' &&
      (!from || sameMovementOrganization(from, organizationName)));
  return {
    fromOrganization: from || (fromDefault ? organizationName : ''),
    toOrganization: to || (toDefault ? organizationName : ''),
    fromRole: s.fromRole || '',
    toRole: s.toRole || '',
  };
}

/** Display classification, never a rewrite of the source event or a name-based identity merge. */
export function movementPerspective(
  record: MovementRecord,
  organizationName: string,
): MovementType {
  const transition = movementTransition(record, organizationName);
  const fromHere = sameMovementOrganization(transition.fromOrganization, organizationName);
  const toHere = sameMovementOrganization(transition.toOrganization, organizationName);
  if (fromHere && toHere) return 'role_change';
  if (fromHere) return 'left';
  if (toHere) return 'joined';
  return 'related';
}

/** Person-level summaries describe the complete transition, not one institution's perspective. */
export function personMovement(record: MovementRecord, organizationName: string) {
  const transition = movementTransition(record, organizationName);
  const transferred = Boolean(
    transition.fromOrganization &&
    transition.toOrganization &&
    !sameMovementOrganization(transition.fromOrganization, transition.toOrganization),
  );
  return {
    ...transition,
    type: transferred ? 'transferred' : movementPerspective(record, organizationName),
    organizationName: transition.toOrganization || transition.fromOrganization || organizationName,
  };
}

export const movementDateLabels = {
  announcement: 'Announcement date',
  effective: 'Effective date',
  reported: 'Source date',
  unknown: 'Date meaning not specified',
} as const;
export function movementDateLabelKey(structured: Record<string, string>) {
  return structured.dateBasis === 'announcement'
    ? 'Announcement date'
    : structured.dateBasis === 'effective'
      ? 'Effective date'
      : structured.dateBasis === 'unknown'
        ? 'Date meaning not specified'
        : 'Source date';
}

/** Only curated or source-derived event keys group records; dates/names never deduplicate evidence. */
export function groupMovementRecords<
  T extends Pick<ModuleRecord, 'id' | 'personName' | 'eventDate' | 'structured'>,
>(records: T[]) {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const key = record.structured.movementGroupId
      ? JSON.stringify([record.personName, record.structured.movementGroupId])
      : 'record:' + record.id;
    const group = groups.get(key) || [];
    group.push(record);
    groups.set(key, group);
  }
  const priority = (r: T) =>
    r.structured.dateBasis === 'effective' ? 0 : r.structured.dateBasis === 'reported' ? 1 : 2;
  return [...groups.values()].map((sources) => ({
    record: [...sources].sort(
      (a, b) => priority(a) - priority(b) || compareMovementDates(a, b),
    )[0]!,
    sources,
  }));
}
