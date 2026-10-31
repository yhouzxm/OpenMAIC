-- Installation-only PG18 service roles. No Identity membership or owner capability.
\set ON_ERROR_STOP on
BEGIN;
DO $$ DECLARE name text; r record; BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 180000 AND 189999 THEN RAISE EXCEPTION 'PG18 required'; END IF;
 FOREACH name IN ARRAY ARRAY['zhiban_academic_runtime','zhiban_autograde_worker'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=name) THEN
   EXECUTE format('CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION',name);
  END IF;
  SELECT * INTO r FROM pg_roles WHERE rolname=name;
  IF NOT r.rolcanlogin OR r.rolinherit OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolbypassrls OR r.rolreplication
   OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) THEN RAISE EXCEPTION 'Service role contract rejected'; END IF;
 END LOOP;
END $$;
COMMIT;
