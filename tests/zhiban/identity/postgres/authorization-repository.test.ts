import { describe, expect, it } from 'vitest';
import { IdentityAuthorizer } from '@/lib/zhiban/application/identity/authorize';
import {
  PostgresAuthorizationState,
  PostgresAuthorizationMutations,
} from '@/lib/zhiban/infrastructure/identity/postgres/repositories/authorization';
import { AuthorizationRejected } from '@/lib/zhiban/application/identity/authorization-error';
import type {
  AuthorizationReceipt,
  IdentityAction,
  MembershipMutationIntent,
} from '@/lib/zhiban/application/identity/ports/authorization';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import {
  instant,
  roleGrantId,
  selfScope,
  tenantScope,
  Membership,
  classId,
  courseId,
  classScope,
  courseScope,
} from '@/lib/zhiban/domain/identity';
import { AuthorizationSqlHarness } from './authorization-harness';
import { tenant, member, grant, id, time, catalogPort } from '../authorization/fixtures';

function environment(h = new AuthorizationSqlHarness(), clock = { now: () => time }) {
  const catalog = catalogPort(),
    state = new PostgresAuthorizationState(h.pool);
  const app = new IdentityAuthorizer(state, catalog, clock),
    mutations = new PostgresAuthorizationMutations(h.pool, catalog, clock);
  return { h, app, mutations };
}
async function receipt(
  e: ReturnType<typeof environment>,
  action: IdentityAction = 'ROLE_REVOKE',
  target = member(20),
  actor = member(10),
) {
  const decision = await e.app.authorize({
    actorUserId: actor.userId,
    actorMembershipId: actor.id,
    context: tenantScopeContext(tenant),
    targetMembershipId: target.id,
    action,
    requestId: 'authorization-contract',
  });
  expect(decision.decision).toBe('ALLOW');
  if (decision.decision !== 'ALLOW') throw new Error('Authorization fixture denied');
  return decision.receipt;
}
const request = (r: AuthorizationReceipt, intent: MembershipMutationIntent) => ({
  operations: [{ receipt: r, intent }],
  requestId: 'authorization-contract',
  auditReason: 'ADMIN_REQUEST' as const,
});

