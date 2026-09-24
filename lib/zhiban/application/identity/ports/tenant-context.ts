import { tenantId, type TenantId } from '@/lib/zhiban/domain/identity';
import { IdentityPortError } from './errors';

declare const tenantContextBrand: unique symbol;
export type TenantContext = Readonly<{
  tenantId: TenantId;
  [tenantContextBrand]: true;
}>;

/** A tenant scoping value, not proof of User, Tenant, Membership or Permission state. */
export function tenantScopeContext(id: TenantId): TenantContext {
  return Object.freeze({ tenantId: tenantId(id) }) as TenantContext;
}

/** Rejects absent or malformed scope. Protected use cases must authorize before calling a repository. */
export function requireTenantContext(context: TenantContext): TenantId {
  if (typeof context !== 'object' || context === null || !Object.hasOwn(context, 'tenantId')) {
    throw new IdentityPortError('TENANT_SCOPE_VIOLATION');
  }
  try {
    return tenantId(context.tenantId);
  } catch {
    throw new IdentityPortError('TENANT_SCOPE_VIOLATION');
  }
}
