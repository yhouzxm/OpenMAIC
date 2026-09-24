import { invariant } from './errors';
import { roleId, type RoleId } from './ids';
import { permission, type Permission } from './permission';

export type RoleCode = 'STUDENT' | 'TEACHER' | 'TENANT_ADMIN';

export function roleCode(value: unknown): RoleCode {
  invariant(
    value === 'STUDENT' || value === 'TEACHER' || value === 'TENANT_ADMIN',
    'INVALID_ROLE',
    'Unknown tenant role.',
  );
  return value;
}

export class Role {
  private constructor(
    public readonly id: RoleId,
    public readonly code: RoleCode,
    public readonly permissions: readonly Permission[],
  ) {
    Object.freeze(this);
  }

  static create(id: RoleId, code: RoleCode, permissions: readonly Permission[]): Role {
    return new Role(
      roleId(id),
      roleCode(code),
      Object.freeze([...new Set(permissions.map(permission))]),
    );
  }
}
