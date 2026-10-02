import { instant, userId, type Instant, type UserId } from '@/lib/zhiban/domain/identity';
import {
  createIdentityAuditEvent,
  type IdentityAuditEventInput,
} from '@/lib/zhiban/application/identity/ports/audit';
import {
  credentialId,
  securityEpoch,
  type CredentialAuditContext,
  type CredentialId,
  type CredentialRepositoryPort,
} from '@/lib/zhiban/application/identity/ports/credential-repository';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import type {
  PasswordRehashHandle,
  PasswordVerifierHandle,
} from '@/lib/zhiban/application/identity/ports/password-hashing';
import {
  repositoryRevision,
  type RepositoryRevision,
} from '@/lib/zhiban/application/identity/ports/repository-types';
import type { PoolClient } from 'pg';
import { controlTransaction, type TransactionPool } from '../transactions';
import { checkedUuid } from '../mappers/checked-values';
import { userFromRow, type UserRow } from '../mappers/user';
import {
  issueVerifier,
  rehashMaterial,
  verifierMaterial,
} from '../../credentials/verifier-material';
import { sanitizedCredentialError } from '../../credentials/credential-errors';
import {
  credentialColumns,
  slotColumns,
  slotMetadata,
  validateAggregate,
  type CredentialRow,
  type SlotRow,
} from './credential-records';
import {
  atPortBoundary,
  expectedRevision,
  integrity,
  nextRevision,
  oneRow,
} from './repository-support';

const uniques = [
  'credential_slots_pkey',
  'credentials_pkey',
  'credentials_user_id_generation_key',
  'credential_one_active',
];
type TransactionClient = Pick<PoolClient, 'query' | 'release'>;
function canonicalUser(id: UserId) {
  checkedUuid(id);
  return userId(id);
}
function increment(value: string) {
  integrity(value !== '9223372036854775807');
  return (BigInt(value) + BigInt(1)).toString();
}
function changed(
  result: { command: string; rowCount: number | null; rows: unknown[] },
  command: string,
) {
  integrity(result.command === command && result.rowCount === 1 && result.rows.length === 0);
}
/** Infrastructure-private snapshot: no encoded material, never an ordinary Loaded result. */
export interface CredentialVerificationSnapshot {
  readonly userId: UserId;
  readonly credentialId: CredentialId;
  readonly revision: RepositoryRevision;
  readonly epoch: string;
  readonly verifier: PasswordVerifierHandle;
}
const snapshots = new WeakSet<object>();

