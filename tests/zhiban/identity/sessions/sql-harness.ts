import { vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import type { SessionRow } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/session-records';
export const uid = '018f0000-0000-7000-8000-000000009001';
export const cid = '018f0000-0000-7000-8000-000000009002';
/** Deterministic SQL unit adapter, NOT real PostgreSQL concurrency/ACL evidence. */
export function sessionSqlHarness() {
  let rows: SessionRow[] = [],
    audit: unknown[][] = [];
  let saved: { rows: SessionRow[]; audit: unknown[][] };
  const user = {
    user_id: uid,
    status: 'ACTIVE',
    created_at: '1000',
    updated_at: '1000',
    disabled_at: null as string | null,
    disabled_reason: null as string | null,
    repository_revision: '1',
  };
  const slot = {
    user_id: uid,
    active_credential_id: cid as string | null,
    repository_revision: '1',
    security_epoch: '1',
  };
  const calls: { sql: string; values: unknown[] }[] = [],
    fail = new Map<string, unknown>();
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    for (const [prefix, error] of fail) if (sql.startsWith(prefix)) throw error;
    const command = sql.split(' ')[0],
      result = (data: unknown[] = [], count = data.length) => ({
        command,
        rows: data,
        rowCount: count,
      });
    if (command === 'BEGIN') {
      saved = structuredClone({ rows, audit });
      return result();
    }
    if (command === 'ROLLBACK') {
      ({ rows, audit } = saved);
      return result();
    }
    if (command === 'COMMIT') return result();
    if (sql.startsWith('SELECT pg_advisory')) return result([{}]);
    if (command === 'SELECT') {
      if (sql.includes('FROM zhiban_identity.users'))
        return result(user.user_id === values[0] ? [{ ...user }] : []);
      if (sql.includes('FROM zhiban_identity.credential_slots'))
        return result(slot.user_id === values[0] ? [{ ...slot }] : []);
      if (sql.includes('FROM zhiban_identity.sessions'))
        return result(
          rows
            .filter((row) =>
              sql.includes('WHERE token_digest')
                ? row.token_digest === values[0]
                : sql.includes('WHERE session_id')
                  ? row.session_id === values[0]
                  : row.user_id === values[0] && row.revoked_at === null,
            )
            .map((row) => ({ ...row })),
        );
    }
    if (sql.startsWith('INSERT INTO zhiban_identity.sessions')) {
      if (rows.some((row) => row.session_id === values[0] || row.token_digest === values[2]))
        throw { code: '23505', constraint: 'sessions_pkey' };
      const row: SessionRow = {
        session_id: String(values[0]),
        user_id: String(values[1]),
        token_digest: String(values[2]),
        created_at: String(values[3]),
        last_seen_at: String(values[4]),
        absolute_expires_at: String(values[5]),
        idle_expires_at: String(values[6]),
        revoked_at: null,
        repository_revision: '1',
        security_epoch: String(values[7]),
        user_revision: String(values[8]),
      };
      rows.push(row);
      return result([{ ...row }]);
    }
    if (sql.startsWith('UPDATE zhiban_identity.sessions SET last_seen_at')) {
      const row = rows.find(
        (row) =>
          row.session_id === values[2] &&
          row.repository_revision === values[3] &&
          row.revoked_at === null,
      );
      if (!row) return result();
      Object.assign(row, {
        last_seen_at: String(values[0]),
        idle_expires_at: String(values[1]),
        repository_revision: (BigInt(row.repository_revision) + BigInt(1)).toString(),
      });
      return result([{ ...row }]);
    }
    if (sql.startsWith('UPDATE zhiban_identity.sessions SET revoked_at')) {
      const row = rows.find(
        (row) =>
          row.session_id === values[1] &&
          row.repository_revision === values[2] &&
          row.revoked_at === null,
      );
      if (!row) return result();
      Object.assign(row, {
        revoked_at: String(values[0]),
        repository_revision: (BigInt(row.repository_revision) + BigInt(1)).toString(),
      });
      return result([], 1);
    }
    if (sql.startsWith('INSERT INTO zhiban_identity.audit_events')) {
      audit.push([...values]);
      return result([], 1);
    }
    throw new Error('Unexpected Session SQL');
  });
  const release = vi.fn();
  const pool: TransactionPool = {
    connect: vi.fn(async () => ({ query: query as unknown as PoolClient['query'], release })),
  };
  return {
    pool,
    calls,
    fail,
    release,
    user,
    slot,
    state: () => structuredClone({ rows, audit }),
    edit: (work: (rows: SessionRow[]) => void) => work(rows),
  };
}
