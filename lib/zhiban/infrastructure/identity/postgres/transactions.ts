import type { PoolClient } from 'pg';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import {
  requireTenantContext,
  type TenantContext,
} from '@/lib/zhiban/application/identity/ports/tenant-context';

/** Structural subset compatible with pg.Pool; never use pool.query in a transaction. */
export interface TransactionPool {
  connect(): Promise<Pick<PoolClient, 'query' | 'release'>>;
}
type TransactionClient = Pick<PoolClient, 'query' | 'release'>;
/** The two isolation modes frozen by 4A, not caller-supplied SQL. */
export type TransactionMode = 'READ_COMMITTED' | 'REPEATABLE_READ_READ_ONLY';

function classify(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return error;
  let code: unknown;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    code = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return error;
  }
  return code === '40001' || code === '40P01'
    ? new IdentityPortError('RETRYABLE_PERSISTENCE_FAILURE')
    : error;
}

async function transaction<T>(
  pool: TransactionPool,
  work: (client: TransactionClient) => Promise<T>,
  tenant: string | null,
  mode: TransactionMode,
): Promise<T> {
  if (mode !== 'READ_COMMITTED' && mode !== 'REPEATABLE_READ_READ_ONLY')
    throw new IdentityPortError('INTEGRITY_FAILURE');
  let client: TransactionClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw classify(error);
  }
  let primary: unknown;
  let failed = false;
  let destroy = false;
  let begun = false;
  let committing = false;
  let result!: T;
  try {
    await client.query(
      mode === 'READ_COMMITTED'
        ? 'BEGIN ISOLATION LEVEL READ COMMITTED'
        : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    begun = true;
    if (tenant !== null)
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenant]);
    result = await work(client);
    committing = true;
    const committed = await client.query('COMMIT');
    // PostgreSQL resolves COMMIT with a ROLLBACK tag when the transaction was
    // already aborted (e.g. the callback caught a statement error). No write
    // committed in that case, so never return the callback's success value.
    if (committed.command !== 'COMMIT') throw new IdentityPortError('INTEGRITY_FAILURE');
  } catch (error) {
    failed = true;
    primary = classify(error);
    // BEGIN/COMMIT failure can leave connection/commit status uncertain: discard it.
    destroy = !begun || committing;
    try {
      await client.query('ROLLBACK');
    } catch {
      destroy = true;
    }
  } finally {
    try {
      client.release(destroy);
    } catch (error) {
      if (!failed) {
        failed = true;
        primary = classify(error);
      }
    }
  }
  if (failed) throw primary;
  return result;
}

/** Supply a restricted CONTROL_RUNTIME pool; this function neither sets nor elevates roles. */
export function controlTransaction<T>(
  pool: TransactionPool,
  work: (client: TransactionClient) => Promise<T>,
  mode: TransactionMode = 'READ_COMMITTED',
): Promise<T> {
  return transaction(pool, work, null, mode);
}

/** Supply a restricted TENANT_RUNTIME pool. Context scopes persistence, not authorization. */
export function tenantTransaction<T>(
  pool: TransactionPool,
  context: TenantContext,
  work: (client: TransactionClient) => Promise<T>,
  mode: TransactionMode = 'READ_COMMITTED',
): Promise<T> {
  const tenant = requireTenantContext(context);
  return transaction(pool, work, tenant, mode);
}
