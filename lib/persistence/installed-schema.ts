/** Explicit host policy. No environment switch and no target-derived expected values. */
import { createHash } from 'node:crypto';
import type { Queryable } from '@openmaic/storage/document/pg';
import {
  applySchemaMigrations as applyNative,
  type SchemaMigrationSet,
} from '@openmaic/storage/pg-migrations';
import { expectedSchemaState } from '@/lib/zhiban/infrastructure/openmaic/schema-state';
import { catalogFingerprint } from '@/lib/zhiban/infrastructure/openmaic/catalog';
import type { BridgePgClient } from '@/lib/zhiban/infrastructure/openmaic/transactions';
export interface InstalledSchemaPolicy {
  database: string;
  runtime: 'zhiban_authoring_runtime';
  owner: 'zhiban_authoring_owner';
  fingerprint: string;
  securityFingerprint: string;
  ledger: Awaited<ReturnType<typeof expectedSchemaState>>;
  receipts: Readonly<Record<string, string>>;
}
let policy: Readonly<InstalledSchemaPolicy> | undefined;
export function configureInstalledSchema(value: InstalledSchemaPolicy) {
  if (
    policy ||
    !value.database ||
    value.runtime !== 'zhiban_authoring_runtime' ||
    value.owner !== 'zhiban_authoring_owner' ||
    !/^[a-f0-9]{64}$/.test(value.fingerprint) ||
    !/^[a-f0-9]{64}$/.test(value.securityFingerprint) ||
    !value.ledger.length
  )
    throw Error('Installed schema policy rejected');
  policy = Object.freeze(structuredClone(value));
}
export async function authoringSecurityFingerprint(q: Queryable) {
  const rows = (
    await q.query(`SELECT jsonb_build_object(
    'roles',(SELECT jsonb_agg(to_jsonb(x) ORDER BY rolname) FROM (SELECT rolname,rolcanlogin,rolsuper,rolinherit,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,rolconfig FROM pg_roles WHERE rolname IN ('zhiban_authoring_owner','zhiban_authoring_migrator','zhiban_authoring_runtime')) x),
    'edges',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY role,member,grantor),'[]') FROM (SELECT a.rolname AS role,b.rolname AS member,g.rolname AS grantor,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles a ON a.oid=m.roleid JOIN pg_roles b ON b.oid=m.member JOIN pg_roles g ON g.oid=m.grantor WHERE a.rolname LIKE 'zhiban_authoring_%' OR b.rolname LIKE 'zhiban_authoring_%') x),
    'database',(SELECT jsonb_build_array(pg_get_userbyid(datdba),datacl::text) FROM pg_database WHERE datname=current_database()),
    'schema',(SELECT jsonb_build_array(pg_get_userbyid(nspowner),nspacl::text) FROM pg_namespace WHERE nspname='public'),
    'defaults',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY owner,schema,type),'[]') FROM (SELECT pg_get_userbyid(defaclrole) AS owner,coalesce(n.nspname,'') AS schema,defaclobjtype AS type,defaclacl::text AS acl FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace) x)
  )::text AS facts`)
  ).rows;
  return createHash('sha256').update(String(rows[0]?.facts)).digest('hex');
}
export async function verifyInstalledSchema(
  q: Queryable,
  approved: Readonly<InstalledSchemaPolicy> | undefined = policy,
): Promise<boolean> {
  if (!approved) return false;
  const r = (
    await q.query(`SELECT current_database() AS db,session_user,current_user,
    current_setting('server_version_num')::int AS version,
    r.rolcanlogin AND NOT(r.rolsuper OR r.rolinherit OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication)
    AND NOT has_database_privilege(r.oid,current_database(),'CREATE')
    AND NOT has_database_privilege(r.oid,current_database(),'TEMP')
    AND NOT has_schema_privilege(r.oid,'public','CREATE')
    AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid)
    AND NOT EXISTS(SELECT 1 FROM pg_class WHERE relowner=r.oid)
    AND NOT EXISTS(SELECT 1 FROM pg_proc WHERE proowner=r.oid)
    AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=r.oid)
    AND NOT EXISTS(SELECT 1 FROM pg_type WHERE typowner=r.oid)
    AND NOT EXISTS(SELECT 1 FROM pg_database WHERE datdba=r.oid) AS safe
    FROM pg_roles r WHERE rolname=session_user`)
  ).rows[0];
  if (
    !r ||
    r.db !== approved.database ||
    r.session_user !== approved.runtime ||
    r.current_user !== approved.runtime ||
    !r.safe ||
    Number(r.version) < 180000 ||
    Number(r.version) >= 190000
  )
    throw Error('Installed schema runtime endpoint rejected');
  if ((await authoringSecurityFingerprint(q)) !== approved.securityFingerprint)
    throw Error('Installed schema role/database ACL rejected');
  const extra = (
    await q.query(
      `SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','p','m') AND has_table_privilege(current_user,c.oid,'MAINTAIN')) AS maintain,
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND pg_get_userbyid(p.proowner)<>$1) AS foreign_owner`,
      [approved.owner],
    )
  ).rows[0];
  if (
    extra?.maintain ||
    extra?.foreign_owner ||
    (await catalogFingerprint(q as unknown as BridgePgClient, 'public')) !== approved.fingerprint
  )
    throw Error('Installed schema catalog/ACL rejected');
  const ledger = (
    await q.query(
      'SELECT store,version,name,checksum FROM public.openmaic_schema_migrations ORDER BY store,version',
    )
  ).rows;
  if (JSON.stringify(ledger) !== JSON.stringify(approved.ledger))
    throw Error('Installed schema ledger rejected');
  for (const [table, digest] of Object.entries(approved.receipts)) {
    if (!/^zhiban_[a-z_]+$/.test(table) || !/^[a-f0-9]{64}$/.test(digest))
      throw Error('Installed schema receipt approved rejected');
    const rows = (await q.query(`SELECT id,digest FROM public.${table}`)).rows;
    if (rows.length !== 1 || rows[0].id !== true || rows[0].digest !== digest)
      throw Error('Installed schema receipt rejected');
  }
  return true;
}
export async function applyHostSchemaMigrations(q: Queryable, set: SchemaMigrationSet) {
  if (!(await verifyInstalledSchema(q))) return applyNative(q, set);
  const expected = await expectedSchemaState([set]);
  if (expected.some((e) => !policy!.ledger.some((a) => JSON.stringify(a) === JSON.stringify(e))))
    throw Error('Uninstalled schema store rejected');
}
export async function hostSchemaBootstrap(
  q: Queryable,
  initialize: (q: Queryable) => Promise<void>,
) {
  if (!(await verifyInstalledSchema(q))) await initialize(q);
}
