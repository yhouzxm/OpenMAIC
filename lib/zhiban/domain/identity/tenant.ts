import { invariant, nonBlank } from './errors';
import { tenantId, type TenantId } from './ids';
import { atOrAfter, instant, type Instant } from './time';

export type TenantStatus = 'ACTIVE' | 'DISABLED' | 'ARCHIVED';

export class Tenant {
  private constructor(
    public readonly id: TenantId,
    public readonly code: string,
    public readonly displayName: string,
    public readonly status: TenantStatus,
    public readonly createdAt: Instant,
    public readonly updatedAt: Instant,
    public readonly disabledAt: Instant | null,
    public readonly disabledReason: string | null,
  ) {
    Object.freeze(this);
  }

  static create(id: TenantId, code: string, displayName: string, now: Instant): Tenant {
    invariant(
      typeof code === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(code),
      'INVALID_ENTITY',
      'Invalid tenant code.',
    );
    return new Tenant(
      tenantId(id),
      code,
      nonBlank(displayName),
      'ACTIVE',
      instant(now),
      now,
      null,
      null,
    );
  }
  disable(now: Instant, reason: string): Tenant {
    invariant(
      this.status === 'ACTIVE',
      'INVALID_STATE_TRANSITION',
      'Only an active tenant can be disabled.',
    );
    return new Tenant(
      this.id,
      this.code,
      this.displayName,
      'DISABLED',
      this.createdAt,
      atOrAfter(now, this.updatedAt),
      now,
      nonBlank(reason),
    );
  }
  restore(now: Instant): Tenant {
    invariant(
      this.status === 'DISABLED',
      'INVALID_STATE_TRANSITION',
      'Only a disabled tenant can be restored.',
    );
    return new Tenant(
      this.id,
      this.code,
      this.displayName,
      'ACTIVE',
      this.createdAt,
      atOrAfter(now, this.updatedAt),
      null,
      null,
    );
  }
  archive(now: Instant): Tenant {
    invariant(
      this.status !== 'ARCHIVED',
      'INVALID_STATE_TRANSITION',
      'Tenant is already archived.',
    );
    return new Tenant(
      this.id,
      this.code,
      this.displayName,
      'ARCHIVED',
      this.createdAt,
      atOrAfter(now, this.updatedAt),
      this.disabledAt,
      this.disabledReason,
    );
  }
}
