import type { Tenant, TenantId } from '@/lib/zhiban/domain/identity';
import type { Loaded, RepositoryRevision } from './repository-types';

/** Tenant administration is separately authorized; this port has no membership collection. */
export interface TenantRepositoryPort {
  findById(id: TenantId): Promise<Loaded<Tenant> | null>;
  findByCode(code: string): Promise<Loaded<Tenant> | null>;
  create(tenant: Tenant): Promise<Loaded<Tenant>>;
  /** Check expected revision before immutable/lifecycle validation and complete state comparison.
   * TRUE_NO_OP returns current stored Loaded and unchanged revision; a legal change advances
   * this row once. Absent saves fail with CONFLICT; stale revisions fail with STALE_WRITE.
   */
  save(tenant: Tenant, expectedRevision: RepositoryRevision): Promise<Loaded<Tenant>>;
}
