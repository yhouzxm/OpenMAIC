import { catalogFingerprint } from '@/lib/zhiban/infrastructure/openmaic/catalog';
import { digest } from './config';
export const schemas = [
  'zhiban_identity',
  'zhiban_bridge',
  'zhiban_academic',
  'zhiban_learning',
  'zhiban_assessment',
  'zhiban_content',
];
export async function contentProfile(client: any, enabled = true) {
  await client.query("SELECT set_config('search_path','pg_catalog',false)");
  const selected = schemas.filter((s) => enabled || s !== 'zhiban_content');
  const fingerprints: Record<string, string> = {};
  for (const schema of selected)
    fingerprints[schema] = await catalogFingerprint(client, schema as any);
  const extra = (
    await client.query(
      `SELECT jsonb_build_object(
    'schemas',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name) FROM (SELECT nspname AS name,pg_get_userbyid(nspowner) AS owner,nspacl::text AS acl FROM pg_namespace WHERE nspname=ANY($1)) x),
    'functionOwners',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.schema,x.name,x.args) FROM (SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS args,pg_get_userbyid(p.proowner) AS owner FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=ANY($1)) x),
    'roles',(SELECT jsonb_agg(to_jsonb(x) ORDER BY x.rolname) FROM (SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolreplication,rolbypassrls FROM pg_roles WHERE rolname IN ('zhiban_identity_owner','zhiban_migrator','zhiban_runtime','zhiban_auth_runtime','zhiban_control_runtime','zhiban_bridge_runtime','zhiban_academic_runtime')) x),
    'edges',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.member,x.granted),'[]') FROM (SELECT member.rolname AS member,granted.rolname AS granted,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member JOIN pg_roles granted ON granted.oid=m.roleid WHERE member.rolname IN ('zhiban_identity_owner','zhiban_migrator','zhiban_runtime','zhiban_auth_runtime','zhiban_control_runtime','zhiban_bridge_runtime','zhiban_academic_runtime') OR granted.rolname IN ('zhiban_identity_owner','zhiban_migrator','zhiban_runtime','zhiban_auth_runtime','zhiban_control_runtime','zhiban_bridge_runtime','zhiban_academic_runtime')) x),
    'defaults',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.schema,x.kind),'[]') FROM (SELECT coalesce(n.nspname,'') AS schema,d.defaclobjtype AS kind,d.defaclacl::text AS acl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname='zhiban_identity_owner')) x)
  ) AS facts`,
      [selected],
    )
  ).rows[0].facts;
  return { fingerprints, extra, fingerprint: digest(JSON.stringify({ fingerprints, extra })) };
}
