import type { ZhibanDatabaseClient, ZhibanDatabasePool } from './types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function withZhibanTenant<T>(
  pool: ZhibanDatabasePool,
  tenantId: string,
  operation: (client: ZhibanDatabaseClient) => Promise<T>,
): Promise<T> {
  if (!UUID_PATTERN.test(tenantId)) throw new Error('tenantId must be a valid UUID');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('zhiban.tenant_id', $1, true)", [tenantId]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release?.();
  }
}
