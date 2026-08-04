import type { AuthenticatedAccount } from '@/lib/zhiban/auth/types';

export type PermissionCode =
  | 'account:read'
  | 'account:manage'
  | 'course:read'
  | 'course:manage'
  | 'grade:read'
  | 'grade:publish'
  | 'risk:read'
  | 'risk:handle'
  | 'audit:read'
  | 'research:export';

export interface AuthorizedPrincipal extends AuthenticatedAccount {
  roles: string[];
  permissions: PermissionCode[];
}

export interface ManagedRoleAssignment {
  id: string;
  roleCode: string;
  roleName: string;
  scopeType: string;
  scopeId: string | null;
}

export interface ManagedAccount {
  id: string;
  loginName: string;
  displayName: string;
  accountType: string;
  status: string;
  identifier: string | null;
  mobileLast4: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  roles: ManagedRoleAssignment[];
}
