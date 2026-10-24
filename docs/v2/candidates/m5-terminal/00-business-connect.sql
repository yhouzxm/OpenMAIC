-- UNAPPLIED additive maintenance ACL. Business postgres administrator only.
-- Preserve approved ordinary Business access; remove PUBLIC-derived cross-DB access.
BEGIN;
DO $$ BEGIN
 IF current_database()<>'zhiban_m1_dev' OR session_user<>'postgres' OR current_user<>'postgres'
  OR current_setting('server_version_num')::integer NOT BETWEEN 160000 AND 169999 THEN
  RAISE EXCEPTION 'Owned Business PG16 administrator required';
 END IF;
END $$;
GRANT CONNECT ON DATABASE zhiban_m1_dev TO zhiban_identity_owner,zhiban_migrator,
 zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime,zhiban_bridge_runtime,zhiban_academic_runtime;
REVOKE CONNECT ON DATABASE zhiban_m1_dev FROM PUBLIC;
COMMIT;
