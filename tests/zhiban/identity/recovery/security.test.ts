import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  randomLocator,
  decode,
  ticketDigest,
  sameSecret,
} from '@/lib/zhiban/infrastructure/identity/recovery/material';
import {
  policy,
  policyDigest,
  budgetCeilings,
} from '@/lib/zhiban/infrastructure/identity/recovery/policy';
import { RecoveryRegistry } from '@/lib/zhiban/infrastructure/identity/recovery/registry';
import {
  RecoveryEvidence,
  evidenceFields,
} from '@/lib/zhiban/infrastructure/identity/recovery/evidence';
import {
  safeError,
  increment,
  RecoveryError,
} from '@/lib/zhiban/infrastructure/identity/recovery/values';
import { issueVerifier } from '@/lib/zhiban/infrastructure/identity/credentials/verifier-material';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { syntheticPasswordScreening } from '../credentials/fixture-policy';
import { budgets, ids, signedStore } from './fixtures';
afterEach(() => vi.restoreAllMocks());
const binding = {
  environment: 'synthetic',
  site: 'site-a',
  caseId: ids.nextCommandId(),
  generation: '1',
};
const fakeVerifier = () =>
  issueVerifier(
    '$argon2id$v=19$m=32768,t=3,p=1$' +
      Buffer.alloc(16, 4).toString('base64').replace(/=/g, '') +
      '$' +
      Buffer.alloc(32, 9).toString('base64').replace(/=/g, ''),
  );
