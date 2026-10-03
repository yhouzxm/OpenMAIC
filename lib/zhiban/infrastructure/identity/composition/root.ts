import { createHash } from 'node:crypto';
import type { TransactionPool } from '../postgres/transactions';
import { ApprovedIdentityCatalog } from '../authorization/identity-catalog';
import { LocalCompromisedPasswordScreening } from '../credentials/password-screening';
import { Argon2PasswordHasher } from '../credentials/argon2-password-hasher';
import { PostgresCredentialRepository } from '../postgres/repositories/credential';
import { PostgresSessionRepository } from '../postgres/repositories/session';
import { sessionPolicy, type SessionPolicy } from '../sessions/session-material';
import { SessionCsrfPolicy, sessionCookiePolicy } from '../sessions/browser-security';
import { OwnAuthentication } from '@/lib/zhiban/application/identity/use-cases/authentication';
import { integrity, oneRow } from '../postgres/repositories/repository-support';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import {
  SharedAdmission,
  purposes,
  admissionPolicyDigest,
  type AdmissionPolicyRecord,
  type AdmissionConfig,
} from './admission';
import { IdentityAuthentication } from './authentication';
import { IdentityIds } from './ids';
import { PlatformIdentityOperator, type OperatorApprovalStore } from './operator';
import { ref, run } from './support';
import { MemberCommands } from './member-commands';
import { MemberAdmissions } from './member-admissions';
import { ControlCommands } from './control-commands';
import { membershipCompositionPolicy } from './membership-intent';
import { MembershipCommands } from '@/lib/zhiban/application/identity/use-cases/memberships';
import type { MembershipCompositionPolicy } from '@/lib/zhiban/application/identity/ports/membership-composition';
import type { MembershipOperatorApprovalStore } from './control-approval';
import { IdentitySafeQueries } from '@/lib/zhiban/application/identity/use-cases/safe-queries';
import { IdentitySafeQueryComposition } from './safe-queries';

