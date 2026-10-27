import { readProfileReference, referenceScope } from './pg-version';
/** Readiness only. A web host never installs or derives its own trusted expected catalog. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { catalogFingerprint } from '../../lib/zhiban/infrastructure/openmaic/catalog';
export const pblMigration = 'lib/zhiban/infrastructure/pbl/postgres/migrations/0001_pbl.sql';
export const pblMigrations = [pblMigration];
export const pblReference = 'docs/v2/evidence/zhiban-pbl-profile-reference-local.json';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export async function pblProfile(client: PoolClient) {
  // The catalog collector is SQL-generic; its public union names only Native/Bridge profiles.
  await client.query('SET LOCAL search_path TO pg_catalog');
  const catalog = await catalogFingerprint(client, 'zhiban_pbl' as 'public');
  const facts = (
    await client.query(`SELECT jsonb_build_object(
    'schema',(SELECT jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',nspacl::text) FROM pg_namespace WHERE nspname='zhiban_pbl'),
    'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner)) ORDER BY p.proname),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='zhiban_pbl'),
    'role',(SELECT jsonb_build_object('login',rolcanlogin,'super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'bypass',rolbypassrls,'replication',rolreplication) FROM pg_roles WHERE rolname='zhiban_academic_runtime'),
    'bridgeRole',(SELECT jsonb_build_object('login',rolcanlogin,'super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'bypass',rolbypassrls,'replication',rolreplication) FROM pg_roles WHERE rolname='zhiban_bridge_runtime'),
    'bridgeEdges',(SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='zhiban_bridge_runtime')),
    'edges',(SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='zhiban_academic_runtime')),
    'helperExecute',jsonb_build_object('bridge',has_function_privilege('zhiban_bridge_runtime','zhiban_pbl.lock_participants(uuid,uuid[])','EXECUTE'),'runtime',has_function_privilege('zhiban_academic_runtime','zhiban_pbl.lock_participants(uuid,uuid[])','EXECUTE'),'public',(SELECT proacl::text FROM pg_proc WHERE oid='zhiban_pbl.lock_participants(uuid,uuid[])'::regprocedure)),
    'schemaPrivileges',jsonb_build_object('usage',has_schema_privilege('zhiban_academic_runtime','zhiban_pbl','USAGE'),'create',has_schema_privilege('zhiban_academic_runtime','zhiban_pbl','CREATE'))
  ) AS facts`)
  ).rows[0].facts;
  return hash(JSON.stringify({ catalog, facts }));
}
export async function loadPbl(pool: Pool): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if (
      !(await client.query("SELECT to_regclass('zhiban_pbl.schema_migrations') AS name")).rows[0]
        .name
    )
      return false;
    const reference = await readProfileReference(pblReference);
    const hashes = await Promise.all(pblMigrations.map(async (p) => hash(await readFile(p))));
    const sourceHash = hashes[0];
    if (
      reference.evidenceOrigin !== 'LOCAL' ||
      reference.githubActions !== false ||
      reference.scope !== referenceScope('FRESH_OWNED_PG16_PBL_REFERENCE') ||
      reference.migrationSha256 !== sourceHash ||
      JSON.stringify(reference.migrationHashes) !== JSON.stringify(hashes) ||
      !/^[a-f0-9]{64}$/.test(reference.profileSha256)
    )
      throw Error('Pbl expected profile/source rejected');
    const ledger = (await client.query('SELECT version,checksum FROM zhiban_pbl.schema_migrations'))
      .rows;
    if (
      ledger.length !== hashes.length ||
      hashes.some(
        (h, i) =>
          !ledger.some((r) => r.version === String(i + 1).padStart(4, '0') && r.checksum === h),
      ) ||
      (await pblProfile(client)) !== reference.profileSha256
    )
      throw Error('Pbl live ledger/catalog/ACL rejected');
    return true;
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
