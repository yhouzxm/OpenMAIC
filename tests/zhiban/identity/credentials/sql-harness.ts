import { vi } from 'vitest';
import type { PoolClient } from 'pg';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import type { CredentialRow, SlotRow } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential-records';

/** SQL unit adapter only, NOT PG16 evidence. Tests independently assert exact SQL/parameters. */
export function credentialSqlHarness() {
  let slot: SlotRow | null = null, rows: CredentialRow[] = [], audit: unknown[][] = [];
  let userActive = true;
  let saved: { slot: SlotRow | null; rows: CredentialRow[]; audit: unknown[][] };
  const calls: { sql: string; values: unknown[] }[] = [];
  const fail = new Map<string, unknown>();
  let override: { command: string; rowCount: number | null; rows: unknown[] } | undefined;
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    for (const [pattern, error] of fail) if (sql.startsWith(pattern)) throw error;
    const command = sql.split(' ')[0];
    const result = (data: unknown[] = [], count = data.length) => ({ command, rows: data, rowCount: count });
    if (command === 'BEGIN') { saved = structuredClone({ slot, rows, audit }); return result(); }
    if (command === 'ROLLBACK') { ({ slot, rows, audit } = saved); return result(); }
    if (command === 'COMMIT') return result();
    if (command === 'SELECT') {
      if (sql.includes('FROM zhiban_identity.credential_slots')) return result(slot && slot.user_id === values[0] ? [{ ...slot }] : []);
      if (sql.includes('FROM zhiban_identity.credentials')) return result(rows.filter(row => row.user_id === values[0]).map(row => ({ ...row })));
      if (sql.includes('FROM zhiban_identity.users')) return result([{ user_id: values[0], status: userActive ? 'ACTIVE' : 'DISABLED', created_at: '1000', updated_at: userActive ? '1000' : '2000', disabled_at: userActive ? null : '2000', disabled_reason: userActive ? null : 'security-test', repository_revision: userActive ? '1' : '2' }]);
    }
    if (sql.startsWith('INSERT INTO zhiban_identity.credential_slots')) {
      if (slot) throw { code: '23505', constraint: 'credential_slots_pkey' };
      slot = { user_id: String(values[0]), credential_type: 'PASSWORD', active_credential_id: String(values[1]), generation: '1', repository_revision: '1', security_epoch: '1', created_at: String(values[2]), updated_at: String(values[2]) }; return result([], 1);
    }
    if (sql.startsWith('INSERT INTO zhiban_identity.credentials')) {
      rows.push({ credential_id: String(values[0]), user_id: String(values[1]), credential_type: 'PASSWORD', generation: String(values[2]), status: 'ACTIVE', slot_revision: String(values[3]), verifier_material: String(values[4]), created_at: String(values[5]), updated_at: String(values[5]), replaced_at: null, revoked_at: null, replaced_by_credential_id: null }); return result([], 1);
    }
    if (sql.startsWith('UPDATE zhiban_identity.credential_slots')) {
      if (override) return override;
      if (!slot || slot.user_id !== values[4] || slot.repository_revision !== values[5]) return result();
      slot = { ...slot, active_credential_id: values[0] as string | null, generation: String(values[1]), repository_revision: (BigInt(slot.repository_revision) + BigInt(1)).toString(), security_epoch: String(values[2]), updated_at: String(values[3]) }; return result([{ ...slot }]);
    }
    if (sql.startsWith('UPDATE zhiban_identity.credentials SET status')) {
      let count = 0;
      rows = rows.map(row => {
        if (row.user_id !== values[6] || row.credential_id !== values[7] || row.status !== 'ACTIVE') return row;
        count++; return { ...row, status: String(values[0]), verifier_material: null, slot_revision: String(values[1]), updated_at: String(values[2]), replaced_at: values[3] as string | null, revoked_at: values[4] as string | null, replaced_by_credential_id: values[5] as string | null };
      }); return result([], count);
    }
    if (sql.startsWith('UPDATE zhiban_identity.credentials SET verifier_material')) {
      let count = 0;
      rows = rows.map(row => {
        if (row.user_id !== values[3] || row.credential_id !== values[4] || row.status !== 'ACTIVE') return row;
        count++; return { ...row, verifier_material: String(values[0]), slot_revision: String(values[1]), updated_at: String(values[2]) };
      }); return result([], count);
    }
    if (sql.startsWith('INSERT INTO zhiban_identity.audit_events')) { audit.push([...values]); return result([], 1); }
    throw new Error('Unexpected SQL in credential test adapter');
  });
  const release = vi.fn();
  const pool: TransactionPool = { connect: vi.fn(async () => ({ query: query as unknown as PoolClient['query'], release })) };
  return { pool, calls, fail, release, disableUser: () => { userActive = false; }, override: (value: typeof override) => { override = value; }, state: () => structuredClone({ slot, rows, audit }), seed: (value: { slot: SlotRow | null; rows: CredentialRow[] }) => { slot = value.slot; rows = value.rows; } };
}
