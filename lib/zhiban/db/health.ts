import { ZHIBAN_MIGRATIONS } from './migrations';
import type { ZhibanQueryable } from './types';

interface RegistryRow extends Record<string, unknown> {
  migration_table: string | null;
}

interface AppliedRow extends Record<string, unknown> {
  version: string;
  checksum: string;
}

export type ZhibanDatabaseHealthStatus = 'healthy' | 'migration_required' | 'unhealthy';

export interface ZhibanDatabaseHealth {
  status: ZhibanDatabaseHealthStatus;
  database: 'reachable' | 'unreachable';
  schema: 'ready' | 'missing' | 'drifted' | 'unknown';
  expectedVersions: string[];
  appliedVersions: string[];
  pendingVersions: string[];
  driftedVersions: string[];
  latencyMs: number;
}

export async function checkZhibanDatabaseHealth(
  queryable: ZhibanQueryable,
): Promise<ZhibanDatabaseHealth> {
  const startedAt = performance.now();
  const expectedVersions = ZHIBAN_MIGRATIONS.map((migration) => migration.version);

  try {
    await queryable.query('SELECT 1 AS ok');
    const registry = await queryable.query<RegistryRow>(
      `SELECT to_regclass('zhiban.schema_migrations')::text AS migration_table`,
    );
    if (!registry.rows[0]?.migration_table) {
      return {
        status: 'migration_required',
        database: 'reachable',
        schema: 'missing',
        expectedVersions,
        appliedVersions: [],
        pendingVersions: expectedVersions,
        driftedVersions: [],
        latencyMs: Math.round(performance.now() - startedAt),
      };
    }

    const appliedResult = await queryable.query<AppliedRow>(
      'SELECT version, checksum FROM zhiban.schema_migrations ORDER BY version',
    );
    const applied = new Map(appliedResult.rows.map((row) => [row.version, row.checksum]));
    const pendingVersions = ZHIBAN_MIGRATIONS.filter(
      (migration) => !applied.has(migration.version),
    ).map((migration) => migration.version);
    const driftedVersions = ZHIBAN_MIGRATIONS.filter(
      (migration) =>
        applied.has(migration.version) && applied.get(migration.version) !== migration.checksum,
    ).map((migration) => migration.version);
    const status =
      driftedVersions.length > 0
        ? 'unhealthy'
        : pendingVersions.length > 0
          ? 'migration_required'
          : 'healthy';

    return {
      status,
      database: 'reachable',
      schema: driftedVersions.length > 0 ? 'drifted' : 'ready',
      expectedVersions,
      appliedVersions: [...applied.keys()],
      pendingVersions,
      driftedVersions,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    return {
      status: 'unhealthy',
      database: 'unreachable',
      schema: 'unknown',
      expectedVersions,
      appliedVersions: [],
      pendingVersions: expectedVersions,
      driftedVersions: [],
      latencyMs: Math.round(performance.now() - startedAt),
    };
  }
}
