import type { PoolClient } from 'pg';
import { instant } from '@/lib/zhiban/domain/identity';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { controlTransaction, type TransactionPool } from '../postgres/transactions';
import { integrity, oneRow } from '../postgres/repositories/repository-support';
import { sanitizedCredentialError } from '../credentials/credential-errors';

export type Client = Pick<PoolClient, 'query' | 'release'>;
/** Internal only; never exported by Application/Domain barrels. */
export async function run<T>(
  pool: TransactionPool,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  try {
    return await controlTransaction(pool, work);
  } catch (error) {
    throw sanitizedCredentialError(error);
  }
}
export async function now(client: Client) {
  const row = oneRow(
    await client.query<{ at: string }>(
      'SELECT floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint AS at',
    ),
    'SELECT',
  );
  integrity(row !== null && typeof row.at === 'string' && /^(0|[1-9][0-9]*)$/.test(row.at));
  return instant(Number(BigInt(row.at)));
}
export function ref(value: unknown): asserts value is string {
  integrity(
    typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9._:-]+$(?![\s\S])/.test(value),
  );
}
export function changed(
  result: { command: string; rowCount: number | null; rows: unknown[] },
  command: string,
) {
  integrity(result.command === command && result.rowCount === 1 && result.rows.length === 0);
}
/** Explicit nextval + OVERRIDING SYSTEM VALUE: no audit SELECT/RETURNING capability. */
export async function audit(
  client: Client,
  type:
    | 'USER_CREATED'
    | 'SYSTEM_ADMIN_GRANT_GRANTED'
    | 'CREDENTIAL_CREATED'
    | 'CREDENTIAL_REPLACED'
    | 'SESSION_REVOKED'
    | 'AUTHENTICATION_REJECTED',
  subject: string | null,
  at: number,
  actor:
    | { user: string }
    | { service: 'identity_bootstrap' | 'identity_provision' }
    | { system: true },
  requestId: string,
  payload: Readonly<Record<string, string | null>>,
) {
  ref(requestId);
  const row = oneRow(
    await client.query<{ id: string }>(
      "SELECT nextval('zhiban_identity.audit_events_event_id_seq'::regclass)::text AS id",
    ),
    'SELECT',
  );
  integrity(row !== null);
  const id = repositoryRevision(row.id);
  const service = 'service' in actor,
    system = 'system' in actor;
  changed(
    await client.query(
      `INSERT INTO zhiban_identity.audit_events
      (event_id,event_shape_version,event_type,event_scope,occurred_at,actor_type,actor_user_id,actor_service_code,
       request_id,reason,subject_user_id,event_payload) OVERRIDING SYSTEM VALUE
     VALUES($1,1,$2,'GLOBAL',$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
      [
        id,
        type,
        at.toString(),
        service ? 'SERVICE' : system ? 'SYSTEM' : 'USER',
        'user' in actor ? actor.user : null,
        service ? actor.service : null,
        requestId,
        service
          ? 'ADMIN_REQUEST'
          : type === 'AUTHENTICATION_REJECTED'
            ? 'CREDENTIAL_REJECTED'
            : 'USER_REQUEST',
        subject,
        JSON.stringify(payload),
      ],
    ),
    'INSERT',
  );
  return id;
}
export function reject(): never {
  throw new IdentityPortError('CONFLICT');
}
