import { userId } from '@/lib/zhiban/domain/identity/ids';

export class AcademicError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_INPUT'
      | 'FORBIDDEN'
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'CAPACITY_FULL'
      | 'DEADLINE_PASSED'
      | 'ATTEMPT_LIMIT'
      | 'ATTACHMENT_LIMIT'
      | 'EXPORT_LIMIT'
      | 'ATTACHMENT_NOT_CLEARED'
      | 'INACTIVE_MEMBER'
      | 'PROGRESS_BLOCKED'
      | 'INVALID_STATE'
      | 'UNAVAILABLE',
  ) {
    super(code);
  }
}
export function requireAcademic(
  condition: unknown,
  code: AcademicError['code'] = 'INVALID_INPUT',
): asserts condition {
  if (!condition) throw new AcademicError(code);
}
export function academicId(value: unknown): string {
  try {
    return userId(value);
  } catch {
    throw new AcademicError('INVALID_INPUT');
  }
}
export function academicText(value: unknown, maximum = 120, empty = false): string {
  requireAcademic(
    typeof value === 'string' &&
      value === value.trim() &&
      value.length <= maximum &&
      (empty || value.length > 0) &&
      !/[\u0000-\u001f\u007f]/.test(value),
  );
  return value;
}
export function academicCode(value: unknown): string {
  const code = academicText(value, 40);
  requireAcademic(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(code));
  return code;
}
export function academicRevision(value: unknown): string {
  requireAcademic(typeof value === 'string' && /^[1-9][0-9]{0,14}$/.test(value));
  return value;
}
export function academicCapacity(value: unknown): number {
  requireAcademic(
    typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 1000,
  );
  return value;
}
export function academicDate(value: unknown): string {
  requireAcademic(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value));
  const date = new Date(value);
  requireAcademic(!Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value);
  return value;
}
export interface AcademicGrant {
  roleCode: string;
  scopeKind: string;
  scopeId: string | null;
  validFrom: number;
  validUntil: number | null;
}
export interface AcademicActor {
  tenantId: string;
  membershipId: string;
  userId: string;
  grants: readonly AcademicGrant[];
  now: number;
  expiresAt: number;
}
export function academicAdmin(actor: AcademicActor): boolean {
  return actor.grants.some(
    (g) =>
      g.roleCode === 'TENANT_ADMIN' &&
      g.scopeKind === 'TENANT' &&
      g.scopeId === null &&
      g.validFrom <= actor.now &&
      (g.validUntil === null || g.validUntil > actor.now),
  );
}
/** An assignment is necessary but never grants a role. CLASS means this offering only. */
export function academicTeacher(actor: AcademicActor, course: string, offering: string): boolean {
  return actor.grants.some(
    (g) =>
      g.roleCode === 'TEACHER' &&
      g.validFrom <= actor.now &&
      (g.validUntil === null || g.validUntil > actor.now) &&
      ((g.scopeKind === 'TENANT' && g.scopeId === null) ||
        (g.scopeKind === 'COURSE' && g.scopeId === course) ||
        (g.scopeKind === 'CLASS' && g.scopeId === offering)),
  );
}
export function academicStudent(actor: AcademicActor): boolean {
  return actor.grants.some(
    (g) =>
      g.roleCode === 'STUDENT' &&
      g.scopeKind === 'SELF' &&
      g.scopeId === null &&
      g.validFrom <= actor.now &&
      (g.validUntil === null || g.validUntil > actor.now),
  );
}
export const academicPolicy = Object.freeze({
  version: 'academic-v1',
  administrator: ['academic:manage'],
  teacher: ['academic:assigned:read'],
  student: ['academic:self:read'],
  selfEnrollment: false,
  teacherRequiresAssignment: true,
  studentRequiresEnrollment: true,
});

