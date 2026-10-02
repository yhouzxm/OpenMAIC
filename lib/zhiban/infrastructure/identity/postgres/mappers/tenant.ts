import type { Tenant } from '@/lib/zhiban/domain/identity/tenant';
import { tenantId } from '@/lib/zhiban/domain/identity/ids';
import { instant } from '@/lib/zhiban/domain/identity/time';
import { rehydrateTenantForPersistence } from '@/lib/zhiban/domain/identity/persistence-rehydration';
import { repositoryRevision, type Loaded } from '@/lib/zhiban/application/identity/ports/repository-types';
import { checkRow, checkedInteger, checkedText, checkedNullableText, instantMaximum } from './checked-values';

export interface TenantRow {
  readonly tenant_id: string;
  readonly code: string;
  readonly display_name: string;
  readonly status: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly disabled_at: string | null;
  readonly disabled_reason: string | null;
  readonly repository_revision: string;
}

function epoch(value: unknown) {
  return instant(Number(checkedInteger(value, instantMaximum)));
}

export function tenantFromRow(row: TenantRow): Loaded<Tenant> {
  const _checked = checkRow(row,
    ['tenant_id', 'code', 'display_name', 'status', 'created_at', 'updated_at', 'disabled_at', 'disabled_reason', 'repository_revision'],
    ['disabled_at', 'disabled_reason']);
  const snapshot = {
    id: tenantId(row.tenant_id), code: row.code, displayName: row.display_name, status: row.status,
    createdAt: epoch(row.created_at), updatedAt: epoch(row.updated_at),
    disabledAt: row.disabled_at === null ? null : epoch(row.disabled_at),
    disabledReason: row.disabled_reason,
  };
  const value = rehydrateTenantForPersistence(snapshot);
  const revision = repositoryRevision(row.repository_revision);
  return { value, revision };
}

export function tenantToRow(value: Tenant): Omit<TenantRow, 'repository_revision'> {
  return {
    tenant_id: value.id, code: value.code, display_name: checkedText(value.displayName), status: value.status,
    created_at: value.createdAt.toString(), updated_at: value.updatedAt.toString(),
    disabled_at: value.disabledAt === null ? null : value.disabledAt.toString(),
    disabled_reason: checkedNullableText(value.disabledReason),
  };
}
