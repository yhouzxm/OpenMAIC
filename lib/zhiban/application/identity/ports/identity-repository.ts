import type {
  SystemAdminGrant,
  SystemAdminGrantId,
  User,
  UserId,
} from '@/lib/zhiban/domain/identity';
import type { Loaded, RepositoryRevision } from './repository-types';

/** Restricted global identity/control-plane access; never a tenant-owned data fallback. */
export interface IdentityRepositoryPort {
  findById(id: UserId): Promise<Loaded<User> | null>;
  create(user: User): Promise<Loaded<User>>;
  /** Check expected revision before immutable/lifecycle validation and full-state comparison.
   * TRUE_NO_OP returns current stored Loaded unchanged; a legal change advances this row once.
   * Absent saves fail with CONFLICT; mismatching revisions fail with STALE_WRITE.
   */
  save(user: User, expectedRevision: RepositoryRevision): Promise<Loaded<User>>;
  findSystemAdminGrant(id: SystemAdminGrantId): Promise<Loaded<SystemAdminGrant> | null>;
  createSystemAdminGrant(grant: SystemAdminGrant): Promise<Loaded<SystemAdminGrant>>;
  /** Same CAS/no-op contract as User; only first revocation may change immutable grant history. */
  saveSystemAdminGrant(
    grant: SystemAdminGrant,
    expectedRevision: RepositoryRevision,
  ): Promise<Loaded<SystemAdminGrant>>;
}
