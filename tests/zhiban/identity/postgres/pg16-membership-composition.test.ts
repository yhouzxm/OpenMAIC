import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { instant, membershipId, selfScope } from '@/lib/zhiban/domain/identity';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { PostgresMembershipRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/membership';
import { MemberCommands } from '@/lib/zhiban/infrastructure/identity/composition/member-commands';
import { MemberAdmissions } from '@/lib/zhiban/infrastructure/identity/composition/member-admissions';
import { ControlCommands } from '@/lib/zhiban/infrastructure/identity/composition/control-commands';
import { digestBearer } from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import {
  adminClient,
  configured,
  expectDenied,
  prepareSchema,
  resetDisposableIdentity,
  runtimeClient,
  verifyPg16,
} from './pg16-harness';
import {
  fixture,
  rows,
  pool,
  ids,
  password,
  transport,
  policy,
  installAdmissionPolicy,
  cleanupPools,
  acknowledgeBlocked,
} from './membership-composition-fixtures';

async function counts() {
  return rows(`SELECT
 (SELECT count(*)::int FROM zhiban_identity.memberships) AS members,
 (SELECT count(*)::int FROM zhiban_identity.role_grants) AS grants,
 (SELECT count(*)::int FROM zhiban_identity.audit_events) AS audit,
 (SELECT count(*)::int FROM zhiban_identity.identity_member_admissions WHERE consumed_at IS NOT NULL) AS consumed,
 (SELECT count(*)::int FROM zhiban_identity.identity_member_approvals) AS approvals,
 (SELECT count(*)::int FROM zhiban_identity.identity_tenant_commands) AS tenant_commands,
 (SELECT count(*)::int FROM zhiban_identity.identity_control_commands) AS control_commands,
 (SELECT count(*)::int FROM zhiban_identity.identity_tenant_command_effects) AS effects`);
}
async function active(e: Awaited<ReturnType<typeof fixture>>) {
  const a = await e.admission(),
    invited = await e.invite(a),
    member = invited.effects[0].membershipId!;
  const consentId = await e.consent(a, member),
    request = await e.request(member, 'MEMBERSHIP_ACTIVATE', {
      admissionId: a.admissionId,
      consentId,
      grants: [{ roleCode: 'STUDENT', scope: selfScope(), validUntil: null }],
    });
  const result = await e.memberCommands().execute(e.manager.handle, request, password, transport);
  return { a, member, consentId, request, result };
}
function failingPool(base: TransactionPool, fragment: string): TransactionPool {
  return {
    connect: async () => {
      const c = await base.connect();
      return {
        release: c.release.bind(c),
        query: ((sql: string, params: unknown[]) => {
          if (sql.includes(fragment)) throw new Error('Synthetic persistence outage.');
          return c.query(sql, params);
        }) as typeof c.query,
      };
    },
  };
}

describe
  .skipIf(!configured)
  .sequential(
    'real PG16 C8 membership/control composition and approved read-only confirmation',
    () => {
      beforeAll(async () => {
        expect(await verifyPg16()).toMatch(/^16\./);
      });
      beforeEach(async () => {
        await prepareSchema();
        await installAdmissionPolicy();
      });
      afterEach(cleanupPools);
      afterAll(resetDisposableIdentity);
      it('C8-PG01 exact migration, RLS, definer and trigger inventory', async () => {
        expect(
          (
            await rows('SELECT version FROM zhiban_identity.schema_migrations ORDER BY version')
          ).map((r) => r.version),
        ).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 1).padStart(4, '0')));
        const tables = await rows(
          "SELECT relname,relrowsecurity,relforcerowsecurity,relowner::regrole::text AS owner FROM pg_class WHERE relnamespace='zhiban_identity'::regnamespace AND relname LIKE 'identity_%' AND relkind='r'",
        );
        const newNames = [
          'identity_member_admissions',
          'identity_member_consents',
          'identity_member_approvals',
          'identity_member_approval_grants',
          'identity_tenant_commands',
          'identity_tenant_command_effects',
          'identity_control_approvals',
          'identity_control_commands',
          'identity_control_command_effects',
          'identity_tenant_onboarding',
        ];
        const selected = tables.filter((t) => newNames.includes(t.relname));
        expect(selected).toHaveLength(10);
        expect(selected.every((t) => t.owner === 'zhiban_identity_owner')).toBe(true);
        expect(selected.filter((t) => t.relrowsecurity && t.relforcerowsecurity)).toHaveLength(6);
      });
      it.each(['zhiban_auth_runtime', 'zhiban_control_runtime'] as const)(
        'C8 ACL %s cannot directly read tenant source/member/grant records',
        async (role) => {
          const c = runtimeClient(role);
          await c.connect();
          try {
            for (const table of [
              'identity_member_admissions',
              'identity_member_consents',
              'identity_member_approvals',
              'identity_member_approval_grants',
              'identity_tenant_commands',
              'identity_tenant_command_effects',
            ])
              await expectDenied(c, `SELECT * FROM zhiban_identity.${table}`);
            if (role === 'zhiban_control_runtime')
              for (const table of ['memberships', 'role_grants'])
                await expectDenied(c, `SELECT * FROM zhiban_identity.${table}`);
          } finally {
            await c.end();
          }
        },
      );
      it('C8-PG04 tenant cannot read control records or secret material; context is not a control capability', async () => {
        const c = runtimeClient('zhiban_runtime');
        await c.connect();
        try {
          for (const table of [
            'identity_control_approvals',
            'identity_control_commands',
            'identity_control_command_effects',
            'identity_tenant_onboarding',
            'credentials',
            'credential_slots',
            'sessions',
          ])
            await expectDenied(c, `SELECT * FROM zhiban_identity.${table}`);
          await expectDenied(c, 'SELECT zhiban_identity.identity_first_tenant_admin_lock($1,$2)', [
            ids.nextTenantId(),
            ids.nextCommandId(),
          ]);
        } finally {
          await c.end();
        }
      });
      it('C8-PG05 PUBLIC table/column/function capability remains absent', async () => {
        expect(
          await rows(
            `SELECT c.relname FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) acl WHERE c.relnamespace='zhiban_identity'::regnamespace AND c.relname LIKE 'identity_%' AND acl.grantee=0`,
          ),
        ).toEqual([]);
        expect(
          await rows(
            `SELECT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid CROSS JOIN LATERAL aclexplode(a.attacl) acl WHERE c.relnamespace='zhiban_identity'::regnamespace AND c.relname LIKE 'identity_%' AND a.attacl IS NOT NULL AND acl.grantee=0`,
          ),
        ).toEqual([]);
        expect(
          await rows(
            `SELECT p.proname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl WHERE p.pronamespace='zhiban_identity'::regnamespace AND p.proname LIKE 'identity_%' AND acl.grantee=0 AND acl.privilege_type='EXECUTE'`,
          ),
        ).toEqual([]);
      });
      it('C8-PG06 operator admission is not membership, grant or consent', async () => {
        const e = await fixture(),
          before = await counts(),
          a = await e.admission();
        expect((await counts())[0]).toMatchObject({
          members: before[0].members,
          grants: before[0].grants,
          approvals: 0,
        });
        expect(
          (
            await rows(
              'SELECT repository_revision,consumed_at,membership_id,source_kind FROM zhiban_identity.identity_member_admissions WHERE admission_id=$1',
              [a.admissionId],
            )
          )[0],
        ).toEqual({
          repository_revision: '1',
          consumed_at: null,
          membership_id: null,
          source_kind: 'OPERATOR_IMPORT',
        });
      });
      it('C8-PG07 unchanged admission safely confirms twice without mutation, audit or ID allocation', async () => {
        const e = await fixture(),
          a = await e.admission(),
          before = await counts();
        const confirmation = await e.control.execute(
          e.operator.handle,
          { ...e.controlRequest(a.manifest), requestId: ids.nextCommandId() },
          password,
          transport,
        );
        expect(confirmation).toMatchObject({
          commandId: a.result.commandId,
          admissionId: a.admissionId,
          status: 'APPLIED',
        });
        expect(await counts()).toEqual(before);
      });
      it('C8-PG08 invite creates PENDING without grants, consumes source and records closed audit', async () => {
        const e = await fixture(),
          a = await e.admission(),
          result = await e.invite(a),
          m = result.effects[0].membershipId!;
        expect(
          (
            await rows(
              'SELECT status,repository_revision,authorization_version FROM zhiban_identity.memberships WHERE membership_id=$1',
              [m],
            )
          )[0],
        ).toEqual({ status: 'PENDING', repository_revision: '1', authorization_version: '0' });
        expect(
          await rows('SELECT grant_id FROM zhiban_identity.role_grants WHERE membership_id=$1', [
            m,
          ]),
        ).toEqual([]);
        expect(
          (
            await rows(
              'SELECT repository_revision,command_id FROM zhiban_identity.identity_member_admissions WHERE admission_id=$1',
              [a.admissionId],
            )
          )[0],
        ).toEqual({ repository_revision: '2', command_id: result.commandId });
        expect(
          (
            await rows(
              "SELECT event_type,event_payload,authorization_version_before,authorization_version_after FROM zhiban_identity.audit_events WHERE subject_membership_id=$1 AND event_type='MEMBERSHIP_PENDING_CREATED'",
              [m],
            )
          )[0],
        ).toEqual({
          event_type: 'MEMBERSHIP_PENDING_CREATED',
          event_payload: {},
          authorization_version_before: null,
          authorization_version_after: '0',
        });
      });
      it('C8-PG09 consumed source cannot replay its old registration outcome', async () => {
        const e = await fixture(),
          a = await e.admission();
        await e.invite(a);
        const before = await counts();
        await expect(
          e.control.execute(e.operator.handle, e.controlRequest(a.manifest), password, transport),
        ).rejects.toBeInstanceOf(IdentityPortError);
        expect(await counts()).toEqual(before);
      });
      it('C8-PG10 self consent records approval evidence, never activates or grants', async () => {
        const e = await fixture(),
          a = await e.admission(),
          result = await e.invite(a),
          m = result.effects[0].membershipId!;
        await e.consent(a, m);
        expect(
          (
            await rows(
              'SELECT status,repository_revision,authorization_version FROM zhiban_identity.memberships WHERE membership_id=$1',
              [m],
            )
          )[0],
        ).toEqual({ status: 'PENDING', repository_revision: '1', authorization_version: '0' });
        const audit = (
          await rows(
            "SELECT actor_user_id,subject_user_id,event_payload FROM zhiban_identity.audit_events WHERE event_type='MEMBERSHIP_CONSENT_RECORDED'",
          )
        )[0];
        expect(audit).toEqual({
          actor_user_id: e.subject.id,
          subject_user_id: e.subject.id,
          event_payload: { purpose: 'ACTIVATE' },
        });
      });
      it('C8-PG11 fresh manager activation advances CAS/authVersion once and writes exact approval chain', async () => {
        const e = await fixture(),
          a = await active(e);
        expect(
          (
            await rows(
              'SELECT status,repository_revision,authorization_version FROM zhiban_identity.memberships WHERE membership_id=$1',
              [a.member],
            )
          )[0],
        ).toEqual({ status: 'ACTIVE', repository_revision: '2', authorization_version: '1' });
        expect(
          await rows(
            'SELECT grant_mode,role_code,scope_kind FROM zhiban_identity.identity_member_approval_grants',
          ),
        ).toEqual([{ grant_mode: 'NEW', role_code: 'STUDENT', scope_kind: 'SELF' }]);
        expect(
          (
            await rows(
              'SELECT consumed_at,approved_at,command_id,consent_id FROM zhiban_identity.identity_member_approvals',
            )
          )[0],
        ).toMatchObject({ command_id: a.result.commandId, consent_id: a.consentId });
      });
      it('C8-PG12 stale-before-confirmation; current after versions confirm without new audit/grants', async () => {
        const e = await fixture(),
          a = await active(e),
          before = await counts();
        await expect(
          e.memberCommands().execute(e.manager.handle, a.request, password, transport),
        ).rejects.toBeInstanceOf(IdentityPortError);
        const current = {
          ...a.request,
          requestId: ids.nextCommandId(),
          targets: a.request.targets.map((t) => ({
            ...t,
            expectedRevision: repositoryRevision('2'),
            expectedAuthorizationVersion: 1,
          })),
        };
        expect(
          await e.memberCommands().execute(e.manager.handle, current, password, transport),
        ).toMatchObject({ commandId: a.result.commandId, status: 'APPLIED' });
        expect(await counts()).toEqual(before);
      });
      it.each(['logout', 'credential', 'disable-restore'] as const)(
        'C8 revoked authentication (%s) cannot execute prepared member command',
        async (mode) => {
          const e = await fixture(),
            target = await e.seed(e.subject, 'STUDENT'),
            r = await e.request(target.id, 'ROLE_GRANT', {
              grants: [{ roleCode: 'STUDENT', scope: selfScope(), validUntil: null }],
            });
          if (mode === 'logout')
            await e.manager.authentication.logout(e.manager.handle, ids.nextCommandId());
          else if (mode === 'credential')
            await e.manager.authentication.changePassword(
              e.manager.handle,
              password,
              'Synthetic-C8-replacement!',
              transport,
              ids.nextCommandId(),
              '1',
            );
          else {
            const u = await e.manager.users.findById(e.manager.id);
            if (!u) throw new Error('Fixture missing.');
            const disabled = await e.manager.users.save(
              u.value.disable(instant(Date.now()), 'ADMIN_REQUEST'),
              u.revision,
            );
            await e.manager.users.save(
              disabled.value.restore(instant(Date.now())),
              disabled.revision,
            );
          }
          const before = await counts();
          await expect(
            e.memberCommands().execute(e.manager.handle, r, password, transport),
          ).rejects.toBeInstanceOf(IdentityPortError);
          expect(await counts()).toEqual(before);
        },
      );
      it('C8-PG16 forged handle and wrong password reject without business mutation', async () => {
        const e = await fixture(),
          target = await e.seed(e.subject, 'STUDENT'),
          r = await e.request(target.id, 'ROLE_GRANT', {
            grants: [{ roleCode: 'STUDENT', scope: selfScope(), validUntil: null }],
          }),
          before = await counts();
        await expect(
          e.memberCommands().execute({ kind: 'AUTHENTICATED_REQUEST' }, r, password, transport),
        ).rejects.toBeInstanceOf(IdentityPortError);
        await expect(
          e.memberCommands().execute(e.manager.handle, r, 'Synthetic-wrong!', transport),
        ).rejects.toBeInstanceOf(IdentityPortError);
        expect(await counts()).toEqual(before);
      });
      it.each([
        'audit_events',
        'identity_member_approvals',
        'identity_tenant_commands',
        'identity_tenant_command_effects',
      ])('C8 failure at %s rolls back parent/history/provenance/audit/outcome', async (table) => {
        const e = await fixture(),
          target = await e.seed(e.subject, 'STUDENT'),
          r = await e.request(target.id, 'ROLE_GRANT', {
            grants: [{ roleCode: 'STUDENT', scope: selfScope(), validUntil: null }],
          }),
          before = await counts();
        const facade = new MemberCommands(
          failingPool(e.manager.tenantPool, 'INSERT INTO zhiban_identity.' + table),
          e.manager.security,
          e.catalog,
          ids,
          policy,
        );
        await expect(
          facade.execute(e.manager.handle, r, password, transport),
        ).rejects.toBeInstanceOf(IdentityPortError);
        expect(await counts()).toEqual(before);
        expect(
          (
            await rows(
              'SELECT repository_revision,authorization_version FROM zhiban_identity.memberships WHERE membership_id=$1',
              [target.id],
            )
          )[0],
        ).toEqual({ repository_revision: '1', authorization_version: '1' });
      });
      it('C8-PG21 legacy grant cannot preserve; fresh approved replacement may recover', async () => {
        const e = await fixture(),
          target = await e.seed(e.subject, 'STUDENT'),
          repo = new PostgresMembershipRepository(e.subject.tenantPool),
          ctx = tenantScopeContext(e.tenant);
        const loaded = await repo.findById(ctx, target.id);
        if (!loaded) throw new Error('Fixture missing.');
        await repo.save(
          ctx,
          target.disable({
            now: instant(Date.now()),
            reason: 'ADMIN_REQUEST',
            expectedAuthorizationVersion: target.authorizationVersion,
          }),
          loaded.revision,
        );
        const a = await e.admission('REACTIVATE', target.id),
          consentId = await e.consent(a, target.id),
          before = await counts();
        const preserve = await e.request(target.id, 'MEMBERSHIP_REACTIVATE', {
          mode: 'PRESERVE_EXISTING_VALID_GRANTS',
          preserveGrantIds: [target.roleGrants[0].id],
          admissionId: a.admissionId,
          consentId,
        });
        await expect(
          e.memberCommands().execute(e.manager.handle, preserve, password, transport),
        ).rejects.toBeInstanceOf(IdentityPortError);
        expect(await counts()).toEqual(before);
        const replace = await e.request(target.id, 'MEMBERSHIP_REACTIVATE', {
          mode: 'REPLACE_GRANTS',
          grants: [{ roleCode: 'STUDENT', scope: selfScope(), validUntil: null }],
          admissionId: a.admissionId,
          consentId,
        });
        await e.memberCommands().execute(e.manager.handle, replace, password, transport);
        const state = await repo.findById(ctx, target.id);
        expect(state?.revision).toBe('3');
        expect(state?.value.status).toBe('ACTIVE');
        expect(
          state?.value.roleGrants.find((g) => g.id === target.roleGrants[0].id)?.isRevoked,
        ).toBe(true);
      });
      it('C8-PG22 last admin guard rejects two-target transfer that leaves none; no partial commit', async () => {
        const e = await fixture(),
          r1 = await e.request(e.managerMember.id, 'ROLE_REVOKE', {
            revokeGrantId: e.managerMember.roleGrants[0].id,
          }),
          r2 = await e.request(e.secondAdmin.id, 'ROLE_REVOKE', {
            revokeGrantId: e.secondAdmin.roleGrants[0].id,
          }),
          before = await counts();
        const r = {
          ...r1,
          action: 'MEMBERSHIP_ATOMIC_TRANSFER' as const,
          targets: [r1.targets[0], r2.targets[0]],
        };
        await expect(
          e.memberCommands().execute(e.manager.handle, r, password, transport),
        ).rejects.toBeInstanceOf(IdentityPortError);
        expect(await counts()).toEqual(before);
      });
      it('C8-PG23 concurrent invites use independent connections and acknowledged Tenant lock; exactly one creation', async () => {
        const e = await fixture(),
          a = await e.admission(),
          other = pool('zhiban_runtime'),
          gate = adminClient();
        await gate.connect();
        const pids = [
          (await e.manager.tenantPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
          (await other.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        ];
        const first = e.admissions(),
          second = new MemberAdmissions(other, e.manager.security, e.catalog, ids, policy, e.store);
        const request = {
          tenantId: e.tenant,
          actorMembershipId: e.managerMember.id,
          expectedActorRevision: repositoryRevision('1'),
          expectedActorAuthorizationVersion: 1,
          expectedTenantRevision: repositoryRevision('1'),
          admissionId: a.admissionId,
          idempotencyKey: ids.nextCommandId(),
          requestId: ids.nextCommandId(),
        };
        try {
          await gate.query('BEGIN');
          const blocker = (await gate.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          await gate.query(
            'SELECT tenant_id FROM zhiban_identity.tenants WHERE tenant_id=$1 FOR UPDATE',
            [e.tenant],
          );
          const outcome = Promise.allSettled([
            first.invite(e.manager.handle, request, password, transport),
            second.invite(
              e.manager.handle,
              { ...request, idempotencyKey: ids.nextCommandId(), requestId: ids.nextCommandId() },
              password,
              transport,
            ),
          ]);
          await acknowledgeBlocked(pids, blocker);
          await gate.query('COMMIT');
          const results = await outcome;
          expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
          expect(
            await rows(
              'SELECT membership_id FROM zhiban_identity.memberships WHERE tenant_id=$1 AND user_id=$2',
              [e.tenant, e.subject.id],
            ),
          ).toHaveLength(1);
        } finally {
          await gate.query('ROLLBACK');
          await gate.end();
        }
      });
      it('C8-PG24 admission confirmation waiting behind invite rereads consumed source and rejects', async () => {
        const e = await fixture(),
          a = await e.admission();
        const waiterPid = (await e.operator.control.query('SELECT pg_backend_pid() AS pid')).rows[0]
            .pid,
          writerPid = (await e.manager.tenantPool.query('SELECT pg_backend_pid() AS pid')).rows[0]
            .pid;
        let release!: () => void, locked!: () => void;
        const resume = new Promise<void>((r) => (release = r)),
          acquired = new Promise<void>((r) => (locked = r));
        const gated: TransactionPool = {
          connect: async () => {
            const c = await e.manager.tenantPool.connect();
            return {
              release: c.release.bind(c),
              query: (async (sql: string, p: unknown[]) => {
                const result = await c.query(sql, p);
                if (sql.includes('identity_member_admission_state(')) {
                  locked();
                  await resume;
                }
                return result;
              }) as typeof c.query,
            };
          },
        };
        const writer = new MemberAdmissions(
          gated,
          e.manager.security,
          e.catalog,
          ids,
          policy,
          e.store,
        );
        const writing = writer
          .invite(
            e.manager.handle,
            {
              tenantId: e.tenant,
              actorMembershipId: e.managerMember.id,
              expectedActorRevision: repositoryRevision('1'),
              expectedActorAuthorizationVersion: 1,
              expectedTenantRevision: repositoryRevision('1'),
              admissionId: a.admissionId,
              idempotencyKey: ids.nextCommandId(),
              requestId: ids.nextCommandId(),
            },
            password,
            transport,
          )
          .then(
            (r) => ({ ok: true, result: r }),
            () => ({ ok: false, result: null }),
          );
        try {
          await Promise.race([
            acquired,
            writing.then(() => {
              throw new Error('Writer finished before acknowledged lock.');
            }),
          ]);
          const confirmation = e.control
            .execute(e.operator.handle, e.controlRequest(a.manifest), password, transport)
            .then(
              () => false,
              () => true,
            );
          await acknowledgeBlocked([waiterPid], writerPid);
          release();
          expect((await writing).ok).toBe(true);
          expect(await confirmation).toBe(true);
          expect(
            (
              await rows(
                'SELECT repository_revision FROM zhiban_identity.identity_member_admissions WHERE admission_id=$1',
                [a.admissionId],
              )
            )[0],
          ).toEqual({ repository_revision: '2' });
        } finally {
          release();
          await writing;
        }
      });
      it('C8-PG25 FIRST creates only the approved singleton, closes anchor and two audits', async () => {
        const e = await fixture(),
          first = await e.first();
        const result = await e.control.execute(
          e.operator.handle,
          e.controlRequest(first.manifest),
          password,
          transport,
          first.consentId,
        );
        expect(result).toMatchObject({
          membershipId: first.manifest.planned_membership_id,
          grantId: first.manifest.planned_grant_id,
          revision: '2',
        });
        expect(
          (
            await rows(
              'SELECT repository_revision,membership_id,grant_id FROM zhiban_identity.identity_tenant_onboarding WHERE tenant_id=$1',
              [first.tenant],
            )
          )[0],
        ).toEqual({
          repository_revision: '2',
          membership_id: result.membershipId,
          grant_id: result.grantId,
        });
        expect(
          await rows(
            'SELECT event_type FROM zhiban_identity.audit_events WHERE tenant_id=$1 AND actor_service_code=$2 ORDER BY event_id',
            [first.tenant, 'identity_tenant_onboarding'],
          ),
        ).toEqual([
          { event_type: 'MEMBERSHIP_PENDING_CREATED' },
          { event_type: 'MEMBERSHIP_ACTIVATED' },
        ]);
      });
      it('C8-PG26 terminal FIRST confirmation is read-only and second apply fails before DML', async () => {
        const e = await fixture(),
          first = await e.first();
        await e.control.execute(
          e.operator.handle,
          e.controlRequest(first.manifest),
          password,
          transport,
          first.consentId,
        );
        const before = await counts();
        expect(
          await e.control.execute(
            e.operator.handle,
            e.controlRequest(first.manifest),
            password,
            transport,
          ),
        ).toMatchObject({ commandId: first.manifest.command_id, revision: '2' });
        expect(await counts()).toEqual(before);
        const c = runtimeClient('zhiban_control_runtime');
        await c.connect();
        try {
          await expectDenied(
            c,
            'SELECT * FROM zhiban_identity.identity_first_tenant_admin_apply($1,$2,$3,$4)',
            [first.tenant, first.manifest.approval_id, first.consentId, Date.now().toString()],
          );
        } finally {
          await c.end();
        }
      });
      it('C8-PG27 isolated FIRST apply cannot commit without paired audits/outcome/terminal anchor', async () => {
        const e = await fixture(),
          first = await e.first(),
          before = await counts(),
          c = runtimeClient('zhiban_control_runtime');
        await c.connect();
        try {
          await c.query('BEGIN');
          await c.query(
            'SELECT * FROM zhiban_identity.identity_first_tenant_admin_apply($1,$2,$3,$4)',
            [first.tenant, first.manifest.approval_id, first.consentId, Date.now().toString()],
          );
          await expect(c.query('COMMIT')).rejects.toMatchObject({ code: '23514' });
        } finally {
          await c.query('ROLLBACK');
          await c.end();
        }
        expect(await counts()).toEqual(before);
      });
      it('C8-PG28 FIRST terminal recheck rejects changed member version, even ACTIVE again', async () => {
        const e = await fixture(),
          first = await e.first();
        await e.control.execute(
          e.operator.handle,
          e.controlRequest(first.manifest),
          password,
          transport,
          first.consentId,
        );
        const repo = new PostgresMembershipRepository(e.subject.tenantPool),
          ctx = tenantScopeContext(first.tenant),
          m = await repo.findById(ctx, membershipId(first.manifest.planned_membership_id!));
        if (!m) throw new Error('Fixture missing.');
        await repo.save(
          ctx,
          m.value.disable({
            now: instant(Date.now()),
            reason: 'ADMIN_REQUEST',
            expectedAuthorizationVersion: m.value.authorizationVersion,
          }),
          m.revision,
        );
        await expect(
          e.control.execute(
            e.operator.handle,
            e.controlRequest(first.manifest),
            password,
            transport,
          ),
        ).rejects.toBeInstanceOf(IdentityPortError);
      });
      it('C8-PG29 unrelated valid members do not invalidate exact FIRST terminal product', async () => {
        const e = await fixture(),
          first = await e.first();
        await e.control.execute(
          e.operator.handle,
          e.controlRequest(first.manifest),
          password,
          transport,
          first.consentId,
        );
        await e.seed(e.manager, 'STUDENT', 'ACTIVE', first.tenant);
        const before = await counts();
        await e.control.execute(
          e.operator.handle,
          e.controlRequest(first.manifest),
          password,
          transport,
        );
        expect(await counts()).toEqual(before);
      });
      it.each([
        'audit_events',
        'identity_control_commands',
        'identity_control_command_effects',
        'UPDATE zhiban_identity.identity_tenant_onboarding',
      ])('C8 FIRST fault %s rolls back complete output', async (fragment) => {
        const e = await fixture(),
          first = await e.first(),
          before = await counts(),
          pattern = fragment.startsWith('UPDATE')
            ? fragment
            : 'INSERT INTO zhiban_identity.' + fragment;
        const control = new ControlCommands(
          failingPool(e.operator.control, pattern),
          e.operator.security,
          e.catalog,
          e.store,
          ids,
          policy,
        );
        await expect(
          control.execute(
            e.operator.handle,
            e.controlRequest(first.manifest),
            password,
            transport,
            first.consentId,
          ),
        ).rejects.toBeInstanceOf(IdentityPortError);
        expect(await counts()).toEqual(before);
        expect(
          (
            await rows(
              'SELECT repository_revision FROM zhiban_identity.identity_tenant_onboarding WHERE tenant_id=$1',
              [first.tenant],
            )
          )[0],
        ).toEqual({ repository_revision: '1' });
      });
      it('C8-PG34 direct admission helper rejects unrelated IDs and restores local context on error', async () => {
        const e = await fixture(),
          a = await e.admission(),
          c = runtimeClient('zhiban_control_runtime');
        await c.connect();
        try {
          await c.query('BEGIN');
          await c.query('SAVEPOINT probe');
          await c.query("SELECT set_config('app.tenant_id',$1,true)", [ids.nextTenantId()]);
          const prior = (await c.query("SELECT current_setting('app.tenant_id',true) AS ctx"))
            .rows[0].ctx;
          await expect(
            c.query('SELECT zhiban_identity.identity_member_admission_register($1,$2,$3,$4)', [
              digestBearer(e.operator.raw),
              e.operator.id,
              a.manifest.approval_id,
              ids.nextCommandId(),
            ]),
          ).rejects.toMatchObject({ code: '42501' });
          await c.query('ROLLBACK TO SAVEPOINT probe');
          await c.query("SELECT set_config('app.tenant_id',$1,true)", [prior]);
          await c.query('SELECT zhiban_identity.identity_member_admission_register($1,$2,$3,$4)', [
            digestBearer(e.operator.raw),
            e.operator.id,
            a.manifest.approval_id,
            a.admissionId,
          ]);
          expect(
            (await c.query("SELECT current_setting('app.tenant_id',true) AS ctx")).rows[0].ctx,
          ).toBe(prior);
        } finally {
          await c.query('ROLLBACK');
          await c.end();
        }
      });
      it('C8-PG35 control User state mutation is CAS/audit/outcome atomic and old Session stays dead', async () => {
        const e = await fixture(),
          m = await e.manifest('USER_DISABLE', {
            target_user_id: e.subject.id,
            expected_user_revision: '1',
          });
        await e.control.execute(e.operator.handle, e.controlRequest(m), password, transport);
        expect(
          (
            await rows(
              'SELECT status,repository_revision FROM zhiban_identity.users WHERE user_id=$1',
              [e.subject.id],
            )
          )[0],
        ).toEqual({ status: 'DISABLED', repository_revision: '2' });
        await expect(e.subject.authentication.me(e.subject.handle)).rejects.toBeInstanceOf(
          IdentityPortError,
        );
        const subjectSessions = await rows(
          'SELECT revoked_at FROM zhiban_identity.sessions WHERE user_id=$1',
          [e.subject.id],
        );
        expect(subjectSessions).toHaveLength(1);
        expect(subjectSessions[0].revoked_at).not.toBeNull();
        const restore = await e.manifest('USER_RESTORE', {
          target_user_id: e.subject.id,
          expected_user_revision: '2',
        });
        await e.control.execute(e.operator.handle, e.controlRequest(restore), password, transport);
        expect(
          (
            await rows(
              'SELECT status,repository_revision FROM zhiban_identity.users WHERE user_id=$1',
              [e.subject.id],
            )
          )[0],
        ).toEqual({ status: 'ACTIVE', repository_revision: '3' });
        await expect(e.subject.authentication.authenticate(e.subject.raw)).rejects.toMatchObject({
          code: 'CONFLICT',
        });
      });
      it('C8-PG36 Tenant restore requires current operational and governance admins', async () => {
        const e = await fixture(),
          disable = await e.manifest('TENANT_DISABLE', {
            tenant_id: e.tenant,
            expected_tenant_revision: '1',
          });
        await e.control.execute(e.operator.handle, e.controlRequest(disable), password, transport);
        const restore = await e.manifest('TENANT_RESTORE', {
          tenant_id: e.tenant,
          expected_tenant_revision: '2',
        });
        await e.control.execute(e.operator.handle, e.controlRequest(restore), password, transport);
        expect(
          (
            await rows(
              'SELECT status,repository_revision FROM zhiban_identity.tenants WHERE tenant_id=$1',
              [e.tenant],
            )
          )[0],
        ).toEqual({ status: 'ACTIVE', repository_revision: '3' });
      });
      it('C8-PG37 safe records/audit/error never contain raw credential, bearer or verifier', async () => {
        const e = await fixture();
        await active(e);
        const persisted = await rows(
          `SELECT row_to_json(c) AS data FROM zhiban_identity.identity_tenant_commands c UNION ALL SELECT row_to_json(a) FROM zhiban_identity.identity_member_approvals a UNION ALL SELECT row_to_json(e) FROM zhiban_identity.audit_events e`,
        );
        const serialized = JSON.stringify(persisted);
        expect(serialized.includes(password)).toBe(false);
        expect(serialized.includes(e.manager.raw)).toBe(false);
        expect(serialized.includes('$argon2')).toBe(false);
        expect(serialized.includes('token_digest')).toBe(false);
      });
      it.each(['USER_CREATE', 'TENANT_CREATE'] as const)(
        'C8 %s safe confirmation requires current after version and preserves original null before',
        async (purpose) => {
          const e = await fixture(),
            m = await e.manifest(
              purpose,
              purpose === 'USER_CREATE'
                ? { planned_user_id: ids.nextUserId() }
                : {
                    planned_tenant_id: ids.nextTenantId(),
                    tenant_code: 'planned_' + ids.nextCommandId().slice(-12),
                    tenant_display_name: 'Planned Tenant',
                  },
            ),
            request = e.controlRequest(m);
          await e.control.execute(e.operator.handle, request, password, transport);
          const before = await counts();
          await expect(
            e.control.execute(e.operator.handle, request, password, transport),
          ).rejects.toBeInstanceOf(IdentityPortError);
          const fresh = {
            ...request,
            ...(purpose === 'USER_CREATE'
              ? { expectedUserRevision: repositoryRevision('1') }
              : { expectedTenantRevision: repositoryRevision('1') }),
          };
          expect(
            await e.control.execute(e.operator.handle, fresh, password, transport),
          ).toMatchObject({ commandId: m.command_id, revision: '1' });
          expect(await counts()).toEqual(before);
          expect(
            (
              await rows(
                'SELECT before_revision,after_revision FROM zhiban_identity.identity_control_command_effects WHERE command_id=$1',
                [m.command_id],
              )
            )[0],
          ).toEqual({ before_revision: null, after_revision: '1' });
        },
      );
      it('C8 completed approved grant provenance permits later preserve without reviving legacy history', async () => {
        const e = await fixture(),
          a = await active(e),
          repo = new PostgresMembershipRepository(e.manager.tenantPool),
          ctx = tenantScopeContext(e.tenant),
          m = await repo.findById(ctx, membershipId(a.member));
        if (!m) throw new Error('Fixture missing.');
        await e
          .memberCommands()
          .execute(
            e.manager.handle,
            await e.request(a.member, 'MEMBERSHIP_DISABLE'),
            password,
            transport,
          );
        const source = await e.admission('REACTIVATE', a.member),
          consentId = await e.consent(source, a.member);
        const req = await e.request(a.member, 'MEMBERSHIP_REACTIVATE', {
          mode: 'PRESERVE_EXISTING_VALID_GRANTS',
          preserveGrantIds: [m.value.roleGrants[0].id],
          admissionId: source.admissionId,
          consentId,
        });
        await e.memberCommands().execute(e.manager.handle, req, password, transport);
        const after = await repo.findById(ctx, membershipId(a.member));
        expect(after?.value.status).toBe('ACTIVE');
        expect(after?.value.roleGrants.map((g) => g.id)).toEqual([m.value.roleGrants[0].id]);
        expect(after?.value.roleGrants[0].isRevoked).toBe(false);
      });
      it('C8 two concurrent administrator self removals cannot leave zero current admins', async () => {
        const e = await fixture(),
          r1 = await e.request(e.managerMember.id, 'ROLE_REVOKE', {
            revokeGrantId: e.managerMember.roleGrants[0].id,
          }),
          r2 = await e.request(
            e.secondAdmin.id,
            'ROLE_REVOKE',
            { revokeGrantId: e.secondAdmin.roleGrants[0].id },
            e.operator,
            e.secondAdmin,
          ),
          gate = adminClient();
        await gate.connect();
        const pids = [
          (await e.manager.tenantPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
          (await e.operator.tenantPool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
        ];
        try {
          await gate.query('BEGIN');
          const blocker = (await gate.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          await gate.query(
            'SELECT tenant_id FROM zhiban_identity.tenants WHERE tenant_id=$1 FOR UPDATE',
            [e.tenant],
          );
          const pending = Promise.allSettled([
            e.memberCommands().execute(e.manager.handle, r1, password, transport),
            e.memberCommands(e.operator).execute(e.operator.handle, r2, password, transport),
          ]);
          await acknowledgeBlocked(pids, blocker);
          await gate.query('COMMIT');
          const results = await pending;
          expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
          const remaining = await rows(
            "SELECT g.grant_id FROM zhiban_identity.role_grants g JOIN zhiban_identity.memberships m USING(tenant_id,membership_id) WHERE g.tenant_id=$1 AND m.status='ACTIVE' AND g.role_code='TENANT_ADMIN' AND g.revoked_at IS NULL",
            [e.tenant],
          );
          expect(remaining).toHaveLength(1);
        } finally {
          await gate.query('ROLLBACK');
          await gate.end();
        }
      });
      it.each(['writer-first', 'helper-first'] as const)(
        'C8 FIRST terminal %s uses acknowledged Tenant serialization and fresh state',
        async (order) => {
          const e = await fixture(),
            first = await e.first();
          await e.control.execute(
            e.operator.handle,
            e.controlRequest(first.manifest),
            password,
            transport,
            first.consentId,
          );
          const c = runtimeClient('zhiban_control_runtime'),
            // Privileged fixture writer probes the helper's lock boundary; the
            // facade concurrency test above separately exercises runtime ACL/policy.
            writer = adminClient();
          await c.connect();
          await writer.connect();
          const cp = (await c.query('SELECT pg_backend_pid() AS pid')).rows[0].pid,
            wp = (await writer.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          const mutate = async () => {
            await writer.query('BEGIN');
            await writer.query("SELECT set_config('app.tenant_id',$1,true)", [first.tenant]);
            await writer.query(
              'SELECT tenant_id FROM zhiban_identity.tenants WHERE tenant_id=$1 FOR UPDATE',
              [first.tenant],
            );
            await writer.query(
              "UPDATE zhiban_identity.memberships SET status='DISABLED',disabled_at=$1,disabled_reason='ADMIN_REQUEST',updated_at=$1,repository_revision=repository_revision+1,authorization_version=authorization_version+1 WHERE tenant_id=$2 AND membership_id=$3",
              [Date.now().toString(), first.tenant, first.manifest.planned_membership_id],
            );
            await writer.query('COMMIT');
          };
          try {
            if (order === 'writer-first') {
              await writer.query('BEGIN');
              await writer.query("SELECT set_config('app.tenant_id',$1,true)", [first.tenant]);
              await writer.query(
                'SELECT tenant_id FROM zhiban_identity.tenants WHERE tenant_id=$1 FOR UPDATE',
                [first.tenant],
              );
              const recheck = c
                .query('SELECT zhiban_identity.identity_first_tenant_admin_lock($1,$2)', [
                  first.tenant,
                  first.manifest.approval_id,
                ])
                .then(
                  () => false,
                  () => true,
                );
              await acknowledgeBlocked([cp], wp);
              await writer.query(
                "UPDATE zhiban_identity.memberships SET status='DISABLED',disabled_at=$1,disabled_reason='ADMIN_REQUEST',updated_at=$1,repository_revision=3,authorization_version=2 WHERE tenant_id=$2 AND membership_id=$3",
                [Date.now().toString(), first.tenant, first.manifest.planned_membership_id],
              );
              await writer.query('COMMIT');
              expect(await recheck).toBe(true);
            } else {
              await c.query('BEGIN');
              await c.query('SELECT zhiban_identity.identity_first_tenant_admin_lock($1,$2)', [
                first.tenant,
                first.manifest.approval_id,
              ]);
              const writing = mutate().then(
                () => true,
                () => false,
              );
              await acknowledgeBlocked([wp], cp);
              await c.query('COMMIT');
              expect(await writing).toBe(true);
              await expect(
                c.query('SELECT zhiban_identity.identity_first_tenant_admin_lock($1,$2)', [
                  first.tenant,
                  first.manifest.approval_id,
                ]),
              ).rejects.toMatchObject({ code: '42501' });
            }
          } finally {
            // Release both sides concurrently if an assertion interrupts a lock wait.
            await Promise.all([c.query('ROLLBACK'), writer.query('ROLLBACK')]);
            await c.end();
            await writer.end();
          }
        },
      );
      it.each(['extra-grant', 'revoked', 'expired', 'future'] as const)(
        'C8 FIRST terminal rejects %s product facts and preserves context',
        async (fault) => {
          const e = await fixture(),
            first = await e.first();
          await e.control.execute(
            e.operator.handle,
            e.controlRequest(first.manifest),
            password,
            transport,
            first.consentId,
          );
          const probe = adminClient(),
            c = runtimeClient('zhiban_control_runtime');
          await probe.connect();
          await c.connect();
          try {
            if (fault === 'extra-grant')
              await probe.query(
                "INSERT INTO zhiban_identity.role_grants(grant_id,tenant_id,membership_id,grant_ordinal,role_code,scope_kind,created_at,valid_from) SELECT $1,tenant_id,membership_id,1,'TENANT_ADMIN','TENANT',created_at,valid_from FROM zhiban_identity.role_grants WHERE grant_id=$2",
                [ids.nextRoleGrantId(), first.manifest.planned_grant_id],
              );
            else if (fault === 'revoked')
              await probe.query(
                'UPDATE zhiban_identity.role_grants SET revoked_at=$1 WHERE grant_id=$2',
                [Date.now().toString(), first.manifest.planned_grant_id],
              );
            else {
              await probe.query('ALTER TABLE zhiban_identity.role_grants DISABLE TRIGGER USER');
              await probe.query(
                `UPDATE zhiban_identity.role_grants SET ${fault === 'expired' ? 'valid_until' : 'valid_from'}=$1 WHERE grant_id=$2`,
                [
                  (Date.now() + (fault === 'expired' ? -1 : 60000)).toString(),
                  first.manifest.planned_grant_id,
                ],
              );
              await probe.query('ALTER TABLE zhiban_identity.role_grants ENABLE TRIGGER USER');
            }
            await c.query('BEGIN');
            await c.query("SELECT set_config('app.tenant_id',$1,true)", [e.tenant]);
            await c.query('SAVEPOINT recheck');
            await expect(
              c.query('SELECT zhiban_identity.identity_first_tenant_admin_lock($1,$2)', [
                first.tenant,
                first.manifest.approval_id,
              ]),
            ).rejects.toMatchObject({ code: '42501' });
            await c.query('ROLLBACK TO SAVEPOINT recheck');
            expect(
              (await c.query("SELECT current_setting('app.tenant_id',true) AS ctx")).rows[0].ctx,
            ).toBe(e.tenant);
          } finally {
            await c.query('ROLLBACK');
            await c.end();
            await probe.end();
          }
        },
      );
      it('C8 leave/rejoin uses new grants and preserves irrevocable prior history', async () => {
        const e = await fixture(),
          a = await active(e);
        const beforeGrant = (
          await rows('SELECT grant_id FROM zhiban_identity.role_grants WHERE membership_id=$1', [
            a.member,
          ])
        )[0].grant_id;
        await e
          .memberCommands()
          .execute(
            e.manager.handle,
            await e.request(a.member, 'MEMBERSHIP_LEAVE_ADMIN'),
            password,
            transport,
          );
        const source = await e.admission('REJOIN', a.member),
          consentId = await e.consent(source, a.member);
        await e.memberCommands().execute(
          e.manager.handle,
          await e.request(a.member, 'MEMBERSHIP_REJOIN', {
            admissionId: source.admissionId,
            consentId,
            grants: [{ roleCode: 'STUDENT', scope: selfScope(), validUntil: null }],
          }),
          password,
          transport,
        );
        const history = await rows(
          'SELECT grant_id,revoked_at IS NOT NULL AS revoked FROM zhiban_identity.role_grants WHERE membership_id=$1 ORDER BY grant_ordinal',
          [a.member],
        );
        expect(history).toHaveLength(2);
        expect(history[0]).toEqual({ grant_id: beforeGrant, revoked: true });
        expect(history[1].grant_id === beforeGrant).toBe(false);
        expect(history[1].revoked).toBe(false);
        expect(
          (
            await rows(
              'SELECT status,repository_revision,authorization_version FROM zhiban_identity.memberships WHERE membership_id=$1',
              [a.member],
            )
          )[0],
        ).toEqual({ status: 'ACTIVE', repository_revision: '4', authorization_version: '3' });
      });
      it('C8 repeated role revoke is stale-before-no-op with unchanged revision/auth/audit', async () => {
        const e = await fixture(),
          a = await active(e),
          g = (
            await rows('SELECT grant_id FROM zhiban_identity.role_grants WHERE membership_id=$1', [
              a.member,
            ])
          )[0].grant_id;
        const request = await e.request(a.member, 'ROLE_REVOKE', { revokeGrantId: g });
        await e.memberCommands().execute(e.manager.handle, request, password, transport);
        const before = await counts();
        await expect(
          e.memberCommands().execute(e.manager.handle, request, password, transport),
        ).rejects.toBeInstanceOf(IdentityPortError);
        expect(
          await e
            .memberCommands()
            .execute(
              e.manager.handle,
              await e.request(a.member, 'ROLE_REVOKE', { revokeGrantId: g }),
              password,
              transport,
            ),
        ).toMatchObject({ status: 'TRUE_NO_OP' });
        expect((await counts())[0].audit).toBe(before[0].audit);
        expect(
          (
            await rows(
              'SELECT repository_revision,authorization_version FROM zhiban_identity.memberships WHERE membership_id=$1',
              [a.member],
            )
          )[0],
        ).toEqual({ repository_revision: '3', authorization_version: '2' });
      });
      it('C8 subject User disable/restore invalidates unconsumed source despite ACTIVE again', async () => {
        const e = await fixture(),
          a = await e.admission(),
          u = await e.subject.users.findById(e.subject.id);
        if (!u) throw new Error('Fixture missing.');
        const disabled = await e.subject.users.save(
          u.value.disable(instant(Date.now()), 'ADMIN_REQUEST'),
          u.revision,
        );
        await e.subject.users.save(disabled.value.restore(instant(Date.now())), disabled.revision);
        const before = await counts();
        await expect(e.invite(a)).rejects.toBeInstanceOf(IdentityPortError);
        await expect(
          e.control.execute(e.operator.handle, e.controlRequest(a.manifest), password, transport),
        ).rejects.toBeInstanceOf(IdentityPortError);
        expect(await counts()).toEqual(before);
      });
    },
  );
