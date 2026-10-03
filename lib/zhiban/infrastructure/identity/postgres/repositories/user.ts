import { assertAuthenticUserForPersistence, type User } from '@/lib/zhiban/domain/identity/user';
import { userId, type UserId, type SystemAdminGrantId } from '@/lib/zhiban/domain/identity/ids';
import type { SystemAdminGrant } from '@/lib/zhiban/domain/identity/system-admin-grant';
import type { IdentityRepositoryPort } from '@/lib/zhiban/application/identity/ports/identity-repository';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import type { RepositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { userFromRow, userToRow, type UserRow } from '../mappers/user';
import { controlTransaction, type TransactionPool } from '../transactions';
import { PostgresSystemAdminGrantRepository } from './system-admin-grant';
import {
  atPortBoundary,
  expectedRevision,
  integrity,
  nextRevision,
  oneRow,
  validateRevision,
} from './repository-support';

const columns =
  'user_id, status, created_at, updated_at, disabled_at, disabled_reason, repository_revision';
const select = `SELECT ${columns} FROM zhiban_identity.users WHERE user_id = $1`;
const insert = `INSERT INTO zhiban_identity.users (${columns}) VALUES ($1, $2, $3, $4, $5, $6, 1) RETURNING ${columns}`;
const update = `UPDATE zhiban_identity.users SET status = $1, updated_at = $2, disabled_at = $3, disabled_reason = $4, repository_revision = repository_revision + 1 WHERE user_id = $5 AND repository_revision = $6::bigint RETURNING ${columns}`;

/** Exact client-bound collaborator, not a public transaction API or hydration capability. */
export async function loadUserOnClient(
  client: Pick<import('pg').PoolClient, 'query'>,
  id: UserId,
  lock: 'SHARE' | 'UPDATE' | null = null,
) {
  userId(id);
  const row = oneRow(
    await client.query<UserRow>(select + (lock === null ? '' : ` FOR ${lock}`), [id]),
    'SELECT',
    true,
  );
  if (row === null) return null;
  const loaded = userFromRow(row);
  integrity(loaded.value.id === id);
  return loaded;
}
export async function writeUserOnClient(
  client: Pick<import('pg').PoolClient, 'query'>,
  candidate: User,
  revision: RepositoryRevision | null,
) {
  assertAuthenticUserForPersistence(candidate);
  const write = candidateRow(candidate);
  if (revision === null) {
    const row = oneRow(
      await client.query<UserRow>(insert, [
        write.user_id,
        write.status,
        write.created_at,
        write.updated_at,
        write.disabled_at,
        write.disabled_reason,
      ]),
      'INSERT',
    );
    integrity(row !== null);
    const loaded = userFromRow(row);
    integrity(loaded.revision === '1' && same(loaded.value, candidate));
    return loaded;
  }
  const current = await loadUserOnClient(client, candidate.id, 'UPDATE');
  integrity(current !== null);
  expectedRevision(current.revision, revision);
  integrity(
    candidate.createdAt === current.value.createdAt &&
      candidate.updatedAt >= current.value.updatedAt,
  );
  if (same(candidate, current.value)) return current;
  const next = nextRevision(revision),
    row = oneRow(
      await client.query<UserRow>(update, [
        write.status,
        write.updated_at,
        write.disabled_at,
        write.disabled_reason,
        candidate.id,
        revision,
      ]),
      'UPDATE',
    );
  integrity(row !== null);
  const loaded = userFromRow(row);
  integrity(loaded.revision === next && same(loaded.value, candidate));
  return loaded;
}

function same(a: User, b: User): boolean {
  return (
    a.id === b.id &&
    a.status === b.status &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt &&
    a.disabledAt === b.disabledAt &&
    a.disabledReason === b.disabledReason
  );
}
function candidateRow(value: User) {
  const row = userToRow(value);
  userFromRow({
    user_id: row.user_id,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    disabled_at: row.disabled_at,
    disabled_reason: row.disabled_reason,
    repository_revision: '1',
  });
  return row;
}

/** User adapter plus the grant methods required by the frozen IdentityRepositoryPort. */
export class PostgresIdentityRepository implements IdentityRepositoryPort {
  private readonly grants: PostgresSystemAdminGrantRepository;
  constructor(private readonly pool: TransactionPool) {
    this.grants = new PostgresSystemAdminGrantRepository(pool);
  }

  findById(id: UserId) {
    return atPortBoundary(async () => {
      userId(id);
      return controlTransaction(this.pool, async (client) => {
        const row = oneRow(await client.query<UserRow>(select, [id]), 'SELECT', true);
        if (!row) return null;
        const loaded = userFromRow(row);
        integrity(loaded.value.id === id);
        return loaded;
      });
    });
  }
  create(candidate: User) {
    return atPortBoundary(async () => {
      assertAuthenticUserForPersistence(candidate);
      const row = candidateRow(candidate);
      return controlTransaction(this.pool, async (client) => {
        const returned = oneRow(
          await client.query<UserRow>(insert, [
            row.user_id,
            row.status,
            row.created_at,
            row.updated_at,
            row.disabled_at,
            row.disabled_reason,
          ]),
          'INSERT',
        );
        integrity(returned !== null);
        const loaded = userFromRow(returned);
        integrity(loaded.revision === '1' && same(loaded.value, candidate));
        return loaded;
      });
    }, ['users_pkey']);
  }
  save(candidate: User, revision: RepositoryRevision) {
    return atPortBoundary(async () => {
      assertAuthenticUserForPersistence(candidate);
      validateRevision(revision);
      return controlTransaction(this.pool, async (client) => {
        const row = oneRow(
          await client.query<UserRow>(select + ' FOR UPDATE', [candidate.id]),
          'SELECT',
          true,
        );
        if (!row) throw new IdentityPortError('CONFLICT');
        const current = userFromRow(row);
        expectedRevision(current.revision, revision);
        integrity(
          candidate.id === current.value.id &&
            candidate.createdAt === current.value.createdAt &&
            candidate.updatedAt >= current.value.updatedAt,
        );
        const write = candidateRow(candidate);
        if (same(current.value, candidate)) return current;
        const next = nextRevision(current.revision);
        const returned = oneRow(
          await client.query<UserRow>(update, [
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
        const loaded = userFromRow(returned);
        integrity(loaded.revision === next && same(loaded.value, candidate));
        return loaded;
      });
    });
  }
  findSystemAdminGrant(id: SystemAdminGrantId) {
    return this.grants.findSystemAdminGrant(id);
  }
  createSystemAdminGrant(value: SystemAdminGrant) {
    return this.grants.createSystemAdminGrant(value);
  }
  saveSystemAdminGrant(value: SystemAdminGrant, revision: RepositoryRevision) {
    return this.grants.saveSystemAdminGrant(value, revision);
  }
}
