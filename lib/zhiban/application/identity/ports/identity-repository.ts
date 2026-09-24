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
  save(user: User, expectedRevision: RepositoryRevision): Promise<Loaded<User>>;
  findSystemAdminGrant(id: SystemAdminGrantId): Promise<Loaded<SystemAdminGrant> | null>;
  createSystemAdminGrant(grant: SystemAdminGrant): Promise<Loaded<SystemAdminGrant>>;
  saveSystemAdminGrant(
    grant: SystemAdminGrant,
    expectedRevision: RepositoryRevision,
  ): Promise<Loaded<SystemAdminGrant>>;
}
