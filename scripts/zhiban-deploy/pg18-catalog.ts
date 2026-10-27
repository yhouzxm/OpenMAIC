/** Exact PG18 reference facts. No cross-version normalization or target-derived expectations. */
import type { PoolClient } from 'pg';
import { catalogFingerprint } from '../../lib/zhiban/infrastructure/openmaic/catalog';
import { hashPgInput } from '../zhiban-local/pg-version';
export async function businessPg18Catalog(c: PoolClient) {
  const identity = (
    await c.query(
      "SELECT current_setting('server_version_num')::int AS version,current_database() AS db",
    )
  ).rows[0];
  if (identity.version < 180000 || identity.version >= 190000)
    throw Error('PG18 catalog endpoint required');
  await c.query("SELECT set_config('search_path','pg_catalog',false)");
  const schemas = (
    await c.query(
      "SELECT nspname,pg_get_userbyid(nspowner) AS owner,nspacl::text AS acl FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema' ORDER BY nspname",
    )
  ).rows;
  const catalogs: Record<string, string> = {};
  for (const row of schemas)
    catalogs[row.nspname] = await catalogFingerprint(c, row.nspname as 'public');
  const roles = (
    await c.query(
      "SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls,rolconnlimit,rolconfig FROM pg_roles WHERE rolname LIKE 'zhiban_%' AND rolname<>'zhiban_lesson_runtime' ORDER BY rolname",
    )
  ).rows;
  const edges = (
    await c.query(
      "SELECT a.rolname AS role,b.rolname AS member,g.rolname AS grantor,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles a ON a.oid=m.roleid JOIN pg_roles b ON b.oid=m.member JOIN pg_roles g ON g.oid=m.grantor WHERE a.rolname LIKE 'zhiban_%' OR b.rolname LIKE 'zhiban_%' ORDER BY a.rolname,b.rolname,g.rolname",
    )
  ).rows;
  const defaults = (
    await c.query(
      "SELECT pg_get_userbyid(defaclrole) AS owner,coalesce(n.nspname,'') AS schema,defaclobjtype,defaclacl::text FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace ORDER BY owner,schema,defaclobjtype",
    )
  ).rows;
  const db = (
    await c.query(
      'SELECT pg_get_userbyid(datdba) AS owner,datacl::text AS acl FROM pg_database WHERE datname=current_database()',
    )
  ).rows[0];
  const maintain = (
    await c.query(
      "SELECT r.rolname,n.nspname,c.relname FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE r.rolname IN ('zhiban_auth_runtime','zhiban_runtime','zhiban_control_runtime','zhiban_bridge_runtime','zhiban_academic_runtime','zhiban_autograde_worker') AND n.nspname!~'^pg_' AND c.relkind IN ('r','p','m') AND has_table_privilege(r.oid,c.oid,'MAINTAIN')",
    )
  ).rows;
  if (maintain.length) throw Error('PG18 restricted runtime MAINTAIN privilege rejected');
  const facts = { schemas, catalogs, roles, edges, defaults, db };
  return { facts, fingerprint: hashPgInput(JSON.stringify(facts)) };
}
