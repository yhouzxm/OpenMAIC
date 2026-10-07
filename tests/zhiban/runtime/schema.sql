-- Disposable C9 contract fixture. Never a shipped Identity migration.
CREATE SCHEMA zhiban_runtime_contract_test AUTHORIZATION zhiban_identity_owner;
SET LOCAL ROLE zhiban_identity_owner;
SET LOCAL search_path=pg_catalog,zhiban_runtime_contract_test,zhiban_identity,pg_temp;
CREATE DOMAIN zhiban_runtime_contract_test.u AS uuid CHECK(VALUE IS NULL OR zhiban_identity.is_uuid_v7(VALUE));
CREATE DOMAIN zhiban_runtime_contract_test.r AS bigint CHECK(VALUE>0);
CREATE DOMAIN zhiban_runtime_contract_test.t AS bigint CHECK(VALUE BETWEEN 0 AND 8640000000000000);
CREATE DOMAIN zhiban_runtime_contract_test.h AS text COLLATE "C" CHECK(VALUE ~ '^[0-9a-f]{64}$');
CREATE DOMAIN zhiban_runtime_contract_test.o AS text COLLATE "C" CHECK(VALUE ~ '^[A-Za-z0-9_-]{43}$');
CREATE DOMAIN zhiban_runtime_contract_test.q AS text CHECK(octet_length(VALUE) BETWEEN 1 AND 256 AND VALUE !~ '[[:cntrl:]]');
CREATE TABLE zhiban_runtime_contract_test.resources(
 tenant_id u NOT NULL REFERENCES zhiban_identity.tenants(tenant_id),slot_id u NOT NULL,generation_id u NOT NULL,stage_ref o NOT NULL,
 state text NOT NULL CHECK(state IN ('ENABLED','SUSPENDED','TRANSFERRING','RETIRED')),
 PRIMARY KEY(tenant_id,slot_id,generation_id),UNIQUE(tenant_id,generation_id),UNIQUE(tenant_id,stage_ref));
CREATE TABLE zhiban_runtime_contract_test.attempts(
 tenant_id u NOT NULL,attempt_id u NOT NULL,slot_id u NOT NULL,generation_id u NOT NULL,learner_membership_id u NOT NULL,
 state text NOT NULL CHECK(state IN ('ACTIVE','CLOSED','REVOKED')),PRIMARY KEY(tenant_id,attempt_id),
 UNIQUE(tenant_id,attempt_id,slot_id,generation_id,learner_membership_id),
 FOREIGN KEY(tenant_id,slot_id,generation_id) REFERENCES zhiban_runtime_contract_test.resources(tenant_id,slot_id,generation_id),
 FOREIGN KEY(tenant_id,learner_membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id));
CREATE TABLE zhiban_runtime_contract_test.scenes(
 tenant_id u NOT NULL,generation_id u NOT NULL,scene_binding_id u NOT NULL,scene_ref q NOT NULL,
 PRIMARY KEY(tenant_id,generation_id,scene_binding_id),UNIQUE(tenant_id,generation_id,scene_ref),
 FOREIGN KEY(tenant_id,generation_id) REFERENCES zhiban_runtime_contract_test.resources(tenant_id,generation_id));
