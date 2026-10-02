import {
  assertAuthenticTenantForPersistence,
  type Tenant,
} from '@/lib/zhiban/domain/identity/tenant';
import { tenantId, type TenantId } from '@/lib/zhiban/domain/identity/ids';
import type { TenantRepositoryPort } from '@/lib/zhiban/application/identity/ports/tenant-repository';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import type { RepositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { tenantFromRow, tenantToRow, type TenantRow } from '../mappers/tenant';
import { checkedText } from '../mappers/checked-values';
import { controlTransaction, type TransactionPool } from '../transactions';
import {
  atPortBoundary,
  expectedRevision,
  integrity,
  nextRevision,
  oneRow,
  validateRevision,
} from './repository-support';

const columns =
  'tenant_id, code, display_name, status, created_at, updated_at, disabled_at, disabled_reason, repository_revision';
const selectId = `SELECT ${columns} FROM zhiban_identity.tenants WHERE tenant_id = $1`;
const selectCode = `SELECT ${columns} FROM zhiban_identity.tenants WHERE code = $1`;
const insert = `INSERT INTO zhiban_identity.tenants (${columns}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1) RETURNING ${columns}`;
const update = `UPDATE zhiban_identity.tenants SET status = $1, updated_at = $2, disabled_at = $3, disabled_reason = $4, repository_revision = repository_revision + 1 WHERE tenant_id = $5 AND repository_revision = $6::bigint RETURNING ${columns}`;

function same(a: Tenant, b: Tenant): boolean {
  return (
    a.id === b.id &&
    a.code === b.code &&
    a.displayName === b.displayName &&
    a.status === b.status &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt &&
    a.disabledAt === b.disabledAt &&
    a.disabledReason === b.disabledReason
  );
}
function candidateRow(value: Tenant) {
  const row = tenantToRow(value);
  tenantFromRow({
    tenant_id: row.tenant_id,
    code: row.code,
    display_name: row.display_name,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    disabled_at: row.disabled_at,
    disabled_reason: row.disabled_reason,
    repository_revision: '1',
  });
  return row;
}

/** Supply only a restricted control-runtime pool, not a tenant/owner connection. */
export class PostgresTenantRepository implements TenantRepositoryPort {
  constructor(private readonly pool: TransactionPool) {}
  findById(id: TenantId) {
    return atPortBoundary(async () => {
      tenantId(id);
      return controlTransaction(this.pool, async (client) => {
        const row = oneRow(await client.query<TenantRow>(selectId, [id]), 'SELECT', true);
        if (!row) return null;
        const loaded = tenantFromRow(row);
        integrity(loaded.value.id === id);
        return loaded;
      });
    });
  }
  findByCode(code: string) {
    return atPortBoundary(async () => {
      checkedText(code);
      return controlTransaction(this.pool, async (client) => {
        const row = oneRow(await client.query<TenantRow>(selectCode, [code]), 'SELECT', true);
        if (!row) return null;
        const loaded = tenantFromRow(row);
        integrity(loaded.value.code === code);
        return loaded;
      });
    });
  }
  create(candidate: Tenant) {
    return atPortBoundary(async () => {
      assertAuthenticTenantForPersistence(candidate);
      const row = candidateRow(candidate);
      return controlTransaction(this.pool, async (client) => {
        const returned = oneRow(
          await client.query<TenantRow>(insert, [
            row.tenant_id,
            row.code,
            row.display_name,
            row.status,
            row.created_at,
            row.updated_at,
            row.disabled_at,
            row.disabled_reason,
          ]),
          'INSERT',
        );
        integrity(returned !== null);
        const loaded = tenantFromRow(returned);
        integrity(loaded.revision === '1' && same(loaded.value, candidate));
        return loaded;
      });
    }, ['tenants_pkey', 'tenants_code_key']);
  }
  save(candidate: Tenant, revision: RepositoryRevision) {
    return atPortBoundary(async () => {
      assertAuthenticTenantForPersistence(candidate);
      validateRevision(revision);
      return controlTransaction(this.pool, async (client) => {
        const row = oneRow(
          await client.query<TenantRow>(selectId + ' FOR UPDATE', [candidate.id]),
          'SELECT',
          true,
        );
        if (!row) throw new IdentityPortError('CONFLICT');
        const current = tenantFromRow(row);
        expectedRevision(current.revision, revision);
        integrity(
          candidate.id === current.value.id &&
            candidate.createdAt === current.value.createdAt &&
            candidate.code === current.value.code &&
            candidate.displayName === current.value.displayName &&
            candidate.updatedAt >= current.value.updatedAt &&
            (current.value.status !== 'ARCHIVED' || same(current.value, candidate)),
        );
        const write = candidateRow(candidate);
        if (same(current.value, candidate)) return current;
        const next = nextRevision(current.revision);
        const returned = oneRow(
          await client.query<TenantRow>(update, [
            write.status,
            write.updated_at,
            write.disabled_at,
            write.disabled_reason,
            candidate.id,
            revision,
          ]),
          'UPDATE',
        );
        integrity(returned !== null);
        const loaded = tenantFromRow(returned);
        integrity(loaded.revision === next && same(loaded.value, candidate));
        return loaded;
      });
    });
  }
}
