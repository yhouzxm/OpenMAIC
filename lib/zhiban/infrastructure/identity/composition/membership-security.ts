import { randomBytes } from 'node:crypto';
import { userId } from '@/lib/zhiban/domain/identity';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import type {
  RecentMembershipReauthentication,
  CompositionAction,
} from '@/lib/zhiban/application/identity/ports/membership-composition';
import type {
  AuthenticatedRequestHandle,
  AuthenticationTransport,
} from '@/lib/zhiban/application/identity/use-cases/authentication';
import type {
  PasswordHashingPort,
  PasswordVerifierHandle,
} from '@/lib/zhiban/application/identity/ports/password-hashing';
import type { PostgresCredentialRepository } from '../postgres/repositories/credential';
import type { TransactionPool } from '../postgres/transactions';
import { integrity, oneRow } from '../postgres/repositories/repository-support';
import { sanitizedCredentialError } from '../credentials/credential-errors';
import { compositionAction, closedCompositionArray } from './membership-intent';
import { SharedAdmission } from './admission';
import { now, ref, run, type Client } from './support';
import { refuse } from './refusals';

interface SessionBinding {
  readonly user: string;
  readonly digest: string;
  readonly session: string;
}
export interface MembershipProofIntent {
  readonly requestId: string;
  readonly commandId: string;
  readonly action: CompositionAction;
  readonly targetIds: readonly string[];
  readonly intentDigest: string;
}
interface Proof {
  readonly handle: AuthenticatedRequestHandle;
  readonly intent: MembershipProofIntent;
  readonly userRevision: string;
  readonly slotRevision: string;
  readonly epoch: string;
  readonly at: number;
  readonly monotonic: number;
}
function copyIntent(input: MembershipProofIntent): MembershipProofIntent {
  integrity(typeof input === 'object' && input !== null);
  const keys = ['requestId', 'commandId', 'action', 'targetIds', 'intentDigest'];
  const descriptors = Object.getOwnPropertyDescriptors(input);
  integrity(
    Reflect.ownKeys(input).length === keys.length &&
      keys.every((k) => Object.hasOwn(descriptors, k) && 'value' in descriptors[k]),
  );
  ref(input.requestId);
  userId(input.commandId);
  compositionAction(input.action);
  closedCompositionArray(input.targetIds, 1, 2);
  const targetIds = input.targetIds.map(userId);
  integrity(
    new Set(targetIds).size === targetIds.length &&
      typeof input.intentDigest === 'string' &&
      /^[a-f0-9]{64}$(?![\s\S])/.test(input.intentDigest),
  );
  return Object.freeze({
    requestId: input.requestId,
    commandId: input.commandId,
    action: input.action,
    targetIds: Object.freeze(targetIds),
    intentDigest: input.intentDigest,
  });
}
function sameIntent(a: MembershipProofIntent, b: MembershipProofIntent) {
  return (
    a.requestId === b.requestId &&
    a.commandId === b.commandId &&
    a.action === b.action &&
    a.intentDigest === b.intentDigest &&
    a.targetIds.length === b.targetIds.length &&
    a.targetIds.every((id, i) => id === b.targetIds[i])
  );
}
/** Infrastructure-only bridge, bound to one existing private authenticated-handle registry.
 * Nothing here exports credential/session material to ordinary Application DTOs. */
