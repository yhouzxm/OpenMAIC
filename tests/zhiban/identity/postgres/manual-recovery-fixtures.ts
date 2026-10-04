import { Pool, type PoolClient } from 'pg';
import { User, instant } from '@/lib/zhiban/domain/identity';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { PostgresIdentityRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/user';
import { PostgresCredentialRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/credential';
import { PostgresSessionRepository } from '@/lib/zhiban/infrastructure/identity/postgres/repositories/session';
import { Argon2PasswordHasher } from '@/lib/zhiban/infrastructure/identity/credentials/argon2-password-hasher';
import {
  newApprovedSession,
  bearerForCookie,
  digestBearer,
} from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import { RecoverySecurity } from '@/lib/zhiban/infrastructure/identity/recovery/security';
import { RecoveryRegistry } from '@/lib/zhiban/infrastructure/identity/recovery/registry';
import {
  ManualRecovery,
  recoveryIntent,
} from '@/lib/zhiban/infrastructure/identity/recovery/composition';
import { RecoveryProvisioning } from '@/lib/zhiban/infrastructure/identity/recovery/provisioning';
import { policyDigest } from '@/lib/zhiban/infrastructure/identity/recovery/policy';
import { syntheticPasswordScreening } from '../credentials/fixture-policy';
import { budgets, ids, signedStore } from '../recovery/fixtures';
import { adminClient, runtimePool } from './pg16-harness';
export const password = 'Synthetic-recovery-original-password!',
  replacement = 'Synthetic-recovery-replacement-password!';
export async function adminRows(sql: string, params?: unknown[]) {
  const c = adminClient();
  await c.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    await c.end();
  }
}
export async function recoveryFixture(pools: Set<Pool>) {
  const auth = runtimePool('zhiban_auth_runtime'),
    control = runtimePool('zhiban_control_runtime');
  pools.add(auth);
  pools.add(control);
  auth.options.statement_timeout = 5000;
  control.options.statement_timeout = 5000;
  const h = new Argon2PasswordHasher(syntheticPasswordScreening),
    credentials = new PostgresCredentialRepository(auth),
    sessions = new PostgresSessionRepository(auth),
    users = new PostgresIdentityRepository(control);
  const subject = ids.nextUserId(),
    actor = ids.nextUserId(),
    verifier = ids.nextUserId(),
    at = instant(Date.now());
  for (const id of [subject, actor, verifier]) await users.create(User.create(id, at));
  for (const id of [subject, actor])
    await credentials.createPassword(
      id,
      ids.nextCredentialId(),
      await h.hash(password),
      instant(Date.now()),
      { actor: { kind: 'SYSTEM' }, reason: 'SECURITY_POLICY', requestId: 'test' },
    );
  const snapshot = await credentials.verificationSnapshot(actor);
  if (!snapshot) throw new Error('Synthetic setup rejected');
  const approved = newApprovedSession(
    snapshot,
    repositoryRevision('1'),
    instant(Date.now()),
    sessions.policy,
  );
  await sessions.create(approved.record);
  const raw = bearerForCookie(approved.bearer),
    grant = ids.nextSystemAdminGrantId();
  await control.query(
    'INSERT INTO zhiban_identity.system_admin_grants(grant_id,user_id,created_at,valid_from) VALUES($1,$2,$3,$3)',
    [grant, actor, Date.now().toString()],
  );
  const signed = signedStore(),
    provision = new RecoveryProvisioning(control, signed.evidence);
  signed.put('policy', 'POLICY', {
    policy_digest: policyDigest(budgets),
    approval_ref: budgets.approval_ref,
    transport_digest: 'a'.repeat(64),
  });
  await provision.policy(budgets, 'policy');
  const src = [ids.nextCommandId(), ids.nextCommandId(), ids.nextCommandId()];
  for (const [k, i, u] of [
    ['ENROLLMENT', 0, subject],
    ['APPOINTMENT', 1, verifier],
    ['CONTACT', 2, subject],
  ] as const) {
    signed.put(k, ('SOURCE_' + k) as 'SOURCE_ENROLLMENT', {
      source_id: src[i],
      source_ref: k,
      bound_user_id: u,
      source_version: '1',
      enrollment_approval_ref: 'original-record',
    });
    await provision.source(k, k);
  }
  await provision.enabled('synthetic', policyDigest(budgets), '1', true, 'policy');
  const target = (await credentials.findSlot(subject))!,
    actorSlot = (await credentials.findSlot(actor))!;
  const caseId = ids.nextCommandId();
  signed.put('register', 'REGISTRATION', {
    case_id: caseId,
    site_ref: 'site-a',
    subject_user_id: subject,
    verifier_user_id: verifier,
    actor_user_id: actor,
    enrollment_source_id: src[0],
    appointment_source_id: src[1],
    contact_source_id: src[2],
    expected_enrollment_source_revision: '1',
    expected_appointment_source_revision: '1',
    expected_contact_source_revision: '1',
    approval_ref: 'register',
    intent: 'REPLACE_ACTIVE_PASSWORD',
    security_clearance_ref: null,
    expected_subject_user_revision: '1',
    expected_verifier_user_revision: '1',
    expected_slot_revision: target.revision,
    expected_security_epoch: target.value.securityEpoch,
    expected_credential_id: target.value.activeCredentialId,
    expected_generation: target.value.generation,
    expected_actor_user_revision: '1',
    expected_actor_slot_revision: actorSlot.revision,
    expected_actor_security_epoch: actorSlot.value.securityEpoch,
    actor_admin_grant_id: grant,
    expected_admin_grant_revision: '1',
  });
  const security = new RecoverySecurity(auth, credentials, h, 256),
    registry = new RecoveryRegistry(256, 600000, 300000);
  let sqlFailure: { stage: string; code: string } | null = null;
  let lastStage = 'NONE';
  const observed = {
    connect: async () => {
      const client = await auth.connect();
      return {
        release: (destroy?: boolean) => client.release(destroy),
        query: (async (sql: string, params?: unknown[]) => {
          const stage = sql.startsWith('SELECT * FROM zhiban_identity.identity_recovery_user_locks')
            ? 'USER_LOCKS'
            : sql.startsWith('SELECT * FROM zhiban_identity.identity_recovery_actor_guard')
              ? 'ACTOR_GUARD'
              : sql.startsWith('SELECT * FROM zhiban_identity.identity_recovery_gate')
                ? 'GATE'
                : sql.startsWith('INSERT INTO zhiban_identity.identity_recovery_cases')
                  ? 'CASE_INSERT'
                  : sql.startsWith('INSERT INTO zhiban_identity.identity_recovery_events')
                    ? 'EVENT_INSERT'
                    : sql === 'SET CONSTRAINTS ALL IMMEDIATE'
                      ? 'CONSTRAINTS'
                      : sql.startsWith('SELECT')
                        ? 'READ'
                        : 'OTHER';
          if (!['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql) && !sql.startsWith('SELECT set_config'))
            lastStage = stage;
          try {
            return await client.query(sql, params);
          } catch (error) {
            // Test-only diagnostic: fixed stage and SQLSTATE, never SQL parameters or secrets.
            let code: unknown;
            try {
              code =
                error !== null && typeof error === 'object'
                  ? Object.getOwnPropertyDescriptor(error, 'code')?.value
                  : undefined;
            } catch {
              code = undefined;
            }
            sqlFailure = {
              stage,
              code: typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code) ? code : 'UNKNOWN',
            };
            throw error;
          }
        }) as PoolClient['query'],
      };
    },
  };
  const service = new ManualRecovery(
    observed,
    signed.evidence,
    h,
    security,
    registry,
    budgets,
    new Uint8Array(32).fill(11),
  );
  let csrf = (await security.context(raw)).csrf;
  const proof = async (
    op: string,
    expected: string | null = null,
    ref: string | null = null,
    id: string = caseId,
  ) => security.stepUp(raw, csrf, password, recoveryIntent(op, id, expected, ref));
  const register = () =>
    proof('register', null, null, 'register').then((p) =>
      service.register(
        p,
        {
          enrollmentRef: 'ENROLLMENT',
          appointmentRef: 'APPOINTMENT',
          contactRef: 'CONTACT',
          approvalRef: 'register',
        },
        'site-a',
        'register',
      ),
    );
  const receipt = async (
    kind: 'VERIFICATION' | 'APPROVAL' | 'HANDOVER' | 'NOTICE',
    ref: string,
    extra: Record<string, string | null> = {},
  ) => {
    const c = (
      await adminRows('SELECT * FROM zhiban_identity.identity_recovery_cases WHERE case_id=$1', [
        caseId,
      ])
    )[0];
    signed.put(ref, kind, {
      issued_at: Date.now().toString(),
      case_id: caseId,
      registration_manifest_digest: c.registration_manifest_digest,
      verifier_user_id: verifier,
      appointment_source_id: src[1],
      expected_appointment_source_revision: '1',
      receipt_ref: ref,
      notice_kind: null,
      route_source_id: null,
      route_source_revision: null,
      ticket_generation: null,
      verified_at: c.verified_at,
      expires_at: c.expires_at,
      pre_notice_receipt_ref: null,
      ...extra,
    });
  };
  const approve = async () => {
    await register();
    await receipt('VERIFICATION', 'verify');
    await service.advance(
      'verify',
      await proof('verify', '1', 'verify'),
      caseId,
      '1',
      'verify',
      'verify',
    );
    await receipt('APPROVAL', 'pre-notice', {
      notice_kind: 'PRE_RESET',
      route_source_id: src[2],
      route_source_revision: '1',
      pre_notice_receipt_ref: 'pre-notice',
    });
    return service.advance(
      'approve',
      await proof('approve', '2', 'pre-notice'),
      caseId,
      '2',
      'pre-notice',
      'approve',
    );
  };
  const issue = async () => {
    await approve();
    const pair = await service.pair(
      await proof('pair', '3'),
      caseId,
      '3',
      'site-a',
      'staff',
      'person',
    );
    const ceremony = registry.open(pair.pairingCode, 'site-a', 'person');
    await receipt('HANDOVER', 'handover', { ticket_generation: '1' });
    await service.issue(
      await proof('issue', '3', 'handover'),
      caseId,
      '3',
      'handover',
      'staff',
      'issue',
    );
    const ticket = await service.subjectTicket(ceremony.cookie, ceremony.csrf, 'site-a', 'person');
    if (!ticket) throw new Error('Synthetic ticket not available');
    return { ceremony, ticket };
  };
  const ready = async () => {
    const issued = await issue();
    await service.submit(
      issued.ceremony.cookie,
      issued.ceremony.csrf,
      'site-a',
      'person',
      issued.ticket,
      replacement,
    );
    const submission = registry.ready(caseId);
    if (!submission) throw new Error('Synthetic submission not available');
    return { ...issued, submission };
  };
  return {
    auth,
    control,
    h,
    credentials,
    sessions,
    users,
    subject,
    actor,
    verifier,
    raw,
    grant,
    signed,
    provision,
    src,
    caseId,
    security,
    registry,
    service,
    sqlFailure: () => sqlFailure,
    lastStage: () => lastStage,
    proof,
    receipt,
    register,
    approve,
    issue,
    ready,
    refreshCsrf: async () => {
      csrf = (await security.context(raw)).csrf;
    },
    digest: digestBearer(raw)!,
  };
}
