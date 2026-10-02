import {
  assertAuthenticSystemAdminGrantForPersistence,
  type SystemAdminGrant,
} from '@/lib/zhiban/domain/identity/system-admin-grant';
import { systemAdminGrantId, type SystemAdminGrantId } from '@/lib/zhiban/domain/identity/ids';
import type { IdentityRepositoryPort } from '@/lib/zhiban/application/identity/ports/identity-repository';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import type { RepositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import {
  systemAdminGrantFromRow,
  systemAdminGrantToRow,
  type SystemAdminGrantRow,
} from '../mappers/system-admin-grant';
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
  'grant_id, user_id, created_at, valid_from, valid_until, revoked_at, repository_revision';
const select = `SELECT ${columns} FROM zhiban_identity.system_admin_grants WHERE grant_id = $1`;
const insert = `INSERT INTO zhiban_identity.system_admin_grants (${columns}) VALUES ($1, $2, $3, $4, $5, $6, 1) RETURNING ${columns}`;
const update = `UPDATE zhiban_identity.system_admin_grants SET revoked_at = $1, repository_revision = repository_revision + 1 WHERE grant_id = $2 AND repository_revision = $3::bigint RETURNING ${columns}`;

function sameImmutable(a: SystemAdminGrant, b: SystemAdminGrant): boolean {
  return (
    a.id === b.id &&
    a.userId === b.userId &&
    a.createdAt === b.createdAt &&
    a.validFrom === b.validFrom &&
    a.validUntil === b.validUntil
  );
}
function same(a: SystemAdminGrant, b: SystemAdminGrant): boolean {
  return sameImmutable(a, b) && a.revokedAt === b.revokedAt;
}
function candidateRow(value: SystemAdminGrant) {
  const row = systemAdminGrantToRow(value);
  systemAdminGrantFromRow({
    grant_id: row.grant_id,
    user_id: row.user_id,
    created_at: row.created_at,
    valid_from: row.valid_from,
    valid_until: row.valid_until,
    revoked_at: row.revoked_at,
    repository_revision: '1',
  });
  return row;
}

/** Isolated control persistence adapter; audited use cases require later same-client composition. */
export class PostgresSystemAdminGrantRepository implements Pick<
  IdentityRepositoryPort,
  'findSystemAdminGrant' | 'createSystemAdminGrant' | 'saveSystemAdminGrant'
> {
  constructor(private readonly pool: TransactionPool) {}

  findSystemAdminGrant(id: SystemAdminGrantId) {
    return atPortBoundary(async () => {
      systemAdminGrantId(id);
      return controlTransaction(this.pool, async (client) => {
        const row = oneRow(await client.query<SystemAdminGrantRow>(select, [id]), 'SELECT', true);
        if (!row) return null;
        const loaded = systemAdminGrantFromRow(row);
        integrity(loaded.value.id === id);
        return loaded;
      });
    });
  }

  createSystemAdminGrant(candidate: SystemAdminGrant) {
    return atPortBoundary(async () => {
      assertAuthenticSystemAdminGrantForPersistence(candidate);
      const row = candidateRow(candidate);
      return controlTransaction(this.pool, async (client) => {
        const returned = oneRow(
          await client.query<SystemAdminGrantRow>(insert, [
            row.grant_id,
            row.user_id,
            row.created_at,
            row.valid_from,
            row.valid_until,
            row.revoked_at,
          ]),
          'INSERT',
        );
        integrity(returned !== null);
        const loaded = systemAdminGrantFromRow(returned);
        integrity(loaded.revision === '1' && same(loaded.value, candidate));
        return loaded;
      });
    }, ['system_admin_grants_pkey']);
  }

  saveSystemAdminGrant(candidate: SystemAdminGrant, revision: RepositoryRevision) {
    return atPortBoundary(async () => {
      assertAuthenticSystemAdminGrantForPersistence(candidate);
      // Validate syntax before SQL, but decide stale only against the locked row.
      validateRevision(revision);
      return controlTransaction(this.pool, async (client) => {
        const row = oneRow(
          await client.query<SystemAdminGrantRow>(select + ' FOR UPDATE', [candidate.id]),
          'SELECT',
          true,
        );
        if (!row) throw new IdentityPortError('CONFLICT');
        const current = systemAdminGrantFromRow(row);
        expectedRevision(current.revision, revision);
        integrity(
          sameImmutable(current.value, candidate) &&
            (current.value.revokedAt === null || current.value.revokedAt === candidate.revokedAt),
        );
        const write = candidateRow(candidate);
        if (same(current.value, candidate)) return current;
        const next = nextRevision(current.revision);
        const returned = oneRow(
          await client.query<SystemAdminGrantRow>(update, [
            write.revoked_at,
            candidate.id,
            revision,
          ]),
          'UPDATE',
        );
        integrity(returned !== null);
        const loaded = systemAdminGrantFromRow(returned);
        integrity(loaded.revision === next && same(loaded.value, candidate));
        return loaded;
      });
    });
  }
}
