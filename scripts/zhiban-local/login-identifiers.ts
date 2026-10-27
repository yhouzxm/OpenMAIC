import { readProfileReference, referenceScope } from './pg-version';
import { referenceSourceHash, referenceSourceEntries } from './reference-source';
/** Readiness only. A web host never installs or derives its own trusted expected catalog. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { catalogFingerprint } from '../../lib/zhiban/infrastructure/openmaic/catalog';
export const loginIdentifiersMigration =
  'lib/zhiban/infrastructure/login-identifiers/postgres/migrations/0001_login_identifiers.sql';
export const loginIdentifiersMigrations = [
  loginIdentifiersMigration,
  'lib/zhiban/infrastructure/login-identifiers/postgres/migrations/0002_nomination_status_qualified.sql',
];
export const loginIdentifiersReference =
  'docs/v2/evidence/zhiban-login-identifiers-profile-reference-local.json';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export async function loginIdentifiersProfile(client: PoolClient) {
  // The catalog collector is SQL-generic; its public union names only Native/Bridge profiles.
  await client.query('SET LOCAL search_path TO pg_catalog');
  const catalog = await catalogFingerprint(client, 'zhiban_login_identifiers' as 'public');
  const facts = (
    await client.query(`SELECT jsonb_build_object(
    'schema',(SELECT jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',nspacl::text) FROM pg_namespace WHERE nspname='zhiban_login_identifiers'),
    'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner)) ORDER BY p.proname),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='zhiban_login_identifiers'),
    'participatingRoles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'bypass',rolbypassrls,'createRole',rolcreaterole,'createDb',rolcreatedb,'replication',rolreplication) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('zhiban_academic_runtime','zhiban_auth_runtime','zhiban_control_runtime')),
    'participatingEdges',(SELECT count(*) FROM pg_auth_members WHERE member IN(SELECT oid FROM pg_roles WHERE rolname IN('zhiban_academic_runtime','zhiban_auth_runtime','zhiban_control_runtime'))),
    'role',(SELECT jsonb_build_object('super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'bypass',rolbypassrls,'replication',rolreplication) FROM pg_roles WHERE rolname='zhiban_academic_runtime'),
    'edges',(SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='zhiban_academic_runtime')),
    'schemaPrivileges',jsonb_build_object('usage',has_schema_privilege('zhiban_academic_runtime','zhiban_login_identifiers','USAGE'),'create',has_schema_privilege('zhiban_academic_runtime','zhiban_login_identifiers','CREATE'))
  ) AS facts`)
  ).rows[0].facts;
  return hash(JSON.stringify({ catalog, facts }));
}
export async function loadLoginIdentifiers(pool: Pool): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if (
      !(
        await client.query(
          "SELECT to_regclass('zhiban_login_identifiers.schema_migrations') AS name",
        )
      ).rows[0].name
    )
      return false;
    const reference = await readProfileReference(loginIdentifiersReference);
    const sourceHash = hash(await readFile(loginIdentifiersMigration));
    if (
      reference.evidenceOrigin !== 'LOCAL' ||
      reference.githubActions !== false ||
      reference.scope !== referenceScope('FRESH_OWNED_PG16_LOGIN_IDENTIFIERS_REFERENCE') ||
      reference.migrationSha256 !== sourceHash ||
      !/^[a-f0-9]{64}$/.test(reference.profileSha256)
    )
      throw Error('Login identifier expected profile/source rejected');
    for (const [path, expected] of referenceSourceEntries(
      reference.sourceHashes,
      loginIdentifiersMigration,
    )) {
      if (hash(await readFile(path)) !== expected)
        throw Error('Login identifier dependency source rejected');
    }
    const ledger = (
      await client.query('SELECT version,checksum FROM zhiban_login_identifiers.schema_migrations')
    ).rows;
    const checks = await Promise.all(
      loginIdentifiersMigrations.map(async (path) => ({
        version: path.split('/').at(-1)!.slice(0, 4),
        checksum: hash(await readFile(path)),
        path,
      })),
    );
    if (
      ledger.length !== checks.length ||
      checks.some(
        (expected) =>
          !ledger.some(
            (row) => row.version === expected.version && row.checksum === expected.checksum,
          ) || referenceSourceHash(reference.sourceHashes, expected.path) !== expected.checksum,
      ) ||
      (await loginIdentifiersProfile(client)) !== reference.profileSha256
    )
      throw Error('Login identifier live ledger/catalog/ACL rejected');
    return true;
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
