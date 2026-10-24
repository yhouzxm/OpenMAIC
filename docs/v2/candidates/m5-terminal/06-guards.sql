-- UNAPPLIED. Private scope is minted by finalize after current grant/barrier proof.
CREATE FUNCTION zhiban_reconcile.service_write_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE s zhiban_reconcile.write_scopes%ROWTYPE;
BEGIN
 IF session_user<>'zhiban_reconcile_executor' THEN
  IF TG_TABLE_NAME='audit_events' AND TG_OP='INSERT' THEN
   IF NEW.reconciliation_id IS NOT NULL OR (TG_TABLE_SCHEMA='zhiban_content' AND NEW.actor_kind='SERVICE_RECONCILE') THEN
    RAISE EXCEPTION 'Service audit requires executor capability' USING ERRCODE='42501';
   END IF;
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO s FROM zhiban_reconcile.write_scopes WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 IF NOT FOUND OR NEW.tenant_id IS DISTINCT FROM s.tenant_id THEN RAISE EXCEPTION 'Private write capability missing'; END IF;
 IF TG_TABLE_SCHEMA='zhiban_content' AND TG_TABLE_NAME='operations' AND TG_OP='UPDATE' THEN
  IF NEW.id=s.content_operation_id AND NEW.state='FAILED' AND NEW.completed_at=s.completed_at
   AND NEW.bridge_operation_id IS NULL AND NEW.result_revision IS NULL AND NEW.result_publication_id IS NULL THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_SCHEMA='zhiban_bridge' AND TG_TABLE_NAME='operations' AND TG_OP='UPDATE' THEN
  IF NEW.operation_id=s.prepare_operation_id AND NEW.state='SUCCEEDED' AND NEW.updated_at=s.completed_at AND NEW.completed_at=s.completed_at
   AND NEW.reason='NONE' AND NEW.result_generation_id=s.generation_id THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_SCHEMA='zhiban_bridge' AND TG_TABLE_NAME='resource_generations' AND TG_OP='UPDATE' THEN
  IF NEW.generation_id=s.generation_id AND NEW.state='ORPHAN' AND NEW.terminal_at=s.completed_at AND NEW.updated_at=s.completed_at AND NEW.activated_at IS NULL THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_SCHEMA='zhiban_content' AND TG_TABLE_NAME='audit_events' AND TG_OP='INSERT' THEN
  IF NEW.id=s.content_audit_id AND NEW.operation_id=s.content_operation_id AND NEW.resource_id=s.resource_id
   AND NEW.actor_kind='SERVICE_RECONCILE' AND NEW.actor_id IS NULL AND NEW.reconciliation_id=s.resolution_id AND NEW.occurred_at=s.completed_at THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_SCHEMA='zhiban_bridge' AND TG_TABLE_NAME='audit_events' AND TG_OP='INSERT' THEN
  IF NEW.event_id=s.bridge_audit_id AND NEW.operation_id=s.prepare_operation_id AND NEW.actor_kind='SERVICE_RECONCILE'
   AND NEW.actor_user_id IS NULL AND NEW.actor_membership_id IS NULL AND NEW.reconciliation_id=s.resolution_id AND NEW.occurred_at=s.completed_at THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Service mutation outside exact capability' USING ERRCODE='42501';
END $$;
CREATE OR REPLACE FUNCTION zhiban_bridge.business_resource_ready(p_tenant_id uuid,p_activity_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,zhiban_content,zhiban_identity,pg_temp SET row_security=on AS $$
BEGIN
 IF p_tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id() THEN RETURN false; END IF;
 IF session_user NOT IN('zhiban_bridge_runtime','zhiban_reconcile_executor') THEN RETURN false; END IF;
 IF session_user='zhiban_reconcile_executor' AND NOT EXISTS(SELECT 1 FROM zhiban_reconcile.write_scopes
  WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND tenant_id=p_tenant_id AND resource_id=p_activity_id) THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM zhiban_content.resources WHERE tenant_id=p_tenant_id AND id=p_activity_id AND kind='SLIDE_CONTENT' AND policy_version='content-text-v1');