CREATE TABLE zhiban_runtime_contract_test.runtime_bindings(
 tenant_id u NOT NULL,runtime_binding_id u NOT NULL,slot_id u NOT NULL,generation_id u NOT NULL,attempt_id u NOT NULL,learner_membership_id u NOT NULL,
 runtime_ref o NOT NULL UNIQUE,learner_handle o NOT NULL UNIQUE,kind text NOT NULL CHECK(kind='chat'),
 status text NOT NULL CHECK(status IN ('PENDING','ACTIVE','COMPLETED','ARCHIVED','FAILED')),repository_revision r NOT NULL,
 outstanding_operation_id u,expected_last_seq bigint CHECK(expected_last_seq BETWEEN 0 AND 127),record_count bigint NOT NULL CHECK(record_count BETWEEN 0 AND 128),
 record_bytes bigint NOT NULL CHECK(record_bytes BETWEEN 0 AND 2097152),native_updated_at t,created_at t NOT NULL,updated_at t NOT NULL CHECK(updated_at>=created_at),
 PRIMARY KEY(tenant_id,runtime_binding_id),UNIQUE(tenant_id,runtime_binding_id,generation_id),UNIQUE(tenant_id,attempt_id,kind),
 FOREIGN KEY(tenant_id,attempt_id,slot_id,generation_id,learner_membership_id) REFERENCES zhiban_runtime_contract_test.attempts(tenant_id,attempt_id,slot_id,generation_id,learner_membership_id),
 FOREIGN KEY(tenant_id,learner_membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id),
 CHECK(((record_count=0 AND expected_last_seq IS NULL AND record_bytes=0) OR (record_count>0 AND expected_last_seq=record_count-1 AND record_bytes>0)) IS TRUE),
 CHECK((status IN ('PENDING','FAILED') AND record_count=0 AND native_updated_at IS NULL) OR (status IN ('ACTIVE','COMPLETED','ARCHIVED') AND native_updated_at IS NOT NULL AND native_updated_at BETWEEN created_at AND updated_at)));