export type AcademicCommand = {
  type:
    | 'CREATE_TERM'
    | 'CREATE_COURSE'
    | 'EDIT_COURSE'
    | 'PUBLISH_COURSE'
    | 'ARCHIVE_COURSE'
    | 'CREATE_CLASS'
    | 'CLASS_MEMBER'
    | 'CLASS_HEAD_TEACHER'
    | 'CREATE_OFFERING'
    | 'UPDATE_OFFERING'
    | 'PREPARE_TEACHER'
    | 'ASSIGN_TEACHER'
    | 'END_TEACHER'
    | 'ENROLL'
    | 'WITHDRAW'
    | 'TRANSFER';
  [key: string]: unknown;
};
const fields: Record<AcademicCommand['type'], string[]> = {
  CREATE_TERM: ['code', 'name', 'startsOn', 'endsOn'],
  CREATE_COURSE: ['code', 'name', 'description', 'ownerMembershipId'],
  EDIT_COURSE: ['id', 'revision', 'name', 'description', 'ownerMembershipId'],
  PUBLISH_COURSE: ['id', 'revision'],
  ARCHIVE_COURSE: ['id', 'revision'],
  CREATE_CLASS: ['code', 'name'],
  CLASS_MEMBER: ['classId', 'membershipId', 'active', 'revision'],
  CLASS_HEAD_TEACHER: ['id', 'revision', 'membershipId'],
  CREATE_OFFERING: ['courseId', 'termId', 'classId', 'code', 'name', 'capacity'],
  UPDATE_OFFERING: ['id', 'revision', 'name', 'capacity', 'status'],
  PREPARE_TEACHER: ['offeringId', 'membershipId', 'revision'],
  ASSIGN_TEACHER: ['offeringId', 'membershipId', 'revision'],
  END_TEACHER: ['id', 'revision'],
  ENROLL: ['offeringId', 'membershipId', 'revision'],
  WITHDRAW: ['id', 'revision'],
  TRANSFER: ['id', 'revision', 'targetOfferingId', 'targetRevision'],
};
export function academicCommand(input: unknown): AcademicCommand {
  requireAcademic(typeof input === 'object' && input !== null && !Array.isArray(input));
  const value = input as AcademicCommand;
  requireAcademic(Object.hasOwn(fields, value.type));
  requireAcademic(
    Object.keys(value).sort().join(',') === ['type', ...fields[value.type]].sort().join(','),
  );
  const result = { ...value };
  for (const [key, item] of Object.entries(result)) {
    if (key === 'type') continue;
    if (
      ['ownerMembershipId', 'classId', 'membershipId'].includes(key) &&
      item === null &&
      ['CREATE_COURSE', 'EDIT_COURSE', 'CREATE_OFFERING', 'CLASS_HEAD_TEACHER'].includes(value.type)
    )
      continue;
    if (
      (key === 'revision' || key === 'targetRevision') &&
      item === null &&
      ['PREPARE_TEACHER', 'ASSIGN_TEACHER', 'ENROLL', 'CLASS_MEMBER', 'TRANSFER'].includes(
        value.type,
      )
    )
      continue;
    if (key.endsWith('Id') || key === 'id') result[key] = academicId(item);
    else if (key.toLowerCase().endsWith('revision')) result[key] = academicRevision(item);
    else if (key === 'code') result[key] = academicCode(item);
    else if (key === 'name') result[key] = academicText(item);
    else if (key === 'description') result[key] = academicText(item, 2000, true);
    else if (key === 'capacity') result[key] = academicCapacity(item);
    else if (key === 'startsOn' || key === 'endsOn') result[key] = academicDate(item);
    else if (key === 'active') requireAcademic(typeof item === 'boolean');
    else if (key === 'status') requireAcademic(item === 'OPEN' || item === 'CLOSED');
  }
  if (value.type === 'CREATE_TERM')
    requireAcademic(String(result.startsOn) <= String(result.endsOn));
  return Object.freeze(
    Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b))),
  ) as AcademicCommand;
}
