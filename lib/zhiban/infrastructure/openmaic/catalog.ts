import type { BridgePgClient } from './transactions';
import { check, hash } from './validation';
export const official = Object.freeze({
  sha: '1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce',
  storage: '0.31.1',
  dsl: '0.11.2',
  renderer: '0.1.11',
});
export async function catalogFingerprint(
  client: BridgePgClient,
  schema: 'public' | 'zhiban_bridge',
) {
  const result = await client.query(
    `SELECT jsonb_build_object(
    'columns',(SELECT coalesce(jsonb_agg(x ORDER BY x.table_name,x.position),'[]') FROM (SELECT c.relname AS table_name,a.attname AS name,a.attnum AS position,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS required,pg_get_expr(d.adbin,d.adrelid) AS initial,a.attacl::text AS acl FROM pg_attribute AS a JOIN pg_class AS c ON c.oid=a.attrelid JOIN pg_namespace AS n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef AS d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname=$1 AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped) AS x),
    'constraints',(SELECT coalesce(jsonb_agg(x ORDER BY x.table_name,x.name),'[]') FROM (SELECT c.relname AS table_name,k.conname AS name,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint AS k JOIN pg_class AS c ON c.oid=k.conrelid JOIN pg_namespace AS n ON n.oid=c.relnamespace WHERE n.nspname=$1) AS x),
    'functions',(SELECT coalesce(jsonb_agg(x ORDER BY x.name,x.args),'[]') FROM (SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS args,pg_get_functiondef(p.oid) AS definition,p.proacl::text AS acl FROM pg_proc AS p JOIN pg_namespace AS n ON n.oid=p.pronamespace WHERE n.nspname=$1 OR ($1='zhiban_bridge' AND n.nspname='zhiban_identity' AND p.proname='bridge_identity_context')) AS x),
    'indexes',(SELECT coalesce(jsonb_agg(x ORDER BY x.name),'[]') FROM (SELECT c.relname AS name,pg_get_indexdef(i.indexrelid) AS definition FROM pg_index AS i JOIN pg_class AS c ON c.oid=i.indexrelid JOIN pg_namespace AS n ON n.oid=c.relnamespace WHERE n.nspname=$1) AS x),
    'triggers',(SELECT coalesce(jsonb_agg(x ORDER BY x.table_name,x.name),'[]') FROM (SELECT c.relname AS table_name,t.tgname AS name,pg_get_triggerdef(t.oid) AS definition,t.tgenabled AS enabled FROM pg_trigger AS t JOIN pg_class AS c ON c.oid=t.tgrelid JOIN pg_namespace AS n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND NOT t.tgisinternal) AS x),
    'policies',(SELECT coalesce(jsonb_agg(x ORDER BY x.table_name,x.name),'[]') FROM (SELECT c.relname AS table_name,p.polname AS name,p.polcmd AS command,p.polpermissive AS permissive,(SELECT jsonb_agg(pg_get_userbyid(r.role_id) ORDER BY pg_get_userbyid(r.role_id)) FROM unnest(p.polroles) AS r(role_id)) AS roles,pg_get_expr(p.polqual,p.polrelid) AS predicate,pg_get_expr(p.polwithcheck,p.polrelid) AS checking FROM pg_policy AS p JOIN pg_class AS c ON c.oid=p.polrelid JOIN pg_namespace AS n ON n.oid=c.relnamespace WHERE n.nspname=$1 OR ($1='zhiban_bridge' AND n.nspname='zhiban_identity' AND p.polname IN ('memberships_bridge_owner_lock','grants_bridge_owner_lock'))) AS x),
    'tables',(SELECT coalesce(jsonb_agg(x ORDER BY x.name),'[]') FROM (SELECT c.relname AS name,c.relrowsecurity AS rls,c.relforcerowsecurity AS force,c.relacl::text AS acl,pg_get_userbyid(c.relowner) AS owner FROM pg_class AS c JOIN pg_namespace AS n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p')) AS x))::text AS catalog`,
    [schema],
  );
  check(result.rows.length === 1 && typeof result.rows[0].catalog === 'string');
  return hash(result.rows[0].catalog);
}
