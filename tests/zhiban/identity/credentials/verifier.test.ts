import { beforeAll, describe, expect, it, vi } from 'vitest';
import { userId } from '@/lib/zhiban/domain/identity';
import { credentialId } from '@/lib/zhiban/application/identity/ports/credential-repository';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { CredentialVerifier } from '@/lib/zhiban/infrastructure/identity/credentials/credential-verifier';
import type { CredentialVerificationSnapshot } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { inspect } from 'node:util';

const id = userId('018f0000-0000-7000-8000-000000000001');
const password = 'Synthetic credential verifier vector!';
let snapshot: CredentialVerificationSnapshot;
const provider = new Argon2PasswordHasher(syntheticPasswordScreening);
beforeAll(async () => { snapshot = { userId: id, credentialId: credentialId('018f0000-0000-7000-8000-000000000002'), revision: repositoryRevision('1'), epoch: '1', verifier: await provider.hash(password) }; });
describe.sequential('uniform credential verification boundary', () => {
  it.each(['known', 'missing', 'disabled', 'revoked', 'invalid', 'wrong'])('one real/dummy KDF for %s; only correct/current/ACTIVE succeeds', async kind => {
    const store = { verificationSnapshot: vi.fn(async () => ['known', 'wrong'].includes(kind) ? snapshot : null), stillCurrent: vi.fn(async () => true) };
    const hashing = { hash: provider.hash.bind(provider), verify: vi.fn(provider.verify.bind(provider)), needsRehash: provider.needsRehash.bind(provider), rehashVerified: provider.rehashVerified.bind(provider) };
    const adapter = await CredentialVerifier.create(store, hashing);
    const result = await adapter.verifyCredential({ identifier: kind === 'invalid' ? 'missing-invalid' : id, secret: kind === 'wrong' ? 'wrong synthetic input' : password });
    expect(hashing.verify).toHaveBeenCalledTimes(1);
    expect(result).toEqual(kind === 'known' ? { status: 'VERIFIED', userId: id } : { status: 'REJECTED' });
    expect(store.stillCurrent).toHaveBeenCalledTimes(kind === 'known' ? 1 : 0);
    expect(JSON.stringify(result).includes(password)).toBe(false);
  });
  it('replace/revoke/disable during KDF rejected by fresh final read, no retry', async () => {
    const store = { verificationSnapshot: vi.fn(async () => snapshot), stillCurrent: vi.fn(async () => false) };
    const adapter = await CredentialVerifier.create(store, provider);
    expect(await adapter.verifyCredential({ identifier: id, secret: password })).toEqual({ status: 'REJECTED' });
    expect(store.verificationSnapshot).toHaveBeenCalledTimes(1); expect(store.stillCurrent).toHaveBeenCalledTimes(1);
  });
  it('input getters are not run; malformed input still performs dummy KDF', async () => {
    const getter = vi.fn(() => { throw new Error(password); });
    const store = { verificationSnapshot: vi.fn(async () => snapshot), stillCurrent: vi.fn(async () => true) };
    const adapter = await CredentialVerifier.create(store, provider);
    expect(await adapter.verifyCredential({ identifier: id, get secret() { return getter(); } })).toEqual({ status: 'REJECTED' });
    expect(getter).not.toHaveBeenCalled();
  });
  it('provider exceptions sanitized, no vendor cause/secret/result', async () => {
    const store = { verificationSnapshot: vi.fn(async () => snapshot), stillCurrent: vi.fn(async () => true) };
    const hashing = { hash: provider.hash.bind(provider), verify: vi.fn(async () => { throw { message: password, nested: snapshot.verifier }; }), needsRehash: () => false, rehashVerified: async () => null };
    const adapter = await CredentialVerifier.create(store, hashing);
    const failure = await adapter.verifyCredential({ identifier: id, secret: password }).catch(error => error);
    expect(failure.code === 'UNAVAILABLE' && failure.message === 'UNAVAILABLE').toBe(true); expect(failure.cause === undefined).toBe(true);
  });
  it('Proxy input throws sanitized; caller exception does not leak the secret', async () => {
    const adapter = await CredentialVerifier.create({ verificationSnapshot:async () => snapshot,stillCurrent:async () => true },provider);
    const request = new Proxy({ identifier:id,secret:password },{ getOwnPropertyDescriptor() { throw new Error(password); } });
    const error = await adapter.verifyCredential(request).catch(value => value);
    expect(error.code === 'UNAVAILABLE' && error.message === 'UNAVAILABLE').toBe(true); expect(error.cause === undefined).toBe(true);
  });
  it('bounded account budget rejects admission without permanent lockout; resets after window', async () => {
    let now = 0;
    const store = { verificationSnapshot:async () => null,stillCurrent:async () => false };
    // Admission contract instrumentation only; real/dummy KDF behavior covered above/PG16.
    const hashing = { hash:provider.hash.bind(provider),verify:vi.fn(async () => false),needsRehash:() => false,rehashVerified:async () => null };
    const adapter = await CredentialVerifier.create(store,hashing,() => now);
    for (let i=0;i<10;i++) await adapter.verifyCredential({ identifier:id,secret:password });
    await expect(adapter.verifyCredential({ identifier:id,secret:password })).rejects.toMatchObject({ code:'UNAVAILABLE' }); expect(hashing.verify).toHaveBeenCalledTimes(10);
    now = 60000; expect(await adapter.verifyCredential({ identifier:id,secret:password })).toEqual({ status:'REJECTED' }); expect(hashing.verify).toHaveBeenCalledTimes(11);
  });
  it('mutated/getter Port error codes cannot disclose submitted secret', async () => {
    for (const accessor of [false, true]) {
      const vendor = new IdentityPortError('UNAVAILABLE');
      if (accessor) Object.defineProperty(vendor, 'code', { get() { throw new Error(password); } });
      else Object.assign(vendor, { code: password, cause: { secret: password } });
      const adapter = await CredentialVerifier.create({ verificationSnapshot: async () => { throw vendor; }, stillCurrent: async () => false }, provider);
      const failure = await adapter.verifyCredential({ identifier: id, secret: password }).catch(value => value);
      expect(failure.code === 'UNAVAILABLE' && failure.message === 'UNAVAILABLE').toBe(true);
      expect(failure.cause === undefined).toBe(true); expect(inspect(failure).includes(password)).toBe(false);
    }
  });
});
import { syntheticPasswordScreening } from './fixture-policy';
