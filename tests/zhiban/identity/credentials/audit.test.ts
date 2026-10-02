import { describe, expect, it } from 'vitest';
import { instant, userId } from '@/lib/zhiban/domain/identity';
import { createIdentityAuditEvent, type IdentityAuditEventInput } from '@/lib/zhiban/application/identity/ports/audit';
import { credentialId, securityEpoch } from '@/lib/zhiban/application/identity/ports/credential-repository';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
const common = { actor: { kind:'SYSTEM' as const }, requestId:null, reason:'SECURITY_POLICY' as const, occurredAt:instant(1000), userId:userId('018f0000-0000-7000-8000-000000000001'), credentialId:credentialId('018f0000-0000-7000-8000-000000000002') };
const inputs: IdentityAuditEventInput[] = [
  { ...common,type:'CREDENTIAL_CREATED',repositoryRevisionAfter:repositoryRevision('1'),securityEpochAfter:securityEpoch('1') },
  { ...common,type:'CREDENTIAL_REPLACED',priorCredentialId:null,repositoryRevisionBefore:repositoryRevision('1'),repositoryRevisionAfter:repositoryRevision('2'),securityEpochBefore:securityEpoch('1'),securityEpochAfter:securityEpoch('2') },
  { ...common,type:'CREDENTIAL_REVOKED',repositoryRevisionBefore:repositoryRevision('1'),repositoryRevisionAfter:repositoryRevision('2'),securityEpochBefore:securityEpoch('1'),securityEpochAfter:securityEpoch('2') },
  { ...common,type:'CREDENTIAL_REHASHED',repositoryRevisionBefore:repositoryRevision('1'),repositoryRevisionAfter:repositoryRevision('2'),securityEpoch:securityEpoch('1') },
];
describe('additive closed Credential audit facts', () => {
  for (const input of inputs) it(`${input.type}: exact whitelist strips nested/top-level secret/provider injection`, () => {
    const event = createIdentityAuditEvent({ ...input, secret:'forbidden',verifier:'forbidden',salt:'forbidden',provider:{secret:'forbidden'},actor:{...input.actor,password:'forbidden'} } as unknown as IdentityAuditEventInput);
    expect(Object.keys(event).sort()).toEqual(Object.keys(input).sort());
    expect(JSON.stringify(event)).not.toContain('forbidden'); expect(Object.isFrozen(event)).toBe(true);
  });
  it('revision and epoch exactly +1; no Number rounding at int8 boundaries', () => {
    const replaced = inputs[1];
    expect(() => createIdentityAuditEvent({ ...replaced,repositoryRevisionAfter:repositoryRevision('3') } as IdentityAuditEventInput)).toThrow();
    expect(() => createIdentityAuditEvent({ ...replaced,securityEpochAfter:securityEpoch('3') } as IdentityAuditEventInput)).toThrow();
    const event = createIdentityAuditEvent({ ...common,type:'CREDENTIAL_REVOKED',repositoryRevisionBefore:repositoryRevision('9007199254740993'),repositoryRevisionAfter:repositoryRevision('9007199254740994'),securityEpochBefore:securityEpoch('9007199254740993'),securityEpochAfter:securityEpoch('9007199254740994') });
    expect(event).toHaveProperty('securityEpochAfter','9007199254740994');
  });
});