END $$;
CREATE FUNCTION zhiban_reconcile.history_constraint() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE r uuid;
BEGIN
 IF TG_TABLE_NAME='resolutions' THEN r:=NEW.resolution_id;
 ELSIF TG_TABLE_NAME='grants' THEN
  SELECT consumed_resolution_id INTO r FROM zhiban_reconcile.grants WHERE tenant_id=NEW.tenant_id AND grant_id=NEW.grant_id;
  IF r IS NULL THEN RETURN NULL; END IF;
 ELSE r:=NEW.reconciliation_id; IF r IS NULL THEN RETURN NULL; END IF;
 END IF;
 IF NOT zhiban_reconcile.assert_resolution_history(NEW.tenant_id,r) THEN RAISE EXCEPTION 'Resolution/audit reverse edge rejected' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION zhiban_reconcile.window_constraint() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE w zhiban_reconcile.windows%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='windows' THEN SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=NEW.window_id;
 ELSE
  IF NEW.current_window_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=NEW.current_window_id;
 END IF;
 IF w.predecessor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM zhiban_reconcile.windows previous
  WHERE previous.window_id=w.predecessor_id AND previous.successor_id=w.window_id AND previous.phase='SUPERSEDED'
   AND previous.deployment_id=w.deployment_id AND previous.epoch<w.epoch) THEN RAISE EXCEPTION 'Predecessor edge rejected'; END IF;
 IF w.phase='SUPERSEDED' THEN
  IF NOT EXISTS(SELECT 1 FROM zhiban_reconcile.windows n WHERE n.window_id=w.successor_id AND n.predecessor_id=w.window_id
   AND n.deployment_id=w.deployment_id AND n.epoch>w.epoch) OR EXISTS(SELECT 1 FROM zhiban_reconcile.window_database_claims WHERE current_window_id=w.window_id) THEN RAISE EXCEPTION 'Successor edge rejected'; END IF;
 ELSIF w.phase='CLOSED' THEN
  IF EXISTS(SELECT 1 FROM zhiban_reconcile.window_database_claims WHERE current_window_id=w.window_id) THEN RAISE EXCEPTION 'Closed claim retained'; END IF;
 ELSE
  IF (SELECT count(*) FROM zhiban_reconcile.window_database_claims WHERE current_window_id=w.window_id AND cluster_identifier=w.cluster_identifier AND database_oid IN(w.business_oid,w.native_oid))<>2 THEN RAISE EXCEPTION 'Active claim missing'; END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION zhiban_reconcile.state_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,zhiban_reconcile,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reconcile ledger delete rejected'; END IF;
 IF TG_TABLE_NAME='grants' THEN
  IF OLD.status<>'ISSUED' OR NEW.status NOT IN('REVOKED','CONSUMED')
   OR (to_jsonb(NEW)-ARRAY['status','consumed_resolution_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','consumed_resolution_id']) THEN RAISE EXCEPTION 'Grant mutation rejected'; END IF;
 ELSIF TG_TABLE_NAME='windows' THEN
  IF OLD.phase IN('CLOSED','SUPERSEDED') OR (to_jsonb(NEW)-ARRAY['phase','successor_id','allowlist','barrier_seq','barrier_at','lease_until'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['phase','successor_id','allowlist','barrier_seq','barrier_at','lease_until'])
   OR (NEW.allowlist IS DISTINCT FROM OLD.allowlist AND OLD.phase<>'PREPARING')
   OR NEW.barrier_seq<OLD.barrier_seq
   OR NOT(NEW.phase=OLD.phase OR NEW.phase='BLOCKED' OR
    (OLD.phase='PREPARING' AND NEW.phase='DRAINED') OR (OLD.phase IN('DRAINED','PROVING','SETTLING') AND NEW.phase='RESUMING') OR
    (OLD.phase='RESUMING' AND NEW.phase='CLOSED') OR (OLD.phase='BLOCKED' AND NEW.phase='SUPERSEDED')) THEN RAISE EXCEPTION 'Window mutation rejected'; END IF;
 ELSIF TG_TABLE_NAME='epoch_counters' THEN
  IF NEW.deployment_id<>OLD.deployment_id OR NEW.epoch<>OLD.epoch+1 THEN RAISE EXCEPTION 'Epoch transition rejected'; END IF;
 ELSIF TG_TABLE_NAME='services' THEN
  IF (to_jsonb(NEW)-ARRAY['authorization_version','status']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['authorization_version','status']) OR NEW.authorization_version<>OLD.authorization_version+1 THEN RAISE EXCEPTION 'Service version rejected'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE s text;t text;BEGIN
 FOREACH t IN ARRAY ARRAY['service_versions','proofs','resolutions','control_events','attempts'] LOOP
  EXECUTE format('CREATE TRIGGER reconcile_immutable BEFORE UPDATE OR DELETE ON zhiban_reconcile.%I FOR EACH ROW EXECUTE FUNCTION zhiban_reconcile.append_only()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['grants','windows','services','epoch_counters'] LOOP
  EXECUTE format('CREATE TRIGGER reconcile_history BEFORE UPDATE OR DELETE ON zhiban_reconcile.%I FOR EACH ROW EXECUTE FUNCTION zhiban_reconcile.state_guard()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['resolutions','grants'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER reconcile_history_consistency AFTER INSERT OR UPDATE ON zhiban_reconcile.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_reconcile.history_constraint()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['windows','window_database_claims'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER reconcile_window_consistency AFTER INSERT OR UPDATE ON zhiban_reconcile.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_reconcile.window_constraint()',t);
 END LOOP;
 FOREACH s IN ARRAY ARRAY['zhiban_content','zhiban_bridge'] LOOP
  FOREACH t IN ARRAY ARRAY['operations','audit_events'] LOOP
   EXECUTE format('CREATE TRIGGER reconcile_exact_write BEFORE INSERT OR UPDATE ON %I.%I FOR EACH ROW EXECUTE FUNCTION zhiban_reconcile.service_write_guard()',s,t);
  END LOOP;
  EXECUTE format('CREATE CONSTRAINT TRIGGER reconcile_audit_consistency AFTER INSERT ON %I.audit_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_reconcile.history_constraint()',s);
 END LOOP;
END $$;
CREATE TRIGGER reconcile_exact_write BEFORE INSERT OR UPDATE ON zhiban_bridge.resource_generations
 FOR EACH ROW EXECUTE FUNCTION zhiban_reconcile.service_write_guard();
