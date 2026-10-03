import { describe, expect, it, vi } from 'vitest';
import { IdentityAuthentication } from '@/lib/zhiban/infrastructure/identity/composition/authentication';
import {
  SharedAdmission,
  observedTransport,
  purposes,
} from '@/lib/zhiban/infrastructure/identity/composition/admission';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import { SessionCsrfPolicy } from '@/lib/zhiban/infrastructure/identity/sessions/browser-security';
import { digestBearer } from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import { issueVerifier } from '@/lib/zhiban/infrastructure/identity/credentials/verifier-material';
import { userId } from '@/lib/zhiban/domain/identity';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import {
  credentialId,
  securityEpoch,
} from '@/lib/zhiban/application/identity/ports/credential-repository';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import type { PostgresCredentialRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import type { PostgresSessionRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/session';
import type { SessionRow } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/session-records';
import type {
  CredentialRow,
  SlotRow,
} from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential-records';
import type { PasswordHashingPort } from '@/lib/zhiban/application/identity/ports/password-hashing';

const uid = '018f0000-0000-7000-8000-000000001001',
  cid = '018f0000-0000-7000-8000-000000001002';
const raw = Buffer.alloc(32, 19).toString('base64url'),
  digest = digestBearer(raw)!;
// Format-valid synthetic SQL fixture; cryptographic behavior is covered by the real provider suite.
const encoded =
  '$argon2id$v=19$m=32768,t=3,p=1$' +
  Buffer.alloc(16).toString('base64').replace(/=+$/, '') +
  '$' +
  Buffer.alloc(32).toString('base64').replace(/=+$/, '');
const transport = observedTransport('127.0.0.1');
async function harness() {
  let session: SessionRow = {
    session_id: 'ses_' + Buffer.alloc(32, 27).toString('base64url'),
    user_id: uid,
    token_digest: digest,
    created_at: '1000',
    last_seen_at: '2000',
    idle_expires_at: '1802000',
    absolute_expires_at: '28801000',
    revoked_at: null,
    repository_revision: '1',
    security_epoch: '1',
    user_revision: '1',
  };
  let slot: SlotRow = {
    user_id: uid,
    credential_type: 'PASSWORD',
    active_credential_id: cid,
    generation: '1',
    repository_revision: '1',
    security_epoch: '1',
    created_at: '1000',
    updated_at: '1000',
  };
  let credentials: CredentialRow[] = [
    {
      credential_id: cid,
      user_id: uid,
      credential_type: 'PASSWORD',
      generation: '1',
      status: 'ACTIVE',
      slot_revision: '1',
      verifier_material: encoded,
      created_at: '1000',
      updated_at: '1000',
      replaced_at: null,
      revoked_at: null,
      replaced_by_credential_id: null,
    },
  ];
  let audits: unknown[][] = [],
    saved: {
      session: SessionRow;
      slot: SlotRow;
      credentials: CredentialRow[];
      audits: unknown[][];
    };
  const calls: { sql: string; params: unknown[] }[] = [],
    fail = new Set<string>();
  const state = {
    clock: 3000,
    anchorRevision: '1',
    anchorStatus: 'ACTIVE',
    staleTouch: false,
    abortCommit: false,
  };
  const result = (command: string, rows: unknown[] = [], count = rows.length) => ({
    command,
    rowCount: count,
    rows,
  });
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if ([...fail].some((p) => sql.startsWith(p)))
      throw Object.assign(new Error('synthetic-private-error'), {
        cause: 'private',
        code: 'private',
        detail: 'private',
      });
    if (sql.startsWith('BEGIN')) {
      saved = structuredClone({ session, slot, credentials, audits });
      return result('BEGIN');
    }
    if (sql === 'ROLLBACK' || (sql === 'COMMIT' && state.abortCommit)) {
      ({ session, slot, credentials, audits } = saved);
      return result('ROLLBACK');
    }
    if (sql === 'COMMIT') return result('COMMIT');
    if (sql.includes('identity_admission_reserve')) return result('SELECT', [{ allowed: true }]);
    if (sql.includes('identity_auth_user_anchor'))
      return result('SELECT', [
        { user_id: uid, user_status: state.anchorStatus, user_revision: state.anchorRevision },
      ]);
    if (sql.includes('pg_advisory_xact_lock')) return result('SELECT', [{}]);
    if (sql.includes('clock_timestamp')) return result('SELECT', [{ at: String(state.clock) }]);
    if (sql.includes('nextval')) return result('SELECT', [{ id: '9007199254740993' }]);
    if (sql.startsWith('SELECT') && sql.includes('FROM zhiban_identity.credential_slots'))
      return result('SELECT', [{ ...slot }]);
    if (sql.startsWith('SELECT') && sql.includes('FROM zhiban_identity.credentials'))
      return result('SELECT', structuredClone(credentials));
    if (sql.startsWith('SELECT') && sql.includes('FROM zhiban_identity.sessions')) {
      if (sql.includes('FOR UPDATE') && state.staleTouch) session.repository_revision = '2';
      return result('SELECT', [{ ...session }]);
    }
    if (sql.startsWith('UPDATE zhiban_identity.sessions SET last_seen_at')) {
      if (
        params[2] !== session.session_id ||
        params[3] !== session.repository_revision ||
        session.revoked_at !== null
      )
        return result('UPDATE');
      session = {
        ...session,
        last_seen_at: String(params[0]),
        idle_expires_at: String(params[1]),
        repository_revision: String(BigInt(session.repository_revision) + BigInt(1)),
      };
      return result('UPDATE', [], 1);
    }
    if (sql.startsWith('UPDATE zhiban_identity.sessions SET revoked_at')) {
      if (
        params[1] !== session.session_id ||
        params[2] !== session.repository_revision ||
        session.revoked_at !== null
      )
        return result('UPDATE');
      session = {
        ...session,
        revoked_at: String(params[0]),
        repository_revision: String(BigInt(session.repository_revision) + BigInt(1)),
      };
      return result('UPDATE', [], 1);
    }
    if (sql.startsWith('UPDATE zhiban_identity.credential_slots')) {
      if (params[4] !== uid || params[5] !== slot.repository_revision) return result('UPDATE');
      slot = {
        ...slot,
        active_credential_id: String(params[0]),
        generation: String(params[1]),
        security_epoch: String(params[2]),
        updated_at: String(params[3]),
        repository_revision: String(BigInt(slot.repository_revision) + BigInt(1)),
      };
      return result('UPDATE', [], 1);
    }
    if (sql.startsWith('UPDATE zhiban_identity.credentials')) {
      const row = credentials.find(
        (c) => c.credential_id === params[4] && c.user_id === params[3] && c.status === 'ACTIVE',
      );
      if (!row) return result('UPDATE');
      Object.assign(row, {
        status: 'REPLACED',
        verifier_material: null,
        slot_revision: String(params[0]),
        updated_at: String(params[1]),
        replaced_at: String(params[1]),
        replaced_by_credential_id: String(params[2]),
      });
      return result('UPDATE', [], 1);
    }
    if (sql.startsWith('INSERT INTO zhiban_identity.credentials')) {
      credentials.push({
        ...credentials[0],
        credential_id: String(params[0]),
        status: 'ACTIVE',
        generation: String(params[2]),
        slot_revision: String(params[3]),
        verifier_material: String(params[4]),
        created_at: String(params[5]),
        updated_at: String(params[5]),
        replaced_at: null,
        replaced_by_credential_id: null,
      });
      return result('INSERT', [], 1);
    }
    if (sql.startsWith('INSERT INTO zhiban_identity.audit_events')) {
      audits.push(params);
      return result('INSERT', [], 1);
    }
    throw new Error('Unrecognized composition SQL in unit harness.');
  });
  const release = vi.fn(),
    connect = vi.fn(async () => ({ query, release })),
    pool = { connect } as unknown as TransactionPool;
  const handle = issueVerifier(encoded),
    snapshot = {
      userId: userId(uid),
      credentialId: credentialId(cid),
      revision: repositoryRevision('1'),
      epoch: securityEpoch('1'),
      verifier: handle,
    };
  const hashing: PasswordHashingPort = {
    hash: vi.fn(async () => handle),
    verify: vi.fn(async (secret) => secret === 'Synthetic-correct-password!'),
    needsRehash: vi.fn(() => false),
    rehashVerified: vi.fn(async () => null),
  };
  const store = {
    verificationSnapshot: vi.fn(async () => snapshot),
    stillCurrent: vi.fn(async () => true),
  };
  const sessions = {
    policy: { absoluteMs: 28800000, idleMs: 1800000 },
    authenticationUserRevision: async () => repositoryRevision('1'),
  } as unknown as PostgresSessionRepository;
  const make = () =>
    IdentityAuthentication.create(
      pool,
      sessions,
      store as unknown as PostgresCredentialRepository,
      hashing,
      new SharedAdmission(pool, {
        environment: 'synthetic',
        approvalRef: 'test-only',
        hmacKey: new Uint8Array(32).fill(1),
        policyDigests: Object.fromEntries(
          purposes.map((p, i) => [p, String(i + 1).repeat(64)]),
        ) as never,
      }),
      new SessionCsrfPolicy('https://synthetic.example'),
      new IdentityIds(),
    );
  const security = await make();
  return {
    security,
    make,
    hashing,
    store,
    state,
    calls,
    fail,
    pool,
    release,
    query,
    get: () => structuredClone({ session, slot, credentials, audits }),
    session: (patch: Partial<SessionRow>) => Object.assign(session, patch),
    slot: (patch: Partial<SlotRow>) => Object.assign(slot, patch),
  };
}
describe('own authentication composition SQL contract (not real PostgreSQL evidence)', () => {
  it('D8 password-state reuses full validated lock path and projects only canonical revision', async () => {
    const h = await harness(),
      handle = await h.security.authenticate(raw);
    h.calls.length = 0;
    expect(await h.security.passwordState(handle!)).toEqual({ credentialRevision: '1' });
    const sql = h.calls.map((c) => c.sql);
    expect(sql.findIndex((s) => s.includes('identity_auth_user_anchor'))).toBeLessThan(
      sql.findIndex((s) => s.includes('pg_advisory')),
    );
    expect(sql.findIndex((s) => s.includes('credential_slots'))).toBeLessThan(
      sql.findIndex((s) => s.includes('FROM zhiban_identity.credentials')),
    );
    expect(sql.findIndex((s) => s.includes('FROM zhiban_identity.credentials'))).toBeLessThan(
      sql.findIndex((s) => s.includes('FROM zhiban_identity.sessions')),
    );
    expect(sql.at(-1)).toBe('COMMIT');
    expect(sql.some((s) => s.startsWith('UPDATE'))).toBe(false);
  });
  it('D8 password-state refuses counterfeit private handle before SQL', async () => {
    const h = await harness();
    h.calls.length = 0;
    await expect(h.security.passwordState({ kind: 'AUTHENTICATED_REQUEST' })).rejects.toThrow();
    expect(h.calls).toEqual([]);
  });
  it('D8 password-state fails closed on malformed credential aggregate', async () => {
    const h = await harness(),
      handle = await h.security.authenticate(raw);
    h.slot({ generation: '2' });
    await expect(h.security.passwordState(handle!)).rejects.toThrow();
  });
  it('D8 password-state rejects current epoch mismatch and releases client', async () => {
    const h = await harness(),
      handle = await h.security.authenticate(raw);
    h.session({ security_epoch: '2' });
    await expect(h.security.passwordState(handle!)).rejects.toThrow();
    expect(h.calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(h.release).toHaveBeenCalled();
  });
  it('touch locks User/barrier/slot/session before fresh clock; CAS/secret-safe DTO', async () => {
    const h = await harness(),
      handle = await h.security.authenticate(raw);
    expect(handle).not.toBeNull();
    const order = h.calls.map((c) => c.sql),
      anchor = order.findIndex((s) => s.includes('identity_auth_user_anchor')),
      barrier = order.findIndex((s) => s.includes('pg_advisory')),
      slot = order.findIndex((s) => s.includes('credential_slots') && s.includes('FOR UPDATE')),
      session = order.findIndex((s) => s.includes('sessions') && s.includes('FOR UPDATE')),
      clock = order.findIndex((s) => s.includes('clock_timestamp'));
    expect(anchor).toBeLessThan(barrier);
    expect(barrier).toBeLessThan(slot);
    expect(slot).toBeLessThan(session);
    expect(session).toBeLessThan(clock);
    expect(
      h.calls.find((c) => c.sql.startsWith('UPDATE zhiban_identity.sessions'))?.params,
    ).toEqual(['3000', '1803000', h.get().session.session_id, '1']);
    expect(h.get().session.repository_revision).toBe('2');
    expect(Object.keys(await h.security.me(handle!)).sort()).toEqual([
      'absoluteExpiresAt',
      'idleExpiresAt',
      'userId',
    ]);
    expect(JSON.stringify(handle)).not.toContain(raw);
    expect(JSON.stringify(handle)).not.toContain(digest);
  });
  it('foreign-instance or fabricated handle never reaches SQL', async () => {
    const h = await harness(),
      handle = await h.security.authenticate(raw),
      other = await h.make();
    h.calls.length = 0;
    await expect(other.me(handle!)).rejects.toThrow();
    await expect(h.security.me({ kind: 'AUTHENTICATED_REQUEST' })).rejects.toThrow();
    expect(h.calls).toHaveLength(0);
  });
  it.each([
    { revoked_at: '2500' },
    { user_revision: '2' },
    { security_epoch: '2' },
    { idle_expires_at: '3000' },
    { absolute_expires_at: '3000', idle_expires_at: '3000' },
  ])('rejects nonlive bindings before touch', async (patch) => {
    const h = await harness();
    h.session(patch);
    await expect(h.security.authenticate(raw)).rejects.toThrow();
    expect(h.calls.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
  });
  it('disabled User rejects and stale touch cannot become true no-op', async () => {
    const h = await harness();
    h.state.anchorStatus = 'DISABLED';
    await expect(h.security.authenticate(raw)).rejects.toThrow();
    h.state.anchorStatus = 'ACTIVE';
    h.state.staleTouch = true;
    await expect(h.security.authenticate(raw)).rejects.toMatchObject({ code: 'STALE_WRITE' });
    expect(h.calls.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
  });
  it('maximum revision and malformed row fail closed', async () => {
    const h = await harness();
    h.session({ repository_revision: '9223372036854775807' });
    await expect(h.security.authenticate(raw)).rejects.toThrow();
    h.session({ repository_revision: '01' });
    await expect(h.security.authenticate(raw)).rejects.toThrow();
  });
  it('storage exception and aborted COMMIT cannot return a handle or expose private cause', async () => {
    const h = await harness();
    h.state.abortCommit = true;
    await expect(h.security.authenticate(raw)).rejects.toThrow();
    expect(h.release).toHaveBeenLastCalledWith(true);
    h.state.abortCommit = false;
    h.fail.add('SELECT');
    try {
      await h.security.authenticate(raw);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(String(error) + JSON.stringify(error)).not.toContain('private');
    }
  });
  it('logout repeated no-op has exactly one same-client secret-free audit', async () => {
    const h = await harness(),
      handle = await h.security.authenticate(raw);
    h.calls.length = 0;
    await h.security.logout(handle!, 'logout');
    await h.security.logout(handle!, 'logout');
    expect(h.get().audits).toHaveLength(1);
    expect(h.get().session.revoked_at).toBe('3000');
    const params = h.get().audits[0];
    expect(params[1]).toBe('SESSION_REVOKED');
    expect(params[0]).toBe('9007199254740993');
    expect(JSON.stringify(params).includes(raw) || JSON.stringify(params).includes(digest)).toBe(
      false,
    );
    expect(h.calls.findIndex((c) => c.sql.startsWith('UPDATE'))).toBeLessThan(
      h.calls.findIndex((c) => c.sql.startsWith('INSERT')),
    );
  });
  it('audit failure rolls back revoke with no partial success', async () => {
    const h = await harness(),
      handle = await h.security.authenticate(raw);
    h.fail.add('INSERT INTO zhiban_identity.audit_events');
    await expect(h.security.logout(handle!, 'rollback')).rejects.toThrow();
    expect(h.get().session.revoked_at).toBeNull();
    expect(h.get().audits).toHaveLength(0);
  });
  it('password change KDF before locks, expected post-state +1 without old-session live recheck', async () => {
    const h = await harness(),
      handle = await h.security.authenticate(raw);
    h.calls.length = 0;
    vi.mocked(h.hashing.hash).mockImplementation(async () => {
      expect(h.calls.some((c) => c.sql.includes('FOR UPDATE'))).toBe(false);
      return issueVerifier(encoded);
    });
    await h.security.changePassword(
      handle!,
      'Synthetic-correct-password!',
      'Synthetic-new-password!',
      transport,
      'change',
      '1',
    );
    const result = h.get();
    expect(result.slot.repository_revision).toBe('2');
    expect(result.slot.security_epoch).toBe('2');
    expect(result.slot.generation).toBe('2');
    expect(result.credentials.map((c) => c.status)).toEqual(['REPLACED', 'ACTIVE']);
    expect(result.credentials[0].verifier_material).toBeNull();
    expect(result.audits[0][1]).toBe('CREDENTIAL_REPLACED');
    expect(result.audits[0][0]).toBe('9007199254740993');
    expect(h.calls.at(-1)?.sql).toBe('COMMIT');
    await expect(h.security.me(handle!)).rejects.toThrow();
  });
  it('stale password mutation, wrong proof, and failed audit leave prior state', async () => {
    const h = await harness(),
      handle = await h.security.authenticate(raw);
    await expect(
      h.security.changePassword(
        handle!,
        'Synthetic-correct-password!',
        'Synthetic-new-password!',
        transport,
        'stale',
        '2',
      ),
    ).rejects.toMatchObject({ code: 'STALE_WRITE' });
    await expect(
      h.security.changePassword(
        handle!,
        'Synthetic-wrong-password!',
        'Synthetic-new-password!',
        transport,
        'wrong',
        '1',
      ),
    ).rejects.toThrow();
    h.fail.add('INSERT INTO zhiban_identity.audit_events');
    await expect(
      h.security.changePassword(
        handle!,
        'Synthetic-correct-password!',
        'Synthetic-new-password!',
        transport,
        'audit',
        '1',
      ),
    ).rejects.toThrow();
    expect(h.get().slot.repository_revision).toBe('1');
    expect(h.get().credentials).toHaveLength(1);
    expect(h.get().audits).toHaveLength(0);
  });
  it('logout-all acquires exclusive barrier before row locks, no lock upgrade or retry', async () => {
    const h = await harness(),
      handle = await h.security.authenticate(raw);
    h.calls.length = 0;
    await h.security.logoutAll(handle!, 'Synthetic-correct-password!', transport, 'all');
    const exclusive = h.calls.findIndex((c) => c.sql.includes('pg_advisory_xact_lock('));
    expect(exclusive).toBeGreaterThan(-1);
    expect(
      h.calls.slice(exclusive).some((c) => c.sql.includes('pg_advisory_xact_lock_shared')),
    ).toBe(false);
    expect(exclusive).toBeLessThan(
      h.calls.findIndex((c, i) => i > exclusive && c.sql.includes('FOR SHARE')),
    );
    expect(h.get().session.revoked_at).not.toBeNull();
  });
  it('unknown/invalid identifier still executes verifier work and closed rejection audit', async () => {
    const h = await harness();
    h.store.verificationSnapshot.mockResolvedValue(null as never);
    vi.mocked(h.hashing.verify).mockClear();
    for (const identifier of [uid, 'invalid'])
      expect(
        await h.security.login(identifier, 'Synthetic-wrong-password!', transport, 'denied'),
      ).toEqual({ status: 'REJECTED' });
    expect(h.hashing.verify).toHaveBeenCalledTimes(2);
    expect(h.get().audits).toHaveLength(2);
    expect(
      h
        .get()
        .audits.every((a) => a[1] === 'AUTHENTICATION_REJECTED' && a[8] === null && a[9] === '{}'),
    ).toBe(true);
  });
  it('CSRF cannot be forged by origin or a different request handle', async () => {
    const h = await harness(),
      handle = await h.security.authenticate(raw),
      proof = await h.security.csrfToken(handle!);
    await h.security.assertUnsafe(handle!, 'https://synthetic.example', proof);
    await expect(
      h.security.assertUnsafe(handle!, 'https://foreign.example', proof),
    ).rejects.toThrow();
    await expect(
      h.security.assertUnsafe(handle!, 'https://synthetic.example', 'synthetic-invalid'),
    ).rejects.toThrow();
  });
  it('maximum credential epoch fails before SQL mutation', async () => {
    const h = await harness(),
      handle = await h.security.authenticate(raw),
      max = '9223372036854775807';
    h.slot({ security_epoch: max });
    h.session({ security_epoch: max });
    h.store.verificationSnapshot.mockResolvedValue({
      ...(await h.store.verificationSnapshot()),
      epoch: securityEpoch(max),
    });
    h.calls.length = 0;
    await expect(
      h.security.changePassword(
        handle!,
        'Synthetic-correct-password!',
        'Synthetic-new-password!',
        transport,
        'maximum',
        '1',
      ),
    ).rejects.toThrow();
    expect(h.calls.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
  });
  it('nonboolean password provider output cannot authorize a sensitive command', async () => {
    const h = await harness(),
      handle = await h.security.authenticate(raw);
    vi.mocked(h.hashing.verify).mockResolvedValue('true' as never);
    h.calls.length = 0;
    await expect(
      h.security.logoutAll(handle!, 'Synthetic-correct-password!', transport, 'invalid-output'),
    ).rejects.toThrow();
    await expect(
      h.security.changePassword(
        handle!,
        'Synthetic-correct-password!',
        'Synthetic-new-password!',
        transport,
        'invalid-output',
        '1',
      ),
    ).rejects.toThrow();
    expect(h.calls.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
  });
  it('external provider error is reconstructed without cause/custom fields', async () => {
    const h = await harness(),
      handle = await h.security.authenticate(raw),
      sentinel = 'synthetic-private-provider-detail';
    vi.mocked(h.hashing.verify).mockRejectedValue(
      Object.assign(new Error(sentinel), { cause: sentinel, code: sentinel }),
    );
    try {
      await h.security.logoutAll(handle!, 'Synthetic-correct-password!', transport, 'exception');
      throw new Error('Expected rejection');
    } catch (error) {
      expect(String(error) + JSON.stringify(error)).not.toContain(sentinel);
    }
    expect(h.get().session.revoked_at).toBeNull();
  });
});
