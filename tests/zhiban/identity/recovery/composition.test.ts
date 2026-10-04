import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { ManualRecovery } from '@/lib/zhiban/infrastructure/identity/recovery/composition';
import type {
  RecoverySecurity,
  RecoveryProof,
} from '@/lib/zhiban/infrastructure/identity/recovery/security';
import { RecoveryRegistry } from '@/lib/zhiban/infrastructure/identity/recovery/registry';
import {
  caseColumns,
  caseRecord,
  ticketRecord,
} from '@/lib/zhiban/infrastructure/identity/recovery/records';
import { RecoveryError } from '@/lib/zhiban/infrastructure/identity/recovery/values';
import { budgets, ids, signedStore } from './fixtures';
function registered() {
  const at = Date.now() - 1000,
    c: Record<string, string | null> = Object.fromEntries(caseColumns.map((k) => [k, null]));
  for (const key of caseColumns) {
    if (key.endsWith('_revision') || key.endsWith('_epoch') || key === 'expected_generation')
      c[key] = '1';
    if (key.endsWith('_id')) c[key] = ids.nextCommandId();
  }
  Object.assign(c, {
    environment_ref: 'synthetic',
    site_ref: 'site-a',
    registration_manifest_digest: 'a'.repeat(64),
    registration_key_ref: 'synthetic-key',
    approval_ref: 'synthetic-approval',
    intent: 'REPLACE_ACTIVE_PASSWORD',
    security_clearance_ref: null,
    state: 'REGISTERED',
    repository_revision: '1',
    ticket_generation: '0',
    created_at: at.toString(),
    registered_expires_at: (at + 3600000).toString(),
    enrollment_kind: 'ENROLLMENT',
    appointment_kind: 'APPOINTMENT',
    contact_kind: 'CONTACT',
  });
  return c;
}
function sqlFixture(enabled = false) {
  let c = registered(),
    saved = { ...c };
  const calls: { sql: string; params: unknown[] }[] = [],
    events: unknown[][] = [];
  let fail: string | undefined,
    commit = 'COMMIT';
  const release = vi.fn();
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (fail && sql.startsWith(fail)) throw new Error('Synthetic SQL failure');
    const command = sql.split(' ')[0],
      result = (rows: unknown[] = [], count = rows.length) => ({ command, rowCount: count, rows });
    if (command === 'BEGIN') {
      saved = { ...c };
      return result();
    }
    if (command === 'ROLLBACK') {
      c = saved;
      events.length = 0;
      return result();
    }
    if (command === 'COMMIT') return { ...result(), command: commit };
    if (sql.includes('identity_recovery_gate('))
      return result([{ policy_revision: '1', enabled, checked_at: Date.now().toString() }]);
    if (sql.includes('identity_recovery_reserve('))
      return result([{ identity_recovery_reserve: true }]);
    if (sql.startsWith('SELECT token_digest FROM zhiban_identity.sessions'))
      return result([{ token_digest: 'd'.repeat(64) }]);
    if (sql.includes('identity_recovery_actor_guard(')) return result([{}]);
    if (sql.includes('FROM zhiban_identity.identity_recovery_cases')) return result([{ ...c }]);
    if (sql.includes('clock_timestamp()')) return result([{ at: Date.now().toString() }]);
    if (sql.startsWith('UPDATE zhiban_identity.identity_recovery_cases')) {
      const keys = sql
        .slice(sql.indexOf('SET ') + 4, sql.indexOf(' WHERE '))
        .split(',')
        .map((x) => x.split('=')[0]);
      if (params.at(-1) !== c.repository_revision) return result([], 0);
      c = { ...c, ...Object.fromEntries(keys.map((k, i) => [k, params[i] as string | null])) };
      return result([], 1);
    }
    if (sql.startsWith('INSERT INTO zhiban_identity.identity_recovery_events')) {
      events.push(params);
      return result([], 1);
    }
    return result([], command === 'UPDATE' ? 1 : 0);
  });
  // Explicit test-only stub. Production only obtains proofs from its private WeakMap.
  const security = {
    take: vi.fn(() => ({ user: c.actor_user_id, digest: 'd'.repeat(64) })),
    check: vi.fn(),
    fresh: vi.fn(),
  } as unknown as RecoverySecurity;
  const hashing = {
    hash: vi.fn(async () => {
      throw new Error('Unexpected KDF');
    }),
    verify: vi.fn(async () => false),
    needsRehash: vi.fn(() => false),
    rehashVerified: vi.fn(async () => null),
  };
  const signed = signedStore();
  const service = new ManualRecovery(
    { connect: async () => ({ query: query as unknown as PoolClient['query'], release }) },
    signed.evidence,
    hashing,
    security,
    new RecoveryRegistry(2, 600000, 300000),
    budgets,
    new Uint8Array(32).fill(8),
  );
  return {
    service,
    security,
    hashing,
    calls,
    events,
    release,
    signed,
    get row() {
      return c;
    },
    setFail: (s: string) => {
      fail = s;
    },
    setCommit: (s: string) => {
      commit = s;
    },
    proof: { kind: 'RECOVERY_REQUEST_PROOF' } as RecoveryProof,
  };
}
describe('private recovery SQL ordering/atomic composition (unit, not PG16 proof)', () => {
  it('pre-KDF submission reservation fails closed on owner source-lock guard failure', async () => {
    const f = sqlFixture(true),
      id = f.row.case_id!;
    f.signed.put('synthetic-approval', 'REGISTRATION', f.row);
    const registration = await f.signed.evidence.load('synthetic-approval', 'REGISTRATION');
    f.row.registration_manifest_digest = registration.digest;
    f.row.registration_key_ref = registration.keyRef;
    const pairing = f.service.registry.pair({
      caseId: id,
      actor: f.row.actor_user_id!,
      subject: f.row.subject_user_id!,
      site: 'site-a',
      operatorTerminal: 'operator',
      subjectTerminal: 'subject',
      caseRevision: '1',
      deadline: Date.now() + 600000,
    });
    const ceremony = f.service.registry.open(pairing, 'site-a', 'subject');
    f.setFail('SELECT * FROM zhiban_identity.identity_recovery_actor_guard');
    await expect(
      f.service.submit(
        ceremony.cookie,
        ceremony.csrf,
        'site-a',
        'subject',
        null,
        'Synthetic-input',
      ),
    ).rejects.toMatchObject({ code: 'RECOVERY_UNAVAILABLE' });
    expect(
      f.calls.filter((call) => call.sql.includes('identity_recovery_actor_guard')),
    ).toHaveLength(1);
    expect(
      f.calls.find((call) => call.sql.includes('identity_recovery_actor_guard'))!.params,
    ).toEqual([id, 'd'.repeat(64), 'LIVE']);
    expect(
      f.calls.some((call) => call.sql.includes('FROM zhiban_identity.identity_recovery_sources')),
    ).toBe(false);
    expect(f.calls.some((call) => call.sql.startsWith('UPDATE'))).toBe(false);
    expect(f.calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(f.hashing.hash).not.toHaveBeenCalled();
  });
  it('CANCEL uses gate/current actor/CAS/event/constraints on one client; no stale target required', async () => {
    const f = sqlFixture(),
      id = f.row.case_id!;
    expect(await f.service.cancel(f.proof, id, '1', 'cancel')).toMatchObject({
      state: 'CANCELLED',
      revision: '2',
    });
    const order = f.calls.map((x) => x.sql),
      at = (prefix: string) => order.findIndex((x) => x.startsWith(prefix));
    expect(order[0]).toBe('BEGIN ISOLATION LEVEL READ COMMITTED');
    expect(at('SELECT * FROM zhiban_identity.identity_recovery_gate')).toBeLessThan(
      at('SELECT * FROM zhiban_identity.identity_recovery_actor_guard'),
    );
    expect(f.calls.find((x) => x.sql.includes('identity_recovery_actor_guard'))!.params).toEqual([
      id,
      'd'.repeat(64),
      'CANCEL',
    ]);
    expect(at('UPDATE zhiban_identity.identity_recovery_tickets')).toBeLessThan(
      at('UPDATE zhiban_identity.identity_recovery_cases'),
    );
    expect(at('UPDATE zhiban_identity.identity_recovery_cases')).toBeLessThan(
      at('INSERT INTO zhiban_identity.identity_recovery_events'),
    );
    expect(at('INSERT INTO zhiban_identity.identity_recovery_events')).toBeLessThan(
      at('SET CONSTRAINTS ALL IMMEDIATE'),
    );
    expect(order.at(-1)).toBe('COMMIT');
    expect(f.release).toHaveBeenCalledTimes(1);
    expect(f.hashing.hash).not.toHaveBeenCalled();
    expect(order.join('\n')).not.toMatch(
      /UPDATE zhiban_identity.(users|credentials|credential_slots|sessions)/,
    );
    expect(f.events[0]).toHaveLength(9);
    expect(f.events[0][1]).toBe('2');
    expect(f.events[0][3]).toBe('CANCELLED');
  });
  it('stale rejects before any write, not a state-equivalent no-op', async () => {
    const f = sqlFixture();
    await expect(f.service.cancel(f.proof, f.row.case_id!, '2', 'stale')).rejects.toThrow();
    expect(f.calls.some((x) => x.sql.startsWith('UPDATE '))).toBe(false);
    expect(f.row.repository_revision).toBe('1');
    expect(f.calls.at(-1)?.sql).toBe('ROLLBACK');
  });
  it('event failure rolls case state/revision back; no success escapes', async () => {
    const f = sqlFixture();
    f.setFail('INSERT INTO zhiban_identity.identity_recovery_events');
    await expect(f.service.cancel(f.proof, f.row.case_id!, '1', 'fault')).rejects.toThrow();
    expect(f.row.state).toBe('REGISTERED');
    expect(f.row.repository_revision).toBe('1');
    expect(f.events).toHaveLength(0);
    expect(f.release).toHaveBeenCalledTimes(1);
  });
  it('an aborted COMMIT tag is rejected and discards the client', async () => {
    const f = sqlFixture();
    f.setCommit('ROLLBACK');
    await expect(f.service.cancel(f.proof, f.row.case_id!, '1', 'aborted')).rejects.toThrow();
    expect(f.row.state).toBe('REGISTERED');
    expect(f.release).toHaveBeenCalledWith(true);
  });
  it('uncertain COMMIT is classified without replay and destroys the client', async () => {
    const f = sqlFixture();
    f.setFail('COMMIT');
    await expect(f.service.cancel(f.proof, f.row.case_id!, '1', 'uncertain')).rejects.toMatchObject(
      { code: 'OUTCOME_UNKNOWN' },
    );
    expect(f.calls.filter((x) => x.sql === 'COMMIT')).toHaveLength(1);
    expect(f.release).toHaveBeenCalledWith(true);
  });
  it('max revision fails before state write', async () => {
    const f = sqlFixture();
    f.row.repository_revision = '9223372036854775807';
    await expect(
      f.service.cancel(f.proof, f.row.case_id!, '9223372036854775807', 'max'),
    ).rejects.toThrow();
    expect(
      f.calls.some((x) => x.sql.startsWith('UPDATE zhiban_identity.identity_recovery_cases')),
    ).toBe(false);
  });
  it('foreign actor is rejected before helper and SQL mutation', async () => {
    const f = sqlFixture();
    vi.mocked(f.security.take).mockReturnValue({ user: ids.nextUserId() } as unknown as ReturnType<
      RecoverySecurity['take']
    >);
    await expect(f.service.cancel(f.proof, f.row.case_id!, '1', 'foreign')).rejects.toBeInstanceOf(
      RecoveryError,
    );
    expect(f.calls.some((x) => x.sql.includes('identity_recovery_actor_guard'))).toBe(false);
  });
});
describe('closed recovery persisted-record validation', () => {
  it('valid REGISTERED metadata contains no secret/verifier', () => {
    expect(caseRecord(registered()).state).toBe('REGISTERED');
  });
  it.each([
    'case_id',
    'actor_user_id',
    'expected_credential_id',
    'expected_slot_revision',
    'expected_security_epoch',
    'registration_manifest_digest',
    'created_at',
  ])('malformed %s fails closed without repair', (key) => {
    const c = registered();
    c[key] = 'invalid';
    expect(() => caseRecord(c)).toThrow();
  });
  it('time/terminal/people/source shapes cannot be forged by persisted rows', () => {
    const c = registered();
    expect(() => caseRecord({ ...c, verified_at: c.created_at, expires_at: null })).toThrow();
    expect(() => caseRecord({ ...c, subject_user_id: c.actor_user_id })).toThrow();
    expect(() => caseRecord({ ...c, state: 'COMPLETED' })).toThrow();
    expect(() => caseRecord({ ...c, enrollment_kind: 'OTHER' })).toThrow();
    expect(() =>
      caseRecord({
        ...c,
        state: 'CANCELLED',
        terminal_at: c.created_at,
        terminal_reason: 'ARBITRARY',
      }),
    ).toThrow();
    expect(() =>
      caseRecord({
        ...c,
        verified_at: c.created_at,
        expires_at: (Number(c.created_at) + 1800000).toString(),
      }),
    ).toThrow();
  });
  it.each(['bad', '01', '6', '-1', '5\n'])(
    'malformed ticket attempts %s cannot hydrate',
    (attempts) => {
      const t = {
        ticket_id: ids.nextCommandId(),
        case_id: ids.nextCommandId(),
        ticket_generation: '1',
        ticket_digest: 'a'.repeat(64),
        state: 'ACTIVE',
        attempts,
        created_at: '1000',
        expires_at: '2000',
        terminal_at: null,
        repository_revision: '1',
      };
      expect(() => ticketRecord(t)).toThrow();
    },
  );
});
