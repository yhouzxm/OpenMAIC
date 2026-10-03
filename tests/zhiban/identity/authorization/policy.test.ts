import { describe, expect, it } from 'vitest';
import {
  Membership,
  Role,
  RoleGrant,
  SystemAdminGrant,
  permission,
  roleId,
  roleGrantId,
  systemAdminGrantId,
  tenantId,
  classId,
  courseId,
  selfScope,
  tenantScope,
  classScope,
  courseScope,
} from '@/lib/zhiban/domain/identity';
import {
  evaluateAuthorization,
  scopeMatches,
  mayDelegate,
  lastAdminCounts,
  systemAdminEligible,
  type AuthorizationInput,
} from '@/lib/zhiban/domain/identity/policies/authorization';
import { identityActionRule } from '@/lib/zhiban/application/identity/authorize';
import { id, tenant, time, member, grant, catalogPort, catalogConfig } from './fixtures';
import { ApprovedIdentityCatalog } from '@/lib/zhiban/infrastructure/identity/authorization/identity-catalog';

async function base(): Promise<AuthorizationInput> {
  const actor = member(10);
  return {
    actorUserId: actor.userId,
    userStatus: 'ACTIVE',
    tenantId: tenant,
    tenantStatus: 'ACTIVE',
    membership: actor,
    catalog: (await catalogPort().load()).snapshot,
    rule: identityActionRule('MEMBERSHIP_READ')!,
    resource: {
      tenantId: tenant,
      resourceId: id(20),
      scope: tenantScope(),
      subjectUserId: null,
      subjectMembershipId: null,
      relationshipSatisfied: true,
      stateAllowed: true,
    },
    now: time,
  };
}
describe('pure authorization security policy', () => {
  it('compound permissions cannot be assembled from two different effective grants', async () => {
    const b = await base(),
      m = member(10, [grant(801, 'TENANT_ADMIN'), grant(802, 'STUDENT', tenantScope())]);
    const roles = b.catalog.roles.map((r) =>
      r.code === 'TENANT_ADMIN'
        ? Role.create(r.id, r.code, ['membership:manage'].map(permission))
        : r.code === 'STUDENT'
          ? Role.create(r.id, r.code, ['role:assign'].map(permission))
          : r,
    );
    expect(
      evaluateAuthorization({
        ...b,
        membership: m,
        catalog: { ...b.catalog, roles },
        rule: identityActionRule('MEMBERSHIP_ACTIVATE')!,
      }).decision,
    ).toBe('DENY');
  });
  it('copied DTO methods cannot fake Domain issuance', async () => {
    const b = await base(),
      fake = {
        ...b.membership,
        effectiveGrantsAt: () => b.membership.roleGrants,
      } as unknown as Membership;
    expect(evaluateAuthorization({ ...b, membership: fake }).decision).toBe('DENY');
    expect(() =>
      lastAdminCounts(tenant, [fake], new Map([[b.actorUserId, 'ACTIVE']]), b.catalog, time),
    ).toThrow();
  });
  it('allows only complete active chain and emits a minimal receipt', async () => {
    const input = await base(),
      result = evaluateAuthorization(input);
    expect(result).toMatchObject({
      decision: 'ALLOW',
      grantId: input.membership.roleGrants[0].id,
      authorizationVersion: 1,
    });
    expect(JSON.stringify(result)).not.toMatch(/permissions|roleGrants|password|digest|secret/);
  });
  it.each(['userStatus', 'tenantStatus'] as const)('%s disabled denies', async (key) => {
    expect(evaluateAuthorization({ ...(await base()), [key]: 'DISABLED' }).decision).toBe('DENY');
  });
  it('archived tenant denies', async () => {
    expect(evaluateAuthorization({ ...(await base()), tenantStatus: 'ARCHIVED' }).decision).toBe(
      'DENY',
    );
  });
  it.each(['PENDING', 'DISABLED', 'LEFT'] as const)('membership %s denies', async (status) => {
    const b = await base(),
      m = b.membership;
    const next =
      status === 'PENDING'
        ? Membership.create({ id: m.id, userId: m.userId, tenantId: tenant, now: time })
        : status === 'DISABLED'
          ? m.disable({ now: time, expectedAuthorizationVersion: 1, reason: 'review' })
          : m.leave({ now: time, expectedAuthorizationVersion: 1 });
    expect(evaluateAuthorization({ ...b, membership: next }).decision).toBe('DENY');
  });
  it.each(['revoked', 'expired', 'future', 'boundary'] as const)(
    'grant %s denies',
    async (mode) => {
      const b = await base(),
        g =
          mode === 'revoked'
            ? grant(800).revoke(time)
            : grant(
                800,
                'TENANT_ADMIN',
                tenantScope(),
                mode === 'future' ? 4000 : 1000,
                mode === 'expired' ? 2000 : mode === 'boundary' ? 3000 : null,
              );
      const m =
        mode === 'revoked'
          ? member(10, [grant(800)]).revokeGrant({
              now: time,
              expectedAuthorizationVersion: 1,
              grantId: g.id,
            })
          : member(10, [g]);
      expect(evaluateAuthorization({ ...b, membership: m }).decision).toBe('DENY');
    },
  );
  it('validFrom inclusive allows', async () => {
    const b = await base();
    expect(
      evaluateAuthorization({
        ...b,
        membership: member(10, [grant(800, 'TENANT_ADMIN', tenantScope(), 3000)]),
      }).decision,
    ).toBe('ALLOW');
  });
  it.each(['actor', 'resource', 'membership'] as const)('cross tenant %s denies', async (kind) => {
    const b = await base(),
      other = tenantId(id(2));
    expect(
      evaluateAuthorization(
        kind === 'actor'
          ? { ...b, tenantId: other }
          : kind === 'resource'
            ? { ...b, resource: { ...b.resource, tenantId: other } }
            : { ...b, membership: member(10, [grant(800)], other) },
      ).decision,
    ).toBe('DENY');
  });
  it.each(['relationshipSatisfied', 'stateAllowed'] as const)(
    '%s false/non-boolean denies',
    async (key) => {
      const b = await base();
      for (const value of [false, undefined, 'true', 1])
        expect(
          evaluateAuthorization({
            ...b,
            resource: { ...b.resource, [key]: value },
          } as AuthorizationInput).decision,
        ).toBe('DENY');
    },
  );
  it('missing permission and stale authVersion deny', async () => {
    const b = await base();
    expect(
      evaluateAuthorization({ ...b, membership: member(10, [grant(800, 'STUDENT')]) }).decision,
    ).toBe('DENY');
    expect(evaluateAuthorization({ ...b, expectedAuthorizationVersion: 0 })).toMatchObject({
      decision: 'DENY',
      reason: 'STALE_AUTHORIZATION',
    });
  });
  it.each(['missing', 'duplicate', 'unknown', 'empty-version'] as const)(
    'catalog %s fails closed',
    async (mode) => {
      const b = await base();
      const roles = [...b.catalog.roles];
      if (mode === 'missing') roles.pop();
      if (mode === 'duplicate') roles[2] = roles[0];
      if (mode === 'unknown') roles.push({ code: 'SYSTEM_ADMIN' } as unknown as Role);
      expect(
        evaluateAuthorization({
          ...b,
          catalog: { version: mode === 'empty-version' ? '' : b.catalog.version, roles },
        }).decision,
      ).toBe('DENY');
    },
  );
  it('unknown/malformed scope and empty permission rule fail closed', async () => {
    const b = await base();
    expect(
      evaluateAuthorization({
        ...b,
        resource: {
          ...b.resource,
          scope: { type: 'SYSTEM', scopeId: null } as unknown as typeof b.resource.scope,
        },
      }).decision,
    ).toBe('DENY');
    expect(
      evaluateAuthorization({ ...b, rule: { ...b.rule, requiredPermissions: [] } }).decision,
    ).toBe('DENY');
    expect(
      evaluateAuthorization({
        ...b,
        resource: {
          ...b.resource,
          scope: { type: 'SELF', scopeId: id(4) } as unknown as typeof b.resource.scope,
        },
      }).decision,
    ).toBe('DENY');
  });
  it('permission/scope and unrelated scopes cannot stitch', async () => {
    const b = await base();
    const m = member(10, [
      grant(801, 'TENANT_ADMIN', classScope(classId(id(7)))),
      grant(802, 'STUDENT', tenantScope()),
    ]);
    expect(evaluateAuthorization({ ...b, membership: m }).decision).toBe('DENY');
    expect(
      evaluateAuthorization({
        ...b,
        membership: member(10, [
          grant(803, 'TENANT_ADMIN', classScope(classId(id(7)))),
          grant(804, 'TENANT_ADMIN', courseScope(courseId(id(8)))),
        ]),
      }).decision,
    ).toBe('DENY');
  });
  it('revoke immediately denies and disabled restore cannot revive revoked grant', async () => {
    const b = await base(),
      m = b.membership.revokeGrant({
        now: time,
        expectedAuthorizationVersion: 1,
        grantId: b.membership.roleGrants[0].id,
      });
    expect(evaluateAuthorization({ ...b, membership: m }).decision).toBe('DENY');
    const disabled = m.disable({ now: time, expectedAuthorizationVersion: 2, reason: 'review' });
    expect(() =>
      disabled.reactivate({
        now: time,
        expectedAuthorizationVersion: 3,
        mode: 'PRESERVE_EXISTING_VALID_GRANTS',
        approvedGrantIds: [m.roleGrants[0].id],
      }),
    ).toThrow();
  });
  it.each(['SELF', 'CLASS', 'COURSE', 'TENANT'] as const)(
    'scope %s exact matching and foreign rejection',
    async (kind) => {
      const b = await base(),
        scope =
          kind === 'SELF'
            ? selfScope()
            : kind === 'CLASS'
              ? classScope(classId(id(7)))
              : kind === 'COURSE'
                ? courseScope(courseId(id(8)))
                : tenantScope();
      const rule = { ...b.rule, targetScopes: [kind], tenantCoversTarget: false };
      const facts = {
        ...b.resource,
        scope,
        subjectUserId: b.membership.userId,
        subjectMembershipId: b.membership.id,
      };
      expect(scopeMatches(scope, facts, b.membership, rule)).toBe(true);
      const foreign = { ...facts, tenantId: tenantId(id(2)) };
      expect(scopeMatches(scope, foreign, b.membership, rule)).toBe(false);
      if (kind === 'SELF')
        expect(
          scopeMatches(
            scope,
            { ...facts, subjectUserId: member(20).userId, subjectMembershipId: member(20).id },
            b.membership,
            rule,
          ),
        ).toBe(false);
      if (kind === 'CLASS' || kind === 'COURSE')
        expect(
          scopeMatches(
            scope,
            {
              ...facts,
              scope: kind === 'CLASS' ? classScope(classId(id(9))) : courseScope(courseId(id(9))),
            },
            b.membership,
            rule,
          ),
        ).toBe(false);
    },
  );
  it('CLASS cannot cover COURSE, TENANT widening must be explicit', async () => {
    const b = await base(),
      facts = { ...b.resource, scope: courseScope(courseId(id(8))) };
    const rule = { ...b.rule, targetScopes: ['COURSE' as const] };
    expect(scopeMatches(classScope(classId(id(8))), facts, b.membership, rule)).toBe(false);
    expect(scopeMatches(tenantScope(), facts, b.membership, rule)).toBe(false);
    expect(
      scopeMatches(tenantScope(), facts, b.membership, { ...rule, tenantCoversTarget: true }),
    ).toBe(true);
  });
  it('SELF contradictory ownership facts deny even if one identifier matches', async () => {
    const b = await base(),
      facts = {
        ...b.resource,
        scope: selfScope(),
        subjectUserId: b.actorUserId,
        subjectMembershipId: member(20).id,
      };
    expect(
      scopeMatches(selfScope(), facts, b.membership, { ...b.rule, targetScopes: ['SELF'] }),
    ).toBe(false);
  });
});

