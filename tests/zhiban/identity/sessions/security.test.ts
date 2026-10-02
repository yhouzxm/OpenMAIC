import { describe, expect, it, vi } from 'vitest';
import { instant, userId } from '@/lib/zhiban/domain/identity';
import { credentialId } from '@/lib/zhiban/application/identity/ports/credential-repository';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { DEFAULT_SESSION_POLICY, bearerForCookie, digestBearer, newApprovedSession, sessionPolicy } from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import { SessionCsrfPolicy, sessionCookiePolicy } from '@/lib/zhiban/infrastructure/identity/sessions/browser-security';
import { SessionAuthenticator } from '@/lib/zhiban/infrastructure/identity/sessions/session-authenticator';
import { PostgresSessionRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/session';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { sessionSqlHarness, uid, cid } from './sql-harness';
const snapshot = { userId: userId(uid), credentialId: credentialId(cid), revision: repositoryRevision('1'), epoch: '1' };
describe('Session security capabilities and protocol-neutral browser contract', () => {
  it('F07 uses independent CSPRNG SessionIds and 256-bit canonical opaque tokens; only digest is projected', () => {
    const a = newApprovedSession(snapshot, repositoryRevision('1'), instant(1000), DEFAULT_SESSION_POLICY);
    const b = newApprovedSession(snapshot, repositoryRevision('1'), instant(1000), DEFAULT_SESSION_POLICY);
    const raw = bearerForCookie(a.bearer);
    expect(Buffer.from(raw, 'base64url').length).toBe(32);
    expect(a.record.id !== b.record.id && raw !== bearerForCookie(b.bearer)).toBe(true);
    expect(a.record.id.includes(raw)).toBe(false);
    expect(digestBearer(raw) === a.record.tokenDigest).toBe(true);
    expect(a.record.tokenDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(a).includes(raw)).toBe(false);
    expect(Object.keys(a.record).some(key => /tenant|role|permission|secret|bearer/i.test(key))).toBe(false);
    expect(() => bearerForCookie({ kind: 'SESSION_BEARER' })).toThrow('INTEGRITY_FAILURE');
  });
  it.each([null, undefined, '', 'not-a-token', 'a'.repeat(44), 'A'.repeat(42) + '_', '\n' + 'A'.repeat(43)])('malformed token fails closed without database access (%#)', value => expect(digestBearer(value)).toBeNull());
  it('freezes configurable 8h/30min and rejects invalid/overflowing policy', () => {
    expect(sessionPolicy()).toEqual({ absoluteMs: 28800000, idleMs: 1800000 });
    for (const idleMs of [0, -1, NaN, Infinity, 28800001]) expect(() => sessionPolicy({ absoluteMs: 28800000, idleMs })).toThrow();
    expect(() => newApprovedSession(snapshot, repositoryRevision('1'), instant(8640000000000000), DEFAULT_SESSION_POLICY)).toThrow();
  });
  it('cookie is host-only, HttpOnly, secure production, Lax, root path; dev uses different non-Host name', () => {
    expect(sessionCookiePolicy()).toEqual({ name: '__Host-zhiban_session', httpOnly: true, secure: true, sameSite: 'lax', path: '/' });
    expect('domain' in sessionCookiePolicy()).toBe(false);
    expect(sessionCookiePolicy(false).name.startsWith('__Host-')).toBe(false);
  });
  it('unsafe requests require BOTH exact trusted origin and session-bound CSRF proof', () => {
    const policy = new SessionCsrfPolicy('https://app.example');
    const a = newApprovedSession(snapshot, repositoryRevision('1'), instant(1000), DEFAULT_SESSION_POLICY).record.id;
    const b = newApprovedSession(snapshot, repositoryRevision('1'), instant(1000), DEFAULT_SESSION_POLICY).record.id;
    const csrf = policy.token(a);
    expect(policy.permitsUnsafeRequest('https://app.example', csrf, a)).toBe(true);
    for (const origin of [null, 'null', 'https://app.example.evil', 'http://app.example', 'https://app.example/']) expect(policy.permitsUnsafeRequest(origin, csrf, a)).toBe(false);
    expect(policy.permitsUnsafeRequest('https://app.example', csrf, b)).toBe(false);
    expect(policy.permitsUnsafeRequest('https://app.example', null, a)).toBe(false);
    expect(() => new SessionCsrfPolicy('http://app.example')).toThrow();
  });
  it('real Argon2 verifies password before issuance; missing subjects take dummy crypto but never create', async () => {
    const db = sessionSqlHarness(), repo = new PostgresSessionRepository(db.pool);
    const hasher = new Argon2PasswordHasher({ isCompromised: async () => false });
    const secret = 'Synthetic-session-contract-password!';
    const verifier = await hasher.hash(secret);
    let verifications = 0;
    const hashing = { hash: hasher.hash.bind(hasher), verify: async (...args: Parameters<typeof hasher.verify>) => { verifications++; return hasher.verify(...args); }, needsRehash: hasher.needsRehash.bind(hasher), rehashVerified: hasher.rehashVerified.bind(hasher) };
    const store = { verificationSnapshot: vi.fn(async () => ({ ...snapshot, verifier })), stillCurrent: vi.fn(async () => true) };
    const auth = await SessionAuthenticator.create(store, repo, hashing);
    expect(await auth.issue({ identifier: uid, secret: 'Synthetic-wrong-password!' }, instant(1000))).toBeNull();
    const result = await auth.issue({ identifier: uid, secret }, instant(1000));
    expect(result !== null).toBe(true); expect(db.state().rows.length).toBe(1);
    expect(JSON.stringify(db.calls).includes(secret)).toBe(false);
    store.verificationSnapshot.mockResolvedValueOnce(null as never);
    expect(await auth.issue({ identifier: uid, secret }, instant(1000))).toBeNull();
    expect(verifications).toBe(3); // Never retain raw secret arguments in spy diagnostics.
  });
  it('captures pre-KDF User revision and rechecks after crypto; disable/restore cannot bind old approval', async () => {
    const db = sessionSqlHarness(), repo = new PostgresSessionRepository(db.pool);
    const hasher = new Argon2PasswordHasher({ isCompromised: async () => false });
    const secret = 'Synthetic-session-race-password!', verifier = await hasher.hash(secret);
    const auth = await SessionAuthenticator.create({ verificationSnapshot: async () => ({ ...snapshot, verifier }), stillCurrent: async () => { db.user.repository_revision = '3'; return true; } }, repo, hasher);
    await expect(auth.issue({ identifier: uid, secret }, instant(1000))).rejects.toMatchObject({ code: 'STALE_WRITE' });
    expect(db.state().rows).toHaveLength(0);
  });
  it('parallel verification attempts do not share snapshot/context or authenticate unknown subject', async () => {
    const db = sessionSqlHarness(), repo = new PostgresSessionRepository(db.pool);
    const hasher = new Argon2PasswordHasher({ isCompromised: async () => false });
    const secret = 'Synthetic-isolated-attempt-password!', verifier = await hasher.hash(secret);
    const other = userId('018f0000-0000-7000-8000-000000009099');
    const auth = await SessionAuthenticator.create({ verificationSnapshot: async id => id === other ? null : { ...snapshot, verifier }, stillCurrent: async () => true }, repo, hasher);
    const results = await Promise.all([auth.issue({ identifier: uid, secret }, instant(1000)), auth.issue({ identifier: other, secret }, instant(1000))]);
    expect(results[0]?.session.value.userId).toBe(uid); expect(results[1]).toBeNull(); expect(db.state().rows).toHaveLength(1);
  });
});
