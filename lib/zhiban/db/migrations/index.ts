import { initialIdentityMigration, type ZhibanMigration } from './001-initial-identity';
import { localAuthMigration } from './002-local-auth';
import { defaultRbacMigration } from './003-default-rbac';
import { rbacDataScopesMigration } from './004-rbac-data-scopes';

export const ZHIBAN_MIGRATIONS: readonly ZhibanMigration[] = [
  initialIdentityMigration,
  localAuthMigration,
  defaultRbacMigration,
  rbacDataScopesMigration,
];

export type { ZhibanMigration } from './001-initial-identity';