describe('explicit delegation and last-admin', () => {
  it('counterfeit proposed grant or target cannot satisfy delegation', async () => {
    const actor = member(10),
      target = member(20),
      proposed = RoleGrant.create({
        id: roleGrantId(id(900)),
        roleCode: 'STUDENT',
        scope: selfScope(),
        createdAt: time,
        validFrom: time,
        validUntil: null,
      });
    const d = {
      actor,
      actorGrant: actor.roleGrants[0],
      target,
      targetUserStatus: 'ACTIVE' as const,
      proposed,
      catalog: (await catalogPort().load()).snapshot,
      now: time,
      preserve: false,
      resourceRelationshipVerified: false,
    };
    expect(
      mayDelegate({
        ...d,
        proposed: { ...proposed, isEffectiveAt: () => true } as unknown as RoleGrant,
      }),
    ).toBe(false);
    expect(
      mayDelegate({
        ...d,
        target: { ...target, effectiveGrantsAt: () => target.roleGrants } as unknown as Membership,
      }),
    ).toBe(false);
  });
  async function delegation(
    code: 'STUDENT' | 'TEACHER' | 'TENANT_ADMIN',
    scope:
      | ReturnType<typeof tenantScope>
      | ReturnType<typeof selfScope>
      | ReturnType<typeof classScope>
      | ReturnType<typeof courseScope>,
  ) {
    const actor = member(10),
      target = member(20);
    return {
      actor,
      actorGrant: actor.roleGrants[0],
      target,
      targetUserStatus: 'ACTIVE' as const,
      proposed: RoleGrant.create({
        id: roleGrantId(id(900)),
        roleCode: code,
        scope,
        createdAt: time,
        validFrom: time,
        validUntil: null,
      }),
      catalog: (await catalogPort().load()).snapshot,
      now: time,
      preserve: false,
      resourceRelationshipVerified: true,
    };
  }
  it.each([
    ['STUDENT', 'SELF', true],
    ['STUDENT', 'CLASS', true],
    ['STUDENT', 'COURSE', true],
    ['STUDENT', 'TENANT', false],
    ['TEACHER', 'SELF', false],
    ['TEACHER', 'CLASS', true],
    ['TEACHER', 'COURSE', true],
    ['TEACHER', 'TENANT', false],
    ['TENANT_ADMIN', 'SELF', false],
    ['TENANT_ADMIN', 'CLASS', false],
    ['TENANT_ADMIN', 'COURSE', false],
    ['TENANT_ADMIN', 'TENANT', true],
  ] as const)('%s + %s ceiling = %s', async (code, kind, allow) => {
    const scope =
      kind === 'SELF'
        ? selfScope()
        : kind === 'CLASS'
          ? classScope(classId(id(7)))
          : kind === 'COURSE'
            ? courseScope(courseId(id(8)))
            : tenantScope();
    expect(mayDelegate(await delegation(code, scope))).toBe(allow);
  });
  it('self admin restore/new elevation, missing resource loader, inactive target deny', async () => {
    const d = await delegation('TENANT_ADMIN', tenantScope());
    expect(mayDelegate({ ...d, target: d.actor })).toBe(false);
    expect(mayDelegate({ ...d, targetUserStatus: 'DISABLED' })).toBe(false);
    expect(
      mayDelegate({
        ...(await delegation('TEACHER', classScope(classId(id(7))))),
        resourceRelationshipVerified: false,
      }),
    ).toBe(false);
  });
  it('role:assign missing, wrong actor scope and expired actor deny', async () => {
    const d = await delegation('STUDENT', selfScope());
    expect(
      mayDelegate({
        ...d,
        catalog: {
          ...d.catalog,
          roles: d.catalog.roles.map((r) =>
            r.code === 'TENANT_ADMIN' ? Role.create(roleId(id(203)), r.code, []) : r,
          ),
        },
      }),
    ).toBe(false);
    const actor = member(10, [grant(801, 'TENANT_ADMIN', selfScope())]);
    expect(mayDelegate({ ...d, actor, actorGrant: actor.roleGrants[0] })).toBe(false);
    const expired = member(10, [grant(802, 'TENANT_ADMIN', tenantScope(), 1000, 2000)]);
    expect(mayDelegate({ ...d, actor: expired, actorGrant: expired.roleGrants[0] })).toBe(false);
  });
  it('no validity stitching; preserve can keep past validFrom only while effective', async () => {
    const d = await delegation('STUDENT', selfScope()),
      actor = member(10, [grant(801, 'TENANT_ADMIN', tenantScope(), 1000, 4000)]);
    expect(mayDelegate({ ...d, actor, actorGrant: actor.roleGrants[0] })).toBe(false);
    const saved = grant(810, 'STUDENT', selfScope(), 1000, 3500),
      target = member(20, [saved]);
    expect(
      mayDelegate({
        ...d,
        actor,
        actorGrant: actor.roleGrants[0],
        target,
        proposed: saved,
        preserve: true,
      }),
    ).toBe(true);
    expect(mayDelegate({ ...d, target, proposed: saved, preserve: false })).toBe(false);
  });
  it('last admin counts distinct people; two admins can leave one and valid atomic successor counts', async () => {
    const catalog = (await catalogPort().load()).snapshot,
      a = member(10, [grant(810), grant(811)]),
      b = member(20);
    const states = new Map([
      [a.userId, 'ACTIVE' as const],
      [b.userId, 'ACTIVE' as const],
    ]);
    expect(lastAdminCounts(tenant, [a], states, catalog, time)).toEqual({
      governance: 1,
      operational: 1,
    });
    expect(lastAdminCounts(tenant, [a, b], states, catalog, time).operational).toBe(2);
    expect(
      lastAdminCounts(
        tenant,
        [a.leave({ now: time, expectedAuthorizationVersion: 1 }), b],
        states,
        catalog,
        time,
      ).operational,
    ).toBe(1);
  });
  it.each([
    'future',
    'expired',
    'revoked',
    'disabled-user',
    'disabled-member',
    'pending',
    'left',
  ] as const)('%s successor never satisfies operational last-admin', async (kind) => {
    const active = member(20, [
      kind === 'future'
        ? grant(820, 'TENANT_ADMIN', tenantScope(), 4000)
        : kind === 'expired'
          ? grant(820, 'TENANT_ADMIN', tenantScope(), 1000, 2000)
          : grant(820),
    ]);
    const b =
      kind === 'revoked'
        ? active.revokeGrant({
            now: time,
            expectedAuthorizationVersion: 1,
            grantId: roleGrantId(id(820)),
          })
        : active;
    const m =
      kind === 'disabled-member'
        ? b.disable({ now: time, expectedAuthorizationVersion: 1, reason: 'review' })
        : kind === 'left'
          ? b.leave({ now: time, expectedAuthorizationVersion: 1 })
          : kind === 'pending'
            ? Membership.create({
                id: b.id,
                userId: b.userId,
                tenantId: tenant,
                now: time,
                roleGrants: b.roleGrants,
              })
            : b;
    expect(
      lastAdminCounts(
        tenant,
        [m],
        new Map([[m.userId, kind === 'disabled-user' ? 'DISABLED' : 'ACTIVE']]),
        (await catalogPort().load()).snapshot,
        time,
      ).operational,
    ).toBe(0);
  });
  it('incomplete/foreign roster fails closed', async () => {
    const a = member(10),
      c = (await catalogPort().load()).snapshot;
    expect(() => lastAdminCounts(tenant, [a], new Map(), c, time)).toThrow();
    expect(() =>
      lastAdminCounts(tenantId(id(2)), [a], new Map([[a.userId, 'ACTIVE']]), c, time),
    ).toThrow();
  });
  it('SystemAdmin has control eligibility only; no tenant grant fallback', async () => {
    const b = await base(),
      g = SystemAdminGrant.create({
        id: systemAdminGrantId(id(901)),
        userId: b.actorUserId,
        createdAt: time,
        validFrom: time,
        validUntil: null,
      });
    expect(systemAdminEligible(b.actorUserId, 'ACTIVE', g, time)).toBe(true);
    expect(systemAdminEligible(b.actorUserId, 'DISABLED', g, time)).toBe(false);
    expect(
      systemAdminEligible(
        b.actorUserId,
        'ACTIVE',
        { ...g, isEffectiveAt: () => true } as unknown as SystemAdminGrant,
        time,
      ),
    ).toBe(false);
    expect(
      evaluateAuthorization({
        ...b,
        membership: member(10, []),
        systemAdminGrant: g,
      } as AuthorizationInput).decision,
    ).toBe('DENY');
    expect(() => grant(905, 'SYSTEM_ADMIN' as never)).toThrow();
  });
});

