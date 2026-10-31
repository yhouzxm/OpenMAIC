/** Catalog-only observation. Approval always comes from an independent pinned source profile. */
import type { Pool } from 'pg';
import type { InstalledSchemaPolicy } from '@/lib/persistence/installed-schema';
import { catalogFingerprint, official } from '../openmaic/catalog';
import { digest, sourceClosure, check, privateBytes } from './files';
export interface SourceProfile {
  kind: 'ZHIBAN_FRESH_SOURCE_PROFILE_V1';
  major: 18;
  provider: typeof official;
  databaseOwner: string;
  grantor: string;
  empty: Record<'business' | 'content' | 'authoring', string>;
  installed: Record<'business' | 'content' | 'authoring', string>;
  authoring: InstalledSchemaPolicy;
  teacherFingerprint: string;
  businessLedger: string;
  sourceHashes: Record<string, string>;
}
export async function databaseProfile(pool: Pool) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN READ ONLY');
    await c.query('SET LOCAL search_path=pg_catalog');
    const version = Number((await c.query('SHOW server_version_num')).rows[0].server_version_num);
    check(version >= 180000 && version < 190000, 'PG18 required');
    const schemas = (
      await c.query(
        "SELECT nspname,pg_get_userbyid(nspowner) AS owner,nspacl::text AS acl FROM pg_namespace WHERE nspname!~'^pg_' AND nspname<>'information_schema' ORDER BY nspname",
      )
    ).rows;
    const catalogs: Record<string, string> = {};
    for (const n of schemas)
      catalogs[n.nspname] = await catalogFingerprint(c, n.nspname as 'public');
    const facts = (
      await c.query(`SELECT jsonb_build_object(
   'roles',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY rolname),'[]') FROM (SELECT rolname,rolcanlogin,rolsuper,rolinherit,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconnlimit,rolconfig FROM pg_roles WHERE rolname LIKE 'zhiban_%') x),
   'edges',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY role,member,grantor),'[]') FROM (SELECT a.rolname AS role,b.rolname AS member,g.rolname AS grantor,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles a ON a.oid=m.roleid JOIN pg_roles b ON b.oid=m.member JOIN pg_roles g ON g.oid=m.grantor WHERE a.rolname LIKE 'zhiban_%' OR b.rolname LIKE 'zhiban_%') x),
   'db',(SELECT jsonb_build_array(pg_get_userbyid(datdba),datacl::text) FROM pg_database WHERE datname=current_database()),
   'defaults',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY owner,schema,type),'[]') FROM (SELECT pg_get_userbyid(defaclrole) AS owner,coalesce(n.nspname,'') AS schema,defaclobjtype AS type,defaclacl::text AS acl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace) x),
   'types',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY schema,name),'[]') FROM (SELECT n.nspname AS schema,t.typname AS name,t.typtype,pg_get_userbyid(t.typowner) AS owner,t.typacl::text,format_type(t.typbasetype,t.typtypmod) AS base,t.typnotnull,t.typdefault,(SELECT jsonb_agg(jsonb_build_array(k.conname,pg_get_constraintdef(k.oid),k.convalidated) ORDER BY k.conname) FROM pg_constraint k WHERE k.contypid=t.oid) AS constraints,(SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid=t.oid) AS enums FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND t.typtype IN('d','e')) x),
   'functions',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY schema,name,args),'[]') FROM (SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS args,pg_get_userbyid(p.proowner) AS owner,p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema') x),
   'views',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY schema,name),'[]') FROM (SELECT n.nspname AS schema,c.relname AS name,pg_get_userbyid(c.relowner) AS owner,c.relacl::text,pg_get_viewdef(c.oid,true) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_' AND n.nspname<>'information_schema' AND c.relkind IN('v','m')) x),
   'sequences',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY schema,name),'[]') FROM (SELECT n.nspname AS schema,c.relname AS name,pg_get_userbyid(c.relowner) AS owner,c.relacl::text,s.seqstart,s.seqincrement,s.seqmin,s.seqmax,s.seqcache,s.seqcycle FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname!~'^pg_') x)
  )::text AS facts`)
    ).rows[0].facts;
    await c.query('COMMIT');
    return digest(JSON.stringify({ schemas, catalogs, facts }));
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release(true);
  }
}
export async function approvedProfile(path: string, pin: string) {
  const bytes = await privateBytes(path);
  check(digest(bytes) === pin, 'Source profile pin rejected');
  const p = JSON.parse(bytes.toString()) as SourceProfile;
  check(
    p.kind === 'ZHIBAN_FRESH_SOURCE_PROFILE_V1' &&
      p.major === 18 &&
      JSON.stringify(p.provider) === JSON.stringify(official),
    'Source profile version rejected',
  );
  check(Object.keys(p.sourceHashes ?? {}).length > 20, 'Incomplete source profile');
  await sourceClosure(p.sourceHashes);
  return p;
}

export async function businessLedger(pool: Pool) {
  const rows = (
    await pool.query(
      'SELECT schema_name,ledger_name,version,checksum FROM zhiban_installation.schema_ledger() ORDER BY schema_name,ledger_name,version',
    )
  ).rows;
  return digest(JSON.stringify(rows));
}
