-- UNAPPLIED; no new roles/role edges/password/default ACL or Native table DML.
REVOKE ALL ON SCHEMA zhiban_handoff FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA zhiban_handoff FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA zhiban_handoff FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA zhiban_handoff FROM PUBLIC;
DO $$ DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['schema_migrations','host_read_authorizations','clear_authorizations','clear_commits','guard_scopes','authorization_events'] LOOP
  EXECUTE format('ALTER TABLE zhiban_handoff.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE zhiban_handoff.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY handoff_owner_internal ON zhiban_handoff.%I TO zhiban_identity_owner USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA zhiban_handoff TO zhiban_control_runtime,zhiban_reconcile_controller;
GRANT EXECUTE ON FUNCTION zhiban_handoff.inspect_host_installation(uuid,uuid,text) TO zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_handoff.begin_clear(uuid,text,text),zhiban_handoff.commit_clear(uuid,text,text),zhiban_handoff.read_clear_result(uuid,text),zhiban_handoff.verify_clear_publication(uuid,text,text) TO zhiban_reconcile_controller;
-- Internal assert/consistency/trigger functions stay owner-only. No raw table grants.