export class MembershipSecurity {
  #proofs = new WeakMap<RecentMembershipReauthentication, Proof>();
  private constructor(
    private readonly resolve: (handle: AuthenticatedRequestHandle) => SessionBinding,
    private readonly pool: TransactionPool,
    private readonly credentials: Pick<PostgresCredentialRepository, 'verificationSnapshot'>,
    private readonly hashing: PasswordHashingPort,
    private readonly admission: SharedAdmission,
    private readonly dummy: PasswordVerifierHandle,
  ) {}
  static async create(
    resolve: (handle: AuthenticatedRequestHandle) => SessionBinding,
    pool: TransactionPool,
    credentials: Pick<PostgresCredentialRepository, 'verificationSnapshot'>,
    hashing: PasswordHashingPort,
    admission: SharedAdmission,
  ) {
    // Once per bridge, not once per request; provider production parameters are unchanged.
    const dummy = await hashing.hash(randomBytes(48).toString('base64url'));
    return new MembershipSecurity(resolve, pool, credentials, hashing, admission, dummy);
  }
  actor(handle: AuthenticatedRequestHandle) {
    return userId(this.resolve(handle).user);
  }
  async consentContext(
    client: Client,
    handle: AuthenticatedRequestHandle,
    tenant: string,
    admission: string | null,
    approval: string | null,
  ) {
    try {
      const binding = this.resolve(handle);
      userId(tenant);
      for (const id of [admission, approval]) if (id !== null) userId(id);
      integrity((admission === null) !== (approval === null));
      const row = oneRow(
        await client.query<{
          membership_id: string | null;
          member_revision: string | null;
          auth_version: string | null;
          purpose: string;
          expires_at: string;
        }>('SELECT * FROM zhiban_identity.identity_member_consent_context($1,$2,$3,$4,$5)', [
          binding.digest,
          binding.user,
          tenant,
          admission,
          approval,
        ]),
        'SELECT',
      );
      integrity(
        row !== null &&
          Object.keys(row).sort().join(',') ===
            'auth_version,expires_at,member_revision,membership_id,purpose',
      );
      integrity(['ACTIVATE', 'REACTIVATE', 'REJOIN', 'FIRST_TENANT_ADMIN'].includes(row.purpose));
      repositoryRevision(row.expires_at);
      if (row.purpose === 'FIRST_TENANT_ADMIN')
        integrity(
          row.membership_id === null && row.member_revision === null && row.auth_version === null,
        );
      else {
        integrity(
          row.membership_id !== null && row.member_revision !== null && row.auth_version !== null,
        );
        userId(row.membership_id);
        repositoryRevision(row.member_revision);
        integrity(
          /^(0|[1-9][0-9]*)$(?![\s\S])/.test(row.auth_version) &&
            BigInt(row.auth_version) <= BigInt('9007199254740991'),
        );
      }
      return Object.freeze(row);
    } catch (error) {
      throw sanitizedCredentialError(error);
    }
  }
  async prepare(
    handle: AuthenticatedRequestHandle,
    input: MembershipProofIntent,
    secret: string,
    transport: AuthenticationTransport,
  ): Promise<RecentMembershipReauthentication> {
    try {
      const intent = copyIntent(input),
        binding = this.resolve(handle);
      integrity(typeof secret === 'string');
      const allowed = await this.admission.reserve(
        'REAUTHENTICATE',
        transport,
        binding.user,
        binding.user,
      );
      if (allowed === false) refuse('ADMISSION_DENIED', 'INTEGRITY_FAILURE');
      integrity(allowed === true);
      const monotonic = performance.now();
      const anchor = await run(this.pool, async (client) => {
        const row = oneRow(
          await client.query<{ user_id: string; user_status: string; user_revision: string }>(
            'SELECT * FROM zhiban_identity.identity_auth_user_anchor($1)',
            [binding.user],
          ),
          'SELECT',
        );
        integrity(
          row !== null &&
            Object.keys(row).length === 3 &&
            row.user_id === binding.user &&
            row.user_status === 'ACTIVE',
        );
        return { revision: repositoryRevision(row.user_revision), at: await now(client) };
      }); // release auth client before snapshot and expensive KDF
      const snapshot = await this.credentials.verificationSnapshot(userId(binding.user));
      const verified = await this.hashing.verify(secret, snapshot?.verifier ?? this.dummy);
      integrity(typeof verified === 'boolean');
      if (snapshot === null || verified === false) refuse('REAUTH_REJECTED', 'INTEGRITY_FAILURE');
      integrity(snapshot.userId === binding.user);
      const elapsed = performance.now() - monotonic;
      integrity(elapsed >= 0 && elapsed < 300000);
      const handleProof: RecentMembershipReauthentication = Object.freeze({
        kind: 'RECENT_MEMBERSHIP_REAUTHENTICATION',
      });
      this.#proofs.set(handleProof, {
        handle,
        intent,
        userRevision: anchor.revision,
        slotRevision: snapshot.revision,
        epoch: snapshot.epoch,
        at: anchor.at,
        monotonic,
      });
      return handleProof;
    } catch (error) {
      throw sanitizedCredentialError(error);
    }
  }
  /** Existing five-column guard. This must run only after the complete sorted User lock set. */
  async assertSession(client: Client, handle: AuthenticatedRequestHandle) {
    try {
      const binding = this.resolve(handle);
      const row = oneRow(
        await client.query<{
          user_id: string;
          user_revision: string;
          security_epoch: string;
          absolute_expires_at: string;
          idle_expires_at: string;
        }>('SELECT * FROM zhiban_identity.identity_session_guard($1,$2)', [
          binding.digest,
          binding.user,
        ]),
        'SELECT',
      );
      integrity(row !== null && Object.keys(row).length === 5 && row.user_id === binding.user);
      repositoryRevision(row.user_revision);
      repositoryRevision(row.security_epoch);
      const at = await now(client);
      for (const expiry of [row.absolute_expires_at, row.idle_expires_at])
        integrity(
          typeof expiry === 'string' &&
            /^(0|[1-9][0-9]*)$(?![\s\S])/.test(expiry) &&
            BigInt(expiry) <= BigInt('8640000000000000') &&
            BigInt(expiry) > BigInt(at),
        );
      return Object.freeze({
        userId: userId(binding.user),
        userRevision: repositoryRevision(row.user_revision),
      });
    } catch (error) {
      throw sanitizedCredentialError(error);
    }
  }
  async registerAdmission(
    client: Client,
    handle: AuthenticatedRequestHandle,
    approvalId: string,
    admissionId: string,
    capacity: number,
  ) {
    try {
      const binding = this.resolve(handle);
      userId(approvalId);
      userId(admissionId);
      integrity(Number.isSafeInteger(capacity) && capacity > 0 && capacity <= 1000000);
      await client.query("SELECT set_config('app.identity_member_capacity',$1,true)", [
        capacity.toString(),
      ]);
      const row = oneRow(
        await client.query<{ admission_id: string }>(
          'SELECT zhiban_identity.identity_member_admission_register($1,$2,$3,$4) AS admission_id',
          [binding.digest, binding.user, approvalId, admissionId],
        ),
        'SELECT',
      );
      integrity(row !== null && Object.keys(row).length === 1 && row.admission_id === admissionId);
      return admissionId;
    } catch (error) {
      throw sanitizedCredentialError(error);
    }
  }
  async assertProof(
    client: Client,
    handle: AuthenticatedRequestHandle,
    proof: RecentMembershipReauthentication,
    input: MembershipProofIntent,
  ) {
    try {
      const intent = copyIntent(input),
        saved = this.#proofs.get(proof),
        binding = this.resolve(handle);
      integrity(saved !== undefined && saved.handle === handle && sameIntent(saved.intent, intent));
      const elapsed = performance.now() - saved.monotonic;
      integrity(elapsed >= 0 && elapsed < 300000);
      const row = oneRow(
        await client.query<{ valid: boolean }>(
          'SELECT zhiban_identity.identity_session_step_up_guard($1,$2,$3,$4,$5,$6) AS valid',
          [
            binding.digest,
            binding.user,
            saved.userRevision,
            saved.slotRevision,
            saved.epoch,
            saved.at.toString(),
          ],
        ),
        'SELECT',
      );
      integrity(row !== null && Object.keys(row).length === 1 && row.valid === true);
      const finalElapsed = performance.now() - saved.monotonic;
      integrity(finalElapsed >= 0 && finalElapsed < 300000);
    } catch (error) {
      throw sanitizedCredentialError(error);
    }
  }
}