describe('same-client authorization mutation SQL contract', () => {
  it('CLASS/COURSE delegation stays closed without real production resource loaders', async () => {
    const e = environment(),
      r = await receipt(e, 'ROLE_GRANT');
    for (const scope of [classScope(classId(id(70))), courseScope(courseId(id(80)))])
      await expect(
        e.mutations.execute(
          request(r, {
            action: 'ROLE_GRANT',
            approvedGrant: {
              id: roleGrantId(id(900)),
              roleCode: 'TEACHER',
              scope,
              validUntil: null,
            },
          }),
        ),
      ).rejects.toMatchObject({ reason: 'DELEGATION_DENIED' });
    expect(e.h.audits).toHaveLength(0);
    expect(e.h.parents.get(member(20).id)!.repository_revision).toBe('1');
  });
  it('second target insert failure rolls back first target CAS, child insert, and audit', async () => {
    const a = member(10),
      b = member(20, [grant(1020, 'STUDENT', selfScope())]),
      c = member(30, [grant(1030, 'STUDENT', selfScope())]);
    const e = environment(new AuthorizationSqlHarness([a, b, c])),
      r1 = await receipt(e, 'ROLE_GRANT', b),
      r2 = await receipt(e, 'ROLE_GRANT', c);
    const approvedGrant = {
      id: roleGrantId(id(900)),
      roleCode: 'STUDENT' as const,
      scope: selfScope(),
      validUntil: null,
    };
    await expect(
      e.mutations.execute({
        operations: [
          { receipt: r1, intent: { action: 'ROLE_GRANT', approvedGrant } },
          { receipt: r2, intent: { action: 'ROLE_GRANT', approvedGrant } },
        ],
        requestId: 'authorization-contract',
        auditReason: 'ADMIN_REQUEST',
      }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(e.h.parents.get(b.id)!.repository_revision).toBe('1');
    expect(e.h.parents.get(c.id)!.repository_revision).toBe('1');
    expect(e.h.grants.get(b.id)).toHaveLength(1);
    expect(e.h.grants.get(c.id)).toHaveLength(1);
    expect(e.h.audits).toHaveLength(0);
    const insertAudit = e.h.calls.findIndex((x) =>
      x.sql.startsWith('INSERT INTO zhiban_identity.audit_events'),
    );
    const inserts = e.h.calls
      .map((x, i) => ({ x, i }))
      .filter(({ x }) => x.sql.startsWith('INSERT INTO zhiban_identity.role_grants'));
    expect(inserts).toHaveLength(2);
    expect(insertAudit).toBeGreaterThan(inserts[0].i);
    expect(insertAudit).toBeLessThan(inserts[1].i);
    expect(e.h.calls.at(-1)?.sql).toBe('ROLLBACK');
  });
  it('receipt cannot be moved to another request/action/target or tenant', async () => {
    const e = environment(),
      r = await receipt(e);
    await expect(
      e.mutations.execute({
        ...request(r, { action: 'ROLE_REVOKE', grantId: member(20).roleGrants[0].id }),
        requestId: 'different-request',
      }),
    ).rejects.toMatchObject({ reason: 'INVALID_FACTS' });
    await expect(
      e.mutations.execute(request(r, { action: 'MEMBERSHIP_LEAVE_ADMIN' })),
    ).rejects.toMatchObject({ reason: 'INVALID_FACTS' });
    expect(e.h.audits).toHaveLength(0);
  });
  it('max authorizationVersion mutation fails closed', async () => {
    const e = environment();
    e.h.parents.set(member(20).id, {
      ...e.h.parents.get(member(20).id)!,
      authorization_version: '9007199254740991',
    });
    const r = await receipt(e);
    await expect(
      e.mutations.execute(
        request(r, { action: 'ROLE_REVOKE', grantId: member(20).roleGrants[0].id }),
      ),
    ).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(e.h.parents.get(member(20).id)!.repository_revision).toBe('1');
  });
  it('commit failure denies, rolls back, releases client and never retries', async () => {
    const e = environment(),
      r = await receipt(e);
    e.h.failCommit = true;
    e.h.calls = [];
    await expect(
      e.mutations.execute(
        request(r, { action: 'ROLE_REVOKE', grantId: member(20).roleGrants[0].id }),
      ),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(e.h.parents.get(member(20).id)!.repository_revision).toBe('1');
    expect(e.h.audits).toHaveLength(0);
    expect(e.h.calls.filter((c) => c.sql.startsWith('BEGIN'))).toHaveLength(1);
    expect(e.h.calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(e.h.released).toBe(2);
  });
  it.each(['replace', 'rejoin', 'preserve', 'restore-replace'] as const)(
    '%s keeps history and uses the same anchor/audit',
    async (kind) => {
      const a = member(10),
        base = member(20, [grant(1020, 'STUDENT', selfScope())]);
      const target =
        kind === 'rejoin'
          ? base.leave({ now: time, expectedAuthorizationVersion: 1 })
          : kind.startsWith('restore') || kind === 'preserve'
            ? base.disable({ now: time, expectedAuthorizationVersion: 1, reason: 'review' })
            : base;
      const e = environment(new AuthorizationSqlHarness([a, target])),
        added = {
          id: roleGrantId(id(901)),
          roleCode: 'STUDENT' as const,
          scope: selfScope(),
          validUntil: null,
        };
      const intent: MembershipMutationIntent =
        kind === 'replace'
          ? { action: 'ROLE_REPLACE', approvedGrants: [added] }
          : kind === 'rejoin'
            ? { action: 'MEMBERSHIP_REJOIN', approvedGrants: [added] }
            : kind === 'preserve'
              ? {
                  action: 'MEMBERSHIP_REACTIVATE',
                  mode: 'PRESERVE_EXISTING_VALID_GRANTS',
                  approvedGrantIds: [base.roleGrants[0].id],
                  approvedGrants: [],
                }
              : {
                  action: 'MEMBERSHIP_REACTIVATE',
                  mode: 'REPLACE_GRANTS',
                  approvedGrantIds: [],
                  approvedGrants: [added],
                };
      const r = await receipt(e, intent.action, target),
        result = (await e.mutations.execute(request(r, intent)))[0];
      expect(result.value.status).toBe('ACTIVE');
      expect(result.value.authorizationVersion).toBe(target.authorizationVersion + 1);
      expect(result.value.roleGrants[0].id).toBe(base.roleGrants[0].id);
      expect(result.value.roleGrants[0].revokedAt).toBe(kind === 'preserve' ? null : time);
      expect(e.h.audits).toHaveLength(1);
      expect(
        e.h.calls.some(
          (c) => c.sql.includes('authorization_state(') && c.params[3] === 'GUARD_MEMBERSHIP',
        ),
      ).toBe(true);
    },
  );
  it('locks helper then sorted parents, fresh reads, CAS + history + audit + checked commit', async () => {
    const e = environment(),
      r = await receipt(e);
    e.h.calls = [];
    const result = await e.mutations.execute(
      request(r, { action: 'ROLE_REVOKE', grantId: member(20).roleGrants[0].id }),
    );
    expect(result[0].revision).toBe('2');
    expect(result[0].value.authorizationVersion).toBe(2);
    expect(result[0].value.roleGrants[0].revokedAt).toBe(time);
    const calls = e.h.calls,
      helper = calls.findIndex((c) => c.sql.includes('authorization_state(')),
      locks = calls.filter(
        (c) => c.sql.includes('memberships WHERE') && c.sql.endsWith('FOR UPDATE'),
      );
    expect(calls[helper].params).toEqual([
      tenant,
      member(10).id,
      [member(20).id],
      'GUARD_MEMBERSHIP',
    ]);
    expect(locks.slice(0, 2).map((c) => c.params)).toEqual([
      [tenant, member(10).id],
      [tenant, member(20).id],
    ]);
    expect(helper).toBeLessThan(calls.indexOf(locks[0]));
    const update = calls.findIndex((c) => c.sql.startsWith('UPDATE zhiban_identity.memberships')),
      revoke = calls.findIndex((c) => c.sql.startsWith('UPDATE zhiban_identity.role_grants')),
      audit = calls.findIndex((c) => c.sql.startsWith('INSERT INTO zhiban_identity.audit_events'));
    expect(calls[update].params.slice(5)).toEqual([tenant, member(20).id, '1']);
    expect(update).toBeLessThan(revoke);
    expect(revoke).toBeLessThan(audit);
    expect(calls.at(-1)?.sql).toBe('COMMIT');
    expect(e.h.audits[0][0]).toBe('ROLE_GRANT_REVOKED');
    expect(e.h.audits[0][2]).toBe(member(10).userId);
    expect(JSON.stringify(e.h.audits)).not.toMatch(
      /password|secret|digest|token|SQLSTATE|permissions/,
    );
    expect(e.h.released).toBe(2);
  });
  it('last effective admin cannot be removed; no writes and rollback', async () => {
    const e = environment(new AuthorizationSqlHarness([member(10)])),
      r = await receipt(e, 'ROLE_REVOKE', member(10));
    await expect(
      e.mutations.execute(
        request(r, { action: 'ROLE_REVOKE', grantId: member(10).roleGrants[0].id }),
      ),
    ).rejects.toMatchObject({ reason: 'LAST_ADMIN_REQUIRED' });
    expect(e.h.grants.get(member(10).id)![0].revoked_at).toBeNull();
    expect(e.h.audits).toEqual([]);
    expect(e.h.calls.at(-1)?.sql).toBe('ROLLBACK');
  });
  it('audit failure rolls back parent CAS and grant revocation', async () => {
    const e = environment(),
      r = await receipt(e);
    e.h.failAudit = true;
    await expect(
      e.mutations.execute(
        request(r, { action: 'ROLE_REVOKE', grantId: member(20).roleGrants[0].id }),
      ),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(e.h.parents.get(member(20).id)!.repository_revision).toBe('1');
    expect(e.h.grants.get(member(20).id)![0].revoked_at).toBeNull();
  });
  it('stale-before-no-op rejects old receipt, current repeated revoke is a true no-op', async () => {
    const e = environment(),
      r = await receipt(e),
      intent = { action: 'ROLE_REVOKE' as const, grantId: member(20).roleGrants[0].id };
    await e.mutations.execute(request(r, intent));
    await expect(e.mutations.execute(request(r, intent))).rejects.toMatchObject({
      code: 'STALE_WRITE',
    });
    const fresh = await receipt(e);
    const after = await e.mutations.execute(request(fresh, intent));
    expect(after[0].revision).toBe('2');
    expect(after[0].value.authorizationVersion).toBe(2);
    expect(e.h.audits).toHaveLength(1);
  });
  it.each([
    'actor-version',
    'user-version',
    'tenant-version',
    'digest',
    'delegation',
    'grant-id',
  ] as const)('%s stale receipt denies', async (kind) => {
    const e = environment(),
      r = await receipt(e);
    const changed = { ...r };
    if (kind === 'actor-version') changed.decision = { ...r.decision, authorizationVersion: 0 };
    if (kind === 'user-version') changed.actorUserRevision = repositoryRevision('2');
    if (kind === 'tenant-version') changed.tenantRevision = repositoryRevision('2');
    if (kind === 'digest') changed.catalogDigest = '0'.repeat(64);
    if (kind === 'delegation') changed.delegationVersion = 'old' as never;
    if (kind === 'grant-id') changed.decision = { ...r.decision, grantId: roleGrantId(id(999)) };
    await expect(
      e.mutations.execute(
        request(changed, { action: 'ROLE_REVOKE', grantId: member(20).roleGrants[0].id }),
      ),
    ).rejects.toMatchObject({ reason: 'STALE_AUTHORIZATION' });
    expect(e.h.audits).toHaveLength(0);
  });
  it('max revision fails closed without state mutation', async () => {
    const e = environment();
    e.h.parents.set(member(20).id, {
      ...e.h.parents.get(member(20).id)!,
      repository_revision: '9223372036854775807',
    });
    const r = await receipt(e);
    await expect(
      e.mutations.execute(
        request(r, { action: 'ROLE_REVOKE', grantId: member(20).roleGrants[0].id }),
      ),
    ).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(e.h.grants.get(member(20).id)![0].revoked_at).toBeNull();
    expect(e.h.audits).toHaveLength(0);
  });
  it.each(['MEMBERSHIP_DISABLE', 'MEMBERSHIP_LEAVE_ADMIN'] as const)(
    '%s persists Domain transition atomically',
    async (action) => {
      const e = environment(),
        r = await receipt(e, action),
        intent = action === 'MEMBERSHIP_DISABLE' ? { action, reason: 'review' } : { action };
      const result = await e.mutations.execute(request(r, intent));
      expect(result[0].value.status).toBe(action === 'MEMBERSHIP_DISABLE' ? 'DISABLED' : 'LEFT');
      expect(e.h.audits).toHaveLength(1);
    },
  );
  it('approved new role gets fresh in-transaction timestamps, not caller timestamps', async () => {
    const e = environment(),
      r = await receipt(e, 'ROLE_GRANT');
    const result = await e.mutations.execute(
      request(r, {
        action: 'ROLE_GRANT',
        approvedGrant: {
          id: roleGrantId(id(900)),
          roleCode: 'STUDENT',
          scope: selfScope(),
          validUntil: null,
        },
      }),
    );
    expect(result[0].value.roleGrants.at(-1)).toMatchObject({
      createdAt: time,
      validFrom: time,
      roleCode: 'STUDENT',
    });
    expect(result[0].revision).toBe('2');
  });
  it('self admin escalation and resource grants without trusted loaders deny', async () => {
    const e = environment(),
      r = await receipt(e, 'ROLE_GRANT', member(10));
    await expect(
      e.mutations.execute(
        request(r, {
          action: 'ROLE_GRANT',
          approvedGrant: {
            id: roleGrantId(id(900)),
            roleCode: 'TENANT_ADMIN',
            scope: tenantScope(),
            validUntil: null,
          },
        }),
      ),
    ).rejects.toMatchObject({ reason: 'DELEGATION_DENIED' });
  });
  it('two-command replacement preserves one admin with complete proposed post-state', async () => {
    const target = member(20, [grant(1020, 'STUDENT', selfScope())]),
      e = environment(new AuthorizationSqlHarness([member(10), target]));
    const remove = await receipt(e, 'ROLE_REVOKE', member(10)),
      add = await receipt(e, 'ROLE_GRANT', target);
    const result = await e.mutations.execute({
      operations: [
        {
          receipt: remove,
          intent: { action: 'ROLE_REVOKE', grantId: member(10).roleGrants[0].id },
        },
        {
          receipt: add,
          intent: {
            action: 'ROLE_GRANT',
            approvedGrant: {
              id: roleGrantId(id(900)),
              roleCode: 'TENANT_ADMIN',
              scope: tenantScope(),
              validUntil: null,
            },
          },
        },
      ],
      requestId: 'authorization-contract',
      auditReason: 'ADMIN_REQUEST',
    });
    expect(result.map((x) => x.revision)).toEqual(['2', '2']);
    expect(e.h.audits).toHaveLength(2);
    expect(e.h.calls.filter((c) => c.sql === 'COMMIT')).toHaveLength(3); // two authorization reads + one atomic mutation
  });
  it('expired authority at final clock check rolls back even after SQL writes', async () => {
    let now = time;
    const e = environment(
      new AuthorizationSqlHarness([
        member(10, [grant(1010, 'TENANT_ADMIN', tenantScope(), 1000, 4000)]),
        member(20),
      ]),
      { now: () => now },
    );
    const r = await receipt(e);
    const query = e.h.query;
    e.h.pool = {
      connect: async () =>
        ({
          query: async (sql: string, params?: unknown[]) => {
            const result = await query(sql, params);
            if (sql.startsWith('INSERT INTO zhiban_identity.audit')) now = instant(4000);
            return result;
          },
          release: () => {
            e.h.released++;
          },
        }) as unknown as Awaited<ReturnType<typeof e.h.pool.connect>>,
    };
    const mutations = new PostgresAuthorizationMutations(e.h.pool, catalogPort(), {
      now: () => now,
    });
    await expect(
      mutations.execute(
        request(r, { action: 'ROLE_REVOKE', grantId: member(20).roleGrants[0].id }),
      ),
    ).rejects.toMatchObject({ reason: 'STALE_AUTHORIZATION' });
    expect(e.h.parents.get(member(20).id)!.repository_revision).toBe('1');
    expect(e.h.audits).toHaveLength(0);
  });
  it('malformed helper facts deny and sanitize error object', async () => {
    const e = environment();
    e.h.malformed = true;
    expect(
      await e.app.authorize({
        actorUserId: member(10).userId,
        actorMembershipId: member(10).id,
        targetMembershipId: member(20).id,
        context: tenantScopeContext(tenant),
        action: 'ROLE_REVOKE',
        requestId: 'authorization-contract',
      }),
    ).toEqual({ decision: 'DENY', reason: 'STORAGE_UNAVAILABLE' });
    expect(JSON.stringify(new AuthorizationRejected('INVALID_FACTS'))).not.toMatch(
      /SQL|secret|cause/,
    );
  });
  it('inactive User fresh after receipt rejects before writes', async () => {
    const e = environment(),
      r = await receipt(e);
    e.h.users.set(member(10).userId, { status: 'DISABLED', revision: '2' });
    await expect(
      e.mutations.execute(
        request(r, { action: 'ROLE_REVOKE', grantId: member(20).roleGrants[0].id }),
      ),
    ).rejects.toMatchObject({ reason: 'INACTIVE_IDENTITY' });
  });
  it('activation and restore use explicit approval and do not revive revoked history', async () => {
    const pending = Membership.create({
      id: member(20).id,
      userId: member(20).userId,
      tenantId: tenant,
      now: instant(1000),
    });
    const e = environment(new AuthorizationSqlHarness([member(10), pending])),
      r = await receipt(e, 'MEMBERSHIP_ACTIVATE', pending);
    const added = {
      id: roleGrantId(id(900)),
      roleCode: 'STUDENT' as const,
      scope: selfScope(),
      validUntil: null,
    };
    expect(
      (
        await e.mutations.execute(
          request(r, { action: 'MEMBERSHIP_ACTIVATE', approvedGrants: [added] }),
        )
      )[0].value.status,
    ).toBe('ACTIVE');
  });
});
