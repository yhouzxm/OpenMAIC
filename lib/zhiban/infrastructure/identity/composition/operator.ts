import { createHash } from 'node:crypto';
import { userId, systemAdminGrantId, instant } from '@/lib/zhiban/domain/identity';
import type { PasswordHashingPort } from '@/lib/zhiban/application/identity/ports/password-hashing';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import type { TransactionPool } from '../postgres/transactions';
import { integrity, oneRow, expectedRevision } from '../postgres/repositories/repository-support';
import type { UserRow } from '../postgres/mappers/user';
import type { SystemAdminGrantRow } from '../postgres/mappers/system-admin-grant';
import { checkRow, checkedInteger, instantMaximum } from '../postgres/mappers/checked-values';
import {
  slotColumns,
  credentialColumns,
  validateAggregate,
  type SlotRow,
  type CredentialRow,
} from '../postgres/repositories/credential-records';
import { verifierMaterial } from '../credentials/verifier-material';
import { SharedAdmission } from './admission';
import { IdentityIds } from './ids';
import { audit, changed, now, ref, run, reject } from './support';
import { sanitizedCredentialError } from '../credentials/credential-errors';

export interface PlatformApproval {
  readonly purpose: 'FIRST_PLATFORM_ADMIN';
  readonly approvalId: string;
  readonly commandId: string;
  readonly userId: string;
  readonly existingUserRevision: string | null;
  readonly grantId: string;
  readonly provisionApprovalId: string;
  readonly environment: string;
  readonly approvalRef: string;
  readonly operatorRef: string;
  readonly approverRef: string;
  readonly requestId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly manifestDigest: string;
}
/** Trusted server/operator evidence storage. Must verify independent human approval/signature
 * and immutable manifest before load; NEVER construct from HTTP/argv approved booleans.
 * No default store/tool is wired; deployment must separately approve named responsibility.
 */
