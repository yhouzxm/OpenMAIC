import { initialIdentityMigration, type ZhibanMigration } from './001-initial-identity';
import { localAuthMigration } from './002-local-auth';
import { defaultRbacMigration } from './003-default-rbac';

export const ZHIBAN_MIGRATIONS: readonly ZhibanMigration[] = [
  initialIdentityMigration,
  localAuthMigration,
  defaultRbacMigration,
];

export type { ZhibanMigration } from './001-initial-identity';
