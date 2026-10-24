import { ASSET_PG_MIGRATIONS } from '@openmaic/storage/asset/pg';
import { DOCUMENT_PG_MIGRATIONS } from '@openmaic/storage/document/pg';
import {
  schemaMigrationChecksum,
  type MigrationQueryable,
  type SchemaMigrationSet,
} from '@openmaic/storage/pg-migrations';

export const documentSchemaSets = [ASSET_PG_MIGRATIONS, DOCUMENT_PG_MIGRATIONS] as const;
export async function expectedSchemaState(
  sets: readonly SchemaMigrationSet[] = documentSchemaSets,
) {
  const rows = await Promise.all(
    sets.flatMap((set) =>
      set.migrations.map(async (migration) => ({
        store: set.store,
        version: migration.version,
        name: migration.name,
        checksum: await schemaMigrationChecksum(migration),
      })),
    ),
  );
  return rows.sort((a, b) => a.store.localeCompare(b.store) || a.version - b.version);
}
// Read-only and strict in every NODE_ENV: receipt acceptance may not downgrade
// checksum errors to production warnings or accept an absent/incomplete ledger.
export async function verifyNativeSchemaState(
  queryable: MigrationQueryable,
  sets: readonly SchemaMigrationSet[] = documentSchemaSets,
) {
  const rows = (
    await queryable.query(
      'SELECT store,version,name,checksum FROM public.openmaic_schema_migrations ORDER BY store,version',
    )
  ).rows;
  if (JSON.stringify(rows) !== JSON.stringify(await expectedSchemaState(sets)))
    throw Error('Native schema ledger rejected');
}
