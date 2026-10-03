import { describe, expect, it, vi } from 'vitest';
import { MembershipCommands } from '@/lib/zhiban/application/identity/use-cases/memberships';
import {
  membershipIntent,
  membershipCompositionPolicy,
  membershipBoundary,
} from '@/lib/zhiban/infrastructure/identity/composition/membership-intent';
import {
  controlManifest,
  controlManifestDigest,
  controlIntentDigest,
  type ControlApprovalManifest,
} from '@/lib/zhiban/infrastructure/identity/composition/control-approval';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { member, tenant, id, catalogConfig } from '../authorization/fixtures';
import { selfScope } from '@/lib/zhiban/domain/identity';
import type { MembershipCommandRequest } from '@/lib/zhiban/application/identity/ports/membership-composition';
import { ControlCommands } from '@/lib/zhiban/infrastructure/identity/composition/control-commands';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import type { MembershipSecurity } from '@/lib/zhiban/infrastructure/identity/composition/membership-security';
import type { ApprovedIdentityCatalog } from '@/lib/zhiban/infrastructure/identity/authorization/identity-catalog';
import type { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';

const policy = {
  environmentRef: 'synthetic',
  approvalRef: 'synthetic-approved',
  tenantRecordCapacity: 1000,
  controlRecordCapacity: 1000,
  sourceTtlMs: 600000,
};
const hash = catalogConfig().expectedDigest;
function request(): MembershipCommandRequest {
  const actor = member(10),
    target = member(20);
  return {
    tenantId: tenant,
    actorMembershipId: actor.id,
    expectedActorRevision: repositoryRevision('1'),
    expectedActorAuthorizationVersion: 1,
    expectedTenantRevision: repositoryRevision('1'),
    action: 'ROLE_GRANT',
    idempotencyKey: 'synthetic-key',
    requestId: 'synthetic-request',
    targets: [
      {
        userId: target.userId,
        membershipId: target.id,
        expectedRevision: repositoryRevision('1'),
        expectedAuthorizationVersion: 1,
        action: 'ROLE_GRANT',
        admissionId: null,
        consentId: null,
        grants: [{ roleCode: 'STUDENT', scope: selfScope(), validUntil: 700000 }],
        preserveGrantIds: [],
        revokeGrantId: null,
        mode: null,
        reason: 'ADMIN_REQUEST',
      },
    ],
  };
}
describe('C8 immutable array input boundary', () => {
  it.each(['targets', 'grants', 'preserveGrantIds'])(
    'rejects accessor in %s without invoking it',
    (kind) => {
      const input = request(),
        get = vi.fn(() => input.targets[0]);
      const array =
        kind === 'targets'
          ? input.targets
          : kind === 'grants'
            ? input.targets[0].grants
            : input.targets[0].preserveGrantIds;
      Object.defineProperty(array, '0', { get, configurable: true });
      expect(() => membershipIntent(input, hash)).toThrow(IdentityPortError);
      expect(get).not.toHaveBeenCalled();
    },
  );
  it('rejects sparse or custom-property arrays', () => {
    const input = request();
    Object.defineProperty(input.targets, 'length', { value: 2 });
    expect(() => membershipIntent(input, hash)).toThrow(IdentityPortError);
    const other = request();
    Object.defineProperty(other.targets, 'unexpected', { value: true });
    expect(() => membershipIntent(other, hash)).toThrow(IdentityPortError);
  });
});
export function controlFixture(): ControlApprovalManifest {
  const m: ControlApprovalManifest = {
    approval_id: id(600),
    purpose: 'FIRST_TENANT_ADMIN',
    environment_ref: 'synthetic',
    approval_ref: 'synthetic-approved',
    operator_ref: 'operator-a',
    approver_ref: 'approver-b',
    operator_user_id: id(110),
    expected_operator_user_revision: '1',
    system_admin_grant_id: id(700),
    expected_admin_grant_revision: '1',
    command_id: id(601),
    manifest_digest: '0'.repeat(64),
    catalog_digest: hash,
    action_version: 'identity-v1',
    delegation_version: 'identity-v1',
    target_user_id: id(120),
    tenant_id: tenant,
    planned_user_id: null,
    planned_tenant_id: null,
    target_membership_id: null,
    planned_membership_id: id(602),
    planned_grant_id: id(603),
    expected_user_revision: '1',
    expected_tenant_revision: '1',
    expected_member_revision: null,
    expected_auth_version: null,
    valid_until: null,
    tenant_code: null,
    tenant_display_name: null,
    admission_purpose: null,
    issued_at: '1000',
    expires_at: '601000',
    reason: 'ADMIN_REQUEST',
  };
  return { ...m, manifest_digest: controlManifestDigest(m) };
}
describe('C8 safe inputs, approval binding and protocol-neutral composition', () => {
  it.each([0, 1, 2])(
    'confirms admission only through entry and final helper checks (failure stage %s)',
    async (failureStage) => {
      const draft = {
        ...controlFixture(),
        purpose: 'MEMBER_ADMISSION',
        admission_purpose: 'INVITE',
        planned_membership_id: null,
        planned_grant_id: null,
      };
      const manifest = { ...draft, manifest_digest: controlManifestDigest(draft) };
      const statements: string[] = [];
      const query = vi.fn(async (sql: string, params: readonly unknown[] = []) => {
        statements.push(sql);
        let rows: Record<string, unknown>[] = [];
        let command = 'SELECT';
        if (sql.startsWith('BEGIN')) command = 'BEGIN';
        else if (sql === 'ROLLBACK') command = 'ROLLBACK';
        else if (sql === 'COMMIT') command = 'COMMIT';
        else if (sql.includes('FROM zhiban_identity.users'))
          rows = [
            {
              user_id: params[0],
              status: 'ACTIVE',
              created_at: '0',
              updated_at: '0',
              disabled_at: null,
              disabled_reason: null,
              repository_revision: '1',
            },
          ];
        else if (sql.includes('FROM zhiban_identity.tenants'))
          rows = [
            {
              tenant_id: tenant,
              code: 'synthetic',
              display_name: 'Synthetic',
              status: 'ACTIVE',
              created_at: '0',
              updated_at: '0',
              disabled_at: null,
              disabled_reason: null,
              repository_revision: '1',
            },
          ];
        else if (sql.includes('clock_timestamp')) rows = [{ at: '2000' }];
        else if (sql.includes('FROM zhiban_identity.system_admin_grants'))
          rows = [
            {
              user_id: manifest.operator_user_id,
              repository_revision: '1',
              valid_from: '0',
              valid_until: null,
              revoked_at: null,
            },
          ];
        else if (sql.includes('FROM zhiban_identity.identity_control_approvals'))
          rows = sql.startsWith('SELECT consumed_at')
            ? [{ consumed_at: '2000' }]
            : [{ ...manifest, consumed_at: '2000' }];
        else if (sql.includes('FROM zhiban_identity.identity_control_commands'))
          rows = [
            {
              command_id: manifest.command_id,
              approval_id: manifest.approval_id,
              intent_digest: controlIntentDigest(manifest),
              outcome_kind: 'APPLIED',
            },
          ];
        else if (sql.includes('FROM zhiban_identity.identity_control_command_effects'))
          rows = [
            {
              target_user_id: manifest.target_user_id,
              tenant_id: tenant,
              membership_id: null,
              grant_id: null,
              admission_id: id(604),
              after_revision: null,
              before_revision: null,
              after_status: null,
              target_kind: 'ADMISSION',
            },
          ];
        else if (!sql.includes('set_config') && !sql.includes('pg_advisory_xact_lock'))
          throw new Error('Unexpected SQL in controlled fixture.');
        return { command, rowCount: rows.length, rows };
      });
      const release = vi.fn();
      const pool = { connect: async () => ({ query, release }) } as unknown as TransactionPool;
      let confirmations = 0;
      const registerAdmission = vi.fn(
        async (_client: unknown, _handle: unknown, approvalId: string, admissionId: string) => {
          expect(approvalId).toBe(manifest.approval_id);
          expect(admissionId).toBe(id(604));
          confirmations++;
          if (confirmations === failureStage) throw new IdentityPortError('CONFLICT');
          return admissionId;
        },
      );
      const security = {
        actor: () => manifest.operator_user_id,
        prepare: async () => ({ kind: 'RECENT_MEMBERSHIP_REAUTHENTICATION' }),
        assertSession: async () => {},
        assertProof: async () => {},
        registerAdmission,
      } as unknown as MembershipSecurity;
      const catalog = {
        load: async () => ({
          contentDigest: hash,
          actionVersion: 'identity-v1',
          delegationVersion: 'identity-v1',
        }),
      } as unknown as ApprovedIdentityCatalog;
      const facade = new ControlCommands(
        pool,
        security,
        catalog,
        { load: async () => manifest },
        {} as IdentityIds,
        policy,
      );
      const result = facade.execute(
        { kind: 'AUTHENTICATED_REQUEST' },
        {
          approvalRef: manifest.approval_ref,
          idempotencyKey: 'same-key',
          requestId: 'confirmation',
          expectedUserRevision: repositoryRevision('1'),
          expectedTenantRevision: repositoryRevision('1'),
        },
        'synthetic-secret',
        { kind: 'SERVER_TRANSPORT' },
      );
      if (failureStage === 0) {
        await expect(result).resolves.toMatchObject({
          commandId: manifest.command_id,
          admissionId: id(604),
          status: 'APPLIED',
        });
        expect(confirmations).toBe(2);
        expect(statements).toContain('COMMIT');
        expect(statements).not.toContain('ROLLBACK');
      } else {
        await expect(result).rejects.toBeInstanceOf(IdentityPortError);
        expect(confirmations).toBe(failureStage);
        expect(statements).toContain('ROLLBACK');
        expect(statements).not.toContain('COMMIT');
      }
      expect(
        statements.some((sql) => sql.includes('FROM zhiban_identity.identity_control_commands')),
      ).toBe(true);
      expect(
        statements.some((sql) => /^(INSERT|UPDATE|DELETE)/.test(sql) || sql.includes('nextval')),
      ).toBe(false);
      expect(release).toHaveBeenCalledOnce();
    },
  );
  it('produces a stable digest without revisions/request/key or any ephemeral security material', () => {
    const r = request(),
      first = membershipIntent(r, hash);
    expect(
      membershipIntent(
        {
          ...r,
          requestId: 'another',
          idempotencyKey: 'another',
          expectedActorRevision: repositoryRevision('2'),
          targets: r.targets.map((t) => ({
            ...t,
            expectedRevision: repositoryRevision('2'),
            expectedAuthorizationVersion: 2,
          })),
        },
        hash,
      ),
    ).toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(['reason', 'userId', 'membershipId', 'grants'] as const)(
    'binds target %s business intent',
    (key) => {
      const r = request(),
        target = { ...r.targets[0] };
      if (key === 'reason') target.reason = 'ACCESS_REVIEW';
      else if (key === 'userId') target.userId = member(30).userId;
      else if (key === 'membershipId') target.membershipId = member(30).id;
      else target.grants = [{ ...target.grants[0], validUntil: 800000 }];
      expect(membershipIntent({ ...r, targets: [target] }, hash)).not.toBe(
        membershipIntent(r, hash),
      );
    },
  );
  it.each([
    'password',
    'secret',
    'token',
    'digest',
    'approved',
    'relationshipSatisfied',
    'role',
  ] as const)('rejects unknown %s instead of hashing or storing it', (key) => {
    expect(() =>
      membershipIntent(
        { ...request(), [key]: 'synthetic-rejected' } as MembershipCommandRequest,
        hash,
      ),
    ).toThrow();
  });
  it('rejects accessors without invoking them', () => {
    const r = request(),
      getter = vi.fn(() => tenant);
    Object.defineProperty(r, 'tenantId', { get: getter, enumerable: true });
    expect(() => membershipIntent(r, hash)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  it.each(['SYSTEM_ADMIN', 'unknown'])('rejects unsupported role %s', (role) => {
    const r = request();
    expect(() =>
      membershipIntent(
        {
          ...r,
          targets: [{ ...r.targets[0], grants: [{ ...r.targets[0].grants[0], roleCode: role }] }],
        } as MembershipCommandRequest,
        hash,
      ),
    ).toThrow();
  });
  it('rejects duplicated targets', () => {
    const r = request();
    expect(() => membershipIntent({ ...r, targets: [r.targets[0], r.targets[0]] }, hash)).toThrow();
  });
  it.each([
    null,
    {},
    { ...policy, sourceTtlMs: 0 },
    { ...policy, tenantRecordCapacity: 0 },
    { ...policy, approved: true },
  ])('requires explicit closed capacity/TTL configuration', (p) => {
    expect(() => membershipCompositionPolicy(p as typeof policy)).toThrow();
  });
  it('freezes approved configuration copies, never fixture defaults', () => {
    expect(Object.isFrozen(membershipCompositionPolicy(policy))).toBe(true);
  });
  it('validates and freezes independent approval manifest', () => {
    expect(Object.isFrozen(controlManifest(controlFixture(), 'synthetic', hash, 600000))).toBe(
      true,
    );
  });
  it.each([
    'environment_ref',
    'approver_ref',
    'manifest_digest',
    'catalog_digest',
    'command_id',
    'planned_grant_id',
  ] as const)('rejects changed manifest %s without a new approval', (key) => {
    const m = controlFixture(),
      next = {
        ...m,
        [key]: key.endsWith('_id') ? id(999) : key === 'approver_ref' ? m.operator_ref : 'changed',
      };
    expect(() => controlManifest(next, 'synthetic', hash, 600000)).toThrow();
  });
  it('does not rewrite original approval expected versions to confirm a completed outcome', () => {
    const m = controlFixture(),
      next = { ...m, expected_user_revision: '2' };
    expect(controlIntentDigest(next)).toBe(controlIntentDigest(m)); // Manifest digest still binds the original before versions.
    expect(() => controlManifest(next, 'synthetic', hash, 600000)).toThrow();
  });
  it.each(['ACCOUNT_RECOVERY', 'not-a-reason'])(
    'a reason label %s never approves a recovery path',
    (reason) => {
      const m = { ...controlFixture(), reason } as ControlApprovalManifest;
      const signed = { ...m, manifest_digest: controlManifestDigest(m) };
      expect(() => controlManifest(signed, 'synthetic', hash, 600000)).toThrow();
    },
  );
  it('sanitizes causes, custom codes and enumerable properties even on an IdentityPortError', async () => {
    const original = Object.assign(new IdentityPortError('CONFLICT'), {
      cause: new Error('synthetic-sensitive'),
      debug: 'synthetic-sensitive',
    });
    const caught = await membershipBoundary(async () => {
      throw original;
    }).catch((e) => e);
    expect(
      caught !== original &&
        !('cause' in caught) &&
        !('debug' in caught) &&
        !JSON.stringify(caught).includes('synthetic-sensitive'),
    ).toBe(true);
  });
  it('Application delegates only closed commands; no persistence/SQL callback interface', async () => {
    const execute = vi
        .fn()
        .mockResolvedValue({ status: 'APPLIED', commandId: id(999), effects: [] }),
      invite = vi.fn(),
      consent = vi.fn();
    const application = new MembershipCommands({ execute }, { invite, consent });
    const handle = { kind: 'AUTHENTICATED_REQUEST' } as const;
    await application.execute(handle, request(), 'synthetic-ephemeral', {} as never);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(Object.getOwnPropertyNames(MembershipCommands.prototype).sort()).toEqual([
      'consent',
      'constructor',
      'execute',
      'invite',
    ]);
  });
});
