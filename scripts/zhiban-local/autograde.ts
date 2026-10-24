/** Trusted expected profile is built in a separate new owned PG16 cluster, never from the live host. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { catalogFingerprint } from '../../lib/zhiban/infrastructure/openmaic/catalog';
export const autogradeMigrations = [
  'lib/zhiban/infrastructure/autograde/postgres/migrations/0001_autograde.sql',
  'lib/zhiban/infrastructure/autograde/postgres/migrations/0002_worker.sql',
];
export const autogradeReference = 'docs/v2/evidence/zhiban-autograde-profile-reference-local.json';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export async function autogradeProfile(c: PoolClient) {
  await c.query('SET LOCAL search_path TO pg_catalog');
  const catalogs: Record<string, unknown> = {};
  for (const s of ['zhiban_autograde', 'zhiban_academic', 'zhiban_learning', 'zhiban_assessment'])
    catalogs[s] = await catalogFingerprint(c, s as 'public');
  const roles = (
    await c.query(
      "SELECT rolname,rolcanlogin,rolsuper,rolinherit,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,(SELECT count(*) FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) AS edges FROM pg_roles r WHERE rolname='zhiban_autograde_worker'",
    )
  ).rows;
  const tables = (
    await c.query(
      "SELECT n.nspname,c.relname,has_table_privilege('zhiban_autograde_worker',c.oid,'SELECT') AS r,has_table_privilege('zhiban_autograde_worker',c.oid,'INSERT') AS i,has_table_privilege('zhiban_autograde_worker',c.oid,'UPDATE') AS u,has_table_privilege('zhiban_autograde_worker',c.oid,'DELETE') AS d FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname LIKE 'zhiban_%' AND c.relkind='r' AND n.nspname IN('zhiban_autograde','zhiban_academic','zhiban_learning','zhiban_assessment','zhiban_identity') ORDER BY n.nspname,c.relname",
    )
  ).rows;
  const functions = (
    await c.query(
      "SELECT n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) AS args,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,p.proconfig,has_function_privilege('zhiban_autograde_worker',p.oid,'EXECUTE') AS worker,has_function_privilege('zhiban_academic_runtime',p.oid,'EXECUTE') AS business FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='zhiban_autograde' ORDER BY p.proname",
    )
  ).rows;
  return hash(JSON.stringify({ catalogs, roles, tables, functions }));
}
export async function loadAutograde(pool: Pool) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if (
      !(await c.query("SELECT to_regclass('zhiban_autograde.schema_migrations') AS name")).rows[0]
        .name
    )
      return false;
    const r = JSON.parse(await readFile(autogradeReference, 'utf8'));
    if (
      r.evidenceOrigin !== 'LOCAL' ||
      r.githubActions !== false ||
      r.scope !== 'FRESH_OWNED_PG16_AUTOGRADE_REFERENCE'
    )
      throw Error('Auto grade expected origin rejected');
    const ledger = (
      await c.query(
        'SELECT version,checksum FROM zhiban_autograde.schema_migrations ORDER BY version',
      )
    ).rows;
    if (ledger.length !== autogradeMigrations.length) throw Error('Auto grade ledger rejected');
    for (const [p, i] of autogradeMigrations.map((p, i) => [p, i] as const)) {
      const h = hash(await readFile(p));
      if (
        ledger[i].version !== p.split('/').at(-1)!.slice(0, 4) ||
        ledger[i].checksum !== h ||
        r.migrationHashes[p] !== h
      )
        throw Error('Auto grade source rejected');
    }
    if ((await autogradeProfile(c)) !== r.profileSha256)
      throw Error('Auto grade catalog/ACL rejected');
    return true;
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}
