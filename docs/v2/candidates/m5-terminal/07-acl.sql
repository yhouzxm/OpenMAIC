-- UNAPPLIED Business ACL. Owner helpers are the only new mutation entry points.
REVOKE ALL ON SCHEMA zhiban_reconcile FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA zhiban_reconcile FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA zhiban_reconcile FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA zhiban_reconcile FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_reconcile TO zhiban_reconcile_controller,zhiban_reconcile_issuer,zhiban_reconcile_executor;
GRANT USAGE ON SCHEMA zhiban_identity TO zhiban_reconcile_controller,zhiban_reconcile_issuer,zhiban_reconcile_executor;
GRANT EXECUTE ON FUNCTION zhiban_identity.current_tenant_id() TO zhiban_reconcile_controller,zhiban_reconcile_issuer,zhiban_reconcile_executor;
DO $$ DECLARE t text;s text;BEGIN
 FOREACH t IN ARRAY ARRAY['installations','services','service_versions','controller_authorizations','epoch_counters','windows','window_database_claims','control_events','write_scopes'] LOOP
  EXECUTE format('ALTER TABLE zhiban_reconcile.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE zhiban_reconcile.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY reconcile_owner_internal ON zhiban_reconcile.%I TO zhiban_identity_owner USING(true) WITH CHECK(true)',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['grants','proofs','resolutions','lookup_permissions','attempts'] LOOP
  EXECUTE format('ALTER TABLE zhiban_reconcile.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE zhiban_reconcile.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY reconcile_owner_scope ON zhiban_reconcile.%I TO zhiban_identity_owner USING(tenant_id=zhiban_identity.current_tenant_id() OR session_user=''zhiban_reconcile_controller'') WITH CHECK(tenant_id=zhiban_identity.current_tenant_id() OR session_user=''zhiban_reconcile_controller'')',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['resources','publications','operations','audit_events'] LOOP
  EXECUTE format('CREATE POLICY terminal_owner_history ON zhiban_content.%I FOR SELECT TO zhiban_identity_owner USING(tenant_id=zhiban_identity.current_tenant_id())',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['operations','audit_events'] LOOP
  EXECUTE format('CREATE POLICY terminal_owner_write ON zhiban_content.%I TO zhiban_identity_owner USING(session_user=''zhiban_reconcile_executor'' AND tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(session_user=''zhiban_reconcile_executor'' AND tenant_id=zhiban_identity.current_tenant_id())',t);
 END LOOP;
 CREATE POLICY terminal_operation_owner_lock ON zhiban_content.operations FOR UPDATE TO zhiban_identity_owner
  USING(session_user='zhiban_reconcile_issuer' AND tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(false);
 CREATE POLICY terminal_resource_owner_lock ON zhiban_content.resources FOR UPDATE TO zhiban_identity_owner
  USING(session_user IN('zhiban_reconcile_issuer','zhiban_reconcile_executor') AND tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(false);
 FOREACH t IN ARRAY ARRAY['courses','offerings'] LOOP
  EXECUTE format('CREATE POLICY terminal_owner_read ON zhiban_academic.%I FOR SELECT TO zhiban_identity_owner USING(tenant_id=zhiban_identity.current_tenant_id())',t);
  EXECUTE format('CREATE POLICY terminal_owner_lock ON zhiban_academic.%I FOR UPDATE TO zhiban_identity_owner USING(session_user IN(''zhiban_reconcile_issuer'',''zhiban_reconcile_executor'') AND tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(false)',t);
 END LOOP;
 CREATE POLICY terminal_tenant_owner_read ON zhiban_identity.tenants FOR SELECT TO zhiban_identity_owner USING(tenant_id=zhiban_identity.current_tenant_id());
 CREATE POLICY terminal_tenant_owner_lock ON zhiban_identity.tenants FOR UPDATE TO zhiban_identity_owner
  USING(session_user IN('zhiban_reconcile_issuer','zhiban_reconcile_executor') AND tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(false);
END $$;
GRANT EXECUTE ON FUNCTION
 zhiban_reconcile.inspect_proposal(uuid,uuid,uuid),
 zhiban_reconcile.issue_grant(uuid,uuid,uuid,uuid,uuid,text,text,text),
 zhiban_reconcile.revoke_grant(uuid,uuid,uuid)
 TO zhiban_reconcile_issuer;
GRANT EXECUTE ON FUNCTION zhiban_reconcile.inspect_proposal(uuid,uuid,uuid) TO zhiban_reconcile_executor;
GRANT EXECUTE ON FUNCTION
 zhiban_reconcile.register_proof(uuid,uuid,text,uuid,text,text,jsonb),
 zhiban_reconcile.finalize_cancel_unpublished(uuid,uuid,text,uuid,uuid,uuid)
 TO zhiban_reconcile_executor;
GRANT EXECUTE ON FUNCTION zhiban_reconcile.read_resolution(uuid,uuid,uuid,uuid,text)
 TO zhiban_reconcile_issuer,zhiban_reconcile_executor;
GRANT EXECUTE ON FUNCTION
 zhiban_reconcile.open_window(uuid,text,uuid,text,text),
 zhiban_reconcile.renew_barrier(uuid,text),
 zhiban_reconcile.takeover_blocked_window(uuid,uuid,uuid,text,text),
 zhiban_reconcile.begin_resume(uuid,text),zhiban_reconcile.complete_resume(uuid,text),
 zhiban_reconcile.set_service_status(text,text,text,text),
 zhiban_reconcile.issue_result_lookup(uuid,uuid,uuid,uuid,uuid,text,text,text,text),
 zhiban_reconcile.revoke_result_lookup(uuid,uuid,text,text),
 zhiban_reconcile.read_recovery_result(uuid,uuid,uuid,uuid,text),
 zhiban_reconcile.read_takeover_result(uuid,uuid,uuid,uuid,text),
 zhiban_reconcile.read_closed_result(uuid,uuid,bigint,text)
 TO zhiban_reconcile_controller;
-- No client table grants; no PUBLIC EXECUTE/default ACL change/owner SET ROLE edge.
-- Existing Bridge runtime proacl is retained for the four replaced functions.
-- Migration owner is already table owner: do not grant runtime extra columns.
