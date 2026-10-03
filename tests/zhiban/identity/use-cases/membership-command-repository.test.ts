import { describe, expect, it } from 'vitest';
import { MemberCommands } from '@/lib/zhiban/infrastructure/identity/composition/member-commands';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import type { MembershipSecurity } from '@/lib/zhiban/infrastructure/identity/composition/membership-security';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import type { MembershipCommandRequest } from '@/lib/zhiban/application/identity/ports/membership-composition';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { selfScope } from '@/lib/zhiban/domain/identity';
import { AuthorizationSqlHarness } from '../postgres/authorization-harness';
import { member, grant, tenant, catalogPort } from '../authorization/fixtures';

const actor = member(10),
  subject = member(20, [grant(1020, 'STUDENT', selfScope())]);
const handle = { kind: 'AUTHENTICATED_REQUEST' as const },
  transport = { kind: 'SERVER_TRANSPORT' as const };
/** Model extra append-only rows from bound INSERT params. Parent/grant CAS uses the
 * existing stateful repository harness; rollback restores every participating store. */
function fixture() {
  const base = new AuthorizationSqlHarness([actor, subject]);
  let records: Record<string, unknown[]>[] = [],
    snapshot: typeof records = [];
  let at = 3000,
    failure: string | null = null,
    checks = 0,
    clockRollback = false;
  const sqlCalls: string[] = [],
    proofOrder: string[] = [];
  const query = async (sql: string, p: unknown[] = []) => {
    sqlCalls.push(sql);
    if (failure !== null && sql.includes(failure))
      throw Object.assign(new Error('Synthetic internal persistence detail.'), {
        cause: 'Synthetic internal material',
        code: 'XX000',
      });
    if (sql.startsWith('BEGIN')) snapshot = structuredClone(records);
    if (sql === 'ROLLBACK') records = snapshot;
    if (sql.startsWith('SELECT user_id FROM zhiban_identity.memberships')) {
      const parent = base.parents.get(String(p[1]));
      return {
        command: 'SELECT',
        rowCount: parent ? 1 : 0,
        rows: parent ? [{ user_id: parent.user_id }] : [],
      };
    }
    if (sql.includes('clock_timestamp'))
      return {
        command: 'SELECT',
        rowCount: 1,
        rows: [{ at: String(clockRollback && at > 3000 ? 2999 : at++) }],
      };
    if (sql.includes('count(*)::integer AS records'))
      return { command: 'SELECT', rowCount: 1, rows: [{ records: records.length }] };
    if (sql.includes('nextval('))
      return { command: 'SELECT', rowCount: 1, rows: [{ id: String(base.audits.length + 1) }] };
    if (sql.startsWith('INSERT INTO zhiban_identity.audit_events')) {
      base.audits.push([...p]);
      return { command: 'INSERT', rowCount: 1, rows: [] };
    }
    if (sql.startsWith('INSERT INTO zhiban_identity.identity_')) {
      const table = sql.match(/INSERT INTO zhiban_identity\.(\w+)/)![1];
      records.push({ [table]: [...p] });
      return { command: 'INSERT', rowCount: 1, rows: [] };
    }
    if (sql.includes('FROM zhiban_identity.identity_tenant_commands')) {
      const values = records
        .filter((r) => 'identity_tenant_commands' in r)
        .map((r) => r.identity_tenant_commands)
        .filter((v) => v[1] === p[0] && v[2] === p[1] && v[4] === p[2] && v[5] === p[3]);
      const rows = values.map((v) => ({
        command_id: v[0],
        intent_digest: v[6],
        completed_at: v[8],
        outcome_kind: v[9],
      }));
      return { command: 'SELECT', rowCount: rows.length, rows };
    }
    if (sql.includes('FROM zhiban_identity.identity_tenant_command_effects')) {
      const rows = records
        .filter((r) => 'identity_tenant_command_effects' in r)
        .map((r) => r.identity_tenant_command_effects)
        .filter((v) => v[0] === p[0] && v[1] === p[1] && v[2] === p[2])
        .map((v) => ({
          after_revision: v[6],
          after_auth_version: v[8],
          after_status: v[9],
          membership_id: v[4],
          target_user_id: v[3],
          approval_id: v[12],
        }));
      return { command: 'SELECT', rowCount: rows.length, rows };
    }
    if (sql.includes('FROM zhiban_identity.identity_member_approvals')) {
      const rows = records
        .filter((r) => 'identity_member_approvals' in r)
        .map((r) => r.identity_member_approvals)
        .filter((v) => v[1] === p[0] && v[0] === p[1])
        .map((v) => ({
          expected_member_revision: v[8],
          expected_auth_version: v[9],
          consent_id: v[19],
          intent_digest: v[18],
          action: v[6],
        }));
      return { command: 'SELECT', rowCount: rows.length, rows };
    }
    if (sql.includes('FROM zhiban_identity.identity_member_approval_grants')) {
      const rows = records
        .filter((r) => 'identity_member_approval_grants' in r)
        .map((r) => r.identity_member_approval_grants)
        .filter((v) => v[0] === p[0] && v[1] === p[1])
        .map((v) => ({
          ordinal: v[2],
          grant_id: v[3],
          grant_mode: v[4],
          role_code: v[5],
          scope_kind: v[6],
          scope_id: v[7],
          created_at: v[8],
          valid_from: v[9],
          valid_until: v[10],
        }));
      return { command: 'SELECT', rowCount: rows.length, rows };
    }
    return base.query(sql, p);
  };
  const pool = {
    connect: async () => ({
      query,
      release: () => {
        base.released++;
      },
    }),
  } as unknown as TransactionPool;
  const security = {
    actor: () => actor.userId,
    prepare: async () => {
      proofOrder.push('KDF');
      return { kind: 'RECENT_MEMBERSHIP_REAUTHENTICATION' };
    },
    assertSession: async () => {},
    assertProof: async () => {
      proofOrder.push('LOCKED_PROOF');
      checks++;
      if (failure === 'FINAL_PROOF' && checks === 2) throw new IdentityPortError('CONFLICT');
    },
  } as unknown as MembershipSecurity;
  const facade = new MemberCommands(pool, security, catalogPort(), new IdentityIds(), {
    environmentRef: 'synthetic',
    approvalRef: 'synthetic-only',
    tenantRecordCapacity: 1000,
    controlRecordCapacity: 1000,
    sourceTtlMs: 600000,
  });
  const request: MembershipCommandRequest = {
    tenantId: tenant,
    actorMembershipId: actor.id,
    expectedActorRevision: repositoryRevision('1'),
    expectedActorAuthorizationVersion: 1,
    expectedTenantRevision: repositoryRevision('1'),
    action: 'ROLE_GRANT',
    idempotencyKey: 'one-key',
    requestId: 'one-request',
    targets: [
      {
        userId: subject.userId,
        membershipId: subject.id,
        expectedRevision: repositoryRevision('1'),
        expectedAuthorizationVersion: 1,
        action: 'ROLE_GRANT',
        admissionId: null,
        consentId: null,
        grants: [{ roleCode: 'STUDENT', scope: selfScope(), validUntil: null }],
        preserveGrantIds: [],
        revokeGrantId: null,
        mode: null,
        reason: 'ADMIN_REQUEST',
      },
    ],
  };
  return {
    base,
    facade,
    request,
    sqlCalls,
    proofOrder,
    records: () => records,
    setFailure: (value: string) => (failure = value),
    setClockRollback: () => (clockRollback = true),
  };
}
describe('C8 stateful member repository composition (not a PostgreSQL parser/concurrency proof)', () => {
  it('grants from SQL parameters, advances CAS/auth once, and final-checks existing approved grant at a later clock', async () => {
    const f = fixture(),
      result = await f.facade.execute(handle, f.request, 'Synthetic-unit-input', transport);
    expect(result.effects[0]).toMatchObject({
      revision: '2',
      authorizationVersion: 2,
      status: 'ACTIVE',
    });
    expect(f.base.parents.get(subject.id)).toMatchObject({
      repository_revision: '2',
      authorization_version: '2',
    });
    expect(f.base.grants.get(subject.id)).toHaveLength(2);
    expect(f.base.audits).toHaveLength(1);
    expect(f.records().filter((r) => 'identity_tenant_commands' in r)).toHaveLength(1);
    expect(f.proofOrder).toEqual(['KDF', 'LOCKED_PROOF', 'LOCKED_PROOF']);
    expect(f.sqlCalls.findIndex((s) => s.includes('authorization_state('))).toBeLessThan(
      f.sqlCalls.findIndex((s) => s.startsWith('UPDATE zhiban_identity.memberships')),
    );
  });
  it('stale rejection precedes no-op/ledger; fresh after versions confirm without extra writes', async () => {
    const f = fixture(),
      saved = await f.facade.execute(handle, f.request, 'Synthetic-unit-input', transport),
      audit = f.base.audits.length,
      records = f.records().length;
    await expect(
      f.facade.execute(handle, f.request, 'Synthetic-unit-input', transport),
    ).rejects.toBeInstanceOf(IdentityPortError);
    const current = {
      ...f.request,
      requestId: 'confirm-request',
      targets: f.request.targets.map((t) => ({
        ...t,
        expectedRevision: repositoryRevision('2'),
        expectedAuthorizationVersion: 2,
      })),
    };
    expect(
      await f.facade.execute(handle, current, 'Synthetic-unit-input', transport),
    ).toMatchObject({ commandId: saved.commandId });
    expect(f.base.audits).toHaveLength(audit);
    expect(f.records()).toHaveLength(records);
    expect(f.base.grants.get(subject.id)).toHaveLength(2);
  });
  it.each([
    'INSERT INTO zhiban_identity.audit_events',
    'identity_member_approvals',
    'identity_member_approval_grants',
    'INSERT INTO zhiban_identity.identity_tenant_command_effects',
    'INSERT INTO zhiban_identity.identity_tenant_commands',
    'FINAL_PROOF',
  ])(
    'failure %s restores parent/grant/provenance/audit/ledger and sanitizes error',
    async (fail) => {
      const f = fixture();
      f.setFailure(fail);
      const before = structuredClone([...f.base.grants]);
      const error = await f.facade
        .execute(handle, f.request, 'Synthetic-unit-input', transport)
        .catch((e) => e);
      expect(error).toBeInstanceOf(IdentityPortError);
      expect(JSON.stringify(error).includes('Synthetic')).toBe(false);
      expect(Object.hasOwn(error, 'cause')).toBe(false);
      expect(f.base.parents.get(subject.id)).toMatchObject({
        repository_revision: '1',
        authorization_version: '1',
      });
      expect([...f.base.grants]).toEqual(before);
      expect(f.base.audits).toEqual([]);
      expect(f.records()).toEqual([]);
      expect(f.sqlCalls).toContain('ROLLBACK');
    },
  );
  it('clock rollback at final verification aborts all mutations', async () => {
    const f = fixture();
    f.setClockRollback();
    await expect(
      f.facade.execute(handle, f.request, 'Synthetic-unit-input', transport),
    ).rejects.toBeInstanceOf(IdentityPortError);
    expect(f.base.parents.get(subject.id)?.repository_revision).toBe('1');
    expect(f.records()).toEqual([]);
  });
  it('safe confirmation rejects malformed immutable approved grant facts rather than trusting only a grant ID', async () => {
    const f = fixture();
    await f.facade.execute(handle, f.request, 'Synthetic-unit-input', transport);
    f
      .records()
      .find((r) => 'identity_member_approval_grants' in r)!.identity_member_approval_grants[5] =
      'TENANT_ADMIN';
    const current = {
      ...f.request,
      targets: f.request.targets.map((t) => ({
        ...t,
        expectedRevision: repositoryRevision('2'),
        expectedAuthorizationVersion: 2,
      })),
    };
    await expect(
      f.facade.execute(handle, current, 'Synthetic-unit-input', transport),
    ).rejects.toBeInstanceOf(IdentityPortError);
    expect(f.base.parents.get(subject.id)?.repository_revision).toBe('2');
  });
  it.each(['9223372036854775807', '01'])('revision %s fails closed', async (rev) => {
    const f = fixture();
    f.base.parents.set(subject.id, {
      ...f.base.parents.get(subject.id)!,
      repository_revision: rev,
    });
    const req = {
      ...f.request,
      targets: f.request.targets.map((t) => ({
        ...t,
        expectedRevision: rev as typeof t.expectedRevision,
      })),
    };
    await expect(
      f.facade.execute(handle, req, 'Synthetic-unit-input', transport),
    ).rejects.toBeInstanceOf(IdentityPortError);
    expect(f.records()).toEqual([]);
  });
});