CREATE TABLE zhiban_runtime_contract_test.runtime_operations(
 tenant_id u NOT NULL,operation_id u NOT NULL,runtime_binding_id u NOT NULL,generation_id u NOT NULL,actor_kind text NOT NULL DEFAULT 'USER' CHECK(actor_kind='USER'),
 actor_user_id u NOT NULL REFERENCES zhiban_identity.users(user_id),actor_membership_id u NOT NULL,request_id q NOT NULL,
 command text NOT NULL CHECK(command IN ('CREATE_RUNTIME','APPEND_USER_RECORD','APPEND_ASSISTANT_RECORD','COMPLETE_RUNTIME','ARCHIVE_RUNTIME')),
 key_digest h NOT NULL,intent_digest h NOT NULL,expected_binding_revision r NOT NULL,reserved_binding_revision r NOT NULL CHECK(reserved_binding_revision::numeric=expected_binding_revision::numeric+1),
 expected_authorization_version bigint NOT NULL CHECK(expected_authorization_version BETWEEN 0 AND 9007199254740991),
 expected_last_seq bigint CHECK(expected_last_seq BETWEEN 0 AND 127),prior_status text NOT NULL CHECK(prior_status IN ('PENDING','ACTIVE','COMPLETED','ARCHIVED','FAILED')),
 prior_record_count bigint NOT NULL CHECK(prior_record_count BETWEEN 0 AND 128),prior_record_bytes bigint NOT NULL CHECK(prior_record_bytes BETWEEN 0 AND 2097152),
 record_id u,native_record_ref o,scene_binding_id u,payload_digest h,payload_bytes bigint CHECK(payload_bytes BETWEEN 1 AND 8192),record_serialized_bytes bigint CHECK(record_serialized_bytes BETWEEN 1 AND 16384),
 target_status text CHECK(target_status IN ('COMPLETED','ARCHIVED')),state text NOT NULL CHECK(state IN ('RESERVED','SUCCEEDED','FAILED','OUTCOME_UNKNOWN')),repository_revision r NOT NULL,
 dispatch_started_at t,result_binding_revision r,result_last_seq bigint CHECK(result_last_seq BETWEEN 0 AND 127),
 reason text NOT NULL CHECK(reason IN ('NONE','DENIED','STALE','INVALID_INPUT','BUDGET_EXCEEDED','STORAGE_FAILURE','INTEGRITY_FAILURE','CANCELLED','UNKNOWN_OUTCOME')),
 created_at t NOT NULL,updated_at t NOT NULL CHECK(updated_at>=created_at),completed_at t,
 PRIMARY KEY(tenant_id,operation_id),UNIQUE(tenant_id,runtime_binding_id,operation_id),UNIQUE(tenant_id,actor_membership_id,runtime_binding_id,command,key_digest),
 FOREIGN KEY(tenant_id,runtime_binding_id,generation_id) REFERENCES zhiban_runtime_contract_test.runtime_bindings(tenant_id,runtime_binding_id,generation_id),
 FOREIGN KEY(tenant_id,actor_membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id),
 FOREIGN KEY(tenant_id,generation_id,scene_binding_id) REFERENCES zhiban_runtime_contract_test.scenes(tenant_id,generation_id,scene_binding_id),
 CHECK(((prior_record_count=0 AND expected_last_seq IS NULL AND prior_record_bytes=0) OR (prior_record_count>0 AND expected_last_seq=prior_record_count-1 AND prior_record_bytes>0)) IS TRUE),
 CHECK(((command IN ('APPEND_USER_RECORD','APPEND_ASSISTANT_RECORD') AND prior_status='ACTIVE' AND prior_record_count<128 AND prior_record_bytes+record_serialized_bytes<=2097152 AND record_id IS NOT NULL AND native_record_ref IS NOT NULL AND payload_digest IS NOT NULL AND payload_bytes IS NOT NULL AND record_serialized_bytes IS NOT NULL AND target_status IS NULL)
 OR (command NOT IN ('APPEND_USER_RECORD','APPEND_ASSISTANT_RECORD') AND record_id IS NULL AND native_record_ref IS NULL AND scene_binding_id IS NULL AND payload_digest IS NULL AND payload_bytes IS NULL AND record_serialized_bytes IS NULL AND
 ((command='CREATE_RUNTIME' AND prior_status='PENDING' AND prior_record_count=0 AND target_status IS NULL) OR (command='COMPLETE_RUNTIME' AND prior_status='ACTIVE' AND target_status='COMPLETED') OR (command='ARCHIVE_RUNTIME' AND prior_status IN ('ACTIVE','COMPLETED') AND target_status='ARCHIVED')))) IS TRUE),
 CHECK(dispatch_started_at IS NULL OR dispatch_started_at BETWEEN created_at AND updated_at),
 CHECK((state IN ('RESERVED','OUTCOME_UNKNOWN') AND completed_at IS NULL AND result_binding_revision IS NULL AND result_last_seq IS NULL AND ((state='RESERVED' AND reason='NONE') OR (state='OUTCOME_UNKNOWN' AND reason='UNKNOWN_OUTCOME' AND dispatch_started_at IS NOT NULL)))
 OR (state IN ('SUCCEEDED','FAILED') AND completed_at IS NOT NULL AND completed_at BETWEEN coalesce(dispatch_started_at,created_at) AND updated_at AND result_binding_revision IS NOT NULL AND result_binding_revision::numeric=reserved_binding_revision::numeric+1 AND
 ((state='SUCCEEDED' AND reason='NONE' AND dispatch_started_at IS NOT NULL) OR (state='FAILED' AND reason NOT IN ('NONE','UNKNOWN_OUTCOME'))))),
 CHECK(state NOT IN ('SUCCEEDED','FAILED') OR result_last_seq IS NOT DISTINCT FROM (CASE WHEN state='SUCCEEDED' AND command IN ('APPEND_USER_RECORD','APPEND_ASSISTANT_RECORD') THEN prior_record_count ELSE expected_last_seq END)));