describe('approved immutable configuration', () => {
  it('matches approved exact manifest and cannot mutate role permissions', async () => {
    const p = catalogPort(),
      c = await p.load();
    expect(c.snapshot.version).toBe('identity-v1');
    expect(c.snapshot.roles.find((r) => r.code === 'TEACHER')!.permissions).toEqual([]);
    expect(Object.isFrozen(c.snapshot.roles[2].permissions)).toBe(true);
    expect(await p.findByCode('TENANT_ADMIN')).toBe(c.snapshot.roles[2]);
  });
  it.each(['missing', 'duplicate-id', 'checksum', 'approval'] as const)(
    'configuration %s rejects',
    (kind) => {
      const c = catalogConfig();
      if (kind === 'missing') delete (c.roleIds as Partial<typeof c.roleIds>).STUDENT;
      if (kind === 'duplicate-id') c.roleIds.TEACHER = c.roleIds.STUDENT;
      if (kind === 'checksum') c.expectedDigest = '0'.repeat(64);
      if (kind === 'approval') c.approvalRecord = '';
      expect(() => new ApprovedIdentityCatalog(c)).toThrow();
    },
  );
  it('unknown action never maps to a similar permission', () => {
    expect(identityActionRule('tenant:manage' as never)).toBeNull();
  });
});
