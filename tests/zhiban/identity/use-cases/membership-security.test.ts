import { describe, it, expect, vi, afterEach } from 'vitest';
import { inspect } from 'node:util';
import { MembershipSecurity } from '@/lib/zhiban/infrastructure/identity/composition/membership-security';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import type {
  PasswordHashingPort,
  PasswordVerifierHandle,
} from '@/lib/zhiban/application/identity/ports/password-hashing';
import type { AuthenticatedRequestHandle } from '@/lib/zhiban/application/identity/ports/authenticated-request';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import type { PostgresCredentialRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import type { SharedAdmission } from '@/lib/zhiban/infrastructure/identity/composition/admission';

const ids = new IdentityIds(),
  user = ids.nextUserId(),
  credential = ids.nextCredentialId();
const secret = 'Synthetic-private-reauth-vector',
  transport = { kind: 'SERVER_TRANSPORT' as const };
const intent = {
  requestId: 'private-request',
  commandId: ids.nextCommandId(),
  action: 'ROLE_GRANT' as const,
  targetIds: [ids.nextMembershipId()],
  intentDigest: 'a'.repeat(64),
};
/** This tests registry/control-flow mechanics, not cryptography. Production provider
 * behavior and production cost remain covered by the existing Argon2 suite. */
async function fixture() {
  const handle = Object.freeze({ kind: 'AUTHENTICATED_REQUEST' as const }),
    handles = new WeakSet<object>([handle]);
  let released = 0,
    missing = false,
    result: unknown = true,
    allowed: unknown = true,
    helper: unknown = true,
    providerError = false;
  const params: unknown[][] = [],
    calls: string[] = [];
  const dummy = Object.freeze({ kind: 'PASSWORD_VERIFIER_HANDLE' as const }),
    real = Object.freeze({ kind: 'PASSWORD_VERIFIER_HANDLE' as const });
  const hash = vi.fn(async () => dummy),
    verify = vi.fn(async (input: string, verifier: PasswordVerifierHandle) => {
      expect(released).toBeGreaterThan(0); // auth anchor client is returned before KDF
      expect(input === secret).toBe(true);
      expect(verifier).toBe(missing ? dummy : real);
      if (providerError) throw Object.assign(new Error(secret), { cause: secret, code: secret });
      return result;
    });
  const query = vi.fn(async (sql: string, p: unknown[] = []) => {
    calls.push(sql);
    params.push([...p]);
    let rows: unknown[] = [];
    if (sql.includes('identity_auth_user_anchor'))
      rows = [{ user_id: user, user_status: 'ACTIVE', user_revision: '7' }];
    if (sql.includes('clock_timestamp')) rows = [{ at: '1000' }];
    if (sql.includes('identity_session_step_up_guard')) rows = [{ valid: helper }];
    return {
      command: sql.startsWith('SELECT') ? 'SELECT' : sql.split(' ')[0],
      rowCount: rows.length,
      rows,
    };
  });
  const client = { query, release: () => released++ },
    pool = { connect: async () => client } as unknown as TransactionPool;
  const credentials = {
    verificationSnapshot: async () =>
      missing
        ? null
        : {
            userId: user,
            credentialId: credential,
            revision: repositoryRevision('9'),
            epoch: '3',
            verifier: real,
          },
  } as Pick<PostgresCredentialRepository, 'verificationSnapshot'>;
  const security = await MembershipSecurity.create(
    (h: AuthenticatedRequestHandle) => {
      if (!handles.has(h)) throw new IdentityPortError('CONFLICT');
      return { user, digest: 'b'.repeat(64), session: 'c'.repeat(64) };
    },
    pool,
    credentials,
    { hash, verify } as unknown as PasswordHashingPort,
    { reserve: async () => allowed } as unknown as SharedAdmission,
  );
  return {
    security,
    client,
    handle,
    calls,
    params,
    hash,
    verify,
    setMissing: () => (missing = true),
    setResult: (v: unknown) => (result = v),
    setAdmission: (v: unknown) => (allowed = v),
    setHelper: (v: unknown) => (helper = v),
    setProviderError: () => (providerError = true),
  };
}
afterEach(() => vi.restoreAllMocks());
describe('C8 private recent membership reauthentication proof', () => {
  it('binds handle/intent/User+slot revisions+epoch, sanitizes returned proof and sends no raw secret to SQL', async () => {
    const f = await fixture(),
      proof = await f.security.prepare(f.handle, intent, secret, transport);
    expect(Object.keys(proof)).toEqual(['kind']);
    expect(f.hash).toHaveBeenCalledTimes(1);
    await f.security.assertProof(f.client as never, f.handle, proof, intent);
    expect(f.params.at(-1)).toEqual(['b'.repeat(64), user, '7', '9', '3', '1000']);
    expect(JSON.stringify(f.params).includes(secret)).toBe(false);
    expect(inspect(proof).includes(secret)).toBe(false);
  });
  it('rejects structural forged/copied proof before SQL', async () => {
    const f = await fixture(),
      proof = await f.security.prepare(f.handle, intent, secret, transport),
      before = f.calls.length;
    await expect(
      f.security.assertProof(f.client as never, f.handle, { ...proof }, intent),
    ).rejects.toBeInstanceOf(IdentityPortError);
    expect(f.calls).toHaveLength(before);
  });
  it.each(['handle', 'requestId', 'commandId', 'action', 'targetIds', 'intentDigest'])(
    'rejects crossed %s before SQL',
    async (field) => {
      const f = await fixture(),
        proof = await f.security.prepare(f.handle, intent, secret, transport),
        before = f.calls.length;
      const changed = {
        ...intent,
        ...(field === 'requestId'
          ? { requestId: 'other' }
          : field === 'commandId'
            ? { commandId: ids.nextCommandId() }
            : field === 'action'
              ? { action: 'ROLE_REVOKE' as const }
              : field === 'targetIds'
                ? { targetIds: [ids.nextMembershipId()] }
                : field === 'intentDigest'
                  ? { intentDigest: 'c'.repeat(64) }
                  : {}),
      };
      await expect(
        f.security.assertProof(
          f.client as never,
          field === 'handle' ? { ...f.handle } : f.handle,
          proof,
          changed,
        ),
      ).rejects.toBeInstanceOf(IdentityPortError);
      expect(f.calls).toHaveLength(before);
    },
  );
  it('missing credential runs dummy verify but cannot mint a proof even if provider returns true', async () => {
    const f = await fixture();
    f.setMissing();
    await expect(f.security.prepare(f.handle, intent, secret, transport)).rejects.toBeInstanceOf(
      IdentityPortError,
    );
    expect(f.verify).toHaveBeenCalledTimes(1);
  });
  it.each([false, null, 'true', 1])('verification %s is not true-only approval', async (value) => {
    const f = await fixture();
    f.setResult(value);
    await expect(f.security.prepare(f.handle, intent, secret, transport)).rejects.toBeInstanceOf(
      IdentityPortError,
    );
  });
  it.each([false, null, 'true', 1])('admission %s rejects before KDF', async (value) => {
    const f = await fixture();
    f.setAdmission(value);
    await expect(f.security.prepare(f.handle, intent, secret, transport)).rejects.toBeInstanceOf(
      IdentityPortError,
    );
    expect(f.verify).not.toHaveBeenCalled();
  });
  it.each([300000, -1])('proof age %s fails closed before SQL', async (age) => {
    const f = await fixture();
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const proof = await f.security.prepare(f.handle, intent, secret, transport),
      before = f.calls.length;
    vi.spyOn(performance, 'now').mockReturnValue(1000 + age);
    await expect(
      f.security.assertProof(f.client as never, f.handle, proof, intent),
    ).rejects.toBeInstanceOf(IdentityPortError);
    expect(f.calls).toHaveLength(before);
  });
  it.each([false, null, 'true', 1])('DB guard result %s never fails open', async (value) => {
    const f = await fixture(),
      proof = await f.security.prepare(f.handle, intent, secret, transport);
    f.setHelper(value);
    await expect(
      f.security.assertProof(f.client as never, f.handle, proof, intent),
    ).rejects.toBeInstanceOf(IdentityPortError);
  });
  it('provider errors lose message/cause/custom code and never expose secret in exception diagnostics', async () => {
    const f = await fixture();
    f.setProviderError();
    const error = await f.security.prepare(f.handle, intent, secret, transport).catch((e) => e);
    expect(error).toBeInstanceOf(IdentityPortError);
    expect(inspect(error).includes(secret)).toBe(false);
    expect(JSON.stringify(error).includes(secret)).toBe(false);
    expect(Object.hasOwn(error, 'cause')).toBe(false);
  });
});
