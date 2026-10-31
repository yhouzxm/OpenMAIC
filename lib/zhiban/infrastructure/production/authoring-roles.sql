-- Admin-only preparation for a separate PG18 authoring database.
-- Runtime never executes this source. No credentials are embedded.
BEGIN;
DO $$ DECLARE n text; r record; BEGIN
 IF current_setting('server_version_num')::int NOT BETWEEN 180000 AND 189999 THEN RAISE EXCEPTION 'PG18 required'; END IF;
 FOREACH n IN ARRAY ARRAY['zhiban_authoring_owner','zhiban_authoring_migrator','zhiban_authoring_runtime'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=n) THEN
   EXECUTE format('CREATE ROLE %I %s NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS',n,CASE WHEN n='zhiban_authoring_owner' THEN 'NOLOGIN' ELSE 'LOGIN' END);
  END IF;
  SELECT * INTO r FROM pg_roles WHERE rolname=n;
  IF r.rolsuper OR r.rolinherit OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls OR r.rolcanlogin<>(n<>'zhiban_authoring_owner') THEN RAISE EXCEPTION 'Authoring role attributes rejected'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles a ON a.oid=m.roleid JOIN pg_roles b ON b.oid=m.member WHERE (a.rolname LIKE 'zhiban_authoring_%' OR b.rolname LIKE 'zhiban_authoring_%') AND NOT(a.rolname='zhiban_authoring_owner' AND b.rolname='zhiban_authoring_migrator' AND NOT m.admin_option AND NOT m.inherit_option AND m.set_option)) THEN RAISE EXCEPTION 'Authoring role graph rejected'; END IF;
END $$;
GRANT zhiban_authoring_owner TO zhiban_authoring_migrator WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO zhiban_authoring_owner;
GRANT USAGE ON SCHEMA public TO zhiban_authoring_runtime;
DO $$ BEGIN
 EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC',current_database());
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO zhiban_authoring_migrator,zhiban_authoring_runtime',current_database());
END $$;
COMMIT;
