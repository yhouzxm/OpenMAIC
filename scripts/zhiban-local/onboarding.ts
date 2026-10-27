import { readProfileReference, referenceScope } from './pg-version';
import { referenceSourceHash } from './reference-source';
/** Readiness only. A web host never installs or derives its own trusted expected catalog. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { catalogFingerprint } from '../../lib/zhiban/infrastructure/openmaic/catalog';
export const onboardingMigration =
  'lib/zhiban/infrastructure/onboarding/postgres/migrations/0001_onboarding.sql';
export const onboardingMigrations = [
  onboardingMigration,
  'lib/zhiban/infrastructure/onboarding/postgres/migrations/0002_local_uuid_checks.sql',
];
export const onboardingReference =
  'docs/v2/evidence/zhiban-onboarding-profile-reference-local.json';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export async function onboardingProfile(client: PoolClient) {
  // The catalog collector is SQL-generic; its public union names only Native/Bridge profiles.
  await client.query('SET LOCAL search_path TO pg_catalog');
  const catalog = await catalogFingerprint(client, 'zhiban_onboarding' as 'public');
  const facts = (
    await client.query(`SELECT jsonb_build_object(
    'schema',(SELECT jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',nspacl::text) FROM pg_namespace WHERE nspname='zhiban_onboarding'),
    'functions',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner)) ORDER BY p.proname),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='zhiban_onboarding'),
    'participatingRoles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'bypass',rolbypassrls,'createRole',rolcreaterole,'createDb',rolcreatedb,'replication',rolreplication) ORDER BY rolname) FROM pg_roles WHERE rolname IN ('zhiban_academic_runtime','zhiban_auth_runtime','zhiban_control_runtime')),
    'participatingEdges',(SELECT count(*) FROM pg_auth_members WHERE member IN(SELECT oid FROM pg_roles WHERE rolname IN('zhiban_academic_runtime','zhiban_auth_runtime','zhiban_control_runtime'))),
    'role',(SELECT jsonb_build_object('super',rolsuper,'inherit',rolinherit,'createRole',rolcreaterole,'createDb',rolcreatedb,'bypass',rolbypassrls,'replication',rolreplication) FROM pg_roles WHERE rolname='zhiban_academic_runtime'),
    'edges',(SELECT count(*) FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='zhiban_academic_runtime')),
    'schemaPrivileges',jsonb_build_object('usage',has_schema_privilege('zhiban_academic_runtime','zhiban_onboarding','USAGE'),'create',has_schema_privilege('zhiban_academic_runtime','zhiban_onboarding','CREATE'))
  ) AS facts`)
  ).rows[0].facts;
  return hash(JSON.stringify({ catalog, facts }));
}
export async function loadOnboarding(pool: Pool): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if (
      !(await client.query("SELECT to_regclass('zhiban_onboarding.schema_migrations') AS name"))
        .rows[0].name
    )
      return false;
    const reference = await readProfileReference(onboardingReference);
    const sourceHash = hash(await readFile(onboardingMigration));
    if (
      reference.evidenceOrigin !== 'LOCAL' ||
      reference.githubActions !== false ||
      reference.scope !== referenceScope('FRESH_OWNED_PG16_ONBOARDING_REFERENCE') ||
      reference.migrationSha256 !== sourceHash ||
      !/^[a-f0-9]{64}$/.test(reference.profileSha256)
    )
      throw Error('Onboarding expected profile/source rejected');
    const ledger = (
      await client.query('SELECT version,checksum FROM zhiban_onboarding.schema_migrations')
    ).rows;
    const checks = await Promise.all(
      onboardingMigrations.map(async (path) => ({
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
      (await onboardingProfile(client)) !== reference.profileSha256
    )
      throw Error('Onboarding live ledger/catalog/ACL rejected');
    return true;
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
