import { controlTransaction } from '../identity/postgres/transactions';
import { observeOperation } from '../identity/composition/refusals';
/** Ordinary recipient setup. No FIRST_PASSWORD/bootstrap/recovery-table mutation. */
import type { Pool } from 'pg';
import { IdentityIds } from '../identity/composition/ids';
import { audit, now } from '../identity/composition/support';
import { verifierMaterial } from '../identity/credentials/verifier-material';
import { validSecret } from '../identity/credentials/argon2-password-hasher';
import type { PasswordHashingPort } from '../../application/identity/ports/password-hashing';
import { AcademicError, requireAcademic } from '../../domain/academic/model';
import { ticketParts } from '../../domain/onboarding/model';
import {
  validateAggregate,
  credentialColumns,
  slotColumns,
} from '../identity/postgres/repositories/credential-records';
export interface SetupContext {
  claimId: string;
  requestId: string;
  tenantId: string;
  userId: string;
  name: string;
  state: 'READY' | 'CLAIMED';
  revision: string;
  expiresAt: number;
  at: number;
}
export class OrdinaryCredentials {
  private readonly ids = new IdentityIds();
  constructor(
    private readonly auth: Pool,
    private readonly hashing: PasswordHashingPort,
    private readonly enabled = false,
  ) {}
  private async transaction<T>(work: Parameters<typeof controlTransaction<T>>[1]): Promise<T> {
    try {
      return await controlTransaction(this.auth, work);
    } catch (error) {
      if (error instanceof AcademicError) throw error;
      const code = (error as { code?: string }).code;
      throw new AcademicError(
        code === '42501'
          ? 'FORBIDDEN'
          : ['23505', '40001', '40P01', 'CONFLICT', 'RETRYABLE_PERSISTENCE_FAILURE'].includes(
                code ?? '',
              )
            ? 'CONFLICT'
            : 'UNAVAILABLE',
      );
    }
  }
  async inspect(ticket: string): Promise<SetupContext> {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    const p = ticketParts(ticket);
    return this.transaction(
      async (c) =>
        (
          await c.query('SELECT zhiban_onboarding.lock_claim($1,$2,NULL) AS context', [
            p.id,
            p.digest,
          ])
        ).rows[0].context,
    );
  }
  async set(ticket: string, revision: string, password: string) {
    requireAcademic(this.enabled, 'UNAVAILABLE');
    const p = ticketParts(ticket);
    requireAcademic(/^[1-9][0-9]{0,14}$/.test(revision) && validSecret(password, true));
    const before = await this.inspect(ticket);
    requireAcademic(before.state === 'READY' && before.revision === revision, 'CONFLICT');
    // Screening/KDF is outside database locks. Never record or fingerprint a submitted password.
    const hashed = await observeOperation(() => this.hashing.hash(password));
    requireAcademic(hashed.ok || hashed.refusal !== 'PASSWORD_POLICY_REJECTED');
    requireAcademic(hashed.ok, 'UNAVAILABLE');
    const verifier = hashed.value,
      credential = this.ids.nextCredentialId(),
      requestId = this.ids.nextCommandId();
    return this.transaction(async (c) => {
      const context = (
        await c.query('SELECT zhiban_onboarding.lock_claim($1,$2,$3) AS context', [
          p.id,
          p.digest,
          revision,
        ])
      ).rows[0].context as SetupContext;
      requireAcademic(context.state === 'READY', 'CONFLICT');
      const old = await c.query(
        `SELECT ${slotColumns} FROM zhiban_identity.credential_slots WHERE user_id=$1 FOR UPDATE`,
        [context.userId],
      );
      requireAcademic(old.rows.length === 0, 'CONFLICT');
      const at = await now(c);
      requireAcademic(at < context.expiresAt, 'FORBIDDEN');
      await c.query(
        "INSERT INTO zhiban_identity.credential_slots(user_id,credential_type,active_credential_id,generation,repository_revision,security_epoch,created_at,updated_at) VALUES($1,'PASSWORD',$2,1,1,1,$3,$3)",
        [context.userId, credential, at.toString()],
      );
      await c.query(
        "INSERT INTO zhiban_identity.credentials(credential_id,user_id,credential_type,generation,status,slot_revision,verifier_material,created_at,updated_at) VALUES($1,$2,'PASSWORD',1,'ACTIVE',1,$3,$4,$4)",
        [credential, context.userId, verifierMaterial(verifier), at.toString()],
      );
      const event = await audit(
        c,
        'CREDENTIAL_CREATED',
        context.userId,
        at,
        { service: 'identity_provision' },
        requestId,
        { credentialId: credential, repositoryRevisionAfter: '1', securityEpochAfter: '1' },
      );
      const slot = (
          await c.query(
            `SELECT ${slotColumns} FROM zhiban_identity.credential_slots WHERE user_id=$1`,
            [context.userId],
          )
        ).rows[0],
        history = (
          await c.query(
            `SELECT ${credentialColumns} FROM zhiban_identity.credentials WHERE user_id=$1 ORDER BY generation`,
            [context.userId],
          )
        ).rows;
      validateAggregate(slot, history);
      await c.query('SELECT zhiban_onboarding.complete_claim($1,$2,$3,$4,$5)', [
        p.id,
        p.digest,
        revision,
        credential,
        event,
      ]);
      return { userId: context.userId, state: 'CLAIMED' as const };
    });
  }
}
