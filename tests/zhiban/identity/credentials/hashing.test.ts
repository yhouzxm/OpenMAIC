import { inspect } from 'node:util';
import { hash } from '@node-rs/argon2';
import { describe, expect, it, vi } from 'vitest';
import * as argon2 from '@node-rs/argon2';
import { Argon2PasswordHasher, PASSWORD_HASH_POLICY, validSecret } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { issueVerifier, rehashMaterial, validateVerifier, verifierMaterial } from '@/lib/zhiban/infrastructure/identity/credentials/verifier-material';
import { credentialId, securityEpoch } from '@/lib/zhiban/application/identity/ports/credential-repository';
import { LocalCompromisedPasswordScreening } from '@/lib/zhiban/infrastructure/identity/credentials/password-screening';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import type { PasswordScreeningPort } from '@/lib/zhiban/application/identity/ports/password-screening';

// Forward every call to the real native provider except explicit one-shot error injection.
vi.mock('@node-rs/argon2', async importOriginal => {
  const real = await importOriginal<typeof import('@node-rs/argon2')>();
  return { ...real, hash: vi.fn(real.hash), verify: vi.fn(real.verify) };
});

const password = 'Synthetic-only! long passphrase';
describe.sequential('credential real Argon2id provider and private handles', () => {
  it('mandatory compromised-password screening fails closed on match/outage; bounded local corpus snapshots configuration', async () => {
    const corpus = [password]; const screen = new LocalCompromisedPasswordScreening(corpus); corpus.length = 0;
    await expect(new Argon2PasswordHasher(screen).hash(password)).rejects.toMatchObject({ code:'INTEGRITY_FAILURE' });
    await expect(new Argon2PasswordHasher({ async isCompromised() { throw new Error(password); } }).hash(password)).rejects.toMatchObject({ code:'UNAVAILABLE',message:'UNAVAILABLE' });
    expect(() => new LocalCompromisedPasswordScreening([])).toThrow('INTEGRITY_FAILURE');
    const vendorError = Object.assign(new IdentityPortError('UNAVAILABLE'), { cause: { secret:password } });
    const failure = await new Argon2PasswordHasher({ async isCompromised() { throw vendorError; } }).hash(password).catch(error => error);
    expect(failure.cause === undefined).toBe(true); expect(failure !== vendorError).toBe(true);
  });
  it.each([undefined, null, 0, '', 'false'])('malformed screening result %# cannot fail open', async value => {
    const screening = { async isCompromised() { return value; } } as unknown as PasswordScreeningPort;
    const before = vi.mocked(argon2.hash).mock.calls.length;
    await expect(new Argon2PasswordHasher(screening).hash(password)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(vi.mocked(argon2.hash).mock.calls.length).toBe(before);
  });
  it('screening error code accessor is never invoked and cannot escape with a secret', async () => {
    const vendor = new IdentityPortError('UNAVAILABLE');
    const accessor = vi.fn(() => { throw new Error(password); });
    Object.defineProperty(vendor, 'code', { get: accessor });
    const failure = await new Argon2PasswordHasher({ async isCompromised() { throw vendor; } }).hash(password).catch(value => value);
    expect(failure.code === 'UNAVAILABLE' && failure.message === 'UNAVAILABLE').toBe(true); expect(failure.cause === undefined).toBe(true);
    expect(accessor).not.toHaveBeenCalled(); expect(inspect(failure).includes(password)).toBe(false);
  });
  it('hash/verify behavior, random provider salts, fixed production policy, redacted handles', async () => {
    const provider = new Argon2PasswordHasher(syntheticPasswordScreening);
    const a = await provider.hash(password), b = await provider.hash(password);
    const encoded = verifierMaterial(a);
    expect(/^\$argon2id\$v=19\$m=32768,t=3,p=1\$/.test(encoded)).toBe(true);
    expect(encoded !== verifierMaterial(b)).toBe(true);
    expect(await provider.verify(password, a)).toBe(true);
    expect(await provider.verify('Synthetic wrong passphrase', a)).toBe(false);
    expect(provider.needsRehash(a)).toBe(false);
    expect(JSON.stringify(a).includes(encoded)).toBe(false);
    expect(inspect(a).includes(encoded)).toBe(false);
    expect(Object.keys(a)).toEqual(['kind']);
  });
  it('legacy approved work factor rehash binds verified same secret/current material', async () => {
    const provider = new Argon2PasswordHasher(syntheticPasswordScreening);
    const old = issueVerifier(await hash(password, { ...PASSWORD_HASH_POLICY, memoryCost: 19456, timeCost: 2 }));
    expect(provider.needsRehash(old)).toBe(true);
    expect(await provider.rehashVerified('not the password', old)).toBeNull();
    const proof = await provider.rehashVerified(password, old);
    expect(proof).not.toBeNull();
    const encoded = rehashMaterial(proof!, verifierMaterial(old));
    expect(await provider.verify(password, issueVerifier(encoded))).toBe(true);
    expect(() => rehashMaterial(proof!, encoded)).toThrow('INTEGRITY_FAILURE');
    expect(JSON.stringify(proof).includes(encoded)).toBe(false);
  });
  it.each(['', 'short', '123456789012345', '\ud800'.repeat(20), 'é'.repeat(513)])('creation policy rejects bounded invalid vector %# without exposure', async secret => {
    const failure = await new Argon2PasswordHasher(syntheticPasswordScreening).hash(secret).catch(error => error);
    expect(failure.code === 'INTEGRITY_FAILURE' && failure.message === 'INTEGRITY_FAILURE').toBe(true);
    expect(failure.cause === undefined).toBe(true);
  });
  it('no trim, normalization or prehash; long Unicode passwords supported', async () => {
    const provider = new Argon2PasswordHasher(syntheticPasswordScreening);
    const secret = '  Unicode e\u0301 passphrase!  ';
    const handle = await provider.hash(secret);
    expect(await provider.verify(secret, handle)).toBe(true);
    expect(await provider.verify(secret.trim(), handle)).toBe(false);
    expect(await provider.verify(secret.normalize('NFC'), handle)).toBe(false);
    expect(validSecret('é'.repeat(512), true)).toBe(true);
  });
  it('forged/copied/frozen handles cannot extract or verify', async () => {
    const provider = new Argon2PasswordHasher(syntheticPasswordScreening);
    const good = await provider.hash(password);
    const forged = Object.freeze({ ...good });
    expect(() => verifierMaterial(forged)).toThrow('INTEGRITY_FAILURE');
    await expect(provider.verify(password, forged)).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
  });
  it('bounds admission instead of queueing attacker-controlled raw secrets', async () => {
    const provider = new Argon2PasswordHasher(syntheticPasswordScreening);
    const first = provider.hash(password), second = provider.hash(password);
    await expect(new Argon2PasswordHasher(syntheticPasswordScreening).hash(password)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    await Promise.all([first, second]);
    expect(await provider.hash(password)).toBeDefined();
  });
  it('provider hash/verify throws sanitize errors and release all process-wide KDF permits', async () => {
    const provider = new Argon2PasswordHasher(syntheticPasswordScreening), handle = await provider.hash(password);
    vi.mocked(argon2.hash).mockRejectedValueOnce(new Error(password));
    await expect(provider.hash(password)).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'UNAVAILABLE' });
    vi.mocked(argon2.verify).mockRejectedValueOnce(new Error(password));
    await expect(provider.verify(password, handle)).rejects.toMatchObject({ code: 'UNAVAILABLE', message: 'UNAVAILABLE' });
    const handles = await Promise.all([provider.hash(password), provider.hash(password)]);
    expect(await provider.verify(password, handles[0])).toBe(true);
  });
  it.each(['0', '01', '+1', '1\n', '9223372036854775808', '1e3', 1])('epoch rejects malformed canonical integer %#', value => {
    if (value === '0') expect(securityEpoch(value)).toBe('0');
    else expect(() => securityEpoch(value as string)).toThrow();
  });
  it('UUID and PHC input grammar are fail closed', async () => {
    expect(() => credentialId('018f0000-0000-4000-8000-000000000001')).toThrow();
    const encoded = verifierMaterial(await new Argon2PasswordHasher(syntheticPasswordScreening).hash(password));
    for (const bad of [encoded + '\n', encoded.replace('argon2id', 'argon2i'), encoded.replace('m=32768', 'm=999999'), encoded.replace('t=3', 't=1'), encoded.replace('p=1', 'p=2'), encoded.replace('v=19', 'v=16'), '', 'x'.repeat(1025)])
      expect(() => validateVerifier(bad)).toThrow('INTEGRITY_FAILURE');
  });
});
import { syntheticPasswordScreening } from './fixture-policy';
