import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool, QueryResult } from 'pg';
import {
  Membership,
  RoleGrant,
  classId,
  classScope,
  courseId,
  courseScope,
  instant,
  roleGrantId,
  selfScope,
  tenantScope,
  tenantId,
  userId,
  membershipId,
} from '@/lib/zhiban/domain/identity';
import { evaluateAuthorization } from '@/lib/zhiban/domain/identity/policies/authorization';
import {
  IdentityAuthorizer,
  identityActionRule,
} from '@/lib/zhiban/application/identity/authorize';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import type {
  AuthorizationReceipt,
  IdentityAction,
  MembershipMutationIntent,
} from '@/lib/zhiban/application/identity/ports/authorization';
import {
  PostgresAuthorizationState,
  PostgresAuthorizationMutations,
} from '@/lib/zhiban/infrastructure/identity/postgres/repositories/authorization';
import { PostgresMembershipRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/membership';
import { membershipToRows } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/membership';
import {
  tenantTransaction,
  type TransactionPool,
} from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import {
  adminClient,
  configured,
  prepareSchema,
  resetDisposableIdentity,
  runtimePool,
  runtimeClient,
  expectDenied,
  verifyPg16,
} from './pg16-harness';
import { id, tenant, time, member, grant, catalogPort } from '../authorization/fixtures';

const context = tenantScopeContext(tenant),
  actor = member(10),
  second = member(30),
  student = member(20, [grant(1020, 'STUDENT', selfScope())]);
const pending = Membership.create({
  id: membershipId(id(40)),
  userId: userId(id(140)),
  tenantId: tenant,
  now: instant(1000),
});
const foreign = member(60, [grant(1060)], tenantId(id(2)));
const pools: Pool[] = [];
const pool = () => {
  const p = runtimePool('zhiban_runtime');
  pools.push(p);
  return p;
};
async function administrator<T>(
  work: (client: ReturnType<typeof adminClient>) => Promise<T>,
): Promise<T> {
  const c = adminClient();
  await c.connect();
  try {
    return await work(c);
  } finally {
    await c.end();
  }
}
async function seedMember(
  c: ReturnType<typeof adminClient>,
  m: Membership,
  revision = '1',
  authVersion?: string,
) {
  await c.query(
    "INSERT INTO zhiban_identity.users (user_id,status,created_at,updated_at) VALUES ($1,'ACTIVE',1000,1000) ON CONFLICT DO NOTHING",
    [m.userId],
  );
  const { membership: r, roleGrants: gs } = membershipToRows(m);
  await c.query(
    'INSERT INTO zhiban_identity.memberships (membership_id,user_id,tenant_id,status,authorization_version,created_at,updated_at,disabled_at,disabled_reason,repository_revision) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [
      r.membership_id,
      r.user_id,
      r.tenant_id,
      r.status,
      authVersion ?? r.authorization_version,
      r.created_at,
      r.updated_at,
      r.disabled_at,
      r.disabled_reason,
      revision,
    ],
  );
  for (const g of gs)
    await c.query(
      'INSERT INTO zhiban_identity.role_grants (grant_id,tenant_id,membership_id,grant_ordinal,role_code,scope_kind,scope_id,created_at,valid_from,valid_until,revoked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
      [
        g.grant_id,
        g.tenant_id,
        g.membership_id,
        g.grant_ordinal,
        g.role_code,
        g.scope_kind,
        g.scope_id,
        g.created_at,
        g.valid_from,
        g.valid_until,
        g.revoked_at,
      ],
    );
}
function environment(p: TransactionPool = pool(), clock = { now: () => time }) {
  const catalog = catalogPort(),
    state = new PostgresAuthorizationState(p);
  return {
    p,
    state,
    catalog,
    app: new IdentityAuthorizer(state, catalog, clock),
    mutations: new PostgresAuthorizationMutations(p, catalog, clock),
  };
}
async function decision(
  e: ReturnType<typeof environment>,
  action: IdentityAction = 'ROLE_REVOKE',
  target = second,
  a = actor,
) {
  return e.app.authorize({
    actorUserId: a.userId,
    actorMembershipId: a.id,
    targetMembershipId: target.id,
    context: tenantScopeContext(a.tenantId),
    action,
    requestId: 'authorization-pg16',
  });
}
async function receipt(
  e: ReturnType<typeof environment>,
  action: IdentityAction = 'ROLE_REVOKE',
  target = second,
  a = actor,
): Promise<AuthorizationReceipt> {
  const d = await decision(e, action, target, a);
  expect(d.decision).toBe('ALLOW');
  if (d.decision !== 'ALLOW') throw new Error('PG16 fixture authorization denied');
  return d.receipt;
}
const request = (r: AuthorizationReceipt, intent: MembershipMutationIntent) => ({
  operations: [{ receipt: r, intent }],
  requestId: 'authorization-pg16',
  auditReason: 'ADMIN_REQUEST' as const,
});
async function rows(sql: string, params: unknown[] = []) {
  return administrator(async (c) => (await c.query(sql, params)).rows);
}
async function removeMember(c: ReturnType<typeof adminClient>, membership: string) {
  await c.query('DELETE FROM zhiban_identity.role_grants WHERE membership_id=$1', [membership]);
  await c.query('DELETE FROM zhiban_identity.memberships WHERE membership_id=$1', [membership]);
}
function gate() {
  let open!: () => void;
  const ready = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { ready, open };
}
async function bounded<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('PG16 lock coordination timed out')), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
function observed(
  p: Pool,
  after: (sql: string, result: QueryResult) => Promise<void>,
): TransactionPool {
  return {
    connect: async () => {
      const c = await p.connect();
      return {
        query: async (sql: string, params?: unknown[]) => {
          const r = await c.query(sql, params);
          await after(sql, r);
          return r;
        },
        release: (destroy?: boolean) => c.release(destroy),
      } as Awaited<ReturnType<TransactionPool['connect']>>;
    },
  };
}
async function acknowledgedBlocked(pid: number) {
  await bounded(
    administrator(async (c) => {
      for (;;) {
        const r = await c.query<{ blocked: boolean }>(
          'SELECT cardinality(pg_blocking_pids($1))>0 AS blocked',
          [pid],
        );
        if (r.rows[0].blocked) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }),
  );
}

describe.skipIf(!configured)('real PG16 authorization A7-03 + transaction signoff', () => {
  beforeAll(async () => {
    expect(await verifyPg16()).toMatch(/^16\./);
    await prepareSchema();
  }, 60000);
  beforeEach(async () => {
    await administrator(async (c) => {
      await c.query(
        'TRUNCATE zhiban_identity.audit_events,zhiban_identity.tenants,zhiban_identity.users CASCADE',
      );
      for (const [t, code] of [
        [tenant, 'authorization-a'],
        [foreign.tenantId, 'authorization-b'],
      ])
        await c.query(
          "INSERT INTO zhiban_identity.tenants (tenant_id,code,display_name,status,created_at,updated_at) VALUES ($1,$2,$2,'ACTIVE',1000,1000)",
          [t, code],
        );
      for (const m of [actor, second, student, pending, foreign]) await seedMember(c, m);
    });
  });
  afterEach(async () => {
    await Promise.all(pools.splice(0).map((p) => p.end()));
  });
  afterAll(async () => {
    await resetDisposableIdentity();
  });

  it('AUTHZ-PG01 active global/User/Tenant/Membership/grant chain allows minimal receipt', async () => {
    const e = environment(),
      r = await receipt(e, 'MEMBERSHIP_READ', student);
    expect(r.decision.authorizationVersion).toBe(1);
    expect(r.targetRevision).toBe('1');
    expect(JSON.stringify(r)).not.toMatch(/password|token|permissions|roleGrants/);
  });
  it('AUTHZ-PG02 disabled User denies even with current admin grant', async () => {
    await rows(
      "UPDATE zhiban_identity.users SET status='DISABLED',updated_at=3000,disabled_at=3000,disabled_reason='review',repository_revision=repository_revision+1 WHERE user_id=$1",
      [actor.userId],
    );
    expect((await decision(environment())).decision).toBe('DENY');
  });
  it('AUTHZ-PG03 disabled Tenant denies despite valid context', async () => {
    await rows(
      "UPDATE zhiban_identity.tenants SET status='DISABLED',updated_at=3000,disabled_at=3000,disabled_reason='review',repository_revision=repository_revision+1 WHERE tenant_id=$1",
      [tenant],
    );
    expect((await decision(environment())).decision).toBe('DENY');
  });
  it.each(['PENDING', 'DISABLED', 'LEFT'] as const)(
    'AUTHZ-PG04 Membership %s denies',
    async (status) => {
      const e = environment();
      if (status === 'PENDING')
        expect((await decision(e, 'MEMBERSHIP_READ', student, pending)).decision).toBe('DENY');
      else {
        const m =
          status === 'DISABLED'
            ? actor.disable({ now: time, expectedAuthorizationVersion: 1, reason: 'review' })
            : actor.leave({ now: time, expectedAuthorizationVersion: 1 });
        await new PostgresMembershipRepository(e.p).save(
          context,
          m,
          (await receipt(e)).actorRevision,
        );
        expect((await decision(e)).decision).toBe('DENY');
      }
    },
  );
  it.each(['revoked', 'expired', 'future'] as const)(
    'AUTHZ-PG05 %s admin grant denies',
    async (kind) => {
      const e = environment(),
        repo = new PostgresMembershipRepository(e.p);
      const m =
        kind === 'revoked'
          ? actor.revokeGrant({
              now: time,
              expectedAuthorizationVersion: 1,
              grantId: actor.roleGrants[0].id,
            })
          : actor.replaceGrants({
              now: time,
              expectedAuthorizationVersion: 1,
              approvedGrants: [
                RoleGrant.create({
                  id: roleGrantId(id(901)),
                  roleCode: 'TENANT_ADMIN',
                  scope: tenantScope(),
                  createdAt: time,
                  validFrom: kind === 'future' ? instant(4000) : time,
                  validUntil: kind === 'expired' ? instant(4000) : null,
                }),
              ],
            });
      await repo.save(context, m, (await receipt(e)).actorRevision);
      const app = kind === 'expired' ? environment(e.p, { now: () => instant(4000) }) : e;
      expect((await decision(app)).decision).toBe('DENY');
    },
  );
  it('AUTHZ-PG06 catalog Student without required permission denies', async () => {
    expect((await decision(environment(), 'MEMBERSHIP_READ', second, student)).decision).toBe(
      'DENY',
    );
  });
  it('AUTHZ-PG07 persisted CLASS/COURSE/SELF facts match exactly, no inferred widening', async () => {
    const e = environment(),
      repo = new PostgresMembershipRepository(e.p),
      c = (await e.catalog.load()).snapshot;
    for (const [scope, foreignScope] of [
      [classScope(classId(id(71))), classScope(classId(id(72)))],
      [courseScope(courseId(id(81))), courseScope(courseId(id(82)))],
      [selfScope(), selfScope()],
    ] as const) {
      const m = member(70, [grant(1070, 'TENANT_ADMIN', scope)]);
      await administrator(async (client) => {
        await removeMember(client, m.id);
        await seedMember(client, m);
      });
      const loaded = (await repo.findById(context, m.id))!;
      const rule = {
        ...identityActionRule('MEMBERSHIP_READ')!,
        targetScopes: [scope.type],
        tenantCoversTarget: false,
      };
      const facts = {
        tenantId: tenant,
        resourceId: id(900),
        scope,
        subjectUserId: m.userId,
        subjectMembershipId: m.id,
        relationshipSatisfied: true,
        stateAllowed: true,
      };
      const input = {
        actorUserId: m.userId,
        userStatus: 'ACTIVE' as const,
        tenantId: tenant,
        tenantStatus: 'ACTIVE' as const,
        membership: loaded.value,
        catalog: c,
        rule,
        resource: facts,
        now: time,
      };
      expect(evaluateAuthorization(input).decision).toBe('ALLOW');
      expect(
        evaluateAuthorization({
          ...input,
          resource: {
            ...facts,
            scope: foreignScope,
            subjectUserId: student.userId,
            subjectMembershipId: student.id,
          },
        }).decision,
      ).toBe('DENY');
    }
  });
  it('AUTHZ-PG08 cross-tenant target/helper probe denies and User lookup is not arbitrary', async () => {
    expect((await decision(environment(), 'MEMBERSHIP_READ', foreign)).decision).toBe('DENY');
    const c = runtimeClient('zhiban_runtime');
    await c.connect();
    try {
      await expectDenied(c, 'SELECT * FROM zhiban_identity.users');
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
      await expect(
        c.query("SELECT * FROM zhiban_identity.authorization_state($1,$2,$3,'READ_CONTEXT')", [
          tenant,
          actor.id,
          [foreign.id],
        ]),
      ).rejects.toMatchObject({ code: '42501' });
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });
  it('AUTHZ-PG09 persisted permission and scope across separate grants do not stitch', async () => {
    const m = member(70, [
      grant(1070, 'TENANT_ADMIN', classScope(classId(id(71)))),
      grant(1071, 'STUDENT', tenantScope()),
    ]);
    await administrator((c) => seedMember(c, m));
    expect((await decision(environment(), 'MEMBERSHIP_READ', student, m)).decision).toBe('DENY');
  });
  it('AUTHZ-PG10 old authorizationVersion/parent revision receipt rejects after mutation', async () => {
    const e = environment(),
      r = await receipt(e),
      repo = new PostgresMembershipRepository(e.p);
    await repo.save(
      context,
      actor.grantRole({
        now: time,
        expectedAuthorizationVersion: 1,
        approvedGrant: grant(901, 'STUDENT', selfScope()),
      }),
      r.actorRevision,
    );
    await expect(
      e.mutations.execute(request(r, { action: 'ROLE_REVOKE', grantId: second.roleGrants[0].id })),
    ).rejects.toMatchObject({ code: 'STALE_WRITE' });
  });
  it('AUTHZ-PG11 guarded revoke immediately removes authorization but not authentication', async () => {
    const e = environment(),
      r = await receipt(e);
    await e.mutations.execute(
      request(r, { action: 'ROLE_REVOKE', grantId: second.roleGrants[0].id }),
    );
    expect((await decision(e, 'MEMBERSHIP_READ', student, second)).decision).toBe('DENY');
    expect((await decision(e, 'MEMBERSHIP_READ', student)).decision).toBe('ALLOW');
  });
  it('AUTHZ-PG12 last effective tenant admin removal is denied without writes', async () => {
    await administrator((c) => removeMember(c, second.id));
    const e = environment(),
      r = await receipt(e, 'ROLE_REVOKE', actor);
    await expect(
      e.mutations.execute(request(r, { action: 'ROLE_REVOKE', grantId: actor.roleGrants[0].id })),
    ).rejects.toMatchObject({ reason: 'LAST_ADMIN_REQUIRED' });
    expect(
      (
        await rows('SELECT revoked_at FROM zhiban_identity.role_grants WHERE grant_id=$1', [
          actor.roleGrants[0].id,
        ])
      )[0].revoked_at,
    ).toBeNull();
  });
  it('AUTHZ-PG13 two admins permit one removal, stale no-op rejected and fresh no-op stable', async () => {
    const e = environment(),
      r = await receipt(e),
      intent = { action: 'ROLE_REVOKE' as const, grantId: second.roleGrants[0].id };
    const changed = await e.mutations.execute(request(r, intent));
    expect(changed[0].revision).toBe('2');
    await expect(e.mutations.execute(request(r, intent))).rejects.toMatchObject({
      code: 'STALE_WRITE',
    });
    const fresh = await receipt(e);
    expect((await e.mutations.execute(request(fresh, intent)))[0].revision).toBe('2');
    expect(await rows('SELECT event_type FROM zhiban_identity.audit_events')).toHaveLength(1);
  });
  it('AUTHZ-PG14 independent two-admin removals serialize; exactly one succeeds and fresh roster follows lock', async () => {
    const p1 = pool(),
      p2 = pool(),
      e1 = environment(p1),
      e2 = environment(p2),
      r1 = await receipt(e1, 'ROLE_REVOKE', actor),
      r2 = await receipt(e2, 'ROLE_REVOKE', second, second);
    const locked = gate(),
      release = gate(),
      attempt = gate();
    let loserPid = 0;
    const guarded = observed(p1, async (sql) => {
      if (sql.includes('authorization_state(') && sql.includes('SELECT')) {
        locked.open();
        await release.ready;
      }
    });
    const waiter: TransactionPool = {
      connect: async () => {
        const c = await p2.connect();
        loserPid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        return {
          query: async (sql: string, params?: unknown[]) => {
            if (sql.includes('authorization_state(')) attempt.open();
            return c.query(sql, params);
          },
          release: (destroy?: boolean) => c.release(destroy),
        } as Awaited<ReturnType<TransactionPool['connect']>>;
      },
    };
    const winnerWork = new PostgresAuthorizationMutations(guarded, catalogPort(), {
      now: () => time,
    }).execute(request(r1, { action: 'ROLE_REVOKE', grantId: actor.roleGrants[0].id }));
    let loserWork: Promise<unknown> | undefined;
    try {
      await bounded(locked.ready);
      loserWork = new PostgresAuthorizationMutations(waiter, catalogPort(), {
        now: () => time,
      }).execute(request(r2, { action: 'ROLE_REVOKE', grantId: second.roleGrants[0].id }));
      const settled = Promise.allSettled([winnerWork, loserWork]);
      await bounded(attempt.ready);
      await acknowledgedBlocked(loserPid);
      release.open();
      const results = await bounded(settled);
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
      expect((results[1] as PromiseRejectedResult).reason).toMatchObject({
        reason: 'LAST_ADMIN_REQUIRED',
      });
      expect(
        (
          await rows(
            "SELECT count(DISTINCT membership_id)::text AS n FROM zhiban_identity.role_grants WHERE role_code='TENANT_ADMIN' AND revoked_at IS NULL AND tenant_id=$1",
            [tenant],
          )
        )[0].n,
      ).toBe('1');
    } finally {
      release.open();
      await Promise.allSettled([winnerWork, ...(loserWork ? [loserWork] : [])]);
    }
  }, 15000);
  it('AUTHZ-PG15 atomic admin replacement preserves one operational administrator', async () => {
    await administrator((c) => removeMember(c, second.id));
    const e = environment(),
      remove = await receipt(e, 'ROLE_REVOKE', actor),
      add = await receipt(e, 'ROLE_GRANT', student);
    const result = await e.mutations.execute({
      operations: [
        { receipt: remove, intent: { action: 'ROLE_REVOKE', grantId: actor.roleGrants[0].id } },
        {
          receipt: add,
          intent: {
            action: 'ROLE_GRANT',
            approvedGrant: {
              id: roleGrantId(id(901)),
              roleCode: 'TENANT_ADMIN',
              scope: tenantScope(),
              validUntil: null,
            },
          },
        },
      ],
      requestId: 'authorization-pg16',
      auditReason: 'ADMIN_REQUEST',
    });
    expect(result.map((r) => r.revision)).toEqual(['2', '2']);
    expect((await decision(e, 'MEMBERSHIP_READ', actor, student)).decision).toBe('ALLOW');
    expect(await rows('SELECT event_type FROM zhiban_identity.audit_events')).toHaveLength(2);
  });
  it.each(['future', 'expired', 'revoked', 'disabled-user'] as const)(
    'AUTHZ-PG16 %s successor does not satisfy last-admin guard',
    async (kind) => {
      await administrator((c) => removeMember(c, second.id));
      const e = environment(),
        repo = new PostgresMembershipRepository(e.p);
      const m =
        kind === 'future' || kind === 'expired'
          ? member(30, [
              grant(
                1030,
                'TENANT_ADMIN',
                tenantScope(),
                kind === 'future' ? 4000 : 1000,
                kind === 'expired' ? 2000 : null,
              ),
            ])
          : kind === 'revoked'
            ? second.revokeGrant({
                now: time,
                expectedAuthorizationVersion: 1,
                grantId: second.roleGrants[0].id,
              })
            : second;
      await administrator((c) => seedMember(c, m));
      if (kind === 'disabled-user')
        await rows(
          "UPDATE zhiban_identity.users SET status='DISABLED',updated_at=3000,disabled_at=3000,disabled_reason='review',repository_revision=repository_revision+1 WHERE user_id=$1",
          [second.userId],
        );
      const r = await receipt(e, 'ROLE_REVOKE', actor);
      await expect(
        e.mutations.execute(request(r, { action: 'ROLE_REVOKE', grantId: actor.roleGrants[0].id })),
      ).rejects.toMatchObject({ reason: 'LAST_ADMIN_REQUIRED' });
      expect((await repo.findById(context, actor.id))!.value.roleGrants[0].revokedAt).toBeNull();
    },
  );
  it('AUTHZ-PG17 owner SELECT policies remain tenant scoped, tenant runtime direct globals stay denied', async () => {
    const e = environment(),
      read = await e.state.read(context, actor.id, student.id);
    expect([...read.globals.users.keys()]).toEqual([actor.id, student.id]);
    expect(await new PostgresMembershipRepository(e.p).findById(context, foreign.id)).toBeNull();
    const policies = await rows(
      "SELECT tablename,roles,cmd,qual FROM pg_policies WHERE policyname LIKE '%authorization_owner_read'",
    );
    expect(policies).toHaveLength(2);
    for (const p of policies) {
      expect(p.roles).toEqual(['zhiban_identity_owner']);
      expect(p.cmd).toBe('SELECT');
      expect(p.qual).toContain('current_tenant_id');
    }
  });
  it('AUTHZ-PG18 real SystemAdminGrant gives no tenant teaching fallback', async () => {
    await rows(
      'INSERT INTO zhiban_identity.system_admin_grants (grant_id,user_id,created_at,valid_from) VALUES ($1,$2,1000,1000)',
      [id(920), student.userId],
    );
    expect((await decision(environment(), 'MEMBERSHIP_READ', actor, student)).decision).toBe(
      'DENY',
    );
  });
  it('AUTHZ-PG19 exact function ACL/owner/config and forbidden roles execute denied', async () => {
    const [f] = await rows(
      "SELECT p.prosecdef,p.provolatile,p.proparallel,p.proconfig,r.rolname FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='zhiban_identity.authorization_state(uuid,uuid,uuid[],text)'::regprocedure",
    );
    expect(f).toMatchObject({
      prosecdef: true,
      provolatile: 'v',
      proparallel: 'u',
      rolname: 'zhiban_identity_owner',
    });
    expect(f.proconfig).toEqual(
      expect.arrayContaining([
        'search_path=pg_catalog, zhiban_identity, pg_temp',
        'row_security=on',
      ]),
    );
    const [acl] = await rows(
      "SELECT count(*)::text AS n FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='zhiban_identity.authorization_state(uuid,uuid,uuid[],text)'::regprocedure AND a.grantee=0",
    );
    expect(acl.n).toBe('0');
    for (const role of ['zhiban_auth_runtime', 'zhiban_control_runtime'] as const) {
      const c = runtimeClient(role);
      await c.connect();
      try {
        await expectDenied(
          c,
          "SELECT * FROM zhiban_identity.authorization_state($1,$2,$3,'READ_CONTEXT')",
          [tenant, actor.id, [student.id]],
        );
      } finally {
        await c.end();
      }
    }
  });
  it('AUTHZ-PG20 unsupported modes/target excess/duplicates/missing context fail closed', async () => {
    const p = pool();
    for (const [targets, mode] of [
      [[student.id], 'SQL'],
      [[actor.id, student.id, second.id], 'READ_CONTEXT'],
      [[student.id, student.id], 'READ_CONTEXT'],
      [[actor.id], 'READ_CONTEXT'],
    ] as const) {
      if (mode === 'READ_CONTEXT' && targets.length === 1) {
        const c = runtimeClient('zhiban_runtime');
        await c.connect();
        try {
          await expectDenied(c, 'SELECT * FROM zhiban_identity.authorization_state($1,$2,$3,$4)', [
            tenant,
            actor.id,
            targets,
            mode,
          ]);
        } finally {
          await c.end();
        }
      } else
        await expect(
          tenantTransaction(p, context, (c) =>
            c.query('SELECT * FROM zhiban_identity.authorization_state($1,$2,$3,$4)', [
              tenant,
              actor.id,
              targets,
              mode,
            ]),
          ),
        ).rejects.toMatchObject({ code: '42501' });
    }
  });
  it('AUTHZ-PG21 audit failure fully rolls back CAS and history', async () => {
    const e = environment(),
      r = await receipt(e);
    await rows(
      "CREATE FUNCTION zhiban_identity.authz_test_audit_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$",
    );
    await rows(
      'CREATE TRIGGER authz_test_audit_reject BEFORE INSERT ON zhiban_identity.audit_events FOR EACH ROW EXECUTE FUNCTION zhiban_identity.authz_test_audit_reject()',
    );
    try {
      await expect(
        e.mutations.execute(
          request(r, { action: 'ROLE_REVOKE', grantId: second.roleGrants[0].id }),
        ),
      ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
      expect(
        (
          await rows(
            'SELECT repository_revision FROM zhiban_identity.memberships WHERE membership_id=$1',
            [second.id],
          )
        )[0].repository_revision,
      ).toBe('1');
      expect(
        (
          await rows('SELECT revoked_at FROM zhiban_identity.role_grants WHERE grant_id=$1', [
            second.roleGrants[0].id,
          ])
        )[0].revoked_at,
      ).toBeNull();
      expect(await rows('SELECT * FROM zhiban_identity.audit_events')).toHaveLength(0);
    } finally {
      await rows('DROP TRIGGER authz_test_audit_reject ON zhiban_identity.audit_events');
      await rows('DROP FUNCTION zhiban_identity.authz_test_audit_reject()');
    }
  });
  it('AUTHZ-PG22 authority expiry before commit rolls back all mutation/audit', async () => {
    const e = environment();
    await new PostgresMembershipRepository(e.p).save(
      context,
      actor.replaceGrants({
        now: time,
        expectedAuthorizationVersion: 1,
        approvedGrants: [
          RoleGrant.create({
            id: roleGrantId(id(901)),
            roleCode: 'TENANT_ADMIN',
            scope: tenantScope(),
            createdAt: time,
            validFrom: time,
            validUntil: instant(4000),
          }),
        ],
      }),
      (await receipt(e)).actorRevision,
    );
    const r = await receipt(e);
    let now = time;
    const p = pool(),
      delayed = observed(p, async (sql) => {
        if (sql.startsWith('INSERT INTO zhiban_identity.audit')) now = instant(4000);
      });
    await expect(
      new PostgresAuthorizationMutations(delayed, catalogPort(), { now: () => now }).execute(
        request(r, { action: 'ROLE_REVOKE', grantId: second.roleGrants[0].id }),
      ),
    ).rejects.toMatchObject({ reason: 'STALE_AUTHORIZATION' });
    expect(
      (
        await rows(
          'SELECT repository_revision FROM zhiban_identity.memberships WHERE membership_id=$1',
          [second.id],
        )
      )[0].repository_revision,
    ).toBe('1');
    expect(await rows('SELECT * FROM zhiban_identity.audit_events')).toHaveLength(0);
  });
  it('AUTHZ-PG23 User disable already locked: guard waits then sees DISABLED and rejects', async () => {
    const p = pool(),
      e = environment(p),
      r = await receipt(e),
      blocker = adminClient();
    await blocker.connect();
    const attempt = gate();
    let pid = 0;
    const waiting: TransactionPool = {
      connect: async () => {
        const c = await p.connect();
        pid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        return {
          query: async (sql: string, params?: unknown[]) => {
            if (sql.includes('authorization_state(')) attempt.open();
            return c.query(sql, params);
          },
          release: (destroy?: boolean) => c.release(destroy),
        } as Awaited<ReturnType<TransactionPool['connect']>>;
      },
    };
    let work: Promise<unknown> | undefined;
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        "UPDATE zhiban_identity.users SET status='DISABLED',updated_at=3000,disabled_at=3000,disabled_reason='review',repository_revision=repository_revision+1 WHERE user_id=$1",
        [actor.userId],
      );
      work = new PostgresAuthorizationMutations(waiting, catalogPort(), {
        now: () => time,
      }).execute(request(r, { action: 'ROLE_REVOKE', grantId: second.roleGrants[0].id }));
      const outcome = work.then(
        () => ({ allowed: true, error: null }),
        (error) => ({ allowed: false, error }),
      );
      await bounded(attempt.ready);
      await acknowledgedBlocked(pid);
      await blocker.query('COMMIT');
      expect(await bounded(outcome)).toMatchObject({
        allowed: false,
        error: { reason: 'INACTIVE_IDENTITY' },
      });
    } finally {
      await blocker.query('ROLLBACK');
      await blocker.end();
      if (work) await Promise.allSettled([work]);
    }
  }, 15000);
  it('AUTHZ-PG24 guard first: User SHARE lock blocks disable until authorized transaction ends', async () => {
    const p = pool(),
      e = environment(p),
      r = await receipt(e),
      locked = gate(),
      release = gate();
    const guarded = observed(p, async (sql) => {
      if (sql.includes('authorization_state(')) {
        locked.open();
        await release.ready;
      }
    });
    const work = new PostgresAuthorizationMutations(guarded, catalogPort(), {
      now: () => time,
    }).execute(request(r, { action: 'ROLE_REVOKE', grantId: second.roleGrants[0].id }));
    const c = adminClient();
    await c.connect();
    let disable: Promise<unknown> | undefined;
    try {
      await bounded(locked.ready);
      const pid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      disable = c.query(
        "UPDATE zhiban_identity.users SET status='DISABLED',updated_at=3000,disabled_at=3000,disabled_reason='review',repository_revision=repository_revision+1 WHERE user_id=$1",
        [actor.userId],
      );
      await acknowledgedBlocked(pid);
      release.open();
      await bounded(work);
      await bounded(disable);
      expect((await decision(e)).decision).toBe('DENY');
    } finally {
      release.open();
      await Promise.allSettled([work, ...(disable ? [disable] : [])]);
      await c.end();
    }
  }, 15000);
  it('AUTHZ-PG25 max revision rejects and pool/client resources are reusable', async () => {
    await administrator(async (c) => {
      await removeMember(c, second.id);
      await seedMember(c, second, '9223372036854775807');
    });
    const p = pool(),
      e = environment(p),
      r = await receipt(e);
    await expect(
      e.mutations.execute(request(r, { action: 'ROLE_REVOKE', grantId: second.roleGrants[0].id })),
    ).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect((await decision(e)).decision).toBe('ALLOW');
    expect(p.waitingCount).toBe(0);
    expect(p.idleCount).toBe(p.totalCount);
  });
  it('AUTHZ-PG26 malformed real SELECT record (fault-injected) fails closed before decision', async () => {
    const e = environment(),
      p = pool();
    const corrupt = observed(p, async () => {});
    const tampered: TransactionPool = {
      connect: async () => {
        const c = await corrupt.connect();
        return {
          query: async (sql: string, params?: unknown[]) => {
            const r = await c.query(sql, params);
            if (
              sql.includes('FROM zhiban_identity.role_grants') &&
              sql.includes('ORDER BY grant_ordinal')
            )
              return { ...r, rows: r.rows.map((g) => ({ ...g, scope_kind: 'SYSTEM' })) };
            return r;
          },
          release: (destroy?: boolean) => c.release(destroy),
        } as Awaited<ReturnType<TransactionPool['connect']>>;
      },
    };
    expect((await decision(environment(tampered))).decision).toBe('DENY');
    expect((await decision(e)).decision).toBe('ALLOW'); // real SELECT result only is fault-injected, never weakened DB invariant
  });
  it.each(['disable-first', 'guard-first'] as const)(
    'AUTHZ-PG27 Tenant mutation %s obeys the same acknowledged row lock',
    async (order) => {
      const p = pool(),
        e = environment(p),
        r = await receipt(e),
        c = adminClient();
      await c.connect();
      const locked = gate(),
        release = gate(),
        attempt = gate();
      let runtimePid = 0;
      const guarded: TransactionPool = {
        connect: async () => {
          const client = await p.connect();
          runtimePid = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
            .rows[0].pid;
          return {
            query: async (sql: string, params?: unknown[]) => {
              if (sql.includes('authorization_state(')) attempt.open();
              const result = await client.query(sql, params);
              if (order === 'guard-first' && sql.includes('authorization_state(')) {
                locked.open();
                await release.ready;
              }
              return result;
            },
            release: (destroy?: boolean) => client.release(destroy),
          } as Awaited<ReturnType<TransactionPool['connect']>>;
        },
      };
      const disableSql =
        "UPDATE zhiban_identity.tenants SET status='DISABLED',updated_at=3000,disabled_at=3000,disabled_reason='review',repository_revision=repository_revision+1 WHERE tenant_id=$1";
      let work: Promise<unknown> | undefined, disable: Promise<unknown> | undefined;
      try {
        if (order === 'disable-first') {
          await c.query('BEGIN');
          await c.query(disableSql, [tenant]);
        }
        work = new PostgresAuthorizationMutations(guarded, catalogPort(), {
          now: () => time,
        }).execute(request(r, { action: 'ROLE_REVOKE', grantId: second.roleGrants[0].id }));
        const outcome = work.then(
          () => ({ allowed: true }),
          (error) => ({ allowed: false, error }),
        );
        if (order === 'disable-first') {
          await bounded(attempt.ready);
          await acknowledgedBlocked(runtimePid);
          await c.query('COMMIT');
          expect(await bounded(outcome)).toMatchObject({ allowed: false });
          expect(
            (
              await rows('SELECT revoked_at FROM zhiban_identity.role_grants WHERE grant_id=$1', [
                second.roleGrants[0].id,
              ])
            )[0].revoked_at,
          ).toBeNull();
        } else {
          await bounded(locked.ready);
          const pid = (await c.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]
            .pid;
          disable = c.query(disableSql, [tenant]);
          await acknowledgedBlocked(pid);
          release.open();
          expect(await bounded(outcome)).toMatchObject({ allowed: true });
          await bounded(disable);
        }
        expect((await decision(e)).decision).toBe('DENY');
      } finally {
        release.open();
        await c.query('ROLLBACK');
        await Promise.allSettled([...(work ? [work] : []), ...(disable ? [disable] : [])]);
        await c.end();
      }
    },
    15000,
  );
  it('AUTHZ-PG28 bounded roster fails whole rather than truncating admin users', async () => {
    await administrator(async (c) => {
      await c.query('BEGIN');
      try {
        for (let n = 1000; n < 1255; n++) await seedMember(c, member(n));
        await c.query('COMMIT');
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      }
    });
    const e = environment(),
      r = await receipt(e);
    await expect(
      e.mutations.execute(request(r, { action: 'ROLE_REVOKE', grantId: second.roleGrants[0].id })),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(await rows('SELECT * FROM zhiban_identity.audit_events')).toHaveLength(0);
  }, 15000);
  it('AUTHZ-PG29 changed search_path cannot shadow helper objects; rollback/pool context clears', async () => {
    const p = pool();
    await tenantTransaction(p, context, async (c) => {
      await c.query('SET LOCAL search_path=pg_temp,public');
      const result = await c.query(
        'SELECT * FROM zhiban_identity.authorization_state($1,$2,$3,$4)',
        [tenant, actor.id, [student.id], 'READ_CONTEXT'],
      );
      expect(result.rows).toHaveLength(3);
    });
    const c = await p.connect();
    try {
      const result = await c.query('SELECT zhiban_identity.current_tenant_id() AS tenant');
      expect(result.rows[0].tenant).toBeNull();
    } finally {
      c.release();
    }
    for (const table of ['users', 'tenants', 'credentials', 'credential_slots', 'sessions']) {
      const runtime = runtimeClient('zhiban_runtime');
      await runtime.connect();
      try {
        await expectDenied(runtime, `SELECT * FROM zhiban_identity.${table}`);
      } finally {
        await runtime.end();
      }
    }
  });
  it('AUTHZ-PG30 max authorizationVersion fails closed, preserving parent/history/audit', async () => {
    await administrator(async (c) => {
      await removeMember(c, second.id);
      await seedMember(c, second, '1', '9007199254740991');
    });
    const e = environment(),
      r = await receipt(e);
    await expect(
      e.mutations.execute(request(r, { action: 'ROLE_REVOKE', grantId: second.roleGrants[0].id })),
    ).rejects.toMatchObject({ code: 'INTEGRITY_FAILURE' });
    expect(
      (
        await rows(
          'SELECT repository_revision FROM zhiban_identity.memberships WHERE membership_id=$1',
          [second.id],
        )
      )[0].repository_revision,
    ).toBe('1');
    expect(await rows('SELECT * FROM zhiban_identity.audit_events')).toHaveLength(0);
  });
  it.each([
    'grant',
    'replace',
    'activate',
    'rejoin',
    'preserve',
    'restore-replace',
    'disable',
    'leave',
  ] as const)('AUTHZ-PG31 %s shares the guarded transaction protocol', async (kind) => {
    const base = student,
      target =
        kind === 'activate'
          ? pending
          : kind === 'rejoin'
            ? base.leave({ now: time, expectedAuthorizationVersion: 1 })
            : kind === 'preserve' || kind === 'restore-replace'
              ? base.disable({ now: time, expectedAuthorizationVersion: 1, reason: 'review' })
              : base;
    if (target !== base && target !== pending)
      await administrator(async (c) => {
        await removeMember(c, base.id);
        await seedMember(c, target);
      });
    const added = {
      id: roleGrantId(id(901)),
      roleCode: 'STUDENT' as const,
      scope: selfScope(),
      validUntil: null,
    };
    const intent: MembershipMutationIntent =
      kind === 'grant'
        ? { action: 'ROLE_GRANT', approvedGrant: added }
        : kind === 'replace'
          ? { action: 'ROLE_REPLACE', approvedGrants: [added] }
          : kind === 'activate'
            ? { action: 'MEMBERSHIP_ACTIVATE', approvedGrants: [added] }
            : kind === 'rejoin'
              ? { action: 'MEMBERSHIP_REJOIN', approvedGrants: [added] }
              : kind === 'preserve'
                ? {
                    action: 'MEMBERSHIP_REACTIVATE',
                    mode: 'PRESERVE_EXISTING_VALID_GRANTS',
                    approvedGrantIds: [base.roleGrants[0].id],
                    approvedGrants: [],
                  }
                : kind === 'restore-replace'
                  ? {
                      action: 'MEMBERSHIP_REACTIVATE',
                      mode: 'REPLACE_GRANTS',
                      approvedGrantIds: [],
                      approvedGrants: [added],
                    }
                  : kind === 'disable'
                    ? { action: 'MEMBERSHIP_DISABLE', reason: 'review' }
                    : { action: 'MEMBERSHIP_LEAVE_ADMIN' };
    const p = pool(),
      e = environment(p),
      r = await receipt(e, intent.action, target);
    let guardCalls = 0;
    const watched = observed(p, async (sql, result) => {
      if (sql.includes('authorization_state(')) {
        expect(result.rows.some((x) => x.fact_kind === 'TENANT')).toBe(true);
        guardCalls++;
      }
    });
    const result = await new PostgresAuthorizationMutations(watched, catalogPort(), {
      now: () => time,
    }).execute(request(r, intent));
    expect(guardCalls).toBe(1);
    expect(result[0].revision).toBe('2');
    expect(result[0].value.authorizationVersion).toBe(target.authorizationVersion + 1);
    const audit = await rows(
      'SELECT actor_user_id,event_type,event_payload FROM zhiban_identity.audit_events',
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_user_id).toBe(actor.userId);
    expect(JSON.stringify(audit)).not.toMatch(/password|secret|digest|token|SQLSTATE/);
  });
  it('AUTHZ-PG32 second-target failure rolls back earlier target history and audit', async () => {
    const e = environment(),
      r1 = await receipt(e, 'ROLE_GRANT', student),
      r2 = await receipt(e, 'ROLE_GRANT', second);
    const approvedGrant = {
      id: roleGrantId(id(901)),
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
        requestId: 'authorization-pg16',
        auditReason: 'ADMIN_REQUEST',
      }),
    ).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(
      await rows('SELECT grant_id FROM zhiban_identity.role_grants WHERE grant_id=$1', [
        approvedGrant.id,
      ]),
    ).toHaveLength(0);
    expect(await rows('SELECT * FROM zhiban_identity.audit_events')).toHaveLength(0);
    expect(
      (
        await rows(
          'SELECT repository_revision FROM zhiban_identity.memberships WHERE membership_id=ANY($1::uuid[])',
          [[student.id, second.id]],
        )
      ).map((x) => x.repository_revision),
    ).toEqual(['1', '1']);
  });
});
