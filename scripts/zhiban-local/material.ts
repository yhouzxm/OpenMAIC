/** Readiness only. A web host never installs or derives its own trusted expected catalog. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { catalogFingerprint } from '../../lib/zhiban/infrastructure/openmaic/catalog';
export const materialMigration =
  'lib/zhiban/infrastructure/material/postgres/migrations/0001_material.sql';
export const materialMigrations = [
  materialMigration,
  materialMigration.replace('0001_material.sql', '0002_resource_formats.sql'),
];
export const materialReference = 'docs/v2/evidence/zhiban-material-reference-local.json';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export async function materialCatalog(client: PoolClient) {
  // The catalog collector is SQL-generic; its public union names only Native/Bridge profiles.
  await client.query('SET LOCAL search_path TO pg_catalog');
  const catalog = await catalogFingerprint(client, 'zhiban_material' as 'public');
  const facts = (
    await client.query(`SELECT jsonb_build_object(
    'schema',(SELECT jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',nspacl::text) FROM pg_namespace WHERE nspname='zhiban_material'),
    'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner)) ORDER BY p.proname),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='zhiban_material'),
    'role',(SELECT jsonb_build_object('super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'bypass',rolbypassrls,'replication',rolreplication) FROM pg_roles WHERE rolname='zhiban_academic_runtime'),
    'edges',(SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='zhiban_academic_runtime')),
    'schemaPrivileges',jsonb_build_object('usage',has_schema_privilege('zhiban_academic_runtime','zhiban_material','USAGE'),'create',has_schema_privilege('zhiban_academic_runtime','zhiban_material','CREATE'))
  ) AS facts`)
  ).rows[0].facts;
  return hash(JSON.stringify({ catalog, facts }));
}
export async function loadMaterial(pool: Pool): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if (
      !(await client.query("SELECT to_regclass('zhiban_material.schema_migrations') AS name"))
        .rows[0].name
    )
      return false;
    const reference = JSON.parse(await readFile(materialReference, 'utf8'));
    const sourceHash = hash(await readFile(materialMigration));
    if (
      reference.evidenceOrigin !== 'LOCAL' ||
      reference.githubActions !== false ||
      reference.scope !== 'FRESH_OWNED_PG16_MATERIAL_REFERENCE' ||
      reference.migrationSha256 !== sourceHash ||
      !/^[a-f0-9]{64}$/.test(reference.profileSha256)
    )
      throw Error('Material expected profile/source rejected');
    const ledger = (
      await client.query('SELECT version,checksum FROM zhiban_material.schema_migrations')
    ).rows;
    if (
      ledger.length !== materialMigrations.length ||
      (await materialCatalog(client)) !== reference.profileSha256
    )
      throw Error('Material live ledger/catalog/ACL rejected');
    for (const [i, file] of materialMigrations.entries()) {
      const checksum = hash(await readFile(file));
      const row = ledger.find((r) => r.version === String(i + 1).padStart(4, '0'));
      if (!row || row.checksum !== checksum || reference.sourceHashes[file] !== checksum)
        throw Error('Material migration source rejected');
    }
    return true;
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
