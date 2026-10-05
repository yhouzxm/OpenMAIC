import { ensureSchema } from '@openmaic/storage/runtime/pg';
import { RUNTIME_DSL_VERSION } from '@openmaic/dsl';
import type { TransactionPool } from '../../identity/postgres/transactions';
import type { BridgePgClient } from '../transactions';
import { catalogFingerprint, official } from '../catalog';
import { RuntimeDeadline } from './admission';
import { runtimeTransaction } from './transactions';
import { exact, hash, requireFact, text, digest } from './validation';

const roles = Object.freeze([
  'zhiban_openmaic_owner',
  'zhiban_openmaic_migrator',
  'zhiban_openmaic_runtime',
]);
export interface RuntimeReceipt {
  database: string;
  approvalRef: string;
  capability: 'RUNTIME_FOUNDATION';
  sha: string;
  storage: string;
  dsl: string;
  runtimeProtocol: '0.1.0';
  fingerprint: string;
  roles: readonly string[];
}
async function fingerprint(client: BridgePgClient) {
  const r = await client.query(
    `SELECT jsonb_build_object(
    'db',(SELECT jsonb_build_object('acl',d.datacl::text,'owner',pg_get_userbyid(d.datdba)) FROM pg_database d WHERE d.datname=current_database()),
    'schema',(SELECT jsonb_build_object('acl',n.nspacl::text,'owner',pg_get_userbyid(n.nspowner)) FROM pg_namespace n WHERE n.nspname='public'),
    'roles',(SELECT jsonb_agg(jsonb_build_object('name',r.rolname,'super',r.rolsuper,'inherit',r.rolinherit,'bypass',r.rolbypassrls,'createRole',r.rolcreaterole,'createDb',r.rolcreatedb,'replication',r.rolreplication,'login',r.rolcanlogin) ORDER BY r.rolname) FROM pg_roles r WHERE r.rolname=ANY($1)),
    'edges',(SELECT coalesce(jsonb_agg(jsonb_build_object('role',pg_get_userbyid(m.roleid),'member',pg_get_userbyid(m.member),'admin',m.admin_option,'inherit',m.inherit_option,'set',m.set_option) ORDER BY m.roleid,m.member),'[]') FROM pg_auth_members m WHERE pg_get_userbyid(m.roleid)=ANY($1) OR pg_get_userbyid(m.member)=ANY($1)))::text AS catalog`,
    [roles],
  );
  requireFact(r.rows.length === 1 && typeof r.rows[0].catalog === 'string');
  const safety = await client.query(
    `SELECT
    (SELECT count(*) FROM pg_roles r WHERE r.rolname=ANY($1) AND NOT(r.rolsuper OR r.rolinherit OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication) AND r.rolcanlogin=(r.rolname<>'zhiban_openmaic_owner'))=3 AS roles,
    NOT EXISTS(SELECT 1 FROM pg_auth_members m WHERE (pg_get_userbyid(m.roleid)=ANY($1) OR pg_get_userbyid(m.member)=ANY($1)) AND NOT(pg_get_userbyid(m.roleid)='zhiban_openmaic_owner' AND pg_get_userbyid(m.member)='zhiban_openmaic_migrator' AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option)) AS edges,
    NOT has_database_privilege('zhiban_openmaic_runtime',current_database(),'CREATE,TEMP') AND NOT has_schema_privilege('zhiban_openmaic_runtime','public','CREATE') AS ddl,
    NOT EXISTS(SELECT 1 FROM pg_class WHERE relowner=(SELECT oid FROM pg_roles WHERE rolname='zhiban_openmaic_runtime')) AND NOT EXISTS(SELECT 1 FROM pg_proc WHERE proowner=(SELECT oid FROM pg_roles WHERE rolname='zhiban_openmaic_runtime')) AND NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=(SELECT oid FROM pg_roles WHERE rolname='zhiban_openmaic_runtime')) AND NOT EXISTS(SELECT 1 FROM pg_type WHERE typowner=(SELECT oid FROM pg_roles WHERE rolname='zhiban_openmaic_runtime')) AND NOT EXISTS(SELECT 1 FROM pg_database WHERE datdba=(SELECT oid FROM pg_roles WHERE rolname='zhiban_openmaic_runtime')) AS ownership`,
    [roles],
  );
  requireFact(['roles', 'edges', 'ddl', 'ownership'].every((k) => safety.rows[0]?.[k] === true));
  const boundary = await client.query(`SELECT
    NOT EXISTS(SELECT 1 FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a WHERE d.datname=current_database() AND NOT (a.grantee=d.datdba OR (pg_get_userbyid(a.grantee) IN ('zhiban_openmaic_runtime','zhiban_openmaic_migrator') AND a.privilege_type='CONNECT' AND NOT a.is_grantable))) AS database_acl,
    (SELECT array_agg(c.relname::text ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S','f'))=ARRAY['runtime_records','runtime_sessions'] AS objects,
    NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') AS functions,
    NOT EXISTS(SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='public' AND NOT(a.grantee=n.nspowner OR (pg_get_userbyid(a.grantee)='zhiban_openmaic_runtime' AND a.privilege_type='USAGE' AND NOT a.is_grantable))) AS schema_acl,
    NOT EXISTS(SELECT 1 FROM pg_roles r WHERE r.rolname IN ('zhiban_runtime','zhiban_auth_runtime','zhiban_control_runtime','zhiban_bridge_runtime','zhiban_migrator','zhiban_identity_owner') AND has_database_privilege(r.oid,current_database(),'CONNECT,CREATE,TEMP')) AS service_isolation,
    NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE n.nspname='public' AND c.relkind='r' AND NOT(a.grantee=c.relowner OR (pg_get_userbyid(a.grantee)='zhiban_openmaic_runtime' AND a.privilege_type IN ('SELECT','INSERT') AND NOT a.is_grantable))) AS table_acl,
    NOT EXISTS(SELECT 1 FROM pg_attribute col JOIN pg_class c ON c.oid=col.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(col.attacl) a WHERE n.nspname='public' AND NOT(a.grantee=c.relowner OR (pg_get_userbyid(a.grantee)='zhiban_openmaic_runtime' AND c.relname='runtime_sessions' AND col.attname IN ('stage_id','learner_key','kind','status','created_at','updated_at','data') AND a.privilege_type='UPDATE' AND NOT a.is_grantable))) AS column_acl,
    has_database_privilege('zhiban_openmaic_runtime',current_database(),'CONNECT') AND has_database_privilege('zhiban_openmaic_migrator',current_database(),'CONNECT') AND has_schema_privilege('zhiban_openmaic_runtime','public','USAGE') AS connect`);
  requireFact(
    [
      'database_acl',
      'objects',
      'functions',
      'schema_acl',
      'service_isolation',
      'table_acl',
      'column_acl',
      'connect',
    ].every((k) => boundary.rows[0]?.[k] === true),
  );
  return hash(JSON.stringify([await catalogFingerprint(client, 'public'), r.rows[0].catalog]));
}
async function identity(client: BridgePgClient, database: string) {
  const r = await client.query('SELECT session_user,current_database() AS db');
  requireFact(
    r.rows.length === 1 &&
      r.rows[0].session_user === 'zhiban_openmaic_migrator' &&
      r.rows[0].db === database &&
      RUNTIME_DSL_VERSION === '0.1.0',
  );
}
/** Explicit maintenance only. Empty private DB; startup/facade never imports this. */
export async function provisionRuntimeNative(
  pool: TransactionPool,
  database: string,
  approvalRef: string,
): Promise<RuntimeReceipt> {
  text(database, 128, true);
  text(approvalRef, 256, true);
  return runtimeTransaction(pool, new RuntimeDeadline(), async (client) => {
    await identity(client, database);
    const r = await client.query(
      "SELECT ((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')+(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'))::integer AS n",
    );
    requireFact(r.rows[0]?.n === 0);
    await client.query('SET LOCAL ROLE zhiban_openmaic_owner');
    await client.query('SET LOCAL search_path=public,pg_catalog,pg_temp');
    await ensureSchema(client);
    await client.query(
      'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC,zhiban_openmaic_runtime',
    );
    await client.query(
      'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC,zhiban_openmaic_runtime',
    );
    const services = await client.query(
      "SELECT rolname FROM pg_roles WHERE rolname IN ('zhiban_runtime','zhiban_auth_runtime','zhiban_control_runtime','zhiban_bridge_runtime','zhiban_migrator','zhiban_identity_owner')",
    );
    for (const row of services.rows) {
      requireFact(
        /^zhiban_(runtime|auth_runtime|control_runtime|bridge_runtime|migrator|identity_owner)$/.test(
          String(row.rolname),
        ),
      );
      await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${row.rolname}`);
      await client.query(`REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${row.rolname}`);
    }
    await client.query(
      'GRANT SELECT,INSERT ON runtime_sessions,runtime_records TO zhiban_openmaic_runtime',
    );
    await client.query(
      'GRANT UPDATE(stage_id,learner_key,kind,status,created_at,updated_at,data) ON runtime_sessions TO zhiban_openmaic_runtime',
    );
    return Object.freeze({
      database,
      approvalRef,
      capability: 'RUNTIME_FOUNDATION',
      sha: official.sha,
      storage: official.storage,
      dsl: official.dsl,
      runtimeProtocol: '0.1.0',
      roles,
      fingerprint: await fingerprint(client),
    });
  });
}
export async function verifyRuntimeProvisioning(pool: TransactionPool, receipt: RuntimeReceipt) {
  exact(receipt, [
    'database',
    'approvalRef',
    'capability',
    'sha',
    'storage',
    'dsl',
    'runtimeProtocol',
    'roles',
    'fingerprint',
  ]);
  text(receipt.database, 128, true);
  text(receipt.approvalRef, 256, true);
  digest(receipt.fingerprint);
  requireFact(
    receipt.capability === 'RUNTIME_FOUNDATION' &&
      receipt.sha === official.sha &&
      receipt.storage === official.storage &&
      receipt.dsl === official.dsl &&
      receipt.runtimeProtocol === '0.1.0' &&
      JSON.stringify(receipt.roles) === JSON.stringify(roles),
  );
  return runtimeTransaction(pool, new RuntimeDeadline(), async (client) => {
    await identity(client, receipt.database);
    await client.query('SET LOCAL ROLE zhiban_openmaic_owner');
    requireFact((await fingerprint(client)) === receipt.fingerprint);
    return Object.freeze({ status: 'VERIFIED' as const });
  });
}