describe('manual recovery security boundaries', () => {
  it('ticket is independent 32-byte CSPRNG and self-describing canonical encoding', () => {
    const a = randomLocator('mrec1_'),
      b = randomLocator('mrec1_');
    expect(a === b).toBe(false);
    expect(decode(a, 'mrec1_')?.length).toBe(32);
    expect(/^[a-f0-9]{64}$/.test(ticketDigest(a, binding)!)).toBe(true);
    const bytes = decode(a, 'mrec1_')!;
    expect(
      ticketDigest(a, binding) ===
        createHash('sha256')
          .update(
            [
              'zhiban-manual-recovery-ticket-v1',
              'synthetic',
              'site-a',
              binding.caseId,
              '1',
              '',
            ].join('\0'),
          )
          .update(bytes)
          .digest('hex'),
    ).toBe(true);
  });
  it.each([
    '',
    'x',
    'mrec1_' + 'a'.repeat(42),
    'mrec1_' + 'a'.repeat(43) + '=',
    'mrec1_' + 'a'.repeat(43) + '\n',
    'mpair1_' + 'a'.repeat(43),
  ])('malformed/purpose-crossed ticket rejects %s', (v) => expect(decode(v, 'mrec1_')).toBeNull());
  it.each(['site', 'environment', 'caseId', 'generation'])('digest binds %s', (key) => {
    const raw = randomLocator('mrec1_');
    const next = {
      ...binding,
      [key]: key === 'caseId' ? ids.nextCommandId() : key === 'generation' ? '2' : 'other',
    };
    expect(ticketDigest(raw, binding) === ticketDigest(raw, next)).toBe(false);
  });
  it.each(Object.keys(budgetCeilings))('finite %s ceiling is enforced', (key) => {
    expect(() => policy({ ...budgets, [key]: 0 })).toThrow();
    expect(() =>
      policy({ ...budgets, [key]: (budgetCeilings as Record<string, number>)[key] + 1 }),
    ).toThrow();
  });
  it('policy digest binds all budgets and environment', () => {
    expect(policyDigest(budgets)).not.toBe(policyDigest({ ...budgets, global_limit: 1001 }));
    expect(() => policy({ ...budgets, extra: true } as typeof budgets)).toThrow();
  });
  it.each(['0', '01', '+1', '1.0', '9223372036854775807'])(
    'revision malformed or max %s fails closed',
    (v) => expect(() => increment(v)).toThrow(),
  );
  it('revision above JS safe range advances precisely', () =>
    expect(increment('9007199254740993')).toBe('9007199254740994'));
  it('error object carries neither cause nor custom/provider text', () => {
    const error = Object.assign(new Error('Synthetic-secret-value'), {
      cause: 'Synthetic-verifier-value',
      code: 'custom-secret',
    });
    const result = safeError(error);
    expect(result.message).toBe('RECOVERY_UNAVAILABLE');
    expect(JSON.stringify(result)).not.toMatch(/Synthetic|custom-secret/);
    expect('cause' in result).toBe(false);
  });
  it('mutated RecoveryError code/getter and equal-length Unicode proof cannot expose secrets', () => {
    const e = new RecoveryError('RECOVERY_REJECTED');
    Object.assign(e, { code: 'Synthetic-secret-code' });
    expect(safeError(e).code).toBe('RECOVERY_UNAVAILABLE');
    Object.defineProperty(e, 'code', {
      get() {
        throw new Error('Synthetic-private-detail');
      },
    });
    expect(safeError(e).code).toBe('RECOVERY_UNAVAILABLE');
    expect(sameSecret('é', 'x')).toBe(false);
  });
  it('real production Argon2 + screening hash and correct/wrong verify', async () => {
    const h = new Argon2PasswordHasher(syntheticPasswordScreening),
      v = await h.hash('Synthetic-recovery-password-for-provider!');
    expect(await h.verify('Synthetic-recovery-password-for-provider!', v)).toBe(true);
    expect(await h.verify('Synthetic-recovery-wrong-password!', v)).toBe(false);
    expect(JSON.stringify(v)).not.toContain('argon2');
  });
  it.each([true, undefined, null, 'false'])(
    'screening invalid verdict fails closed',
    async (verdict) => {
      const h = new Argon2PasswordHasher({ isCompromised: async () => verdict as boolean });
      await expect(h.hash('Synthetic-recovery-screening-password!')).rejects.toThrow();
    },
  );
  it('screening exception sanitizes and KDF permit releases', async () => {
    const h = new Argon2PasswordHasher({
      isCompromised: async () => {
        throw new Error('Synthetic-input-secret');
      },
    });
    await expect(h.hash('Synthetic-recovery-screening-password!')).rejects.not.toThrow(
      'Synthetic-input-secret',
    );
    const good = new Argon2PasswordHasher(syntheticPasswordScreening);
    expect(await good.hash('Synthetic-recovery-after-error-password!')).toBeDefined();
  });
});
describe('signed original evidence trust', () => {
  it.each([Infinity, NaN, -1])('non-finite/invalid key lifetime rejects %#', (until) => {
    const s = signedStore();
    expect(
      () => new RecoveryEvidence(s.store, 'synthetic', [{ ...s.key, validUntil: until }]),
    ).toThrow();
  });
  const source = () => ({
    source_id: ids.nextCommandId(),
    source_ref: 'original-enrollment',
    bound_user_id: ids.nextUserId(),
    source_version: '1',
    enrollment_approval_ref: 'original-approval',
  });
  it('real Ed25519 canonical signed manifest succeeds', async () => {
    const s = signedStore();
    s.put('enroll', 'SOURCE_ENROLLMENT', source());
    expect((await s.evidence.load('enroll', 'SOURCE_ENROLLMENT')).digest).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(['signature', 'canonical', 'keyRef'])('tampered %s rejects', async (field) => {
    const s = signedStore(),
      e = s.put('enroll', 'SOURCE_ENROLLMENT', source());
    s.records.set('enroll', {
      ...e,
      [field]:
        field === 'keyRef' ? 'foreign' : field === 'canonical' ? e.canonical + ' ' : 'a'.repeat(86),
    });
    await expect(s.evidence.load('enroll', 'SOURCE_ENROLLMENT')).rejects.toThrow();
  });
  it('wrong requested purpose rejects valid signature', async () => {
    const s = signedStore();
    s.put('enroll', 'SOURCE_ENROLLMENT', source());
    await expect(s.evidence.load('enroll', 'NOTICE')).rejects.toThrow();
  });
  it.each(['issuer_ref', 'environment_ref', 'purpose', 'source_id', 'source_version'])(
    'signed but invalid %s is rejected',
    async (field) => {
      const s = signedStore();
      s.put('enroll', 'SOURCE_ENROLLMENT', { ...source(), [field]: 'invalid' });
      await expect(s.evidence.load('enroll', 'SOURCE_ENROLLMENT')).rejects.toThrow();
    },
  );
  it('key is pinned to source and synchronization uncertainty closes service', async () => {
    const s = signedStore();
    s.put('enroll', 'SOURCE_ENROLLMENT', source());
    await expect(s.evidence.load('enroll', 'SOURCE_ENROLLMENT', 'wrong-key')).rejects.toThrow();
    s.uncertain();
    await expect(s.evidence.load('enroll', 'SOURCE_ENROLLMENT')).rejects.toThrow();
  });
  it('duplicate ordered fields rejected even if signed', async () => {
    const s = signedStore(),
      e = s.put('enroll', 'SOURCE_ENROLLMENT', source()),
      pairs = JSON.parse(e.canonical);
    pairs[1] = pairs[0];
    const canonical = JSON.stringify(pairs);
    s.records.set('enroll', {
      canonical,
      keyRef: s.key.keyRef,
      signature: sign(null, Buffer.from(canonical), s.privateKey).toString('base64url'),
    });
    await expect(s.evidence.load('enroll', 'SOURCE_ENROLLMENT')).rejects.toThrow();
  });
  it('non-Ed25519 key rejected', () => {
    const s = signedStore(),
      rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    expect(
      () => new RecoveryEvidence(s.store, 'synthetic', [{ ...s.key, publicKey: rsa.publicKey }]),
    ).toThrow();
  });
  it('signature field set bounded and closed', () =>
    expect(new Set(evidenceFields('REGISTRATION')).size).toBe(
      evidenceFields('REGISTRATION').length,
    ));
});
describe('bounded two-lane single-use registry', () => {
  const ceremony = () => ({
    caseId: ids.nextCommandId(),
    actor: ids.nextUserId(),
    subject: ids.nextUserId(),
    site: 'site-a',
    operatorTerminal: 'staff',
    subjectTerminal: 'person',
    caseRevision: '3',
    deadline: Date.now() + 600000,
  });
  function setup() {
    const r = new RecoveryRegistry(2, 600000, 300000),
      b = ceremony(),
      pair = r.pair(b),
      c = r.open(pair, 'site-a', 'person');
    return { r, b, c };
  }
  it('pair code cannot be replayed or moved to another terminal', () => {
    const r = new RecoveryRegistry(2, 600000, 300000),
      b = ceremony(),
      p = r.pair(b);
    expect(() => r.open(p, 'site-a', 'foreign')).toThrow();
    r.open(p, 'site-a', 'person');
    expect(() => r.open(p, 'site-a', 'person')).toThrow();
  });
  it('subject cookie/proof must match site and terminal', () => {
    const { r, c } = setup();
    expect(() => r.ceremony(c.cookie, c.csrf, 'foreign', 'person')).toThrow();
    expect(() => r.ceremony(c.cookie, 'bad', 'site-a', 'person')).toThrow();
  });
  it('raw ticket delivery occurs once, never serializes registry', () => {
    const { r, b, c } = setup(),
      raw = randomLocator('mrec1_');
    r.deliver(
      c.cookie,
      { raw, generation: '1', id: ids.nextCommandId(), digest: 'a'.repeat(64) },
      '4',
    );
    expect(r.takeTicket(c.cookie) === raw).toBe(true);
    expect(r.takeTicket(c.cookie)).toBeNull();
    expect(JSON.stringify(r).includes(raw)).toBe(false);
    expect(JSON.stringify(r).includes(c.cookie)).toBe(false);
    r.invalidate(b.caseId);
    expect(() => r.takeTicket(c.cookie)).toThrow();
  });
  it('submission replacement and claim consume one handle', () => {
    const { r, b, c } = setup(),
      id = ids.nextCommandId();
    r.deliver(
      c.cookie,
      { raw: randomLocator('mrec1_'), generation: '1', id, digest: 'a'.repeat(64) },
      '4',
    );
    r.takeTicket(c.cookie);
    const sb = {
      caseId: b.caseId,
      caseRevision: '4',
      generation: '1',
      ticketId: id,
      ticketDigest: 'a'.repeat(64),
      approvalDigest: 'b'.repeat(64),
      deadline: Date.now() + 300000,
      ceremony: c.cookie,
    };
    const first = r.submit(c.cookie, sb, fakeVerifier()),
      second = r.submit(c.cookie, sb, fakeVerifier());
    expect(() => r.claim(first, b.caseId)).toThrow();
    expect(r.claim(second, b.caseId).ticketId).toBe(id);
    expect(() => r.claim(second, b.caseId)).toThrow();
  });
  it('ticket lifetime cannot extend a shorter ceremony or submission deadline', () => {
    const r = new RecoveryRegistry(2, 1000, 500),
      b = ceremony();
    const c = r.open(r.pair(b), 'site-a', 'person'),
      id = ids.nextCommandId();
    r.deliver(
      c.cookie,
      { raw: randomLocator('mrec1_'), generation: '1', id, digest: 'a'.repeat(64) },
      '4',
    );
    r.takeTicket(c.cookie);
    const binding = {
      caseId: b.caseId,
      caseRevision: '4',
      generation: '1',
      ticketId: id,
      ticketDigest: 'a'.repeat(64),
      approvalDigest: 'b'.repeat(64),
      ceremony: c.cookie,
      deadline: c.deadline,
    };
    expect(() =>
      r.submit(c.cookie, { ...binding, deadline: c.deadline + 1 }, fakeVerifier()),
    ).toThrow();
    const at = Date.now(),
      ref = r.submit(c.cookie, binding, fakeVerifier());
    vi.spyOn(Date, 'now').mockReturnValue(at + 501);
    expect(() => r.claim(ref, b.caseId)).toThrow();
  });
  it('expiry equality and backward wall time reject', () => {
    const { r, c } = setup(),
      at = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(at + 600001);
    expect(() => r.ceremony(c.cookie, c.csrf, 'site-a', 'person')).toThrow();
    vi.mocked(Date.now).mockReturnValue(at - 1000);
    expect(() => r.ceremony(c.cookie, c.csrf, 'site-a', 'person')).toThrow();
  });
  it('finite capacity rejects new unbounded pairing work', () => {
    const r = new RecoveryRegistry(1, 600000, 300000);
    r.pair(ceremony());
    expect(() => r.pair(ceremony())).toThrow();
  });
  it('explicit re-pair of the same case works at capacity and invalidates the old ceremony', () => {
    const r = new RecoveryRegistry(1, 600000, 300000),
      b = ceremony();
    const old = r.open(r.pair(b), 'site-a', 'person');
    const next = r.open(r.pair({ ...b, caseRevision: '4' }), 'site-a', 'person');
    expect(() => r.ceremony(old.cookie, old.csrf, 'site-a', 'person')).toThrow();
    expect(r.ceremony(next.cookie, next.csrf, 'site-a', 'person').caseRevision).toBe('4');
  });
  it('restart and fake submission handles cannot authenticate', () => {
    const { r, b } = setup();
    expect(() => r.claim(randomLocator('msub1_'), b.caseId)).toThrow();
    const fresh = new RecoveryRegistry(2, 600000, 300000);
    expect(fresh.ready(b.caseId)).toBeNull();
  });
});
