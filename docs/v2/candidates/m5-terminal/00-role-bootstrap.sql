-- UNAPPLIED. Cluster administrator only; never run from normal installer/runtime.
-- New roles are NOLOGIN, no password, no owner membership. No existing role altered.
DO $$ BEGIN
 IF current_database()<>'postgres' OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999
    OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN
  RAISE EXCEPTION 'Dedicated PG16 administrator required';
 END IF;
END $$;
CREATE ROLE zhiban_reconcile_controller NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE zhiban_reconcile_issuer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE zhiban_reconcile_executor NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE zhiban_reconcile_native_proof NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE zhiban_reconcile_observer NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- Observer exposes only fixed catalog metadata through its SECURITY DEFINER seam.
GRANT pg_read_all_stats TO zhiban_reconcile_observer WITH INHERIT TRUE, SET FALSE;
GRANT CONNECT ON DATABASE zhiban_m1_dev TO zhiban_reconcile_controller,zhiban_reconcile_issuer,zhiban_reconcile_executor;
GRANT CONNECT ON DATABASE zhiban_m5_native TO zhiban_reconcile_native_proof;
REVOKE ALL ON DATABASE zhiban_m5_native FROM zhiban_reconcile_controller,zhiban_reconcile_issuer,zhiban_reconcile_executor;
REVOKE ALL ON DATABASE zhiban_m1_dev FROM zhiban_reconcile_native_proof;