/** Composition MUST supply a zhiban_auth_runtime pool, not control/migrator credentials. */
export class PostgresCredentialRepository implements CredentialRepositoryPort {
  constructor(private readonly authPool: TransactionPool) {}
  private async run<T>(work: (client: TransactionClient) => Promise<T>, readOnly = false) {
    try {
      return await atPortBoundary(
        () =>
          controlTransaction(
            this.authPool,
            work,
            readOnly ? 'REPEATABLE_READ_READ_ONLY' : 'READ_COMMITTED',
          ),
        uniques,
      );
    } catch (error) {
      throw sanitizedCredentialError(error);
    }
  }
  private captureAudit(audit: CredentialAuditContext, at: Instant): CredentialAuditContext {
    const event = createIdentityAuditEvent({
      actor: audit.actor,
      requestId: audit.requestId,
      reason: audit.reason,
      occurredAt: at,
      type: 'AUTHENTICATION_REJECTED',
    });
    return Object.freeze({ actor: event.actor, requestId: event.requestId, reason: event.reason });
  }
  private async read(client: TransactionClient, id: UserId, lock = false) {
    const slot = oneRow(
      await client.query<SlotRow>(
        `SELECT ${slotColumns} FROM zhiban_identity.credential_slots WHERE user_id = $1${lock ? ' FOR UPDATE' : ''}`,
        [id],
      ),
      'SELECT',
      true,
    );
    if (!slot) return null;
    integrity(slot.user_id === id);
    const result = await client.query<CredentialRow>(
      `SELECT ${credentialColumns} FROM zhiban_identity.credentials WHERE user_id = $1 ORDER BY generation`,
      [id],
    );
    integrity(
      result.command === 'SELECT' &&
        Array.isArray(result.rows) &&
        result.rowCount === result.rows.length,
    );
    const aggregate = validateAggregate(slot, result.rows);
    return { slot, rows: result.rows, ...aggregate };
  }
  findSlot(id: UserId) {
    return this.run(
      async (client) => (await this.read(client, canonicalUser(id)))?.loaded ?? null,
      true,
    );
  }
  findHistory(id: UserId) {
    return this.run(
      async (client) => Object.freeze((await this.read(client, canonicalUser(id)))?.history ?? []),
      true,
    );
  }
  private async insert(
    client: TransactionClient,
    id: UserId,
    newId: CredentialId,
    material: string,
    generation: string,
    revision: string,
    at: Instant,
  ) {
    changed(
      await client.query(
        `INSERT INTO zhiban_identity.credentials (credential_id, user_id, credential_type, generation, status, slot_revision, verifier_material, created_at, updated_at, replaced_at, revoked_at, replaced_by_credential_id) VALUES ($1,$2,'PASSWORD',$3,'ACTIVE',$4,$5,$6,$6,NULL,NULL,NULL)`,
        [newId, id, generation, revision, material, at.toString()],
      ),
      'INSERT',
    );
  }
  private async audit(client: TransactionClient, eventInput: IdentityAuditEventInput) {
    const event = createIdentityAuditEvent(eventInput);
    // Exact credential-event projection, never serialize arbitrary input/handle.
    integrity(event.type.startsWith('CREDENTIAL_') && 'credentialId' in event);
    if (!('credentialId' in event)) throw new IdentityPortError('INTEGRITY_FAILURE');
    let payload: object;
    switch (event.type) {
      case 'CREDENTIAL_CREATED':
        payload = {
          credentialId: event.credentialId,
          repositoryRevisionAfter: event.repositoryRevisionAfter,
          securityEpochAfter: event.securityEpochAfter,
        };
        break;
      case 'CREDENTIAL_REPLACED':
        payload = {
          priorCredentialId: event.priorCredentialId,
          credentialId: event.credentialId,
          repositoryRevisionBefore: event.repositoryRevisionBefore,
          repositoryRevisionAfter: event.repositoryRevisionAfter,
          securityEpochBefore: event.securityEpochBefore,
          securityEpochAfter: event.securityEpochAfter,
        };
        break;
      case 'CREDENTIAL_REVOKED':
        payload = {
          credentialId: event.credentialId,
          repositoryRevisionBefore: event.repositoryRevisionBefore,
          repositoryRevisionAfter: event.repositoryRevisionAfter,
          securityEpochBefore: event.securityEpochBefore,
          securityEpochAfter: event.securityEpochAfter,
        };
        break;
      case 'CREDENTIAL_REHASHED':
        payload = {
          credentialId: event.credentialId,
          repositoryRevisionBefore: event.repositoryRevisionBefore,
          repositoryRevisionAfter: event.repositoryRevisionAfter,
          securityEpoch: event.securityEpoch,
        };
        break;
      default:
        throw new IdentityPortError('INTEGRITY_FAILURE');
    }
    changed(
      await client.query(
        `INSERT INTO zhiban_identity.audit_events (event_shape_version, event_type, event_scope, occurred_at, actor_type, actor_user_id, actor_service_code, request_id, reason, tenant_id, subject_user_id, subject_membership_id, authorization_version_before, authorization_version_after, event_payload) VALUES (1,$1,'GLOBAL',$2,$3,$4,$5,$6,$7,NULL,$8,NULL,NULL,NULL,$9::jsonb)`,
        [
          event.type,
          event.occurredAt.toString(),
          event.actor.kind,
          event.actor.kind === 'USER' ? event.actor.userId : null,
          event.actor.kind === 'SERVICE' ? event.actor.serviceCode : null,
          event.requestId,
          event.reason,
          event.userId,
          JSON.stringify(payload),
        ],
      ),
      'INSERT',
    );
  }
  createPassword(
    id: UserId,
    newId: CredentialId,
    verifier: PasswordVerifierHandle,
    at: Instant,
    audit: CredentialAuditContext,
  ) {
    return this.run(async (client) => {
      id = canonicalUser(id);
      newId = credentialId(newId);
      at = instant(at);
      const material = verifierMaterial(verifier);
      audit = this.captureAudit(audit, at);
      changed(
        await client.query(
          `INSERT INTO zhiban_identity.credential_slots (user_id, credential_type, active_credential_id, generation, repository_revision, security_epoch, created_at, updated_at) VALUES ($1,'PASSWORD',$2,1,1,1,$3,$3)`,
          [id, newId, at.toString()],
        ),
        'INSERT',
      );
      await this.insert(client, id, newId, material, '1', '1', at);
      await this.audit(client, {
        ...audit,
        occurredAt: at,
        type: 'CREDENTIAL_CREATED',
        userId: id,
        credentialId: newId,
        repositoryRevisionAfter: repositoryRevision('1'),
        securityEpochAfter: securityEpoch('1'),
      });
      const stored = await this.read(client, id);
      integrity(stored !== null);
      return stored.loaded;
    });
  }
  replacePassword(
    id: UserId,
    revision: RepositoryRevision,
    current: CredentialId | null,
    newId: CredentialId,
    verifier: PasswordVerifierHandle,
    at: Instant,
    audit: CredentialAuditContext,
  ) {
    return this.mutate('replace', id, revision, current, newId, verifier, at, audit);
  }
  revokePassword(
    id: UserId,
    revision: RepositoryRevision,
    current: CredentialId | null,
    at: Instant,
    audit: CredentialAuditContext,
  ) {
    return this.mutate('revoke', id, revision, current, null, null, at, audit);
  }
  rehashPassword(
    id: UserId,
    revision: RepositoryRevision,
    current: CredentialId,
    proof: PasswordRehashHandle,
    at: Instant,
    audit: CredentialAuditContext,
  ) {
    return this.mutate('rehash', id, revision, current, current, proof, at, audit);
  }
  private mutate(
    kind: 'replace' | 'revoke' | 'rehash',
    id: UserId,
    revision: RepositoryRevision,
    current: CredentialId | null,
    newId: CredentialId | null,
    handle: PasswordVerifierHandle | PasswordRehashHandle | null,
    at: Instant,
    audit: CredentialAuditContext,
  ) {
    return this.run(async (client) => {
      id = canonicalUser(id);
      at = instant(at);
      audit = this.captureAudit(audit, at);
      if (current !== null) credentialId(current);
      if (newId !== null) credentialId(newId);
      const stored = await this.read(client, id, true);
      if (!stored) throw new IdentityPortError('CONFLICT');
      expectedRevision(stored.loaded.revision, revision);
      if (stored.slot.active_credential_id !== current) throw new IdentityPortError('CONFLICT');
      if (kind === 'revoke' && current === null) return stored.loaded;
      integrity(at >= stored.loaded.value.updatedAt);
      const next = nextRevision(revision),
        epoch =
          kind === 'rehash' ? stored.slot.security_epoch : increment(stored.slot.security_epoch);
      const generation =
        kind === 'replace' ? increment(stored.slot.generation) : stored.slot.generation;
      const active = stored.rows.find((row) => row.credential_id === current);
      let material: string | null = null;
      if (kind === 'replace') {
        integrity(handle?.kind === 'PASSWORD_VERIFIER_HANDLE' && newId !== null);
        if (stored.rows.some((row) => row.credential_id === newId))
          throw new IdentityPortError('CONFLICT');
        material = verifierMaterial(handle);
      } else if (kind === 'rehash') {
        integrity(
          handle?.kind === 'PASSWORD_REHASH_HANDLE' &&
            active?.verifier_material !== null &&
            active?.verifier_material !== undefined,
        );
        material = rehashMaterial(handle, active.verifier_material);
      }
      const result = await client.query<SlotRow>(
        `UPDATE zhiban_identity.credential_slots SET active_credential_id = $1, generation = $2, repository_revision = repository_revision + 1, security_epoch = $3, updated_at = $4 WHERE user_id = $5 AND repository_revision = $6 RETURNING ${slotColumns}`,
        [kind === 'revoke' ? null : newId, generation, epoch, at.toString(), id, revision],
      );
      const row = oneRow(result, 'UPDATE', true);
      if (!row) {
        const latest = await this.read(client, id);
        if (!latest) throw new IdentityPortError('CONFLICT');
        expectedRevision(latest.loaded.revision, revision);
        throw new IdentityPortError('INTEGRITY_FAILURE');
      }
      slotMetadata(row);
      integrity(
        row.repository_revision === next &&
          row.security_epoch === epoch &&
          row.active_credential_id === (kind === 'revoke' ? null : newId) &&
          row.generation === generation &&
          row.user_id === id &&
          row.created_at === stored.slot.created_at &&
          row.updated_at === at.toString(),
      );
      if (current !== null) {
        if (kind === 'rehash')
          changed(
            await client.query(
              `UPDATE zhiban_identity.credentials SET verifier_material = $1, slot_revision = $2, updated_at = $3 WHERE user_id = $4 AND credential_id = $5 AND status = 'ACTIVE'`,
              [material, next, at.toString(), id, current],
            ),
            'UPDATE',
          );
        else
          changed(
            await client.query(
              `UPDATE zhiban_identity.credentials SET status = $1, verifier_material = NULL, slot_revision = $2, updated_at = $3, replaced_at = $4, revoked_at = $5, replaced_by_credential_id = $6 WHERE user_id = $7 AND credential_id = $8 AND status = 'ACTIVE'`,
              [
                kind === 'replace' ? 'REPLACED' : 'REVOKED',
                next,
                at.toString(),
                kind === 'replace' ? at.toString() : null,
                kind === 'revoke' ? at.toString() : null,
                kind === 'replace' ? newId : null,
                id,
                current,
              ],
            ),
            'UPDATE',
          );
      }
      if (kind === 'replace') {
        integrity(newId !== null && material !== null);
        await this.insert(client, id, newId, material, generation, next, at);
      }
      const facts = {
        ...audit,
        occurredAt: at,
        userId: id,
        credentialId: (newId ?? current) as CredentialId,
        repositoryRevisionBefore: revision,
        repositoryRevisionAfter: next,
      };
      if (kind === 'rehash')
        await this.audit(client, {
          ...facts,
          type: 'CREDENTIAL_REHASHED',
          securityEpoch: securityEpoch(epoch),
        });
      else if (kind === 'replace')
        await this.audit(client, {
          ...facts,
          type: 'CREDENTIAL_REPLACED',
          priorCredentialId: current,
          securityEpochBefore: securityEpoch(stored.slot.security_epoch),
          securityEpochAfter: securityEpoch(epoch),
        });
      else
        await this.audit(client, {
          ...facts,
          type: 'CREDENTIAL_REVOKED',
          securityEpochBefore: securityEpoch(stored.slot.security_epoch),
          securityEpochAfter: securityEpoch(epoch),
        });
      const committed = await this.read(client, id);
      integrity(committed !== null && committed.loaded.revision === next);
      return committed.loaded;
    });
  }
  async verificationSnapshot(id: UserId): Promise<CredentialVerificationSnapshot | null> {
    return this.run(async (client) => {
      canonicalUser(id);
      const user = oneRow(
        await client.query<UserRow>(
          'SELECT user_id, status, created_at, updated_at, disabled_at, disabled_reason, repository_revision FROM zhiban_identity.users WHERE user_id = $1',
          [id],
        ),
        'SELECT',
        true,
      );
      integrity(user === null || user.user_id === id);
      const stored = await this.read(client, id);
      if (
        user === null ||
        userFromRow(user).value.status !== 'ACTIVE' ||
        stored === null ||
        stored.slot.active_credential_id === null
      )
        return null;
      const active = stored.rows.find((row) => row.status === 'ACTIVE');
      integrity(active?.verifier_material !== null && active?.verifier_material !== undefined);
      const snapshot = Object.freeze({
        userId: id,
        credentialId: credentialId(active.credential_id),
        revision: stored.loaded.revision,
        epoch: stored.slot.security_epoch,
        verifier: issueVerifier(active.verifier_material),
      });
      snapshots.add(snapshot);
      return snapshot;
    }, true);
  }
  async stillCurrent(snapshot: CredentialVerificationSnapshot): Promise<boolean> {
    return this.run(async (client) => {
      integrity(snapshots.has(snapshot));
      // A fresh statement snapshot AFTER crypto, not the old repeatable-read snapshot.
      const slot = oneRow(
        await client.query<SlotRow>(
          `SELECT ${slotColumns} FROM zhiban_identity.credential_slots WHERE user_id = $1 FOR SHARE`,
          [snapshot.userId],
        ),
        'SELECT',
        true,
      );
      if (!slot) return false;
      integrity(slot.user_id === snapshot.userId);
      const history = await client.query<CredentialRow>(
        `SELECT ${credentialColumns} FROM zhiban_identity.credentials WHERE user_id = $1 ORDER BY generation`,
        [snapshot.userId],
      );
      integrity(
        history.command === 'SELECT' &&
          Array.isArray(history.rows) &&
          history.rowCount === history.rows.length,
      );
      validateAggregate(slot, history.rows);
      const user = oneRow(
        await client.query<UserRow>(
          'SELECT user_id, status, created_at, updated_at, disabled_at, disabled_reason, repository_revision FROM zhiban_identity.users WHERE user_id = $1',
          [snapshot.userId],
        ),
        'SELECT',
        true,
      );
      integrity(user === null || user.user_id === snapshot.userId);
      return (
        user !== null &&
        userFromRow(user).value.status === 'ACTIVE' &&
        slot.active_credential_id === snapshot.credentialId &&
        slot.repository_revision === snapshot.revision &&
        slot.security_epoch === snapshot.epoch
      );
    });
  }
}
