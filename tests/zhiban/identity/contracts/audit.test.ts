import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  createIdentityAuditEvent,
  type IdentityAuditEvent,
  type IdentityAuditEventInput,
  type IdentityAuditType,
} from '@/lib/zhiban/application/identity/ports';
import {
  classId,
  classScope,
  instant,
  membershipId,
  roleGrantId,
  tenantId,
  userId,
} from '@/lib/zhiban/domain/identity';
import { FakeAudit } from './fakes';

const NOW = instant(Date.parse('2026-09-22T12:00:00.000Z'));
const USER = userId('01996e82-5800-7000-8000-000000000003');
const TENANT = tenantId('01996e82-5800-7000-8000-000000000001');
const MEMBERSHIP = membershipId('01996e82-5800-7000-8000-000000000004');
const GRANT = roleGrantId('01996e82-5800-7000-8000-000000000005');
const OLD_GRANT = roleGrantId('01996e82-5800-7000-8000-000000000007');
const scope = classScope(classId('01996e82-5800-7000-8000-000000000006'));
const approvedGrant = {
  id: GRANT,
  roleCode: 'TEACHER' as const,
  scope,
  validFrom: NOW,
  validUntil: null,
};
const base = {
  occurredAt: NOW,
  actor: { kind: 'USER' as const, userId: USER },
  requestId: 'request-1',
  reason: 'ACCESS_REVIEW' as const,
};
const membership = {
  membershipId: MEMBERSHIP,
  tenantId: TENANT,
  userId: USER,
  authorizationVersionBefore: 3,
  authorizationVersionAfter: 4,
};

describe('controlled Identity audit event contract', () => {
  it('projects away sensitive and unknown fields at runtime, including nested extras', async () => {
    const input: IdentityAuditEventInput = {
      ...base,
      ...membership,
      type: 'MEMBERSHIP_REACTIVATED',
      mode: 'REPLACE_GRANTS',
      priorGrantIds: [OLD_GRANT],
      approvedGrants: [approvedGrant],
    };
    const contaminated = {
      ...input,
      secret: 'synthetic-secret',
      password: 'synthetic-password',
      rawToken: 'synthetic-token',
      tokenDigest: 'synthetic-digest',
      credential: { secret: 'nested-secret' },
      providerKey: 'synthetic-provider-key',
      actor: { ...base.actor, secret: 'nested-secret' },
      approvedGrants: [{ ...approvedGrant, rawToken: 'nested-token' }],
    };
    const event = createIdentityAuditEvent(contaminated);
    const audit = new FakeAudit();
    await audit.append(event);
    expect(audit.events).toHaveLength(1);
    const saved = JSON.stringify(audit.events[0]);
    for (const forbidden of [
      'secret',
      'password',
      'rawToken',
      'tokenDigest',
      'credential',
      'providerKey',
    ]) {
      expect(saved).not.toContain(forbidden);
    }
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.actor)).toBe(true);
    if (event.type !== 'MEMBERSHIP_REACTIVATED') throw new Error('Unexpected audit type.');
    expect(Object.isFrozen(event.approvedGrants)).toBe(true);
    expect(Object.isFrozen(event.approvedGrants[0].scope)).toBe(true);
    await expect(audit.append(contaminated as unknown as IdentityAuditEvent)).rejects.toThrow();
  });

  it('records reactivation mode, reason, versions, approved grant and scope', () => {
    const event = createIdentityAuditEvent({
      ...base,
      ...membership,
      type: 'MEMBERSHIP_REACTIVATED',
      mode: 'PRESERVE_EXISTING_VALID_GRANTS',
      priorGrantIds: [GRANT],
      approvedGrants: [approvedGrant],
    });
    expect(event).toMatchObject({
      type: 'MEMBERSHIP_REACTIVATED',
      membershipId: MEMBERSHIP,
      tenantId: TENANT,
      userId: USER,
      mode: 'PRESERVE_EXISTING_VALID_GRANTS',
      priorGrantIds: [GRANT],
      reason: 'ACCESS_REVIEW',
      authorizationVersionBefore: 3,
      authorizationVersionAfter: 4,
      approvedGrants: [{ id: GRANT, roleCode: 'TEACHER', scope }],
    });
    expect(() =>
      createIdentityAuditEvent({
        ...base,
        ...membership,
        type: 'MEMBERSHIP_REACTIVATED',
        mode: 'REPLACE_GRANTS',
        priorGrantIds: [OLD_GRANT],
        approvedGrants: [approvedGrant],
        authorizationVersionAfter: 3,
      }),
    ).toThrow();
  });

  it('records rejoin as new approved grants, and grant revoke with its original facts', () => {
    const rejoin = createIdentityAuditEvent({
      ...base,
      ...membership,
      type: 'MEMBERSHIP_REJOINED',
      priorGrantIds: [OLD_GRANT],
      approvedGrants: [approvedGrant],
    });
    expect(rejoin).toMatchObject({
      type: 'MEMBERSHIP_REJOINED',
      membershipId: MEMBERSHIP,
      tenantId: TENANT,
      userId: USER,
      reason: 'ACCESS_REVIEW',
      priorGrantIds: [OLD_GRANT],
      authorizationVersionBefore: 3,
      authorizationVersionAfter: 4,
      approvedGrants: [{ id: GRANT, roleCode: 'TEACHER', scope }],
    });
    expect(() =>
      createIdentityAuditEvent({
        ...base,
        ...membership,
        type: 'MEMBERSHIP_REJOINED',
        priorGrantIds: [GRANT],
        approvedGrants: [approvedGrant],
      }),
    ).toThrow();
    const revoke = createIdentityAuditEvent({
      ...base,
      ...membership,
      type: 'ROLE_GRANT_REVOKED',
      grant: approvedGrant,
    });
    expect(revoke).toMatchObject({
      type: 'ROLE_GRANT_REVOKED',
      membershipId: MEMBERSHIP,
      tenantId: TENANT,
      reason: 'ACCESS_REVIEW',
      authorizationVersionBefore: 3,
      authorizationVersionAfter: 4,
      grant: { id: GRANT, roleCode: 'TEACHER', scope },
    });
  });

  it('rejects unknown event types and reasons, and keeps the event vocabulary closed', () => {
    expect(() =>
      createIdentityAuditEvent({
        ...base,
        type: 'UNKNOWN_EVENT',
      } as unknown as IdentityAuditEventInput),
    ).toThrow();
    expect(() =>
      createIdentityAuditEvent({
        ...base,
        userId: USER,
        type: 'USER_DISABLED',
        reason: 'secret-filled free text',
      } as unknown as IdentityAuditEventInput),
    ).toThrow();
    expectTypeOf<'UNKNOWN_EVENT' extends IdentityAuditType ? true : false>().toEqualTypeOf<false>();
  });
});
