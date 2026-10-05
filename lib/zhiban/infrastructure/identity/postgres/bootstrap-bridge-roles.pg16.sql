-- PSQL-only additive admin bootstrap on the designated Identity PG16 database.
\set ON_ERROR_STOP on
BEGIN;
DO $$ BEGIN
  IF current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999 THEN RAISE EXCEPTION 'PG16 required'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='zhiban_bridge_runtime') THEN
    CREATE ROLE zhiban_bridge_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='zhiban_bridge_runtime' AND rolcanlogin AND NOT rolinherit AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolbypassrls AND NOT rolreplication)
    OR EXISTS(SELECT 1 FROM pg_auth_members AS m JOIN pg_roles AS r ON r.oid IN(m.roleid,m.member) WHERE r.rolname='zhiban_bridge_runtime') THEN
    RAISE EXCEPTION 'Bridge role contract rejected';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_roles AS r WHERE r.rolname='zhiban_bridge_runtime' AND (
      EXISTS(SELECT 1 FROM pg_class WHERE relowner=r.oid)
      OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner=r.oid)
      OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=r.oid)
      OR EXISTS(SELECT 1 FROM pg_type WHERE typowner=r.oid)
      OR EXISTS(SELECT 1 FROM pg_database WHERE datdba=r.oid))) THEN
    RAISE EXCEPTION 'Bridge runtime ownership rejected';
  END IF;
END; $$;
SELECT format('GRANT CONNECT ON DATABASE %I TO zhiban_bridge_runtime',current_database()) \gexec
DO $$ BEGIN
  IF has_database_privilege('zhiban_bridge_runtime',current_database(),'CREATE') OR has_database_privilege('zhiban_bridge_runtime',current_database(),'TEMPORARY') THEN
    RAISE EXCEPTION 'Bridge role database privileges rejected';
  END IF;
END; $$;
COMMIT;
