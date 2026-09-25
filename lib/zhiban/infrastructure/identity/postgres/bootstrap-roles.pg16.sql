-- PSQL-ONLY ADMIN BOOTSTRAP SCRIPT for a dedicated PostgreSQL 16 V2 database.
-- Canonical invocation: psql -X -f bootstrap-roles.pg16.sql (admin connection).
-- Never run through node-postgres, web startup, the migration runner, or against V1/OpenMAIC.
-- LOGIN credentials are provisioned out of band; this script contains no passwords.
\set ON_ERROR_STOP on
\set ON_ERROR_ROLLBACK off
BEGIN;

-- Roles are cluster-wide. An existing role is reusable only when its complete
-- security attributes and membership graph match this dedicated design.
DO $identity_roles$
DECLARE
  expected_role record;
  actual_role record;
  owner_oid oid;
  migrator_oid oid;
BEGIN
  FOR expected_role IN
    SELECT * FROM (VALUES
      ('zhiban_identity_owner', false),
      ('zhiban_migrator', true),
      ('zhiban_runtime', true),
      ('zhiban_auth_runtime', true),
      ('zhiban_control_runtime', true)
    ) AS expected(role_name, can_login)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = expected_role.role_name
    ) THEN
      EXECUTE format(
        'CREATE ROLE %I %s NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT',
        expected_role.role_name,
        CASE WHEN expected_role.can_login THEN 'LOGIN' ELSE 'NOLOGIN' END
      );
    END IF;

    SELECT oid, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
           rolbypassrls, rolreplication, rolinherit
      INTO actual_role
      FROM pg_catalog.pg_roles
      WHERE rolname = expected_role.role_name;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Required Identity role is missing: %', expected_role.role_name;
    END IF;
    IF actual_role.rolcanlogin IS DISTINCT FROM expected_role.can_login
       OR actual_role.rolsuper
       OR actual_role.rolcreatedb
       OR actual_role.rolcreaterole
       OR actual_role.rolbypassrls
       OR actual_role.rolreplication
       OR actual_role.rolinherit THEN
      RAISE EXCEPTION 'Unsafe existing Identity role attributes: %', expected_role.role_name;
    END IF;
  END LOOP;

  SELECT oid INTO owner_oid FROM pg_catalog.pg_roles WHERE rolname = 'zhiban_identity_owner';
  SELECT oid INTO migrator_oid FROM pg_catalog.pg_roles WHERE rolname = 'zhiban_migrator';

  -- Stronger than NOINHERIT: runtime roles have no outgoing or incoming role
  -- membership at all. Thus no direct or transitive INHERIT/SET ROLE path exists.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members membership
    JOIN pg_catalog.pg_roles runtime_role
      ON runtime_role.oid = membership.member OR runtime_role.oid = membership.roleid
    WHERE runtime_role.rolname IN (
      'zhiban_runtime', 'zhiban_auth_runtime', 'zhiban_control_runtime'
    )
  ) THEN
    RAISE EXCEPTION 'Runtime Identity role membership is forbidden';
  END IF;

  -- Explicitly inspect PG16 SET-capable transitive closure as defense in depth.
  IF EXISTS (
    WITH RECURSIVE set_paths AS (
      SELECT runtime_role.oid AS root_oid, membership.roleid AS target_oid,
             membership.set_option AS can_set, ARRAY[runtime_role.oid, membership.roleid] AS visited
      FROM pg_catalog.pg_roles runtime_role
      JOIN pg_catalog.pg_auth_members membership ON membership.member = runtime_role.oid
      WHERE runtime_role.rolname IN (
        'zhiban_runtime', 'zhiban_auth_runtime', 'zhiban_control_runtime'
      )
      UNION ALL
      SELECT path.root_oid, membership.roleid,
             path.can_set AND membership.set_option,
             path.visited || membership.roleid
      FROM set_paths path
      JOIN pg_catalog.pg_auth_members membership ON membership.member = path.target_oid
      WHERE NOT membership.roleid = ANY(path.visited)
    )
    SELECT 1 FROM set_paths WHERE can_set
  ) THEN
    RAISE EXCEPTION 'Runtime Identity role has a transitive SET ROLE path';
  END IF;

  -- The owner grants no capability to another role. The migrator may only
  -- receive the single approved owner edge, and no role may assume migrator.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = owner_oid)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid = migrator_oid)
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_auth_members
       WHERE member = migrator_oid AND roleid <> owner_oid
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_auth_members
       WHERE roleid = owner_oid AND member <> migrator_oid
     ) THEN
    RAISE EXCEPTION 'Unexpected Identity owner or migrator membership';
  END IF;

  IF (
    SELECT count(*) FROM pg_catalog.pg_auth_members
    WHERE member = migrator_oid AND roleid = owner_oid
  ) > 1 OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE member = migrator_oid AND roleid = owner_oid
      AND (admin_option OR inherit_option OR NOT set_option)
  ) THEN
    RAISE EXCEPTION 'Unsafe existing Identity migrator-to-owner membership';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE member = migrator_oid AND roleid = owner_oid
  ) THEN
    GRANT zhiban_identity_owner TO zhiban_migrator
      WITH ADMIN FALSE, INHERIT FALSE, SET TRUE;
  END IF;
END;
$identity_roles$;

-- Only after role attributes and membership pass: narrow privileges in this
-- dedicated database. Unexpected direct CREATE/TEMP grants are rejected, not
-- silently revoked from pre-existing roles.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
DO $identity_database$
DECLARE
  runtime_name text;
BEGIN
  EXECUTE format(
    'REVOKE CREATE, TEMPORARY ON DATABASE %I FROM PUBLIC', current_database()
  );
  FOR runtime_name IN
    SELECT unnest(ARRAY[
      'zhiban_runtime', 'zhiban_auth_runtime', 'zhiban_control_runtime'
    ])
  LOOP
    IF pg_catalog.has_database_privilege(runtime_name, current_database(), 'CREATE')
       OR pg_catalog.has_database_privilege(runtime_name, current_database(), 'TEMPORARY')
       OR pg_catalog.has_schema_privilege(runtime_name, 'public', 'CREATE') THEN
      RAISE EXCEPTION 'Unsafe effective Identity runtime DDL privilege: %', runtime_name;
    END IF;
  END LOOP;
  EXECUTE format(
    'GRANT CREATE ON DATABASE %I TO zhiban_identity_owner', current_database()
  );
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO zhiban_migrator, zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime',
    current_database()
  );
END;
$identity_database$;

-- Database-specific defaults do not affect roles used by other databases.
DO $identity_search_path$
DECLARE
  identity_role text;
BEGIN
  FOREACH identity_role IN ARRAY ARRAY[
    'zhiban_migrator', 'zhiban_runtime', 'zhiban_auth_runtime', 'zhiban_control_runtime'
  ] LOOP
    EXECUTE format(
      'ALTER ROLE %I IN DATABASE %I SET search_path = pg_catalog, zhiban_identity, pg_temp',
      identity_role, current_database()
    );
  END LOOP;
END;
$identity_search_path$;

COMMIT;