CREATE UNIQUE INDEX runtime_one_fence ON zhiban_runtime_contract_test.runtime_operations(tenant_id,runtime_binding_id) WHERE state IN ('RESERVED','OUTCOME_UNKNOWN');
CREATE UNIQUE INDEX runtime_native_record ON zhiban_runtime_contract_test.runtime_operations(native_record_ref) WHERE native_record_ref IS NOT NULL;
CREATE UNIQUE INDEX runtime_record_id ON zhiban_runtime_contract_test.runtime_operations(tenant_id,record_id) WHERE record_id IS NOT NULL;
ALTER TABLE zhiban_runtime_contract_test.runtime_bindings ADD FOREIGN KEY(tenant_id,outstanding_operation_id) REFERENCES zhiban_runtime_contract_test.runtime_operations(tenant_id,operation_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE zhiban_runtime_contract_test.runtime_audit_events(
 tenant_id u NOT NULL,event_id u NOT NULL,runtime_binding_id u NOT NULL,operation_id u NOT NULL,actor_user_id u NOT NULL REFERENCES zhiban_identity.users(user_id),actor_membership_id u NOT NULL,
 request_id q NOT NULL,event_type text NOT NULL CHECK(event_type IN ('RUNTIME_RESERVED','DISPATCH_MARKED','RUNTIME_SETTLED','RUNTIME_FAILED','OUTCOME_QUARANTINED','OUTCOME_RECONCILED')),
 binding_revision_before r NOT NULL,binding_revision_after r NOT NULL,operation_revision r NOT NULL,reason text NOT NULL,occurred_at t NOT NULL,
 PRIMARY KEY(tenant_id,event_id),UNIQUE(tenant_id,operation_id,operation_revision),
 FOREIGN KEY(tenant_id,runtime_binding_id,operation_id) REFERENCES zhiban_runtime_contract_test.runtime_operations(tenant_id,runtime_binding_id,operation_id),
 FOREIGN KEY(tenant_id,actor_membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id));

CREATE FUNCTION zhiban_runtime_contract_test.runtime_parent_context(p_tenant_id uuid,p_slot_id uuid,p_generation_id uuid,p_attempt_id uuid,p_learner_membership_id uuid)
RETURNS TABLE(resource_state text,attempt_state text,stage_ref text) LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_runtime_contract_test,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE resource_row record; attempt_row record;
BEGIN
 IF session_user<>'zhiban_bridge_runtime' OR p_tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id() OR NOT(zhiban_identity.is_uuid_v7(p_tenant_id) AND zhiban_identity.is_uuid_v7(p_slot_id) AND zhiban_identity.is_uuid_v7(p_generation_id) AND zhiban_identity.is_uuid_v7(p_attempt_id) AND zhiban_identity.is_uuid_v7(p_learner_membership_id)) THEN RAISE EXCEPTION 'Runtime parent rejected'; END IF;
 SELECT r.* INTO resource_row FROM zhiban_runtime_contract_test.resources AS r WHERE r.tenant_id=p_tenant_id AND r.slot_id=p_slot_id AND r.generation_id=p_generation_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Runtime parent rejected'; END IF;
 SELECT a.* INTO attempt_row FROM zhiban_runtime_contract_test.attempts AS a WHERE a.tenant_id=p_tenant_id AND a.attempt_id=p_attempt_id AND a.slot_id=p_slot_id AND a.generation_id=p_generation_id AND a.learner_membership_id=p_learner_membership_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Runtime parent rejected'; END IF;
 RETURN QUERY SELECT resource_row.state::text,attempt_row.state::text,resource_row.stage_ref::text;
END $$;
CREATE FUNCTION zhiban_runtime_contract_test.binding_history_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,zhiban_runtime_contract_test,zhiban_identity,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Runtime history rejected'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'PENDING' OR NEW.repository_revision<>1 OR NEW.outstanding_operation_id IS NOT NULL OR NEW.record_count<>0 THEN RAISE EXCEPTION 'Runtime initial state rejected'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','repository_revision','outstanding_operation_id','expected_last_seq','record_count','record_bytes','native_updated_at','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','repository_revision','outstanding_operation_id','expected_last_seq','record_count','record_bytes','native_updated_at','updated_at'])
  OR OLD.repository_revision=9223372036854775807 OR NEW.repository_revision<>OLD.repository_revision+1 OR NEW.updated_at<OLD.updated_at OR OLD.status IN ('ARCHIVED','FAILED')
  OR NOT((OLD.status='PENDING' AND NEW.status IN ('PENDING','ACTIVE','FAILED')) OR (OLD.status='ACTIVE' AND NEW.status IN ('ACTIVE','COMPLETED','ARCHIVED')) OR (OLD.status='COMPLETED' AND NEW.status IN ('COMPLETED','ARCHIVED'))) THEN RAISE EXCEPTION 'Runtime history rejected'; END IF;
 END IF;
 IF NEW.updated_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint THEN RAISE EXCEPTION 'Runtime clock rejected'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION zhiban_runtime_contract_test.operation_history_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,zhiban_runtime_contract_test,zhiban_identity,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Runtime history rejected'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'RESERVED' OR NEW.repository_revision<>1 OR NEW.dispatch_started_at IS NOT NULL OR NEW.expected_binding_revision>9223372036854775805 THEN RAISE EXCEPTION 'Runtime reservation rejected'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','repository_revision','dispatch_started_at','result_binding_revision','result_last_seq','reason','updated_at','completed_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','repository_revision','dispatch_started_at','result_binding_revision','result_last_seq','reason','updated_at','completed_at'])
  OR OLD.repository_revision=9223372036854775807 OR NEW.repository_revision<>OLD.repository_revision+1 OR NEW.updated_at<OLD.updated_at
  OR (OLD.dispatch_started_at IS NOT NULL AND NEW.dispatch_started_at IS DISTINCT FROM OLD.dispatch_started_at)
  OR NOT((OLD.state='RESERVED' AND OLD.repository_revision=1 AND NEW.repository_revision=2 AND ((NEW.state='RESERVED' AND NEW.dispatch_started_at IS NOT NULL) OR (NEW.state='FAILED' AND NEW.dispatch_started_at IS NULL)))
   OR (OLD.state='RESERVED' AND OLD.repository_revision=2 AND NEW.repository_revision=3 AND NEW.state IN ('SUCCEEDED','FAILED','OUTCOME_UNKNOWN'))
   OR (OLD.state='OUTCOME_UNKNOWN' AND OLD.repository_revision=3 AND NEW.repository_revision=4 AND NEW.state IN ('SUCCEEDED','FAILED'))) THEN RAISE EXCEPTION 'Runtime operation rejected'; END IF;
 END IF;
 IF NEW.updated_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint THEN RAISE EXCEPTION 'Runtime clock rejected'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION zhiban_runtime_contract_test.runtime_consistency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,zhiban_runtime_contract_test,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE anchor record; op_row record; event_row record; expected_count bigint; expected_bytes bigint; expected_status text;
BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME NOT IN ('runtime_bindings','runtime_operations','runtime_audit_events') THEN RAISE EXCEPTION 'Runtime consistency rejected'; END IF;
 SELECT b.* INTO anchor FROM zhiban_runtime_contract_test.runtime_bindings AS b WHERE b.tenant_id=NEW.tenant_id AND b.runtime_binding_id=NEW.runtime_binding_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Runtime consistency rejected'; END IF;
 PERFORM * FROM zhiban_runtime_contract_test.runtime_parent_context(anchor.tenant_id,anchor.slot_id,anchor.generation_id,anchor.attempt_id,anchor.learner_membership_id);
 IF EXISTS(SELECT 1 FROM zhiban_runtime_contract_test.runtime_operations p WHERE p.tenant_id=anchor.tenant_id AND p.runtime_binding_id=anchor.runtime_binding_id AND p.state IN ('RESERVED','OUTCOME_UNKNOWN') AND (anchor.outstanding_operation_id IS DISTINCT FROM p.operation_id OR anchor.repository_revision<>p.reserved_binding_revision OR anchor.status<>p.prior_status OR anchor.record_count<>p.prior_record_count OR anchor.record_bytes<>p.prior_record_bytes OR anchor.expected_last_seq IS DISTINCT FROM p.expected_last_seq))
 OR (anchor.outstanding_operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM zhiban_runtime_contract_test.runtime_operations p WHERE p.tenant_id=anchor.tenant_id AND p.operation_id=anchor.outstanding_operation_id AND p.runtime_binding_id=anchor.runtime_binding_id AND p.state IN ('RESERVED','OUTCOME_UNKNOWN'))) THEN RAISE EXCEPTION 'Runtime fence rejected'; END IF;
 FOR op_row IN SELECT p.* FROM zhiban_runtime_contract_test.runtime_operations p WHERE p.tenant_id=anchor.tenant_id AND p.runtime_binding_id=anchor.runtime_binding_id LOOP
  IF NOT EXISTS(SELECT 1 FROM zhiban_identity.memberships m WHERE m.tenant_id=op_row.tenant_id AND m.membership_id=op_row.actor_membership_id AND m.user_id=op_row.actor_user_id)
  OR (SELECT count(*) FROM zhiban_runtime_contract_test.runtime_audit_events e WHERE e.tenant_id=op_row.tenant_id AND e.operation_id=op_row.operation_id)<>op_row.repository_revision THEN RAISE EXCEPTION 'Runtime audit rejected'; END IF;
  FOR event_row IN SELECT e.* FROM zhiban_runtime_contract_test.runtime_audit_events e WHERE e.tenant_id=op_row.tenant_id AND e.operation_id=op_row.operation_id LOOP
   IF event_row.actor_user_id<>op_row.actor_user_id OR event_row.actor_membership_id<>op_row.actor_membership_id OR event_row.request_id<>op_row.request_id OR event_row.occurred_at<op_row.created_at OR event_row.occurred_at>op_row.updated_at OR event_row.operation_revision>op_row.repository_revision
   OR NOT((event_row.operation_revision=1 AND event_row.event_type='RUNTIME_RESERVED' AND event_row.reason='NONE' AND event_row.binding_revision_before=op_row.expected_binding_revision AND event_row.binding_revision_after=op_row.reserved_binding_revision)
    OR (event_row.operation_revision=2 AND event_row.event_type='DISPATCH_MARKED' AND event_row.reason='NONE' AND event_row.binding_revision_before=op_row.reserved_binding_revision AND event_row.binding_revision_after=op_row.reserved_binding_revision AND op_row.dispatch_started_at IS NOT NULL)
    OR (event_row.operation_revision=3 AND event_row.event_type='OUTCOME_QUARANTINED' AND event_row.reason='UNKNOWN_OUTCOME' AND event_row.binding_revision_before=op_row.reserved_binding_revision AND event_row.binding_revision_after=op_row.reserved_binding_revision)
    OR (event_row.operation_revision=op_row.repository_revision AND event_row.event_type IN ('RUNTIME_SETTLED','RUNTIME_FAILED','OUTCOME_RECONCILED') AND op_row.state IN ('SUCCEEDED','FAILED') AND event_row.reason=op_row.reason AND event_row.binding_revision_before=op_row.reserved_binding_revision AND event_row.binding_revision_after=op_row.result_binding_revision AND ((op_row.repository_revision=2 AND op_row.state='FAILED' AND event_row.event_type='RUNTIME_FAILED') OR (op_row.repository_revision=3 AND event_row.event_type=(CASE WHEN op_row.state='SUCCEEDED' THEN 'RUNTIME_SETTLED' ELSE 'RUNTIME_FAILED' END)) OR (op_row.repository_revision=4 AND event_row.event_type='OUTCOME_RECONCILED')))) THEN RAISE EXCEPTION 'Runtime audit rejected'; END IF;
  END LOOP;
  IF op_row.state IN ('SUCCEEDED','FAILED') AND op_row.result_binding_revision=anchor.repository_revision THEN
   expected_count:=op_row.prior_record_count; expected_bytes:=op_row.prior_record_bytes; expected_status:=op_row.prior_status;
   IF op_row.state='SUCCEEDED' THEN
    IF op_row.command='CREATE_RUNTIME' THEN expected_status:='ACTIVE';
    ELSIF op_row.command IN ('APPEND_USER_RECORD','APPEND_ASSISTANT_RECORD') THEN expected_count:=expected_count+1; expected_bytes:=expected_bytes+op_row.record_serialized_bytes;
    ELSE expected_status:=op_row.target_status; END IF;
   ELSIF op_row.command='CREATE_RUNTIME' THEN expected_status:='FAILED'; END IF;
   IF anchor.outstanding_operation_id IS NOT NULL OR anchor.record_count<>expected_count OR anchor.record_bytes<>expected_bytes OR anchor.status<>expected_status OR op_row.result_last_seq IS DISTINCT FROM anchor.expected_last_seq
   OR (op_row.state='SUCCEEDED' AND anchor.native_updated_at<>(CASE WHEN op_row.command='CREATE_RUNTIME' THEN anchor.created_at ELSE op_row.created_at END)) THEN RAISE EXCEPTION 'Runtime settlement rejected'; END IF;
  END IF;
 END LOOP;
 IF anchor.outstanding_operation_id IS NULL AND NOT EXISTS(SELECT 1 FROM zhiban_runtime_contract_test.runtime_operations p WHERE p.tenant_id=anchor.tenant_id AND p.runtime_binding_id=anchor.runtime_binding_id AND p.result_binding_revision=anchor.repository_revision AND p.state IN ('SUCCEEDED','FAILED')) THEN RAISE EXCEPTION 'Runtime orphan binding rejected'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION zhiban_runtime_contract_test.audit_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'Runtime audit immutable'; END $$;
