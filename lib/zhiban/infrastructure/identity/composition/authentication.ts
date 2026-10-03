import { instant, membershipId, tenantId, userId } from '@/lib/zhiban/domain/identity';
import type {
  AuthenticatedRequestHandle,
  OwnAuthenticationPort,
  OwnIdentity,
  OwnSpace,
} from '@/lib/zhiban/application/identity/use-cases/authentication';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { securityEpoch } from '@/lib/zhiban/application/identity/ports/credential-repository';
import type { PasswordHashingPort } from '@/lib/zhiban/application/identity/ports/password-hashing';
import { SessionAuthenticator } from '../sessions/session-authenticator';
import { SessionCsrfPolicy } from '../sessions/browser-security';
import { digestBearer, bearerForCookie, type SessionBearer } from '../sessions/session-material';
import { PostgresCredentialRepository } from '../postgres/repositories/credential';
import { PostgresSessionRepository } from '../postgres/repositories/session';
import {
  sessionColumns,
  sessionFromRow,
  type SessionRow,
} from '../postgres/repositories/session-records';
import {
  slotColumns,
  credentialColumns,
  validateAggregate,
  type SlotRow,
  type CredentialRow,
} from '../postgres/repositories/credential-records';
import {
  integrity,
  oneRow,
  expectedRevision,
  nextRevision,
} from '../postgres/repositories/repository-support';
import type { TransactionPool } from '../postgres/transactions';
import { verifierMaterial } from '../credentials/verifier-material';
import { sanitizedCredentialError } from '../credentials/credential-errors';
import { canonicalLoginIdentifier } from './identifier';
import { IdentityIds } from './ids';
import { SharedAdmission, type TransportFacts } from './admission';
import { audit, changed, now, ref, run, reject, type Client } from './support';

