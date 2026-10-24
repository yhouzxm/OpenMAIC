-- UNAPPLIED CANDIDATE. Run only by the future explicit LOCAL admin installer.
-- Must precede SET LOCAL ROLE zhiban_identity_owner in the SAME transaction.
DO $preflight$
DECLARE role_name text; r pg_roles%ROWTYPE; name text;
BEGIN
 IF session_user <> 'postgres' OR current_user <> 'postgres'
    OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999
    OR current_database() <> 'zhiban_m1_dev'
    OR current_setting('port') <> '55433'
    OR current_setting('data_directory') <> '/home/zxm/.local/share/zhiban-m1/pgdata'
    OR current_setting('transaction_isolation') <> 'read committed'
    OR current_setting('server_encoding') <> 'UTF8' THEN
   RAISE EXCEPTION 'Exact owned LOCAL PG16 admin transaction required';
 END IF;
 IF to_regnamespace('zhiban_content') IS NOT NULL THEN
   RAISE EXCEPTION 'Existing content schema: inspect ledger and receipt, do not reset/reapply';
 END IF;
 FOREACH role_name IN ARRAY ARRAY['zhiban_identity_owner','zhiban_bridge_runtime'] LOOP
   SELECT * INTO r FROM pg_roles WHERE rolname=role_name;
   IF NOT FOUND OR r.rolsuper OR r.rolbypassrls OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication
      OR r.rolinherit OR r.rolcanlogin<>(role_name='zhiban_bridge_runtime')
      OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR (role_name='zhiban_bridge_runtime' AND roleid=r.oid))
      OR (role_name='zhiban_bridge_runtime' AND (
        has_database_privilege(r.oid,current_database(),'CREATE') OR has_database_privilege(r.oid,current_database(),'TEMP')
        OR EXISTS(SELECT 1 FROM pg_class WHERE relowner=r.oid))) THEN
     RAISE EXCEPTION 'Existing role manifest rejected';
   END IF;
 END LOOP;
 IF (SELECT count(*) FROM pg_auth_members m
     WHERE m.roleid=(SELECT oid FROM pg_roles WHERE rolname='zhiban_identity_owner'))<>1
    OR NOT EXISTS(SELECT 1 FROM pg_auth_members m
     JOIN pg_roles granted ON granted.oid=m.roleid JOIN pg_roles member ON member.oid=m.member
     WHERE granted.rolname='zhiban_identity_owner' AND member.rolname='zhiban_migrator'
       AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option)
    OR EXISTS(SELECT 1 FROM pg_auth_members m
     WHERE m.roleid=(SELECT oid FROM pg_roles WHERE rolname='zhiban_migrator')
       OR (m.member=(SELECT oid FROM pg_roles WHERE rolname='zhiban_migrator')
         AND m.roleid<>(SELECT oid FROM pg_roles WHERE rolname='zhiban_identity_owner'))) THEN
   RAISE EXCEPTION 'Exact PG16 migrator/owner role edges required';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_default_acl d CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname='zhiban_identity_owner')
      AND a.grantee NOT IN (0,d.defaclrole)) THEN
   RAISE EXCEPTION 'Unexpected owner default ACL';
 END IF;
 IF (SELECT count(*) FROM zhiban_identity.schema_migrations)<>13
    OR (SELECT count(*) FROM zhiban_academic.schema_migrations)<>1
    OR (SELECT count(*) FROM zhiban_learning.schema_migrations)<>1
    OR (SELECT count(*) FROM zhiban_assessment.schema_migrations)<>1 THEN
   RAISE EXCEPTION 'Prerequisite ledger shape rejected';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='zhiban_bridge.business_resource_ready(uuid,uuid)'::regprocedure
     AND NOT prosecdef AND provolatile='s' AND proowner=(SELECT oid FROM pg_roles WHERE rolname='zhiban_identity_owner')
     AND prosrc ~* '^\s*SELECT\s+FALSE\s*$') THEN
   RAISE EXCEPTION 'Original closed gate required';
 END IF;
 FOREACH name IN ARRAY ARRAY['courses','offerings','assignments','enrollments'] LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='zhiban_academic' AND c.relname=name AND c.relrowsecurity AND c.relforcerowsecurity
       AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='zhiban_identity_owner')
       AND (SELECT count(*) FROM pg_policy WHERE polrelid=c.oid)=1) THEN
     RAISE EXCEPTION 'Original Academic profile required';
   END IF;
 END LOOP;
 -- The installer MUST additionally match every original source checksum,
 -- catalog/role ACL fingerprint and receipt BEFORE any DDL. Counts are not proof.
END;
$preflight$;
