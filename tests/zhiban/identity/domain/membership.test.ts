import { describe, expect, it } from 'vitest';
import {
  Membership,
  RoleGrant,
  roleGrantId,
  instant,
  type MembershipReactivation,
  type ApprovedMembershipCommand,
} from '@/lib/zhiban/domain/identity';
import {
  AFTER,
  BEFORE,
  NOW,
  USER,
  TENANT,
  MEMBERSHIP,
  active,
  command,
  expectError,
  grant,
  pending,
  uuid,
} from './fixtures';

const disable = (m: Membership) => m.disable({ ...command(m), reason: 'review' });

describe('Membership lifecycle', () => {
  it('pending preloaded grants cannot authorize or activate automatically', () => {
    const old = grant(10);
    const p = pending([old]);
    expect(p.status).toBe('PENDING');
    expect(p.effectiveGrantsAt(NOW)).toEqual([]);
    const activated = p.activatePending({ ...command(p), approvedGrants: [] });
    expect(activated.effectiveGrantsAt(NOW)).toEqual([]);
    expect(activated.roleGrants[0].isRevoked).toBe(true);
    expectError(
      () => activated.activatePending({ ...command(activated), approvedGrants: [] }),
      'INVALID_STATE_TRANSITION',
    );
  });
  it('allows pending cancellation through disabled without adding a state', () => {
    const p = pending([grant(10)]);
    const disabled = disable(p);
    expect(disabled.status).toBe('DISABLED');
    expect(disabled.authorizationVersion).toBe(1);
    expect(disabled.roleGrants).toHaveLength(1);
    expect(disabled.effectiveGrantsAt(AFTER)).toEqual([]);
  });
  it('disabled grants remain recorded but ineffective', () => {
    const m = active();
    const disabled = disable(m);
    expect(disabled.roleGrants).toEqual(m.roleGrants);
    expect(disabled.effectiveGrantsAt(NOW)).toEqual([]);
    expect(disabled.disabledReason).toBe('review');
  });
  it('requires an explicit recovery mode, including at runtime', () => {
    const m = disable(active());
    const invalid = command(m) as MembershipReactivation;
    expectError(() => m.reactivate(invalid), 'REACTIVATION_MODE_REQUIRED');
    expect('activate' in m).toBe(false);
  });
  it('preserves only explicitly approved, currently effective grants', () => {
    const selected = grant(10);
    const excluded = grant(11);
    const future = grant(12, { validFrom: AFTER });
    const m = disable(active([selected, excluded, future]));
    const recovered = m.reactivate({
      ...command(m),
      mode: 'PRESERVE_EXISTING_VALID_GRANTS',
      approvedGrantIds: [selected.id],
    });
    expect(recovered.effectiveGrantsAt(NOW).map((g) => g.id)).toEqual([selected.id]);
    expect(recovered.effectiveGrantsAt(AFTER).map((g) => g.id)).toEqual([selected.id]);
    expect(recovered.roleGrants).toHaveLength(3);
    expect(recovered.roleGrants.slice(1).every((g) => g.isRevoked)).toBe(true);
    expect(recovered.disabledAt).toBeNull();
    expect(recovered.disabledReason).toBeNull();
    expect(m.roleGrants.every((g) => !g.isRevoked)).toBe(true);
  });
  it('does not auto-approve grants when approval IDs are missing', () => {
    const m = disable(active());
    const invalid = {
      ...command(m),
      mode: 'PRESERVE_EXISTING_VALID_GRANTS',
    } as MembershipReactivation;
    expectError(() => m.reactivate(invalid), 'UNAPPROVED_GRANT_REACTIVATION');
  });
  it('allows explicitly approving an empty preserve set', () => {
    const m = disable(active());
    const recovered = m.reactivate({
      ...command(m),
      mode: 'PRESERVE_EXISTING_VALID_GRANTS',
      approvedGrantIds: [],
    });
    expect(recovered.effectiveGrantsAt(AFTER)).toEqual([]);
    expect(recovered.roleGrants[0].isRevoked).toBe(true);
  });
  it.each(['revoked', 'expired', 'future'] as const)(
    'rejects preserve approval for %s grants',
    (kind) => {
      const item = grant(10, {
        validFrom: kind === 'future' ? AFTER : BEFORE,
        validUntil: kind === 'expired' ? NOW : null,
      });
      let m = pending([kind === 'revoked' ? item.revoke(NOW) : item]);
      m = disable(m);
      expectError(
        () =>
          m.reactivate({
            ...command(m),
            mode: 'PRESERVE_EXISTING_VALID_GRANTS',
            approvedGrantIds: [item.id],
          }),
        'UNAPPROVED_GRANT_REACTIVATION',
      );
      expect(m.status).toBe('DISABLED');
      expect(m.authorizationVersion).toBe(1);
    },
  );
  it('rejects unknown or duplicate approval IDs', () => {
    const m = disable(active());
    for (const ids of [[roleGrantId(uuid(90))], [m.roleGrants[0].id, m.roleGrants[0].id]]) {
      expectError(
        () =>
          m.reactivate({
            ...command(m),
            mode: 'PRESERVE_EXISTING_VALID_GRANTS',
            approvedGrantIds: ids,
          }),
        'UNAPPROVED_GRANT_REACTIVATION',
      );
    }
  });
  it('replace retains old grants as irrevocable history and uses only new grants', () => {
    const m = disable(active());
    const replacement = grant(11, { roleCode: 'TEACHER' });
    const recovered = m.reactivate({
      ...command(m),
      mode: 'REPLACE_GRANTS',
      approvedGrants: [replacement],
    });
    expect(recovered.roleGrants).toHaveLength(2);
    expect(recovered.roleGrants[0].isRevoked).toBe(true);
    expect(recovered.effectiveGrantsAt(NOW)).toEqual([replacement]);
    expect(recovered.authorizationVersion).toBe(m.authorizationVersion + 1);
  });
  it('replacement cannot reuse an old identifier to erase revocation history', () => {
    const m = disable(active());
    expectError(
      () => m.reactivate({ ...command(m), mode: 'REPLACE_GRANTS', approvedGrants: [grant(10)] }),
      'INVALID_ROLE_GRANT',
    );
  });
  it.each(['expired', 'revoked'] as const)('replacement rejects %s grants', (kind) => {
    const m = disable(active());
    const item = kind === 'expired' ? grant(12, { validUntil: NOW }) : grant(12).revoke(NOW);
    expectError(
      () => m.reactivate({ ...command(m), mode: 'REPLACE_GRANTS', approvedGrants: [item] }),
      'INVALID_ROLE_GRANT',
    );
  });
  it('new explicitly approved future grants never start early', () => {
    const m = disable(active());
    const item = grant(12, { validFrom: AFTER });
    const recovered = m.reactivate({
      ...command(m),
      mode: 'REPLACE_GRANTS',
      approvedGrants: [item],
    });
    expect(recovered.effectiveGrantsAt(NOW)).toEqual([]);
    expect(recovered.effectiveGrantsAt(AFTER)).toEqual([item]);
  });
  it('left rejoin preserves identity and never restores old roles', () => {
    const m = active();
    const left = m.leave(command(m));
    expect(left.status).toBe('LEFT');
    expect(left.effectiveGrantsAt(NOW)).toEqual([]);
    expect(left.roleGrants[0].isRevoked).toBe(true);
    const rejoined = left.rejoin({ ...command(left), approvedGrants: [grant(11)] });
    expect(rejoined.id).toBe(MEMBERSHIP);
    expect(rejoined.userId).toBe(USER);
    expect(rejoined.tenantId).toBe(TENANT);
    expect(rejoined.roleGrants).toHaveLength(2);
    expect(rejoined.effectiveGrantsAt(NOW).map((g) => g.id)).toEqual([roleGrantId(uuid(11))]);
    expect(left.rejoin({ ...command(left), approvedGrants: [] }).effectiveGrantsAt(NOW)).toEqual(
      [],
    );
  });
  it('left rejoin requires explicitly supplied new approvals', () => {
    const m = active();
    const left = m.leave(command(m));
    expectError(
      () => left.rejoin(command(left) as ApprovedMembershipCommand),
      'INVALID_ROLE_GRANT',
    );
    expectError(
      () => left.rejoin({ ...command(left), approvedGrants: [grant(10)] }),
      'INVALID_ROLE_GRANT',
    );
    expectError(
      () =>
        left.reactivate({
          ...command(left),
          mode: 'PRESERVE_EXISTING_VALID_GRANTS',
          approvedGrantIds: [],
        }),
      'INVALID_STATE_TRANSITION',
    );
  });
  it('increments authorizationVersion once per effective change; duplicate revocation is a no-op', () => {
    let m = active();
    expect(m.authorizationVersion).toBe(1);
    m = m.grantRole({ ...command(m), approvedGrant: grant(11) });
    expect(m.authorizationVersion).toBe(2);
    m = m.revokeGrant({ ...command(m), grantId: roleGrantId(uuid(11)) });
    expect(m.authorizationVersion).toBe(3);
    expect(m.revokeGrant({ ...command(m), grantId: roleGrantId(uuid(11)) })).toBe(m);
    m = disable(m);
    expect(m.authorizationVersion).toBe(4);
    m = m.reactivate({
      ...command(m),
      mode: 'PRESERVE_EXISTING_VALID_GRANTS',
      approvedGrantIds: [roleGrantId(uuid(10))],
    });
    expect(m.authorizationVersion).toBe(5);
    m = m.replaceGrants({ ...command(m), approvedGrants: [grant(12)] });
    expect(m.authorizationVersion).toBe(6);
    m = m.leave(command(m));
    expect(m.authorizationVersion).toBe(7);
    m = m.rejoin({ ...command(m), approvedGrants: [] });
    expect(m.authorizationVersion).toBe(8);
  });
  it.each([-1, 0, 1.5, NaN, Infinity, 100])(
    'rejects invalid or stale expected version %s',
    (version) => {
      const m = active();
      expectError(
        () => m.disable({ now: NOW, expectedAuthorizationVersion: version, reason: 'review' }),
        'AUTHORIZATION_VERSION_CONFLICT',
      );
      expect(m.status).toBe('ACTIVE');
    },
  );
  it('requires retry against current state after a revocation and rejects stale recovery', () => {
    const m = disable(active());
    const stale = {
      ...command(m),
      mode: 'PRESERVE_EXISTING_VALID_GRANTS' as const,
      approvedGrantIds: [roleGrantId(uuid(10))],
    };
    const revoked = m.revokeGrant({ ...command(m), now: AFTER, grantId: roleGrantId(uuid(10)) });
    expect(revoked.disabledAt).toBe(NOW);
    expectError(
      () => revoked.reactivate({ ...stale, now: AFTER }),
      'AUTHORIZATION_VERSION_CONFLICT',
    );
    expectError(
      () => revoked.reactivate({ ...stale, ...command(revoked, AFTER) }),
      'UNAPPROVED_GRANT_REACTIVATION',
    );
  });
  it('cannot mutate status, identity, version or grant collection externally', () => {
    const source = [grant(10)];
    const m = active(source);
    source.push(grant(11));
    expect(m.roleGrants).toHaveLength(1);
    for (const key of ['status', 'userId', 'tenantId', 'authorizationVersion']) {
      expect(Reflect.set(m, key, 999)).toBe(false);
    }
    expect(Reflect.set(m.roleGrants, '1', grant(12))).toBe(false);
    const effective = m.effectiveGrantsAt(NOW);
    expect(Object.isFrozen(effective)).toBe(true);
    expect('setAuthorizationVersion' in m).toBe(false);
  });
  it('rejects duplicate grants, invalid times and future-created grants without partial changes', () => {
    expectError(() => pending([grant(10), grant(10)]), 'INVALID_ROLE_GRANT');
    expectError(() => pending([grant(10, { createdAt: AFTER, validFrom: AFTER })]), 'INVALID_TIME');
    const m = active();
    expectError(() => m.disable({ ...command(m, BEFORE), reason: 'review' }), 'INVALID_TIME');
    expectError(
      () => m.grantRole({ ...command(m), approvedGrant: grant(10) }),
      'INVALID_ROLE_GRANT',
    );
    expectError(
      () => m.revokeGrant({ ...command(m), grantId: roleGrantId(uuid(90)) }),
      'INVALID_ROLE_GRANT',
    );
    expect(m.authorizationVersion).toBe(1);
  });
  it('does not physically erase expired or previously revoked grants during leave', () => {
    const expired = grant(11, { validUntil: AFTER });
    let m = active([grant(10), expired]);
    m = m.revokeGrant({ ...command(m), grantId: roleGrantId(uuid(10)) });
    const left = m.leave(command(m, instant(AFTER + 1)));
    expect(left.roleGrants).toHaveLength(2);
    expect(left.roleGrants[0].revokedAt).toBe(NOW);
    expect(left.roleGrants[1].isExpired(AFTER)).toBe(true);
    expect(left.roleGrants.every((g) => g instanceof RoleGrant)).toBe(true);
  });
});
