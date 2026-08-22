import type { ZhibanDatabaseClient, ZhibanDatabasePool } from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function serializeClient(client: ZhibanDatabaseClient) {
  let queue: Promise<void> = Promise.resolve();
  let queryError: unknown;

  const serializedClient: ZhibanDatabaseClient = {
    query<TRow extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ) {
      const pending = queue.then(async () => {
        if (queryError !== undefined) throw queryError;
        try {
          return await client.query<TRow>(text, values);
        } catch (error) {
          queryError = error;
          throw error;
        }
      });

      // Keep the queue usable for draining even when a query rejects. Subsequent
      // queued calls observe queryError and do not issue more SQL in the failed
      // transaction.
      queue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
  };

  return {
    client: serializedClient,
    async drain() {
      await queue;
      if (queryError !== undefined) throw queryError;
    },
  };
}

export async function withZhibanTenant<T>(
  pool: ZhibanDatabasePool,
  tenantId: string,
  operation: (client: ZhibanDatabaseClient) => Promise<T>,
): Promise<T> {
  if (!UUID_PATTERN.test(tenantId)) throw new Error('tenantId must be a valid UUID');

  const client = await pool.connect();
  const serialized = serializeClient(client);
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('zhiban.tenant_id', $1, true)", [tenantId]);
    const result = await operation(serialized.client);
    await serialized.drain();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await serialized.drain().catch(() => undefined);
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release?.();
  }
}
