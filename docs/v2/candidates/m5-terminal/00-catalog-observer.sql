-- UNAPPLIED: administrator on Business DB, after role bootstrap, before helpers.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'zhiban_m1_dev' OR NOT(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN
  RAISE EXCEPTION 'Observer bootstrap rejected';
 END IF;
END $$;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO zhiban_reconcile_observer;
GRANT SELECT(oid,subdbid,subenabled) ON pg_catalog.pg_subscription TO zhiban_reconcile_observer;
CREATE SCHEMA zhiban_reconcile_catalog AUTHORIZATION zhiban_reconcile_observer;
REVOKE ALL ON SCHEMA zhiban_reconcile_catalog FROM PUBLIC;
SET LOCAL ROLE zhiban_reconcile_observer;
CREATE FUNCTION zhiban_reconcile_catalog.observe(p_business oid,p_native oid)
RETURNS jsonb LANGUAGE sql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
 SELECT pg_stat_clear_snapshot();
 SELECT jsonb_build_object(
  'pg',current_setting('server_version_num')::integer,
  'cluster', (SELECT system_identifier::text FROM pg_control_system()),
  'postmasterStart',pg_postmaster_start_time(),
  'databases',(SELECT jsonb_agg(jsonb_build_object('oid',oid::text,'name',datname,'allowConnections',datallowconn) ORDER BY oid)
    FROM pg_database WHERE oid IN(p_business,p_native)),
  'subscriptions',(SELECT count(*) FROM pg_subscription WHERE subdbid IN(p_business,p_native) AND subenabled),
  'writerLogins',(SELECT count(*) FROM pg_roles WHERE rolcanlogin AND rolname IN('zhiban_migrator','zhiban_runtime','zhiban_auth_runtime','zhiban_control_runtime','zhiban_bridge_runtime','zhiban_academic_runtime','zhiban_openmaic_migrator','zhiban_openmaic_runtime')),
  'preparedEnabled',current_setting('max_prepared_transactions')::integer<>0,
  'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database IN('zhiban_m1_dev','zhiban_m5_native')),
  'backends',coalesce((SELECT jsonb_agg(jsonb_build_object('pid',pid,'start',backend_start,'role',usename,'databaseOid',datid::text,'type',backend_type) ORDER BY datid,pid)
    FROM pg_stat_activity WHERE datid IN(p_business,p_native)),'[]'::jsonb))
$$;
REVOKE ALL ON FUNCTION zhiban_reconcile_catalog.observe(oid,oid) FROM PUBLIC;
RESET ROLE;
GRANT USAGE ON SCHEMA zhiban_reconcile_catalog TO zhiban_identity_owner;
GRANT EXECUTE ON FUNCTION zhiban_reconcile_catalog.observe(oid,oid) TO zhiban_identity_owner;
-- Catalog observer has NO Business/Native table privilege and no client EXECUTE.
COMMIT;
