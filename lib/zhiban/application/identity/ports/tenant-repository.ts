import type { Tenant, TenantId } from '@/lib/zhiban/domain/identity';
import type { Loaded, RepositoryRevision } from './repository-types';

/** Tenant administration is separately authorized; this port has no membership collection. */
export interface TenantRepositoryPort {
  findById(id: TenantId): Promise<Loaded<Tenant> | null>;
  findByCode(code: string): Promise<Loaded<Tenant> | null>;
  create(tenant: Tenant): Promise<Loaded<Tenant>>;
  save(tenant: Tenant, expectedRevision: RepositoryRevision): Promise<Loaded<Tenant>>;
}