CREATE TRIGGER binding_history BEFORE INSERT OR UPDATE OR DELETE ON zhiban_runtime_contract_test.runtime_bindings FOR EACH ROW EXECUTE FUNCTION zhiban_runtime_contract_test.binding_history_guard();
CREATE TRIGGER operation_history BEFORE INSERT OR UPDATE OR DELETE ON zhiban_runtime_contract_test.runtime_operations FOR EACH ROW EXECUTE FUNCTION zhiban_runtime_contract_test.operation_history_guard();
CREATE TRIGGER audit_history BEFORE UPDATE OR DELETE ON zhiban_runtime_contract_test.runtime_audit_events FOR EACH ROW EXECUTE FUNCTION zhiban_runtime_contract_test.audit_immutable();
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['resources','attempts','scenes','runtime_bindings','runtime_operations','runtime_audit_events'] LOOP
  EXECUTE format('ALTER TABLE zhiban_runtime_contract_test.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE zhiban_runtime_contract_test.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY owner_access ON zhiban_runtime_contract_test.%I TO zhiban_identity_owner USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',table_name);
  EXECUTE format('CREATE POLICY bridge_read ON zhiban_runtime_contract_test.%I FOR SELECT TO zhiban_bridge_runtime USING(tenant_id=zhiban_identity.current_tenant_id())',table_name);
  IF table_name IN ('runtime_bindings','runtime_operations','runtime_audit_events') THEN
   EXECUTE format('CREATE POLICY bridge_insert ON zhiban_runtime_contract_test.%I FOR INSERT TO zhiban_bridge_runtime WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',table_name);
   EXECUTE format('CREATE CONSTRAINT TRIGGER runtime_consistency AFTER INSERT OR UPDATE ON zhiban_runtime_contract_test.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_runtime_contract_test.runtime_consistency()',table_name);
  END IF;
  IF table_name IN ('runtime_bindings','runtime_operations') THEN EXECUTE format('CREATE POLICY bridge_update ON zhiban_runtime_contract_test.%I FOR UPDATE TO zhiban_bridge_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',table_name); END IF;
 END LOOP;
