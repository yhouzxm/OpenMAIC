import type { Pool } from 'pg';
import {
  User,
  Tenant,
  Membership,
  RoleGrant,
  SystemAdminGrant,
  instant,
  membershipId,
  tenantScope,
  selfScope,
  userId,
} from '@/lib/zhiban/domain/identity';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import type {
  MembershipCommandRequest,
  ControlCompositionRequest,
} from '@/lib/zhiban/application/identity/ports/membership-composition';
import { PostgresIdentityRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/user';
import { PostgresTenantRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/tenant';
import { PostgresMembershipRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/membership';
import { PostgresCredentialRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { PostgresSessionRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/session';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import { SessionCsrfPolicy } from '@/lib/zhiban/infrastructure/identity/sessions/browser-security';
import { bearerForCookie } from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import {
  SharedAdmission,
  observedTransport,
  purposes,
  admissionPolicyDigest,
  type AdmissionConfig,
} from '@/lib/zhiban/infrastructure/identity/composition/admission';
import { IdentityAuthentication } from '@/lib/zhiban/infrastructure/identity/composition/authentication';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
import { ControlCommands } from '@/lib/zhiban/infrastructure/identity/composition/control-commands';
import { MemberCommands } from '@/lib/zhiban/infrastructure/identity/composition/member-commands';
import { MemberAdmissions } from '@/lib/zhiban/infrastructure/identity/composition/member-admissions';
import {
  controlManifestDigest,
  type ControlApprovalManifest,
} from '@/lib/zhiban/infrastructure/identity/composition/control-approval';
import { catalogPort } from '../authorization/fixtures';
import { syntheticPasswordScreening } from '../credentials/fixture-policy';
import { adminClient, runtimePool } from './pg16-harness';

// Explicit test-only configuration. Never exported by a production default/root.
export const password = 'Synthetic-C8-credential-input!';
export const transport = observedTransport('127.0.0.1');
export const ids = new IdentityIds();
export const policy = {
  environmentRef: 'synthetic',
  approvalRef: 'synthetic-only',
  tenantRecordCapacity: 10000,
  controlRecordCapacity: 10000,
  sourceTtlMs: 600000,
};
const hash = new Argon2PasswordHasher(syntheticPasswordScreening);
const admissionConfig: AdmissionConfig = {
  environment: 'synthetic',
  approvalRef: 'synthetic-only',
  hmacKey: new Uint8Array(32).fill(71),
  policyDigests: Object.fromEntries(
    purposes.map((p) => [
      p,
      admissionPolicyDigest({
        purpose: p,
        environment_ref: 'synthetic',
        approval_ref: 'synthetic-only',
        created_at: '0',
        window_ms: '3600000',
        global_limit: '1000',
        ip_limit: p === 'INITIAL_PROVISION' ? null : '1000',
        locator_limit: p === 'INITIAL_PROVISION' ? null : '1000',
        pair_limit: p === 'INITIAL_PROVISION' ? null : '1000',
        user_limit: p === 'LOGIN' ? null : '1000',
        max_buckets: '10000',
      }),
    ]),
  ) as AdmissionConfig['policyDigests'],
};
const pools = new Set<Pool>();
export function pool(role: 'zhiban_runtime' | 'zhiban_auth_runtime' | 'zhiban_control_runtime') {
  const p = runtimePool(role);
  p.options.statement_timeout = 8000;
  p.options.connectionTimeoutMillis = 8000;
  pools.add(p);
  return p;
}
export async function cleanupPools() {
  await Promise.all([...pools].map((p) => p.end()));
  pools.clear();
}
export async function rows(sql: string, params: unknown[] = []) {
  const c = adminClient();
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}
export async function installAdmissionPolicy() {
  const control = pool('zhiban_control_runtime');
  for (const purpose of purposes) {
    await control.query(
      `INSERT INTO zhiban_identity.admission_policies(purpose,policy_digest,approval_ref,environment_ref,created_at,window_ms,global_limit,ip_limit,locator_limit,pair_limit,user_limit,max_buckets)
      VALUES($1,$2,'synthetic-only','synthetic',0,3600000,1000,$3,$3,$3,$4,10000)`,
      [
        purpose,
        admissionConfig.policyDigests[purpose],
        purpose === 'INITIAL_PROVISION' ? null : 1000,
        purpose === 'LOGIN' ? null : 1000,
      ],
    );
    await control.query('INSERT INTO zhiban_identity.admission_gate(purpose) VALUES($1)', [
      purpose,
    ]);
  }
}
export async function identity() {
  const auth = pool('zhiban_auth_runtime'),
    control = pool('zhiban_control_runtime'),
    tenantPool = pool('zhiban_runtime'),
    id = ids.nextUserId();
  const users = new PostgresIdentityRepository(control),
    credentials = new PostgresCredentialRepository(auth),
    sessions = new PostgresSessionRepository(auth);
  await users.create(User.create(id, instant(Date.now())));
  await credentials.createPassword(
    id,
    ids.nextCredentialId(),
    await hash.hash(password),
    instant(Date.now()),
    { actor: { kind: 'SYSTEM' }, reason: 'SECURITY_POLICY', requestId: ids.nextCommandId() },
  );
  const authentication = await IdentityAuthentication.create(
    auth,
    sessions,
    credentials,
    hash,
    new SharedAdmission(auth, admissionConfig),
    new SessionCsrfPolicy('https://synthetic.example'),
    ids,
  );
  const login = await authentication.login(id, password, transport, ids.nextCommandId());
  if (login.status !== 'ISSUED') throw new Error('Synthetic login rejected.');
  const raw = bearerForCookie(login.bearer),
    handle = await authentication.authenticate(raw);
  if (handle === null) throw new Error('Synthetic Session rejected.');
  return {
    id,
    auth,
    control,
    tenantPool,
    users,
    credentials,
    sessions,
    authentication,
    raw,
    handle,
    security: await authentication.membershipSecurity(),
  };
}
export type IdentityFixture = Awaited<ReturnType<typeof identity>>;
export async function fixture() {
  const operator = await identity(),
    manager = await identity(),
    subject = await identity(),
    catalog = catalogPort(),
    manifests = new Map<string, ControlApprovalManifest>();
  const adminGrant = SystemAdminGrant.create({
    id: ids.nextSystemAdminGrantId(),
    userId: operator.id,
    createdAt: instant(Date.now()),
    validFrom: instant(Date.now()),
    validUntil: null,
  });
  await operator.users.createSystemAdminGrant(adminGrant);
  const tenant = ids.nextTenantId();
  await new PostgresTenantRepository(operator.control).create(
    Tenant.create(
      tenant,
      'synthetic_' + ids.nextCommandId().slice(-12),
      'Synthetic',
      instant(Date.now()),
    ),
  );
  const store = { load: async (ref: string) => manifests.get(ref) ?? null };
  const control = new ControlCommands(
    operator.control,
    operator.security,
    catalog,
    store,
    ids,
    policy,
  );
  const memberCommands = (who = manager) =>
    new MemberCommands(who.tenantPool, who.security, catalog, ids, policy);
  const admissions = (who = manager) =>
    new MemberAdmissions(who.tenantPool, who.security, catalog, ids, policy, store);
  async function seed(
    who: IdentityFixture,
    code: 'TENANT_ADMIN' | 'STUDENT' = 'TENANT_ADMIN',
    status: 'ACTIVE' | 'PENDING' = 'ACTIVE',
    t = tenant,
  ) {
    const at = instant(Date.now());
    let m = Membership.create({
      id: ids.nextMembershipId(),
      userId: who.id,
      tenantId: t,
      now: at,
    });
    if (status === 'ACTIVE')
      m = m.activatePending({
        now: at,
        expectedAuthorizationVersion: 0,
        approvedGrants: [
          RoleGrant.create({
            id: ids.nextRoleGrantId(),
            roleCode: code,
            scope: code === 'TENANT_ADMIN' ? tenantScope() : selfScope(),
            createdAt: at,
            validFrom: at,
            validUntil: null,
          }),
        ],
      });
    await new PostgresMembershipRepository(who.tenantPool).create(tenantScopeContext(t), m);
    return m;
  }
  const managerMember = await seed(manager),
    secondAdmin = await seed(operator);
  async function manifest(
    purpose: ControlApprovalManifest['purpose'],
    changes: Partial<ControlApprovalManifest> = {},
  ) {
    const snapshot = await catalog.load(),
      at = Date.now();
    const draft: ControlApprovalManifest = {
      approval_id: ids.nextCommandId(),
      purpose,
      environment_ref: 'synthetic',
      approval_ref: ids.nextCommandId(),
      operator_ref: 'synthetic-operator',
      approver_ref: 'synthetic-independent-approver',
      operator_user_id: operator.id,
      expected_operator_user_revision: '1',
      system_admin_grant_id: adminGrant.id,
      expected_admin_grant_revision: '1',
      command_id: ids.nextCommandId(),
      manifest_digest: '0'.repeat(64),
      catalog_digest: snapshot.contentDigest,
      action_version: 'identity-v1',
      delegation_version: 'identity-v1',
      target_user_id: null,
      tenant_id: null,
      planned_user_id: null,
      planned_tenant_id: null,
      target_membership_id: null,
      planned_membership_id: null,
      planned_grant_id: null,
      expected_user_revision: null,
      expected_tenant_revision: null,
      expected_member_revision: null,
      expected_auth_version: null,
      valid_until: null,
      tenant_code: null,
      tenant_display_name: null,
      admission_purpose: null,
      issued_at: (at - 1000).toString(),
      expires_at: (at + 599000).toString(),
      reason: 'ADMIN_REQUEST',
      ...changes,
    };
    const m = { ...draft, manifest_digest: controlManifestDigest(draft) };
    manifests.set(m.approval_ref, m);
    await control.registerApproval(
      operator.handle,
      m.approval_ref,
      password,
      transport,
      ids.nextCommandId(),
    );
    return m;
  }
  function controlRequest(
    m: ControlApprovalManifest,
    key = m.command_id,
  ): ControlCompositionRequest {
    return {
      approvalRef: m.approval_ref,
      idempotencyKey: key,
      requestId: ids.nextCommandId(),
      expectedUserRevision:
        m.expected_user_revision === null ? null : repositoryRevision(m.expected_user_revision),
      expectedTenantRevision:
        m.expected_tenant_revision === null ? null : repositoryRevision(m.expected_tenant_revision),
    };
  }
  async function admission(
    purpose: 'INVITE' | 'REACTIVATE' | 'REJOIN' = 'INVITE',
    member: string | null = null,
    t = tenant,
  ) {
    const current =
      member === null
        ? null
        : (
            await rows(
              'SELECT repository_revision,authorization_version FROM zhiban_identity.memberships WHERE membership_id=$1',
              [member],
            )
          )[0];
    const m = await manifest('MEMBER_ADMISSION', {
      tenant_id: t,
      target_user_id: subject.id,
      expected_user_revision: '1',
      expected_tenant_revision: '1',
      admission_purpose: purpose,
      target_membership_id: member,
      expected_member_revision: current?.repository_revision ?? null,
      expected_auth_version: current?.authorization_version ?? null,
    });
    const result = await control.execute(operator.handle, controlRequest(m), password, transport);
    if (!result.admissionId) throw new Error('Synthetic admission missing.');
    return { manifest: m, result, admissionId: result.admissionId };
  }
  async function invite(a: Awaited<ReturnType<typeof admission>>, key = ids.nextCommandId()) {
    return admissions().invite(
      manager.handle,
      {
        tenantId: tenant,
        actorMembershipId: managerMember.id,
        expectedActorRevision: repositoryRevision('1'),
        expectedActorAuthorizationVersion: 1,
        expectedTenantRevision: repositoryRevision('1'),
        admissionId: a.admissionId,
        idempotencyKey: key,
        requestId: ids.nextCommandId(),
      },
      password,
      transport,
    );
  }
  async function consent(a: Awaited<ReturnType<typeof admission>>, member: string) {
    const current = (
      await rows(
        'SELECT repository_revision,authorization_version FROM zhiban_identity.memberships WHERE membership_id=$1',
        [member],
      )
    )[0];
    const result = await admissions(subject).consent(subject.handle, {
      tenantId: tenant,
      admissionId: a.admissionId,
      controlApprovalRef: null,
      expectedMemberRevision: repositoryRevision(current.repository_revision),
      expectedAuthorizationVersion: Number(BigInt(current.authorization_version)),
      idempotencyKey: ids.nextCommandId(),
      requestId: ids.nextCommandId(),
    });
    const saved = (
      await rows(
        'SELECT consent_id FROM zhiban_identity.identity_member_consents WHERE command_id=$1',
        [result.commandId],
      )
    )[0];
    return saved.consent_id as string;
  }
  async function request(
    member: string,
    action: MembershipCommandRequest['targets'][number]['action'],
    changes: Partial<MembershipCommandRequest['targets'][number]> = {},
    _who = manager,
    actorMember = managerMember,
  ) {
    const current = (
      await rows(
        'SELECT user_id,repository_revision,authorization_version FROM zhiban_identity.memberships WHERE membership_id=$1',
        [member],
      )
    )[0];
    const actor = (
      await rows(
        'SELECT repository_revision,authorization_version FROM zhiban_identity.memberships WHERE membership_id=$1',
        [actorMember.id],
      )
    )[0];
    return {
      tenantId: tenant,
      actorMembershipId: actorMember.id,
      expectedActorRevision: repositoryRevision(actor.repository_revision),
      expectedActorAuthorizationVersion: Number(BigInt(actor.authorization_version)),
      expectedTenantRevision: repositoryRevision('1'),
      action,
      idempotencyKey: ids.nextCommandId(),
      requestId: ids.nextCommandId(),
      targets: [
        {
          userId: userId(current.user_id),
          membershipId: membershipId(member),
          expectedRevision: repositoryRevision(current.repository_revision),
          expectedAuthorizationVersion: Number(BigInt(current.authorization_version)),
          action,
          admissionId: null,
          consentId: null,
          grants: [],
          preserveGrantIds: [],
          revokeGrantId: null,
          mode: null,
          reason: 'ADMIN_REQUEST',
          ...changes,
        },
      ],
    } satisfies MembershipCommandRequest;
  }
  async function first() {
    const newTenant = ids.nextTenantId();
    const created = await manifest('TENANT_CREATE', {
      planned_tenant_id: newTenant,
      tenant_code: 'new_' + newTenant.slice(-12),
      tenant_display_name: 'New Tenant',
    });
    await control.execute(operator.handle, controlRequest(created), password, transport);
    const m = await manifest('FIRST_TENANT_ADMIN', {
      tenant_id: newTenant,
      target_user_id: subject.id,
      expected_user_revision: '1',
      expected_tenant_revision: '1',
      planned_membership_id: ids.nextMembershipId(),
      planned_grant_id: ids.nextRoleGrantId(),
    });
    const c = await admissions(subject).consent(subject.handle, {
      tenantId: newTenant,
      admissionId: null,
      controlApprovalRef: m.approval_ref,
      expectedMemberRevision: null,
      expectedAuthorizationVersion: null,
      idempotencyKey: ids.nextCommandId(),
      requestId: ids.nextCommandId(),
    });
    const saved = (
      await rows(
        'SELECT consent_id FROM zhiban_identity.identity_member_consents WHERE command_id=$1',
        [c.commandId],
      )
    )[0];
    return { tenant: newTenant, manifest: m, consentId: saved.consent_id as string };
  }
  return {
    operator,
    manager,
    subject,
    tenant,
    catalog,
    store,
    control,
    memberCommands,
    admissions,
    seed,
    managerMember,
    secondAdmin,
    manifest,
    controlRequest,
    admission,
    invite,
    consent,
    request,
    first,
  };
}
/** Observe real lock blockers, including tuple-lock waiter chains; no sleep-only race. */
export async function acknowledgeBlocked(pids: number[], blocker: number) {
  const deadline = performance.now() + 5000;
  while (performance.now() < deadline) {
    const state = await rows(
      `WITH RECURSIVE chain(origin,pid,path) AS (
    SELECT s.pid,s.pid,ARRAY[s.pid] FROM pg_stat_activity AS s WHERE s.pid=ANY($1::int[])
    UNION ALL SELECT c.origin,b.pid,c.path||b.pid FROM chain AS c CROSS JOIN LATERAL unnest(pg_blocking_pids(c.pid)) AS b(pid) WHERE NOT b.pid=ANY(c.path))
    SELECT origin,bool_or(pid=$2::int) AS blocked FROM chain GROUP BY origin`,
      [pids, blocker],
    );
    if (state.length === pids.length && state.every((r) => r.blocked)) return;
  }
  throw new Error('Expected acknowledged lock wait missing.');
}
