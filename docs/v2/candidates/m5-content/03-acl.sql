-- UNAPPLIED 0001_content component 3/3. Exact grants; no role/bootstrap creation.
-- New owner policies are visible to the content-enabled Academic receipt profile.
-- Existing tenant_scope policies, frozen helpers, grants and ledgers stay intact.
REVOKE ALL ON SCHEMA zhiban_content FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_content TO zhiban_bridge_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA zhiban_content FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA zhiban_content FROM PUBLIC;
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['resources','publications','operations','audit_events'] LOOP
  EXECUTE format('ALTER TABLE zhiban_content.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE zhiban_content.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY content_read ON zhiban_content.%I FOR SELECT TO zhiban_bridge_runtime,zhiban_identity_owner USING(session_user=''zhiban_bridge_runtime'' AND tenant_id=zhiban_identity.current_tenant_id())',table_name);
  EXECUTE format('CREATE POLICY content_insert ON zhiban_content.%I FOR INSERT TO zhiban_bridge_runtime WITH CHECK(session_user=''zhiban_bridge_runtime'' AND tenant_id=zhiban_identity.current_tenant_id())',table_name);
  EXECUTE format('GRANT SELECT,INSERT ON zhiban_content.%I TO zhiban_bridge_runtime',table_name);
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['resources','operations'] LOOP
  EXECUTE format('CREATE POLICY content_update ON zhiban_content.%I FOR UPDATE TO zhiban_bridge_runtime USING(session_user=''zhiban_bridge_runtime'' AND tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(session_user=''zhiban_bridge_runtime'' AND tenant_id=zhiban_identity.current_tenant_id())',table_name);
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['courses','offerings','assignments','enrollments'] LOOP
  EXECUTE format('CREATE POLICY content_owner_read ON zhiban_academic.%I FOR SELECT TO zhiban_identity_owner USING(session_user=''zhiban_bridge_runtime'' AND tenant_id=zhiban_identity.current_tenant_id())',table_name);
  -- SELECT FOR SHARE needs applicable UPDATE policy, but actual UPDATE fails.
  EXECUTE format('CREATE POLICY content_owner_lock ON zhiban_academic.%I FOR UPDATE TO zhiban_identity_owner USING(session_user=''zhiban_bridge_runtime'' AND tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(false)',table_name);
 END LOOP;
END $$;
GRANT UPDATE(title,draft,state,revision,active_publication_id,last_publication_no,updated_by,updated_at)
 ON zhiban_content.resources TO zhiban_bridge_runtime;
GRANT UPDATE(state,prepare_operation_id,bridge_operation_id,result_publication_id,result_revision,completed_at)
 ON zhiban_content.operations TO zhiban_bridge_runtime;
GRANT SELECT ON zhiban_content.schema_migrations TO zhiban_bridge_runtime;
GRANT EXECUTE ON FUNCTION zhiban_content.utf16_length(text),zhiban_content.valid_draft(jsonb),
 zhiban_content.draft_digest(jsonb),zhiban_content.lock_business_context(uuid,uuid,uuid,uuid,text)
 TO zhiban_bridge_runtime;
-- Do NOT grant runtime direct EXECUTE on trigger functions or Academic raw DML.
-- CREATE OR REPLACE business_resource_ready preserves original owner/proacl.
-- The installer MUST verify these and exact existing Bridge schema/EXECUTE ACL.
-- No native database CONNECT, credentials, role membership, broad default ACL,
-- SECURITY DEFINER business mutation, DDL/TRUNCATE/DELETE/REFERENCES/TRIGGER grants.
