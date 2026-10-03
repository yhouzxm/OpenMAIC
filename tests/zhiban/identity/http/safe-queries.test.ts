import { describe, expect, it, vi } from 'vitest';
import { IdentitySafeQueryComposition } from '@/lib/zhiban/infrastructure/identity/composition/safe-queries';
import { membershipToRows } from '@/lib/zhiban/infrastructure/identity/postgres/mappers/membership';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import { member, grant, tenant, catalogPort, id } from '../authorization/fixtures';
import { selfScope, instant, userId, membershipId, Membership } from '@/lib/zhiban/domain/identity';
import { observeOperation } from '@/lib/zhiban/infrastructure/identity/composition/refusals';

function fixture() {
  const actor = member(10),
    target = member(20, [grant(30, 'STUDENT', selfScope())]),
    members = new Map([
      [actor.id, actor],
      [target.id, target],
    ]),
    handle = { kind: 'AUTHENTICATED_REQUEST' } as const;
  const calls: { sql: string; params: unknown[] }[] = [];
  let spoof = false,
    permission = true,
    corrupt = false,
    clock = 3000,
    failFinal = false,
    guards = 0;
  const release = vi.fn(),
    security = {
      actor: () => actor.userId,
      assertSession: vi.fn(async () => {
        calls.push({ sql: 'PRIVATE_SESSION', params: [] });
        if (failFinal && ++guards > 1) throw Error('Synthetic outage');
        return { userId: actor.userId, userRevision: '1' };
      }),
    };
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    let rows: unknown[] = [];
    let command = 'SELECT';
    if (sql.startsWith('BEGIN')) command = 'BEGIN';
    else if (sql === 'COMMIT' || sql === 'ROLLBACK') command = sql;
    else if (sql.includes('set_config')) rows = [{}];
    else if (sql.startsWith('SELECT user_id FROM')) {
      const m = members.get(params[1] as never);
      rows = m ? [{ user_id: spoof ? id(900) : m.userId }] : [];
    } else if (sql.includes('authorization_state'))
      rows = [
        {
          fact_kind: 'TENANT',
          tenant_id: tenant,
          tenant_status: 'ACTIVE',
          tenant_revision: '1',
          membership_id: null,
          user_id: null,
          user_status: null,
          user_revision: null,
        },
        ...[...members.values()].map((m) => ({
          fact_kind: 'USER',
          tenant_id: tenant,
          tenant_status: null,
          tenant_revision: null,
          membership_id: m.id,
          user_id: m.userId,
          user_status: 'ACTIVE',
          user_revision: '1',
        })),
      ];
    else if (sql.includes('clock_timestamp')) rows = [{ at: String(clock) }];
    else if (sql.includes('FROM zhiban_identity.memberships')) {
      let m = members.get(params[1] as never);
      if (m) {
        if (!permission && m.id === actor.id) m = member(10, [grant(31, 'STUDENT', selfScope())]);
        rows = [{ ...membershipToRows(m).membership, repository_revision: corrupt ? '01' : '1' }];
      }
    } else if (sql.includes('FROM zhiban_identity.role_grants')) {
      let m = members.get(params[1] as never);
      if (m) {
        if (!permission && m.id === actor.id) m = member(10, [grant(31, 'STUDENT', selfScope())]);
        rows = [...membershipToRows(m).roleGrants];
      }
    } else if (sql.includes('identity_member_consents')) rows = [];
    else throw Error('Unexpected safe-query SQL');
    return { command, rowCount: rows.length, rows };
  });
  const pool = { connect: async () => ({ query, release }) } as unknown as TransactionPool;
  const port = new IdentitySafeQueryComposition(
    { passwordState: async () => ({ credentialRevision: '1' }) } as never,
    pool,
    security as never,
    catalogPort(),
    {
      environmentRef: 'synthetic',
      approvalRef: 'synthetic',
      tenantRecordCapacity: 1000,
      controlRecordCapacity: 1000,
      sourceTtlMs: 600000,
    },
    null,
  );
  const q = {
    tenantId: tenant,
    actorMembershipId: actor.id,
    membershipId: target.id,
    afterGrantId: null,
    consentPurpose: null,
  };
  return {
    port,
    handle,
    q,
    calls,
    release,
    members,
    actor,
    target,
    set: (x: {
      spoof?: boolean;
      permission?: boolean;
      corrupt?: boolean;
      clock?: number;
      failFinal?: boolean;
    }) => {
      spoof = x.spoof ?? spoof;
      permission = x.permission ?? permission;
      corrupt = x.corrupt ?? corrupt;
      clock = x.clock ?? clock;
      failFinal = x.failFinal ?? failFinal;
    },
  };
}
describe('D8 same-client safe manager composition', () => {
  it('locks only after scoped actor ownership and projects exact metadata', async () => {
    const e = fixture(),
      v = await e.port.member(e.handle, e.q);
    expect(Object.keys(v).sort()).toEqual([
      'actorAuthorizationVersion',
      'actorRevision',
      'authorizationVersion',
      'consent',
      'grants',
      'membershipId',
      'nextGrantCursor',
      'revision',
      'status',
      'tenantId',
      'tenantRevision',
      'userId',
    ]);
    expect(v.grants).toHaveLength(1);
    expect(v.consent).toBeNull();
    const binding = e.calls.findIndex((c) => c.sql.startsWith('SELECT user_id')),
      lock = e.calls.findIndex((c) => c.sql.includes('authorization_state')),
      session = e.calls.findIndex((c) => c.sql === 'PRIVATE_SESSION');
    expect(binding).toBeLessThan(lock);
    expect(lock).toBeLessThan(session);
    expect(e.calls[lock].params).toEqual([tenant, e.actor.id, [e.target.id], 'GUARD_MEMBERSHIP']);
    expect(e.calls.filter((c) => c.sql === 'PRIVATE_SESSION')).toHaveLength(2);
    expect(e.calls.at(-1)?.sql).toBe('COMMIT');
    expect(e.calls.some((c) => c.sql.includes('identity_member_consents'))).toBe(false);
  });
  it('spoofed actor never locks any User/Session', async () => {
    const e = fixture();
    e.set({ spoof: true });
    expect(await observeOperation(() => e.port.member(e.handle, e.q))).toEqual({
      ok: false,
      refusal: 'TARGET_HIDDEN',
    });
    expect(
      e.calls.some((c) => c.sql.includes('authorization_state') || c.sql === 'PRIVATE_SESSION'),
    ).toBe(false);
    expect(e.calls.at(-1)?.sql).toBe('ROLLBACK');
  });
  it('real Domain permission denial is hidden', async () => {
    const e = fixture();
    e.set({ permission: false });
    expect(await observeOperation(() => e.port.member(e.handle, e.q))).toEqual({
      ok: false,
      refusal: 'TARGET_HIDDEN',
    });
  });
  it('unknown member is hidden before serialization', async () => {
    const e = fixture();
    await expect(
      e.port.member(e.handle, { ...e.q, membershipId: membershipId(id(999)) }),
    ).rejects.toThrow();
    expect(e.calls.some((c) => c.sql.includes('authorization_state'))).toBe(false);
  });
  it('corrupt persisted revision is system failure not HTTP409', async () => {
    const e = fixture();
    e.set({ corrupt: true });
    expect(await observeOperation(() => e.port.member(e.handle, e.q))).toEqual({
      ok: false,
      refusal: null,
    });
  });
  it('final Session recheck failure rolls back read and releases client', async () => {
    const e = fixture();
    e.set({ failFinal: true });
    await expect(e.port.member(e.handle, e.q)).rejects.toThrow();
    expect(e.calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(e.release).toHaveBeenCalledTimes(1);
  });
  it('full aggregate validated before bounded grant page; cursor uses effective only', async () => {
    const e = fixture();
    e.members.set(
      e.target.id,
      member(
        20,
        Array.from({ length: 18 }, (_, i) => grant(100 + i, 'STUDENT', selfScope())),
      ),
    );
    const v = await e.port.member(e.handle, e.q);
    expect(v.grants).toHaveLength(16);
    expect(v.nextGrantCursor).toBe(id(115));
    const next = await e.port.member(e.handle, { ...e.q, afterGrantId: v.nextGrantCursor });
    expect(next.grants.map((g) => g.grantId)).toEqual([id(116), id(117)]);
    expect(next.nextGrantCursor).toBeNull();
  });
  it('expired history not projected', async () => {
    const e = fixture();
    e.members.set(e.target.id, member(20, [grant(100, 'STUDENT', selfScope(), 1000, 2000)]));
    expect((await e.port.member(e.handle, e.q)).grants).toEqual([]);
  });
  it('optional consent query retains RLS/User/version/source/consumption filters', async () => {
    const e = fixture();
    e.members.set(
      e.target.id,
      Membership.create({
        id: e.target.id,
        userId: e.target.userId,
        tenantId: tenant,
        now: instant(1000),
      }),
    );
    await e.port.member(e.handle, { ...e.q, consentPurpose: 'ACTIVATE' });
    const query = e.calls.find((c) => c.sql.includes('identity_member_consents'))!;
    expect(query.params).toEqual([
      tenant,
      e.target.id,
      e.target.userId,
      'ACTIVATE',
      '1',
      0,
      '1',
      '3000',
    ]);
    expect(query.sql).toContain('NOT EXISTS');
    expect(query.sql).toContain('identity_member_approvals');
    expect(query.sql).toContain('a.subject_user_revision=c.subject_user_revision');
    expect(query.sql).toContain('LIMIT 2');
  });
  it('consent metadata for a different current lifecycle is not projected', async () => {
    const e = fixture();
    expect(
      (await e.port.member(e.handle, { ...e.q, consentPurpose: 'ACTIVATE' })).consent,
    ).toBeNull();
    expect(e.calls.some((c) => c.sql.includes('identity_member_consents'))).toBe(false);
  });
  it('input mutation while awaiting the client cannot switch tenant or actor', async () => {
    const e = fixture();
    const reading = e.port.member(e.handle, e.q);
    e.q.actorMembershipId = membershipId(id(999));
    expect((await reading).actorRevision).toBe('1');
    expect(e.calls[2].params[1]).toBe(e.actor.id);
  });
  it('FIRST missing approved store refuses before helper SQL, no invented authority', async () => {
    const e = fixture();
    await expect(
      e.port.consentContext(e.handle, {
        tenantId: tenant,
        admissionId: null,
        onboardingRef: 'approved.ref',
      }),
    ).rejects.toThrow();
    expect(e.calls).toEqual([]);
  });
  it('invalid source combination refuses before SQL', async () => {
    const e = fixture();
    await expect(
      e.port.consentContext(e.handle, {
        tenantId: tenant,
        admissionId: userId(id(500)),
        onboardingRef: 'approved.ref',
      }),
    ).rejects.toThrow();
    expect(e.calls).toEqual([]);
  });
});
