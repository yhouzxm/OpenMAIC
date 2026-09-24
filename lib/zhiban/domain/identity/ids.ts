import { invariant } from './errors';

declare const idBrand: unique symbol;
type Id<Kind extends string> = string & { readonly [idBrand]: Kind };
export type UserId = Id<'User'>;
export type TenantId = Id<'Tenant'>;
export type MembershipId = Id<'Membership'>;
export type RoleId = Id<'Role'>;
export type RoleGrantId = Id<'RoleGrant'>;
export type SystemAdminGrantId = Id<'SystemAdminGrant'>;
export type ClassId = Id<'Class'>;
export type CourseId = Id<'Course'>;

function parseId<Kind extends string>(value: unknown): Id<Kind> {
  invariant(
    typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
    'INVALID_ID',
    'A UUIDv7 identifier is required.',
  );
  return value.toLowerCase() as Id<Kind>;
}

export const userId = (value: unknown): UserId => parseId<'User'>(value);
export const tenantId = (value: unknown): TenantId => parseId<'Tenant'>(value);
export const membershipId = (value: unknown): MembershipId => parseId<'Membership'>(value);
export const roleId = (value: unknown): RoleId => parseId<'Role'>(value);
export const roleGrantId = (value: unknown): RoleGrantId => parseId<'RoleGrant'>(value);
export const systemAdminGrantId = (value: unknown): SystemAdminGrantId =>
  parseId<'SystemAdminGrant'>(value);
export const classId = (value: unknown): ClassId => parseId<'Class'>(value);
export const courseId = (value: unknown): CourseId => parseId<'Course'>(value);
