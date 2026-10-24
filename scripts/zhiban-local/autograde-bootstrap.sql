-- PSQL-only, dedicated owned LOCAL PG16 cluster. No role membership or Identity grant.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='zhiban_autograde_worker') THEN CREATE ROLE zhiban_autograde_worker LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='zhiban_autograde_worker' AND (NOT rolcanlogin OR rolinherit OR rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls OR rolreplication)) OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='zhiban_autograde_worker') OR roleid=(SELECT oid FROM pg_roles WHERE rolname='zhiban_autograde_worker')) THEN RAISE EXCEPTION 'Auto grade service role rejected'; END IF;
END $$;
