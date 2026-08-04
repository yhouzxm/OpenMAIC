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

export type DataScopeType = 'self' | 'project_group' | 'class' | 'course' | 'tenant' | 'system';

export interface ScopedGrant {
  roleCode: string;
  permission: PermissionCode;
  scopeType: DataScopeType;
  scopeId: string | null;
}

export interface ResourceScopeContext {
  ownerAccountId?: string;
  projectGroupIds?: string[];
  classIds?: string[];
  courseIds?: string[];
}

export interface AuthorizedPrincipal extends AuthenticatedAccount {
  roles: string[];
  permissions: PermissionCode[];
  grants: ScopedGrant[];
}

export interface AuthorizationScope {
  id: string;
  scopeType: Extract<DataScopeType, 'project_group' | 'class' | 'course'>;
  code: string;
  name: string;
  externalRef: string | null;
  status: 'active' | 'archived';
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