export interface OperatorApprovalStore {
  load(approvalRef: string): Promise<PlatformApproval | null>;
}
interface BootstrapRow extends Record<string, unknown> {
  repository_revision: string;
  approval_id: string | null;
  command_id: string | null;
  target_user_id: string | null;
  system_admin_grant_id: string | null;
  credential_provision_id: string | null;
  manifest_digest: string | null;
  user_revision: string | null;
  environment_ref: string | null;
}
interface ProvisionRow extends Record<string, unknown> {
  approval_id: string;
  command_id: string;
  user_id: string;
  expected_user_revision: string;
  purpose: string;
  environment_ref: string;
  approval_ref: string;
  operator_ref: string;
  approver_ref: string;
  request_id: string;
  manifest_digest: string;
  issued_at: string;
  expires_at: string;
  consumed_at: string | null;
  credential_id: string | null;
  credential_event_id: string | null;
}
const provisionFields = [
  'approval_id',
  'command_id',
  'user_id',
  'expected_user_revision',
  'purpose',
  'environment_ref',
  'approval_ref',
  'operator_ref',
  'approver_ref',
  'request_id',
  'manifest_digest',
  'issued_at',
  'expires_at',
  'consumed_at',
  'credential_id',
  'credential_event_id',
] as const;
const bootstrapFields = [
  'singleton_key',
  'repository_revision',
  'approval_id',
  'command_id',
  'environment_ref',
  'approval_ref',
  'operator_ref',
  'approver_ref',
  'request_id',
  'manifest_digest',
  'target_user_id',
  'user_revision',
  'system_admin_grant_id',
  'issued_at',
  'expires_at',
  'completed_at',
  'created_user',
  'user_created_event_id',
  'grant_created_event_id',
  'credential_provision_id',
] as const;
function ledgerRow(
  row: Record<string, unknown>,
  fields: readonly string[],
  nullable: readonly string[],
  booleanField?: string,
) {
  integrity(
    Object.getPrototypeOf(row) === Object.prototype &&
      Reflect.ownKeys(row).length === fields.length,
  );
  for (const key of fields) {
    const d = Object.getOwnPropertyDescriptor(row, key);
    integrity(d !== undefined && 'value' in d);
    integrity(
      d.value === null
        ? nullable.includes(key)
        : key === booleanField
          ? typeof d.value === 'boolean'
          : typeof d.value === 'string',
    );
  }
}
function provisionRecord(row: ProvisionRow) {
  ledgerRow(row, provisionFields, ['consumed_at', 'credential_id', 'credential_event_id']);
  for (const key of ['approval_id', 'command_id', 'user_id']) userId(row[key]);
  repositoryRevision(row.expected_user_revision);
  for (const key of [
    'environment_ref',
    'approval_ref',
    'operator_ref',
    'approver_ref',
    'request_id',
  ])
    ref(row[key]);
  integrity(
    row.purpose === 'FIRST_PASSWORD' &&
      row.operator_ref !== row.approver_ref &&
      /^[0-9a-f]{64}$(?![\s\S])/.test(row.manifest_digest),
  );
  const from = checkedInteger(row.issued_at, instantMaximum),
    until = checkedInteger(row.expires_at, instantMaximum);
  integrity(until > from && until - from <= BigInt(86400000));
  if (row.consumed_at === null)
    integrity(row.credential_id === null && row.credential_event_id === null);
  else {
    const consumed = checkedInteger(row.consumed_at, instantMaximum);
    integrity(
      consumed >= from &&
        consumed < until &&
        row.credential_id !== null &&
        row.credential_event_id !== null,
    );
    userId(row.credential_id);
    repositoryRevision(row.credential_event_id);
  }
}
function bootstrapRecord(row: BootstrapRow) {
  ledgerRow(
    row,
    bootstrapFields,
    bootstrapFields.filter((k) => k !== 'singleton_key' && k !== 'repository_revision'),
    'created_user',
  );
  integrity(row.singleton_key === 'PLATFORM');
  repositoryRevision(row.repository_revision);
  if (row.repository_revision === '1') {
    integrity(bootstrapFields.slice(2).every((k) => row[k] === null));
    return;
  }
  integrity(row.repository_revision === '2' && typeof row.created_user === 'boolean');
  for (const key of [
    'approval_id',
    'command_id',
    'target_user_id',
    'system_admin_grant_id',
    'credential_provision_id',
  ])
    userId(row[key]);
  const revision = (value: unknown) => {
    integrity(typeof value === 'string');
    return repositoryRevision(value);
  };
  revision(row.user_revision);
  revision(row.grant_created_event_id);
  if (row.created_user) revision(row.user_created_event_id);
  else integrity(row.user_created_event_id === null);
  for (const key of [
    'environment_ref',
    'approval_ref',
    'operator_ref',
    'approver_ref',
    'request_id',
  ])
    ref(row[key]);
  integrity(
    row.operator_ref !== row.approver_ref &&
      typeof row.manifest_digest === 'string' &&
      /^[0-9a-f]{64}$(?![\s\S])/.test(row.manifest_digest),
  );
  const from = checkedInteger(row.issued_at, instantMaximum),
    until = checkedInteger(row.expires_at, instantMaximum),
    completed = checkedInteger(row.completed_at, instantMaximum);
  integrity(
    until > from && until - from <= BigInt(86400000) && completed >= from && completed < until,
  );
}
const fields = [
  'purpose',
  'approvalId',
  'commandId',
  'userId',
  'existingUserRevision',
  'grantId',
  'provisionApprovalId',
  'environment',
  'approvalRef',
  'operatorRef',
  'approverRef',
  'requestId',
  'issuedAt',
  'expiresAt',
] as const;
// Security-only state projections, not aggregate hydration capabilities. DH07 terminal
// mappers remain repository-owned and never cross into this composition module.
function activeUser(row: UserRow) {
  checkRow(
    row,
    [
      'user_id',
      'status',
      'created_at',
      'updated_at',
      'disabled_at',
      'disabled_reason',
      'repository_revision',
    ],
    ['disabled_at', 'disabled_reason'],
  );
  userId(row.user_id);
  const created = checkedInteger(row.created_at, instantMaximum),
    updated = checkedInteger(row.updated_at, instantMaximum);
  integrity(
    row.status === 'ACTIVE' &&
      row.disabled_at === null &&
      row.disabled_reason === null &&
      updated >= created,
  );
  return { revision: repositoryRevision(row.repository_revision) };
}
function activeGrant(row: SystemAdminGrantRow, expectedUser: string, at: number) {
  checkRow(
    row,
    [
      'grant_id',
      'user_id',
      'created_at',
      'valid_from',
      'valid_until',
      'revoked_at',
      'repository_revision',
    ],
    ['valid_until', 'revoked_at'],
  );
  systemAdminGrantId(row.grant_id);
  userId(row.user_id);
  repositoryRevision(row.repository_revision);
  const created = checkedInteger(row.created_at, instantMaximum),
    from = checkedInteger(row.valid_from, instantMaximum),
    until = row.valid_until === null ? null : checkedInteger(row.valid_until, instantMaximum);
  integrity(
    from >= created &&
      (until === null || until > from) &&
      row.user_id === expectedUser &&
      row.revoked_at === null &&
      BigInt(at) >= from &&
      (until === null || BigInt(at) < until),
  );
}
export function platformManifestDigest(manifest: Omit<PlatformApproval, 'manifestDigest'>) {
  return createHash('sha256')
    .update(JSON.stringify(fields.map((key) => [key, manifest[key]])))
    .digest('hex');
}
/** Explicit two-step operator protocol, not an HTTP endpoint or cross-pool ACID claim. */
export class PlatformIdentityOperator {
  #store: OperatorApprovalStore;
  #environment: string;
  constructor(
    private readonly controlPool: TransactionPool,
    private readonly authPool: TransactionPool,
    store: OperatorApprovalStore,
    environment: string,
    private readonly hashing: PasswordHashingPort,
    private readonly admission: SharedAdmission,
    private readonly ids: IdentityIds,
  ) {
    ref(environment);
    integrity(store !== null && typeof store?.load === 'function');
    this.#store = store;
    this.#environment = environment;
  }
  private async approval(reference: string) {
    ref(reference);
    let loaded: PlatformApproval | null;
    try {
      loaded = await this.#store.load(reference);
    } catch (error) {
      throw sanitizedCredentialError(error);
    }
    integrity(
      loaded !== null &&
        typeof loaded === 'object' &&
        Object.getPrototypeOf(loaded) === Object.prototype &&
        Reflect.ownKeys(loaded).length === fields.length + 1,
    );
    const copied: Record<string, unknown> = {};
    for (const key of [...fields, 'manifestDigest']) {
      const descriptor = Object.getOwnPropertyDescriptor(loaded, key);
      integrity(descriptor !== undefined && 'value' in descriptor);
      copied[key] = descriptor.value;
    }
    const value = copied as unknown as PlatformApproval;
    integrity(
      value.purpose === 'FIRST_PLATFORM_ADMIN' &&
        value.environment === this.#environment &&
        value.approvalRef === reference,
    );
    for (const key of [
      'environment',
      'approvalRef',
      'operatorRef',
      'approverRef',
      'requestId',
    ] as const)
      ref(value[key]);
    for (const key of [
      'approvalId',
      'commandId',
      'userId',
      'grantId',
      'provisionApprovalId',
    ] as const) {
      integrity(userId(value[key]) === value[key]);
    }
    systemAdminGrantId(value.grantId);
    if (value.existingUserRevision !== null) repositoryRevision(value.existingUserRevision);
    instant(value.issuedAt);
    instant(value.expiresAt);
    integrity(
      value.operatorRef !== value.approverRef &&
        value.expiresAt > value.issuedAt &&
        value.expiresAt - value.issuedAt <= 86400000 &&
        typeof value.manifestDigest === 'string' &&
        /^[0-9a-f]{64}$(?![\s\S])/.test(value.manifestDigest) &&
        value.manifestDigest === platformManifestDigest(value),
    );
    return Object.freeze({ ...value });
  }
  private live(manifest: PlatformApproval, at: number) {
    if (at < manifest.issuedAt || at >= manifest.expiresAt) reject();
  }
  async bootstrap(reference: string) {
    try {
      return await this.bootstrapChecked(reference);
    } catch (error) {
      throw sanitizedCredentialError(error);
    }
  }
  private async bootstrapChecked(reference: string) {
    const m = await this.approval(reference);
    return run(this.controlPool, async (client) => {
      const b = oneRow(
        await client.query<BootstrapRow>(
          "SELECT * FROM zhiban_identity.identity_platform_bootstrap WHERE singleton_key='PLATFORM' FOR UPDATE",
        ),
        'SELECT',
      );
      integrity(b !== null);
      bootstrapRecord(b);
      if (b.repository_revision === '2') {
        this.live(m, await now(client));
        if (
          b.approval_id !== m.approvalId ||
          b.command_id !== m.commandId ||
          b.manifest_digest !== m.manifestDigest ||
          b.target_user_id !== m.userId ||
          b.system_admin_grant_id !== m.grantId ||
          b.credential_provision_id !== m.provisionApprovalId ||
          b.environment_ref !== m.environment ||
          b.approval_ref !== m.approvalRef ||
          b.operator_ref !== m.operatorRef ||
          b.approver_ref !== m.approverRef ||
          b.request_id !== m.requestId ||
          b.issued_at !== m.issuedAt.toString() ||
          b.expires_at !== m.expiresAt.toString() ||
          b.created_user !== (m.existingUserRevision === null) ||
          (m.existingUserRevision !== null && b.user_revision !== m.existingUserRevision)
        )
          reject();
        const current = oneRow(
          await client.query<UserRow>(
            'SELECT user_id,status,created_at,updated_at,disabled_at,disabled_reason,repository_revision FROM zhiban_identity.users WHERE user_id=$1 FOR SHARE',
            [m.userId],
          ),
          'SELECT',
        );
        const grant = oneRow(
          await client.query<SystemAdminGrantRow>(
            'SELECT grant_id,user_id,created_at,valid_from,valid_until,revoked_at,repository_revision FROM zhiban_identity.system_admin_grants WHERE grant_id=$1 FOR SHARE',
            [m.grantId],
          ),
          'SELECT',
        );
        integrity(current !== null && grant !== null);
        const u = activeUser(current),
          at = await now(client);
        activeGrant(grant, m.userId, at);
        if (
          u.revision !== b.user_revision ||
          grant.created_at !== b.completed_at ||
          grant.valid_from !== b.completed_at
        )
          reject();
        this.live(m, at);
        return Object.freeze({
          userId: userId(m.userId),
          grantId: systemAdminGrantId(m.grantId),
          provisionApprovalId: m.provisionApprovalId,
        });
      }
      integrity(b.repository_revision === '1' && b.approval_id === null);
      await client.query('SELECT zhiban_identity.identity_platform_bootstrap_lock()');
      const history = await client.query(
        'SELECT grant_id FROM zhiban_identity.system_admin_grants LIMIT 1',
      );
      integrity(history.command === 'SELECT' && history.rowCount === history.rows.length);
      if (history.rows.length !== 0) reject();
      const existing = oneRow(
        await client.query<UserRow>(
          'SELECT user_id,status,created_at,updated_at,disabled_at,disabled_reason,repository_revision FROM zhiban_identity.users WHERE user_id=$1 FOR UPDATE',
          [m.userId],
        ),
        'SELECT',
        true,
      );
      const at = await now(client);
      this.live(m, at);
      let revision: string;
      if (existing) {
        const current = activeUser(existing);
        if (m.existingUserRevision === null) reject();
        expectedRevision(current.revision, repositoryRevision(m.existingUserRevision));
        revision = current.revision;
      } else {
        if (m.existingUserRevision !== null) reject();
        changed(
          await client.query(
            "INSERT INTO zhiban_identity.users(user_id,status,created_at,updated_at) VALUES($1,'ACTIVE',$2,$2)",
            [m.userId, at.toString()],
          ),
          'INSERT',
        );
        revision = '1';
      }
      changed(
        await client.query(
          'INSERT INTO zhiban_identity.system_admin_grants(grant_id,user_id,created_at,valid_from) VALUES($1,$2,$3,$3)',
          [m.grantId, m.userId, at.toString()],
        ),
        'INSERT',
      );
      const userAudit = existing
        ? null
        : await audit(
            client,
            'USER_CREATED',
            m.userId,
            at,
            { service: 'identity_bootstrap' },
            m.requestId,
            {},
          );
      const grantAudit = await audit(
        client,
        'SYSTEM_ADMIN_GRANT_GRANTED',
        m.userId,
        at,
        { service: 'identity_bootstrap' },
        m.requestId,
        { grantId: m.grantId },
      );
      changed(
        await client.query(
          `INSERT INTO zhiban_identity.identity_credential_provisions
        (approval_id,command_id,user_id,expected_user_revision,purpose,environment_ref,approval_ref,operator_ref,approver_ref,request_id,manifest_digest,issued_at,expires_at)
        VALUES($1,$2,$3,$4,'FIRST_PASSWORD',$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            m.provisionApprovalId,
            m.commandId,
            m.userId,
            revision,
            m.environment,
            m.approvalRef,
            m.operatorRef,
            m.approverRef,
            m.requestId,
            m.manifestDigest,
            m.issuedAt.toString(),
            m.expiresAt.toString(),
          ],
        ),
        'INSERT',
      );
      changed(
        await client.query(
          `UPDATE zhiban_identity.identity_platform_bootstrap SET repository_revision=2,
        approval_id=$1,command_id=$2,environment_ref=$3,approval_ref=$4,operator_ref=$5,approver_ref=$6,request_id=$7,manifest_digest=$8,
        target_user_id=$9,user_revision=$10,system_admin_grant_id=$11,issued_at=$12,expires_at=$13,completed_at=$14,created_user=$15,
        user_created_event_id=$16,grant_created_event_id=$17,credential_provision_id=$18 WHERE singleton_key='PLATFORM' AND repository_revision=1`,
          [
            m.approvalId,
            m.commandId,
            m.environment,
            m.approvalRef,
            m.operatorRef,
            m.approverRef,
            m.requestId,
            m.manifestDigest,
            m.userId,
            revision,
            m.grantId,
            m.issuedAt.toString(),
            m.expiresAt.toString(),
            at.toString(),
            existing === null,
            userAudit,
            grantAudit,
            m.provisionApprovalId,
          ],
        ),
        'UPDATE',
      );
      this.live(m, await now(client));
      return Object.freeze({
        userId: userId(m.userId),
        grantId: systemAdminGrantId(m.grantId),
        provisionApprovalId: m.provisionApprovalId,
      });
    });
  }
  async provision(reference: string, password: string) {
    try {
      return await this.provisionChecked(reference, password);
    } catch (error) {
      throw sanitizedCredentialError(error);
    }
  }
  private async provisionChecked(reference: string, password: string) {
    const m = await this.approval(reference);
    if (!(await this.admission.reserve('INITIAL_PROVISION', null, m.userId, m.userId)))
      throw new IdentityPortError('UNAVAILABLE');
    const verifier = await this.hashing.hash(password),
      id = this.ids.nextCredentialId(); // Outside DB locks, never argv/log.
    return run(this.authPool, async (client) => {
      const anchor = oneRow(
        await client.query<{ user_id: string; user_status: string; user_revision: string }>(
          'SELECT * FROM zhiban_identity.identity_auth_user_anchor($1)',
          [m.userId],
        ),
        'SELECT',
      );
      integrity(anchor !== null && anchor.user_id === m.userId && anchor.user_status === 'ACTIVE');
      repositoryRevision(anchor.user_revision);
      await client.query(
        "SELECT pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('zhiban-session-user:' || $1::text,0))",
        [m.userId],
      );
      const p = oneRow(
        await client.query<ProvisionRow>(
          'SELECT * FROM zhiban_identity.identity_credential_provisions WHERE approval_id=$1 FOR UPDATE',
          [m.provisionApprovalId],
        ),
        'SELECT',
      );
      integrity(p !== null);
      provisionRecord(p);
      if (
        p.user_id !== m.userId ||
        p.command_id !== m.commandId ||
        p.purpose !== 'FIRST_PASSWORD' ||
        p.environment_ref !== m.environment ||
        p.approval_ref !== m.approvalRef ||
        p.operator_ref !== m.operatorRef ||
        p.approver_ref !== m.approverRef ||
        p.request_id !== m.requestId ||
        p.manifest_digest !== m.manifestDigest ||
        p.issued_at !== m.issuedAt.toString() ||
        p.expires_at !== m.expiresAt.toString()
      )
        reject();
      expectedRevision(
        repositoryRevision(anchor.user_revision),
        repositoryRevision(p.expected_user_revision),
      );
      const at = await now(client);
      this.live(m, at);
      const slot = oneRow(
        await client.query<SlotRow>(
          `SELECT ${slotColumns} FROM zhiban_identity.credential_slots WHERE user_id=$1 FOR UPDATE`,
          [m.userId],
        ),
        'SELECT',
        true,
      );
      if (p.consumed_at !== null) {
        if (
          !slot ||
          slot.active_credential_id !== p.credential_id ||
          slot.repository_revision !== '1' ||
          slot.security_epoch !== '1' ||
          slot.generation !== '1' ||
          p.credential_event_id === null
        )
          reject();
        const rows = await client.query<CredentialRow>(
          `SELECT ${credentialColumns} FROM zhiban_identity.credentials WHERE user_id=$1 ORDER BY generation`,
          [m.userId],
        );
        integrity(rows.command === 'SELECT' && rows.rowCount === rows.rows.length);
        validateAggregate(slot, rows.rows);
        this.live(m, await now(client));
        return Object.freeze({ userId: userId(m.userId), credentialId: p.credential_id });
      }
      if (slot !== null) reject(); // Permanent slot history, not only active pointer.
      changed(
        await client.query(
          "INSERT INTO zhiban_identity.credential_slots(user_id,credential_type,active_credential_id,generation,repository_revision,security_epoch,created_at,updated_at) VALUES($1,'PASSWORD',$2,1,1,1,$3,$3)",
          [m.userId, id, at.toString()],
        ),
        'INSERT',
      );
      changed(
        await client.query(
          "INSERT INTO zhiban_identity.credentials(credential_id,user_id,credential_type,generation,status,slot_revision,verifier_material,created_at,updated_at) VALUES($1,$2,'PASSWORD',1,'ACTIVE',1,$3,$4,$4)",
          [id, m.userId, verifierMaterial(verifier), at.toString()],
        ),
        'INSERT',
      );
      const event = await audit(
        client,
        'CREDENTIAL_CREATED',
        m.userId,
        at,
        { service: 'identity_provision' },
        m.requestId,
        {
          credentialId: id,
          repositoryRevisionAfter: '1',
          securityEpochAfter: '1',
        },
      );
      changed(
        await client.query(
          'UPDATE zhiban_identity.identity_credential_provisions SET consumed_at=$1,credential_id=$2,credential_event_id=$3 WHERE approval_id=$4 AND consumed_at IS NULL',
          [at.toString(), id, event, m.provisionApprovalId],
        ),
        'UPDATE',
      );
      this.live(m, await now(client));
      return Object.freeze({ userId: userId(m.userId), credentialId: id });
    });
  }
}