export interface IdentityCompositionConfig {
  readonly origin: string;
  readonly sessionPolicy: SessionPolicy;
  readonly catalog: ConstructorParameters<typeof ApprovedIdentityCatalog>[0];
  readonly admission: AdmissionConfig;
  readonly corpus: {
    readonly approvalRef: string;
    readonly expectedDigest: string;
    readonly values: readonly string[];
  };
  /** Until separately approved named operator evidence/config exists, pass null. */
  readonly operator: OperatorApprovalStore | null;
  readonly transportApprovalRef: string;
  readonly deployment: 'SINGLE_PROCESS_HTTPS';
  /** No approved capacity/evidence configuration means these entrypoints remain closed. */
  readonly membership?: {
    readonly policy: MembershipCompositionPolicy;
    readonly operator: MembershipOperatorApprovalStore | null;
  } | null;
}
/** Explicit server-only root. No env defaults, fixture import, HTTP or startup DDL. */
export async function createIdentityComposition(
  pools: { auth: TransactionPool; tenant: TransactionPool; control: TransactionPool },
  config: IdentityCompositionConfig,
) {
  try {
    if (typeof window !== 'undefined') throw new IdentityPortError('UNAVAILABLE');
    integrity(config !== null && config?.deployment === 'SINGLE_PROCESS_HTTPS');
    ref(config.transportApprovalRef);
    ref(config.corpus?.approvalRef);
    const csrf = new SessionCsrfPolicy(config.origin, true);
    const policy = sessionPolicy(config.sessionPolicy);
    const catalog = new ApprovedIdentityCatalog(config.catalog);
    const corpus = new LocalCompromisedPasswordScreening(config.corpus.values);
    const digest = createHash('sha256').update(JSON.stringify(config.corpus.values)).digest('hex');
    integrity(digest === config.corpus.expectedDigest);
    const dbs: string[] = [];
    for (const [key, role] of [
      ['auth', 'zhiban_auth_runtime'],
      ['tenant', 'zhiban_runtime'],
      ['control', 'zhiban_control_runtime'],
    ] as const) {
      await run(pools[key], async (client) => {
        const row = oneRow(
          await client.query<{
            session_user: string;
            current_user: string;
            database: string;
            safe: boolean;
            memberships: number;
          }>(
            `SELECT session_user,current_user,current_database() AS database,
            (r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolbypassrls AND NOT r.rolcreatedb AND NOT r.rolcreaterole
             AND NOT r.rolreplication AND NOT r.rolinherit
             AND NOT pg_catalog.has_database_privilege(r.oid,current_database(),'CREATE')
             AND NOT pg_catalog.has_database_privilege(r.oid,current_database(),'TEMPORARY')
             AND NOT pg_catalog.has_schema_privilege(r.oid,'zhiban_identity','CREATE')) AS safe,
            (SELECT count(*)::integer FROM pg_catalog.pg_auth_members WHERE member=r.oid) AS memberships
           FROM pg_catalog.pg_roles AS r WHERE r.rolname=session_user`,
          ),
          'SELECT',
        );
        integrity(
          row !== null &&
            row.session_user === role &&
            row.current_user === role &&
            row.safe === true &&
            row.memberships === 0 &&
            typeof row.database === 'string',
        );
        dbs.push(row.database);
        const schema = oneRow(
          await client.query<{ ready: boolean }>(
            `SELECT NOT EXISTS (SELECT 1 FROM unnest(ARRAY[
            'schema_migrations','users','tenants','memberships','role_grants','system_admin_grants',
            'sessions','audit_events','credential_slots','credentials','admission_policies','admission_gate',
            'admission_buckets','identity_platform_bootstrap','identity_credential_provisions',
            'identity_member_admissions','identity_member_consents','identity_member_approvals','identity_member_approval_grants',
            'identity_tenant_commands','identity_tenant_command_effects','identity_control_approvals',
            'identity_control_commands','identity_control_command_effects','identity_tenant_onboarding']) AS t(name)
            WHERE to_regclass('zhiban_identity.' || t.name) IS NULL)
            AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY[
            'authorization_state(uuid,uuid,uuid[],text)','identity_auth_user_anchor(uuid)',
            'identity_session_guard(text,uuid)','identity_session_spaces(text,uuid,integer)',
            'identity_platform_bootstrap_lock()','identity_admission_reserve(text,text,text[])',
            'identity_admission_prune(text,text,integer)','identity_bootstrap_consistency()',
            'identity_provision_consistency()',
            'identity_session_step_up_guard(text,uuid,bigint,bigint,bigint,bigint)',
            'identity_member_admission_state(uuid,uuid,uuid)',
            'identity_member_consent_context(text,uuid,uuid,uuid,uuid)',
            'identity_member_admission_register(text,uuid,uuid,uuid)',
            'identity_tenant_restore_guard(uuid,uuid)',
            'identity_first_tenant_admin_lock(uuid,uuid)',
            'identity_first_tenant_admin_apply(uuid,uuid,uuid,bigint)',
            'identity_membership_composition_consistency()']) AS f(signature)
            WHERE to_regprocedure('zhiban_identity.' || f.signature) IS NULL) AS ready`,
          ),
          'SELECT',
        );
        integrity(schema?.ready === true); // Runtime cannot read migration ledger; maintenance runner verifies checksums.
      });
    }
    integrity(new Set(dbs).size === 1 && new Set(Object.values(pools)).size === 3);
    // Approved config is checked before any locator/KDF; no account-dependent config error.
    await run(pools.control, async (client) => {
      const rows = await client.query<AdmissionPolicyRecord & { policy_digest: string }>(
        'SELECT purpose,policy_digest,approval_ref,environment_ref,created_at,window_ms,global_limit,ip_limit,locator_limit,pair_limit,user_limit,max_buckets FROM zhiban_identity.admission_policies',
      );
      integrity(rows.command === 'SELECT' && rows.rowCount === 4 && rows.rows.length === 4);
      for (const purpose of purposes) {
        const p = rows.rows.find((row) => row.purpose === purpose);
        integrity(p !== undefined);
        const { policy_digest: recordedDigest, ...manifest } = p;
        integrity(
          recordedDigest === config.admission.policyDigests[purpose] &&
            admissionPolicyDigest(manifest) === recordedDigest &&
            p.approval_ref === config.admission.approvalRef &&
            p.environment_ref === config.admission.environment,
        );
      }
    });
    const admission = new SharedAdmission(pools.auth, config.admission),
      ids = new IdentityIds(),
      hashing = new Argon2PasswordHasher(corpus);
    const credentials = new PostgresCredentialRepository(pools.auth),
      sessions = new PostgresSessionRepository(pools.auth, policy);
    const security = await IdentityAuthentication.create(
      pools.auth,
      sessions,
      credentials,
      hashing,
      admission,
      csrf,
      ids,
    );
    const operator =
      config.operator === null
        ? null
        : new PlatformIdentityOperator(
            pools.control,
            pools.auth,
            config.operator,
            config.admission.environment,
            hashing,
            admission,
            ids,
          );
    let members: MembershipCommands | null = null,
      control: ControlCommands | null = null;
    let queries: IdentitySafeQueries | null = null;
    if (config.membership !== undefined && config.membership !== null) {
      const memberPolicy = membershipCompositionPolicy(config.membership.policy);
      integrity(memberPolicy.environmentRef === config.admission.environment);
      const bridge = await security.membershipSecurity();
      queries = new IdentitySafeQueries(
        new IdentitySafeQueryComposition(
          security,
          pools.tenant,
          bridge,
          catalog,
          memberPolicy,
          config.membership.operator,
        ),
      );
      members = new MembershipCommands(
        new MemberCommands(pools.tenant, bridge, catalog, ids, memberPolicy),
        new MemberAdmissions(
          pools.tenant,
          bridge,
          catalog,
          ids,
          memberPolicy,
          config.membership.operator,
        ),
      );
      if (config.membership.operator !== null)
        control = new ControlCommands(
          pools.control,
          bridge,
          catalog,
          config.membership.operator,
          ids,
          memberPolicy,
        );
    }
    return Object.freeze({
      application: new OwnAuthentication(security),
      security,
      admission,
      ids,
      catalog,
      operator,
      members,
      queries,
      control,
      cookiePolicy: sessionCookiePolicy(true),
    });
  } catch {
    throw new IdentityPortError('UNAVAILABLE');
  } // No config/connection/corpus/cause disclosure.
}
