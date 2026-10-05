-- Admin-only, separate empty private database; credentials are out of band.
\set ON_ERROR_STOP on
BEGIN;
DO $$ DECLARE n text; r record; BEGIN
  IF current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999 THEN RAISE EXCEPTION 'PG16 required'; END IF;
  FOREACH n IN ARRAY ARRAY['zhiban_openmaic_owner','zhiban_openmaic_migrator','zhiban_openmaic_runtime'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=n) THEN
      EXECUTE format('CREATE ROLE %I %s NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION',n,CASE WHEN n='zhiban_openmaic_owner' THEN 'NOLOGIN' ELSE 'LOGIN' END);
    END IF;
    SELECT * INTO r FROM pg_roles WHERE rolname=n;
    IF r.rolsuper OR r.rolinherit OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication OR r.rolcanlogin<>(n<>'zhiban_openmaic_owner') THEN RAISE EXCEPTION 'Native role contract rejected'; END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM pg_roles AS native_role WHERE native_role.rolname IN ('zhiban_openmaic_runtime','zhiban_openmaic_migrator') AND (
      EXISTS(SELECT 1 FROM pg_class WHERE relowner=native_role.oid)
      OR EXISTS(SELECT 1 FROM pg_proc WHERE proowner=native_role.oid)
      OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=native_role.oid)
      OR EXISTS(SELECT 1 FROM pg_type WHERE typowner=native_role.oid)
      OR EXISTS(SELECT 1 FROM pg_database WHERE datdba=native_role.oid))) THEN
    RAISE EXCEPTION 'Native runtime ownership rejected';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_auth_members AS m JOIN pg_roles AS a ON a.oid=m.roleid JOIN pg_roles AS b ON b.oid=m.member
    WHERE (a.rolname LIKE 'zhiban_openmaic_%' OR b.rolname LIKE 'zhiban_openmaic_%')
      AND NOT(a.rolname='zhiban_openmaic_owner' AND b.rolname='zhiban_openmaic_migrator' AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option)) THEN RAISE EXCEPTION 'Native role membership rejected'; END IF;
END; $$;
GRANT zhiban_openmaic_owner TO zhiban_openmaic_migrator WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO zhiban_openmaic_owner;
GRANT USAGE ON SCHEMA public TO zhiban_openmaic_runtime;
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC',current_database()) \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM %I',current_database(),rolname)
FROM pg_roles WHERE rolname IN ('zhiban_runtime','zhiban_auth_runtime','zhiban_control_runtime','zhiban_bridge_runtime','zhiban_migrator','zhiban_identity_owner') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO zhiban_openmaic_migrator,zhiban_openmaic_runtime',current_database()) \gexec
COMMIT;
