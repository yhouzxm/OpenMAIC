import { initialIdentityMigration, type ZhibanMigration } from './001-initial-identity';

export const ZHIBAN_MIGRATIONS: readonly ZhibanMigration[] = [initialIdentityMigration];

export type { ZhibanMigration } from './001-initial-identity';