interface Binding {
  readonly digest: string;
  readonly user: string;
  readonly session: string;
}
const rejected = Object.freeze({ status: 'REJECTED' as const });
/** No public HTTP routes. Password/cookie inputs exist only for this call; never retained. */
export class IdentityAuthentication implements OwnAuthenticationPort {
  #handles = new WeakMap<AuthenticatedRequestHandle, Binding>();
  private constructor(
    private readonly pool: TransactionPool,
    private readonly sessions: PostgresSessionRepository,
    private readonly credentials: PostgresCredentialRepository,
    private readonly hashing: PasswordHashingPort,
    private readonly authenticator: SessionAuthenticator,
    private readonly admission: SharedAdmission,
    private readonly csrf: SessionCsrfPolicy,
    private readonly ids: IdentityIds,
  ) {}
  static async create(
    pool: TransactionPool,
    sessions: PostgresSessionRepository,
    credentials: PostgresCredentialRepository,
    hashing: PasswordHashingPort,
    admission: SharedAdmission,
    csrf: SessionCsrfPolicy,
    ids: IdentityIds,
  ) {
    return new IdentityAuthentication(
      pool,
      sessions,
      credentials,
      hashing,
      await SessionAuthenticator.create(credentials, sessions, hashing),
      admission,
      csrf,
      ids,
    );
  }
  async login(
    identifier: unknown,
    secret: string,
    transport: TransportFacts,
    requestId: string,
    oldCookie?: unknown,
  ): Promise<
    | { readonly status: 'ISSUED'; readonly bearer: SessionBearer; readonly identity: OwnIdentity }
    | typeof rejected
  > {
    ref(requestId);
    const locator = canonicalLoginIdentifier(identifier);
    // Invalid bounded input shares the verifier's genuine invalid-locator dummy path.
    if (!(await this.admission.reserve('LOGIN', transport, locator ?? 'invalid')))
      throw new IdentityPortError('UNAVAILABLE');
    let issued: Awaited<ReturnType<SessionAuthenticator['issue']>>;
    try {
      issued = await this.authenticator.issue(
        { identifier: locator ?? '', secret },
        instant(Date.now()),
      );
    } catch {
      issued = null;
    } // No account-specific provider/row/crypto error reaches public boundary.
    if (!issued) {
      await run(this.pool, async (client) =>
        audit(
          client,
          'AUTHENTICATION_REJECTED',
          null,
          await now(client),
          { system: true },
          requestId,
          {},
        ),
      );
      return rejected;
    }
    // Never reveal a new bearer if explicit replacement of an old cookie cannot complete.
    if (oldCookie !== undefined) {
      const old = await this.authenticate(oldCookie);
      if (old) await this.logout(old, requestId);
    }
    const live = await this.authenticate(bearerForCookie(issued.bearer));
    if (!live) return rejected;
    const identity = await this.me(live);
    return Object.freeze({ status: 'ISSUED', bearer: issued.bearer, identity });
  }
  private binding(handle: AuthenticatedRequestHandle) {
    const binding = this.#handles.get(handle);
    integrity(binding !== undefined);
    return binding;
  }
  private async hint(client: Client, digest: string) {
    const row = oneRow(
      await client.query<SessionRow>(
        `SELECT ${sessionColumns} FROM zhiban_identity.sessions WHERE token_digest=$1`,
        [digest],
      ),
      'SELECT',
      true,
    );
    return row === null ? null : sessionFromRow(row);
  }
  private async anchor(client: Client, user: string) {
    const row = oneRow(
      await client.query<{ user_id: string; user_status: string; user_revision: string }>(
        'SELECT * FROM zhiban_identity.identity_auth_user_anchor($1)',
        [user],
      ),
      'SELECT',
    );
    integrity(
      row !== null &&
        Object.keys(row).length === 3 &&
        row.user_id === user &&
        row.user_status === 'ACTIVE',
    );
    return repositoryRevision(row.user_revision);
  }
  private async locked(
    client: Client,
    binding: Binding,
    mode: 'SHARE' | 'UPDATE',
    exclusive = false,
  ) {
    const userRevision = await this.anchor(client, binding.user);
    await client.query(
      `SELECT pg_catalog.pg_advisory_xact_lock${exclusive ? '' : '_shared'}(pg_catalog.hashtextextended('zhiban-session-user:' || $1::text,0))`,
      [binding.user],
    );
    const slot = oneRow(
      await client.query<SlotRow>(
        `SELECT ${slotColumns} FROM zhiban_identity.credential_slots WHERE user_id=$1 FOR ${mode}`,
        [binding.user],
      ),
      'SELECT',
      true,
    );
    if (!slot) reject();
    const history = await client.query<CredentialRow>(
      `SELECT ${credentialColumns} FROM zhiban_identity.credentials WHERE user_id=$1 ORDER BY generation`,
      [binding.user],
    );
    integrity(history.command === 'SELECT' && history.rowCount === history.rows.length);
    validateAggregate(slot, history.rows);
    const row = oneRow(
      await client.query<SessionRow>(
        `SELECT ${sessionColumns} FROM zhiban_identity.sessions WHERE token_digest=$1 FOR ${mode}`,
        [binding.digest],
      ),
      'SELECT',
      true,
    );
    if (!row) reject();
    const session = sessionFromRow(row),
      at = await now(client);
    if (
      session.value.id !== binding.session ||
      session.value.userId !== binding.user ||
      session.value.tokenDigest !== binding.digest ||
      session.value.revokedAt !== null ||
      session.value.userRevision !== userRevision ||
      session.value.securityEpoch !== slot.security_epoch ||
      slot.active_credential_id === null ||
      at < session.value.lastSeenAt ||
      at >= session.value.idleExpiresAt ||
      at >= session.value.absoluteExpiresAt
    )
      reject();
    return { session, slot, at, userRevision };
  }
  private async finalTime(
    client: Client,
    state: Awaited<ReturnType<IdentityAuthentication['locked']>>,
  ) {
    const at = await now(client);
    if (
      at < state.at ||
      at >= state.session.value.idleExpiresAt ||
      at >= state.session.value.absoluteExpiresAt
    )
      reject();
  }
  async authenticate(raw: unknown): Promise<AuthenticatedRequestHandle | null> {
    const digest = digestBearer(raw);
    if (!digest) return null;
    return run(this.pool, async (client) => {
      const hint = await this.hint(client, digest);
      if (!hint) return null;
      const binding = { digest, user: hint.value.userId, session: hint.value.id };
      // Invalid/revoked sessions reject. Driver/outage failure is NOT converted to success.
      const state = await this.locked(client, binding, 'UPDATE');
      expectedRevision(state.session.revision, hint.revision);
      const idle = instant(
        Math.min(state.at + this.sessions.policy.idleMs, state.session.value.absoluteExpiresAt),
      );
      if (
        state.at !== state.session.value.lastSeenAt ||
        idle !== state.session.value.idleExpiresAt
      ) {
        nextRevision(state.session.revision);
        changed(
          await client.query(
            'UPDATE zhiban_identity.sessions SET last_seen_at=$1,idle_expires_at=$2,repository_revision=repository_revision+1 WHERE session_id=$3 AND repository_revision=$4 AND revoked_at IS NULL',
            [
              state.at.toString(),
              Math.max(idle, state.session.value.idleExpiresAt).toString(),
              binding.session,
              state.session.revision,
            ],
          ),
          'UPDATE',
        );
      }
      await this.finalTime(client, state);
      const handle = Object.freeze({ kind: 'AUTHENTICATED_REQUEST' as const });
      this.#handles.set(handle, Object.freeze(binding));
      return handle;
    });
  }
  async me(handle: AuthenticatedRequestHandle) {
    const binding = this.binding(handle);
    return run(this.pool, async (client) => {
      const state = await this.locked(client, binding, 'SHARE');
      await this.finalTime(client, state);
      return Object.freeze({
        userId: userId(binding.user),
        absoluteExpiresAt: state.session.value.absoluteExpiresAt,
        idleExpiresAt: state.session.value.idleExpiresAt,
      });
    });
  }
  csrfToken(handle: AuthenticatedRequestHandle) {
    return run(this.pool, async (client) => {
      const state = await this.locked(client, this.binding(handle), 'SHARE');
      await this.finalTime(client, state);
      return this.csrf.token(state.session.value.id);
    });
  }
  async assertUnsafe(handle: AuthenticatedRequestHandle, origin: unknown, csrf: unknown) {
    // This is a protocol-neutral adapter contract, not authorization of a later write.
    const binding = this.binding(handle);
    if (!this.csrf.permitsUnsafeRequest(origin, csrf, this.idsSession(binding.session))) reject();
    await this.me(handle);
  }
  private idsSession(value: string) {
    return sessionFromRowId(value);
  }
  async spaces(
    handle: AuthenticatedRequestHandle,
    after: ReturnType<typeof membershipId> | null,
    limit: number,
  ) {
    const binding = this.binding(handle);
    integrity(Number.isInteger(limit) && limit >= 1 && limit <= 50);
    if (after !== null) membershipId(after);
    return run(this.pool, async (client) => {
      const result = await client.query<{
        tenant_id: string;
        tenant_code: string;
        tenant_display_name: string;
        membership_id: string;
      }>('SELECT * FROM zhiban_identity.identity_session_spaces($1,$2,$3)', [
        binding.digest,
        after,
        limit,
      ]);
      integrity(
        result.command === 'SELECT' &&
          result.rowCount === result.rows.length &&
          result.rows.length <= limit,
      );
      return Object.freeze(
        result.rows.map((row) => {
          integrity(
            Object.keys(row).length === 4 &&
              typeof row.tenant_code === 'string' &&
              /^[a-z][a-z0-9_-]{0,63}$(?![\s\S])/.test(row.tenant_code) &&
              typeof row.tenant_display_name === 'string' &&
              row.tenant_display_name.trim().length > 0,
          );
          return Object.freeze({
            tenantId: tenantId(row.tenant_id),
            tenantCode: row.tenant_code,
            displayName: row.tenant_display_name,
            membershipId: membershipId(row.membership_id),
          });
        }),
      ) as readonly OwnSpace[];
    });
  }
  private async revoke(client: Client, row: SessionRow, at: number, requestId: string) {
    const stored = sessionFromRow(row);
    if (stored.value.revokedAt !== null) return;
    integrity(at >= stored.value.lastSeenAt);
    nextRevision(stored.revision);
    changed(
      await client.query(
        'UPDATE zhiban_identity.sessions SET revoked_at=$1,repository_revision=repository_revision+1 WHERE session_id=$2 AND repository_revision=$3 AND revoked_at IS NULL',
        [at.toString(), stored.value.id, stored.revision],
      ),
      'UPDATE',
    );
    await audit(
      client,
      'SESSION_REVOKED',
      stored.value.userId,
      at,
      { user: stored.value.userId },
      requestId,
      { sessionId: stored.value.id },
    );
  }
  async logout(handle: AuthenticatedRequestHandle, requestId: string) {
    ref(requestId);
    const binding = this.binding(handle);
    return run(this.pool, async (client) => {
      // Repeated logout is idempotent, but raw/foreign handle never authorizes revocation.
      const hint = await this.hint(client, binding.digest);
      if (!hint || hint.value.revokedAt !== null) return;
      const state = await this.locked(client, binding, 'UPDATE');
      await this.revoke(
        client,
        {
          session_id: state.session.value.id,
          user_id: binding.user,
          token_digest: binding.digest,
          created_at: state.session.value.createdAt.toString(),
          last_seen_at: state.session.value.lastSeenAt.toString(),
          absolute_expires_at: state.session.value.absoluteExpiresAt.toString(),
          idle_expires_at: state.session.value.idleExpiresAt.toString(),
          revoked_at: null,
          repository_revision: state.session.revision,
          security_epoch: state.session.value.securityEpoch,
          user_revision: state.userRevision,
        },
        state.at,
        requestId,
      );
      await this.finalTime(client, state); // Expected post-state is revoked; do not require old live again.
    });
  }
  async logoutAll(
    handle: AuthenticatedRequestHandle,
    password: string,
    transport: TransportFacts,
    requestId: string,
  ) {
    try {
      await this.logoutAllChecked(handle, password, transport, requestId);
    } catch (error) {
      throw sanitizedCredentialError(error);
    }
  }
  private async logoutAllChecked(
    handle: AuthenticatedRequestHandle,
    password: string,
    transport: TransportFacts,
    requestId: string,
  ) {
    await this.sensitive(
      handle,
      password,
      transport,
      requestId,
      'REAUTHENTICATE',
      async (client, state) => {
        const rows = await client.query<SessionRow>(
          `SELECT ${sessionColumns} FROM zhiban_identity.sessions WHERE user_id=$1 AND revoked_at IS NULL ORDER BY session_id FOR UPDATE`,
          [state.session.value.userId],
        );
        integrity(rows.command === 'SELECT' && rows.rowCount === rows.rows.length);
        for (const row of rows.rows) {
          integrity(row.user_id === state.session.value.userId);
          await this.revoke(client, row, state.at, requestId);
        }
      },
    );
  }
  async changePassword(
    handle: AuthenticatedRequestHandle,
    password: string,
    newPassword: string,
    transport: TransportFacts,
    requestId: string,
    expected: string,
  ) {
    try {
      await this.changePasswordChecked(
        handle,
        password,
        newPassword,
        transport,
        requestId,
        expected,
      );
    } catch (error) {
      throw sanitizedCredentialError(error);
    }
  }
  private async changePasswordChecked(
    handle: AuthenticatedRequestHandle,
    password: string,
    newPassword: string,
    transport: TransportFacts,
    requestId: string,
    expected: string,
  ) {
    ref(requestId);
    repositoryRevision(expected);
    // Admission precedes screening/hash; old-password proof and new KDF remain outside locks.
    const binding = this.binding(handle);
    if (!(await this.admission.reserve('PASSWORD_CHANGE', transport, binding.user, binding.user)))
      throw new IdentityPortError('UNAVAILABLE');
    const snapshot = await this.credentials.verificationSnapshot(userId(binding.user));
    if (!snapshot || (await this.hashing.verify(password, snapshot.verifier)) !== true) reject();
    const proofAt = performance.now(),
      verifier = await this.hashing.hash(newPassword),
      newId = this.ids.nextCredentialId();
    return run(this.pool, async (client) => {
      const state = await this.locked(client, binding, 'UPDATE');
      expectedRevision(
        repositoryRevision(state.slot.repository_revision),
        repositoryRevision(expected),
      );
      if (
        state.slot.repository_revision !== snapshot.revision ||
        state.slot.security_epoch !== snapshot.epoch ||
        state.slot.active_credential_id !== snapshot.credentialId ||
        performance.now() - proofAt >= 300000
      )
        reject();
      const revision = nextRevision(snapshot.revision),
        epoch = nextRevision(repositoryRevision(snapshot.epoch)),
        generation = nextRevision(repositoryRevision(state.slot.generation));
      changed(
        await client.query(
          'UPDATE zhiban_identity.credential_slots SET active_credential_id=$1,generation=$2,repository_revision=repository_revision+1,security_epoch=$3,updated_at=$4 WHERE user_id=$5 AND repository_revision=$6',
          [newId, generation, epoch, state.at.toString(), binding.user, snapshot.revision],
        ),
        'UPDATE',
      );
      changed(
        await client.query(
          "UPDATE zhiban_identity.credentials SET status='REPLACED',verifier_material=NULL,slot_revision=$1,updated_at=$2,replaced_at=$2,replaced_by_credential_id=$3 WHERE user_id=$4 AND credential_id=$5 AND status='ACTIVE'",
          [revision, state.at.toString(), newId, binding.user, snapshot.credentialId],
        ),
        'UPDATE',
      );
      changed(
        await client.query(
          "INSERT INTO zhiban_identity.credentials(credential_id,user_id,credential_type,generation,status,slot_revision,verifier_material,created_at,updated_at) VALUES($1,$2,'PASSWORD',$3,'ACTIVE',$4,$5,$6,$6)",
          [
            newId,
            binding.user,
            generation,
            revision,
            verifierMaterial(verifier),
            state.at.toString(),
          ],
        ),
        'INSERT',
      );
      await audit(
        client,
        'CREDENTIAL_REPLACED',
        binding.user,
        state.at,
        { user: binding.user },
        requestId,
        {
          priorCredentialId: snapshot.credentialId,
          credentialId: newId,
          repositoryRevisionBefore: snapshot.revision,
          repositoryRevisionAfter: revision,
          securityEpochBefore: securityEpoch(snapshot.epoch),
          securityEpochAfter: securityEpoch(epoch),
        },
      );
      const post = oneRow(
        await client.query<SlotRow>(
          `SELECT ${slotColumns} FROM zhiban_identity.credential_slots WHERE user_id=$1`,
          [binding.user],
        ),
        'SELECT',
      );
      const history = await client.query<CredentialRow>(
        `SELECT ${credentialColumns} FROM zhiban_identity.credentials WHERE user_id=$1 ORDER BY generation`,
        [binding.user],
      );
      integrity(
        post !== null &&
          post.active_credential_id === newId &&
          post.repository_revision === revision &&
          post.security_epoch === epoch &&
          post.generation === generation &&
          history.command === 'SELECT' &&
          history.rowCount === history.rows.length,
      );
      validateAggregate(post, history.rows);
      await this.finalTime(client, state);
      if (performance.now() - proofAt >= 300000) reject();
    });
  }
  private async sensitive(
    handle: AuthenticatedRequestHandle,
    password: string,
    transport: TransportFacts,
    requestId: string,
    purpose: 'REAUTHENTICATE',
    work: (
      client: Client,
      state: Awaited<ReturnType<IdentityAuthentication['locked']>>,
    ) => Promise<void>,
  ) {
    ref(requestId);
    const binding = this.binding(handle);
    if (!(await this.admission.reserve(purpose, transport, binding.user, binding.user)))
      throw new IdentityPortError('UNAVAILABLE');
    const before = await this.me(handle);
    const snapshot = await this.credentials.verificationSnapshot(before.userId),
      proofAt = performance.now();
    if (!snapshot || (await this.hashing.verify(password, snapshot.verifier)) !== true) reject();
    await run(this.pool, async (client) => {
      // Exclusive barrier BEFORE any slot/session locks; no shared-to-exclusive upgrade.
      const state = await this.locked(client, binding, 'SHARE', true);
      if (
        state.slot.repository_revision !== snapshot.revision ||
        state.slot.security_epoch !== snapshot.epoch ||
        state.slot.active_credential_id !== snapshot.credentialId ||
        performance.now() - proofAt >= 300000
      )
        reject();
      await work(client, state);
      await this.finalTime(client, state);
      if (performance.now() - proofAt >= 300000) reject();
    });
  }
}
import { sessionId as sessionFromRowId } from '@/lib/zhiban/application/identity/ports/session-repository';