END $$;
REVOKE ALL ON SCHEMA zhiban_runtime_contract_test FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_runtime_contract_test TO zhiban_bridge_runtime;
REVOKE ALL ON ALL TABLES IN SCHEMA zhiban_runtime_contract_test FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime,zhiban_bridge_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA zhiban_runtime_contract_test FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime,zhiban_bridge_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA zhiban_runtime_contract_test TO zhiban_bridge_runtime;
GRANT INSERT ON zhiban_runtime_contract_test.runtime_bindings,zhiban_runtime_contract_test.runtime_operations,zhiban_runtime_contract_test.runtime_audit_events TO zhiban_bridge_runtime;
GRANT UPDATE(status,repository_revision,outstanding_operation_id,expected_last_seq,record_count,record_bytes,native_updated_at,updated_at) ON zhiban_runtime_contract_test.runtime_bindings TO zhiban_bridge_runtime;
GRANT UPDATE(state,repository_revision,dispatch_started_at,result_binding_revision,result_last_seq,reason,updated_at,completed_at) ON zhiban_runtime_contract_test.runtime_operations TO zhiban_bridge_runtime;
GRANT EXECUTE ON FUNCTION zhiban_runtime_contract_test.runtime_parent_context(uuid,uuid,uuid,uuid,uuid) TO zhiban_bridge_runtime;
