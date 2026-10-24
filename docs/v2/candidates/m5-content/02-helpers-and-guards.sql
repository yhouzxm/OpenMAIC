-- UNAPPLIED 0001_content component 2/3. No change to Identity's frozen helper.
CREATE FUNCTION zhiban_content.lock_business_context(
 p_tenant_id uuid,p_resource_id uuid,p_offering_id uuid,p_actor_membership_id uuid,p_action text
) RETURNS TABLE(course_id uuid,course_status text,course_revision bigint,offering_status text,offering_revision bigint,
 relationship_id uuid,relationship_revision bigint,valid_from bigint,valid_until bigint,evaluated_at bigint)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_content,zhiban_academic,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE v_o zhiban_academic.offerings%ROWTYPE; v_c zhiban_academic.courses%ROWTYPE;
 v_relation record; v_now bigint;
BEGIN
 IF session_user<>'zhiban_bridge_runtime' OR p_tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id()
    OR zhiban_identity.is_uuid_v7(p_tenant_id) IS DISTINCT FROM TRUE
    OR zhiban_identity.is_uuid_v7(p_offering_id) IS DISTINCT FROM TRUE
    OR zhiban_identity.is_uuid_v7(p_actor_membership_id) IS DISTINCT FROM TRUE
    OR p_action IS NULL OR p_action NOT IN ('TEACHER_WRITE','TEACHER_WITHDRAW','TEACHER_READ','STUDENT_READ')
    OR (p_resource_id IS NULL AND p_action<>'TEACHER_WRITE')
    OR (p_resource_id IS NOT NULL AND zhiban_identity.is_uuid_v7(p_resource_id) IS DISTINCT FROM TRUE) THEN
   RAISE EXCEPTION 'Content business context rejected' USING ERRCODE='42501';
 END IF;
 SELECT o.* INTO v_o FROM zhiban_academic.offerings o WHERE o.tenant_id=p_tenant_id AND o.id=p_offering_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Content business context rejected' USING ERRCODE='42501'; END IF;
 SELECT c.* INTO v_c FROM zhiban_academic.courses c WHERE c.tenant_id=p_tenant_id AND c.id=v_o.course_id FOR SHARE;
 IF NOT FOUND OR v_c.status='ARCHIVED' OR (p_action='TEACHER_WRITE' AND v_o.status<>'OPEN') THEN
   RAISE EXCEPTION 'Content business context rejected' USING ERRCODE='42501';
 END IF;
 IF p_resource_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM zhiban_content.resources r
     WHERE r.tenant_id=p_tenant_id AND r.id=p_resource_id AND r.offering_id=p_offering_id
       AND r.kind='SLIDE_CONTENT' AND r.policy_version='content-text-v1') THEN
   RAISE EXCEPTION 'Content business context rejected' USING ERRCODE='42501';
 END IF;
 IF p_action='STUDENT_READ' THEN
   SELECT e.id,e.revision,e.valid_from,e.valid_until INTO v_relation FROM zhiban_academic.enrollments e
    WHERE e.tenant_id=p_tenant_id AND e.offering_id=p_offering_id AND e.membership_id=p_actor_membership_id
      AND e.status='ACTIVE' ORDER BY e.id FOR SHARE;
 ELSE
   SELECT a.id,a.revision,a.valid_from,a.valid_until INTO v_relation FROM zhiban_academic.assignments a
    WHERE a.tenant_id=p_tenant_id AND a.offering_id=p_offering_id AND a.membership_id=p_actor_membership_id
      AND a.status='ACTIVE' ORDER BY a.id FOR SHARE;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Content business context rejected' USING ERRCODE='42501'; END IF;
 v_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF v_relation.valid_from>v_now OR v_relation.valid_until IS NOT NULL THEN
   RAISE EXCEPTION 'Content business context rejected' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT v_c.id,v_c.status,v_c.revision,v_o.status,v_o.revision,
    v_relation.id::uuid,v_relation.revision::bigint,v_relation.valid_from::bigint,v_relation.valid_until::bigint,v_now;
 -- This is ONLY locked business facts. Caller MUST first invoke existing private
 -- Identity guard on THIS client and check a single current grant role+scope.
 -- NULL resource is only the CREATE path; the server allocates the resource ID.
END;
$$;
CREATE OR REPLACE FUNCTION zhiban_bridge.business_resource_ready(p_tenant_id uuid,p_activity_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog,zhiban_bridge,zhiban_identity,pg_temp AS $$
 SELECT coalesce(session_user='zhiban_bridge_runtime'
   AND p_tenant_id=zhiban_identity.current_tenant_id()
   AND zhiban_identity.is_uuid_v7(p_tenant_id) AND zhiban_identity.is_uuid_v7(p_activity_id)
   AND EXISTS(SELECT 1 FROM zhiban_content.resources r WHERE r.tenant_id=p_tenant_id AND r.id=p_activity_id
      AND r.kind='SLIDE_CONTENT' AND r.policy_version='content-text-v1'),false);
$$;
CREATE FUNCTION zhiban_content.resource_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,zhiban_content,zhiban_identity,pg_temp AS $$
DECLARE action_name text;
BEGIN
 IF session_user<>'zhiban_bridge_runtime' OR NEW.tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id()
    OR current_setting('transaction_isolation')<>'read committed' THEN
   RAISE EXCEPTION 'Content context rejected' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.state<>'DRAFT' OR NEW.revision<>1 OR NEW.updated_by<>NEW.created_by OR NEW.updated_at<>NEW.created_at THEN
     RAISE EXCEPTION 'Content initial state rejected' USING ERRCODE='23514';
   END IF;
 ELSE
   IF OLD.revision=9223372036854775807 THEN RAISE EXCEPTION 'Content revision exhausted' USING ERRCODE='23514'; END IF;
   IF NEW.revision<>OLD.revision+1 OR NEW.updated_at<OLD.updated_at
     OR (NEW.tenant_id,NEW.id,NEW.offering_id,NEW.kind,NEW.policy_version,NEW.created_by,NEW.created_at)
        IS DISTINCT FROM (OLD.tenant_id,OLD.id,OLD.offering_id,OLD.kind,OLD.policy_version,OLD.created_by,OLD.created_at) THEN
     RAISE EXCEPTION 'Content immutable/CAS rejected' USING ERRCODE='23514';
   END IF;
   IF EXISTS(SELECT 1 FROM zhiban_content.operations o WHERE o.tenant_id=OLD.tenant_id AND o.resource_id=OLD.id
     AND o.action='PUBLISH_CONTENT' AND o.state IN ('RESERVED','OUTCOME_UNKNOWN')) THEN
     RAISE EXCEPTION 'Outstanding publish fence' USING ERRCODE='23514';
   END IF;
   IF NEW.active_publication_id IS DISTINCT FROM OLD.active_publication_id THEN
     action_name:='PUBLISH_CONTENT';
     IF NEW.state<>'PUBLISHED' OR NEW.last_publication_no<>OLD.last_publication_no+1
       OR (NEW.title,NEW.draft) IS DISTINCT FROM (OLD.title,OLD.draft) THEN
       RAISE EXCEPTION 'Content publication transition rejected' USING ERRCODE='23514';
     END IF;
   ELSIF NEW.state IS DISTINCT FROM OLD.state THEN
     action_name:='WITHDRAW_CONTENT';
     IF OLD.state<>'PUBLISHED' OR NEW.state<>'WITHDRAWN' OR NEW.last_publication_no<>OLD.last_publication_no
       OR (NEW.title,NEW.draft) IS DISTINCT FROM (OLD.title,OLD.draft) THEN
       RAISE EXCEPTION 'Content withdrawal transition rejected' USING ERRCODE='23514';
     END IF;
   ELSE
     action_name:='SAVE_CONTENT';
     IF NEW.last_publication_no<>OLD.last_publication_no OR (NEW.title,NEW.draft) IS NOT DISTINCT FROM (OLD.title,OLD.draft) THEN
       RAISE EXCEPTION 'No-op must not UPDATE resource' USING ERRCODE='23514';
     END IF;
   END IF;
   IF NOT EXISTS(SELECT 1 FROM zhiban_content.operations o WHERE o.tenant_id=OLD.tenant_id AND o.resource_id=OLD.id
      AND o.action=action_name AND o.state='SUCCEEDED' AND o.actor_id=NEW.updated_by
      AND o.source_revision=OLD.revision AND o.source_digest=zhiban_content.draft_digest(OLD.draft)
      AND o.result_revision=NEW.revision AND o.completed_at=NEW.updated_at
      AND (action_name<>'PUBLISH_CONTENT' OR o.result_publication_id=NEW.active_publication_id)) THEN
     RAISE EXCEPTION 'Successful exact operation required before resource UPDATE' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER content_resource_guard BEFORE INSERT OR UPDATE ON zhiban_content.resources
 FOR EACH ROW EXECUTE FUNCTION zhiban_content.resource_guard();
CREATE FUNCTION zhiban_content.operation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,zhiban_content,zhiban_identity,pg_temp AS $$
DECLARE r zhiban_content.resources%ROWTYPE;
BEGIN
 IF session_user<>'zhiban_bridge_runtime' OR NEW.tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id()
    OR current_setting('transaction_isolation')<>'read committed' THEN
   RAISE EXCEPTION 'Content operation context rejected' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' THEN
   SELECT * INTO r FROM zhiban_content.resources WHERE tenant_id=NEW.tenant_id AND id=NEW.resource_id FOR UPDATE;
   IF NOT FOUND OR NEW.source_revision<>r.revision OR NEW.source_digest<>zhiban_content.draft_digest(r.draft)
      OR NEW.source_revision=9223372036854775807
      OR EXISTS(SELECT 1 FROM zhiban_content.operations o WHERE o.tenant_id=NEW.tenant_id AND o.resource_id=NEW.resource_id
       AND o.action='PUBLISH_CONTENT' AND o.state IN ('RESERVED','OUTCOME_UNKNOWN')) THEN
     RAISE EXCEPTION 'Operation source/fence rejected' USING ERRCODE='23514';
   END IF;
   IF (NEW.action='PUBLISH_CONTENT' AND (NEW.state<>'RESERVED' OR NEW.prepare_operation_id IS NOT NULL OR NEW.bridge_operation_id IS NOT NULL))
      OR (NEW.action<>'PUBLISH_CONTENT' AND NEW.state<>'SUCCEEDED') THEN
     RAISE EXCEPTION 'Operation initial state rejected' USING ERRCODE='23514';
   END IF;
   IF NEW.action='WITHDRAW_CONTENT' AND NEW.result_revision=NEW.source_revision AND r.state<>'WITHDRAWN' THEN
     RAISE EXCEPTION 'Withdrawal no-op requires already withdrawn resource' USING ERRCODE='23514';
   END IF;
   IF NEW.action='CREATE_CONTENT' AND (r.revision<>1 OR NEW.actor_id<>r.created_by OR NEW.result_revision<>1) THEN
     RAISE EXCEPTION 'Create result rejected' USING ERRCODE='23514';
   END IF;
 ELSE
   IF (NEW.tenant_id,NEW.id,NEW.resource_id,NEW.actor_id,NEW.action,NEW.key_digest,NEW.intent_digest,NEW.source_revision,NEW.source_digest,NEW.expected_native_digest,NEW.created_at)
      IS DISTINCT FROM (OLD.tenant_id,OLD.id,OLD.resource_id,OLD.actor_id,OLD.action,OLD.key_digest,OLD.intent_digest,OLD.source_revision,OLD.source_digest,OLD.expected_native_digest,OLD.created_at)
      OR OLD.action<>'PUBLISH_CONTENT' OR OLD.state NOT IN ('RESERVED','OUTCOME_UNKNOWN')
      OR NEW.state NOT IN ('RESERVED','SUCCEEDED','FAILED','OUTCOME_UNKNOWN')
      OR (NEW.state='RESERVED' AND (OLD.state<>'RESERVED' OR
          (NEW.prepare_operation_id,NEW.bridge_operation_id) IS NOT DISTINCT FROM (OLD.prepare_operation_id,OLD.bridge_operation_id)))
      OR (NEW.state='OUTCOME_UNKNOWN' AND OLD.state='OUTCOME_UNKNOWN')
      OR (OLD.prepare_operation_id IS NOT NULL AND NEW.prepare_operation_id IS DISTINCT FROM OLD.prepare_operation_id)
      OR (OLD.bridge_operation_id IS NOT NULL AND NEW.bridge_operation_id IS DISTINCT FROM OLD.bridge_operation_id) THEN
     RAISE EXCEPTION 'Operation immutable/terminal transition rejected' USING ERRCODE='23514';
   END IF;
   SELECT * INTO r FROM zhiban_content.resources WHERE tenant_id=NEW.tenant_id AND id=NEW.resource_id FOR UPDATE;
   IF NOT FOUND OR r.revision<>NEW.source_revision OR zhiban_content.draft_digest(r.draft)<>NEW.source_digest THEN
     RAISE EXCEPTION 'Reserved source changed' USING ERRCODE='23514';
   END IF;
   -- OUTCOME_UNKNOWN -> terminal needs fresh authorized exact reconciliation in
   -- the future server; this SQL shape is NOT a reconciliation permission/API.
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER content_operation_guard BEFORE INSERT OR UPDATE ON zhiban_content.operations
 FOR EACH ROW EXECUTE FUNCTION zhiban_content.operation_guard();
CREATE FUNCTION zhiban_content.publication_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,zhiban_content,zhiban_identity,pg_temp AS $$
DECLARE r zhiban_content.resources%ROWTYPE;
BEGIN
 IF session_user<>'zhiban_bridge_runtime' OR NEW.tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id() THEN
   RAISE EXCEPTION 'Content publication context rejected' USING ERRCODE='42501';
 END IF;
 SELECT * INTO r FROM zhiban_content.resources WHERE tenant_id=NEW.tenant_id AND id=NEW.resource_id FOR UPDATE;
 IF NOT FOUND OR r.revision<>NEW.source_revision OR NEW.title<>r.title OR NEW.policy_version<>r.policy_version
    OR NEW.publication_no<>r.last_publication_no+1 OR NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(r.draft->'slides') s,
      LATERAL jsonb_array_elements(s.value->'elements') e WHERE btrim(e.value->>'text',E' \n\r\t')<>'') THEN
   RAISE EXCEPTION 'Content publish source rejected' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER content_publication_guard BEFORE INSERT ON zhiban_content.publications
 FOR EACH ROW EXECUTE FUNCTION zhiban_content.publication_guard();
CREATE FUNCTION zhiban_content.append_only() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Content history immutable' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER content_publications_immutable BEFORE UPDATE OR DELETE ON zhiban_content.publications
 FOR EACH ROW EXECUTE FUNCTION zhiban_content.append_only();
CREATE TRIGGER content_audit_immutable BEFORE UPDATE OR DELETE ON zhiban_content.audit_events
 FOR EACH ROW EXECUTE FUNCTION zhiban_content.append_only();
CREATE TRIGGER content_resources_no_delete BEFORE DELETE ON zhiban_content.resources
 FOR EACH ROW EXECUTE FUNCTION zhiban_content.append_only();
CREATE TRIGGER content_operations_no_delete BEFORE DELETE ON zhiban_content.operations
 FOR EACH ROW EXECUTE FUNCTION zhiban_content.append_only();
-- Re-read final rows at COMMIT: a deferred trigger must not validate its stale
-- NEW pointer after several updates in the same transaction. Full table dispatch
-- avoids reading resource_id on a Bridge row or slot_id on a Content row.
CREATE FUNCTION zhiban_content.link_consistency() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,zhiban_content,zhiban_bridge,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE resource_key uuid; r zhiban_content.resources%ROWTYPE; o zhiban_content.operations%ROWTYPE;
BEGIN
 IF session_user<>'zhiban_bridge_runtime' OR NEW.tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id() THEN
   RAISE EXCEPTION 'Content consistency context rejected' USING ERRCODE='42501';
 END IF;
 IF TG_TABLE_SCHEMA='zhiban_content' THEN
   IF TG_TABLE_NAME='resources' THEN resource_key:=NEW.id;
   ELSIF TG_TABLE_NAME IN ('publications','operations','audit_events') THEN resource_key:=NEW.resource_id;
   ELSE RAISE EXCEPTION 'Unsupported Content consistency table'; END IF;
 ELSIF TG_TABLE_SCHEMA='zhiban_bridge' THEN
   IF TG_TABLE_NAME='resource_slots' THEN resource_key:=NEW.activity_id;
   ELSIF TG_TABLE_NAME IN ('resource_generations','operations') THEN
     SELECT s.activity_id INTO resource_key FROM zhiban_bridge.resource_slots s
      WHERE s.tenant_id=NEW.tenant_id AND s.slot_id=NEW.slot_id;
   ELSE RAISE EXCEPTION 'Unsupported Bridge consistency table'; END IF;
 ELSE RAISE EXCEPTION 'Unsupported consistency schema'; END IF;
 SELECT * INTO r FROM zhiban_content.resources WHERE tenant_id=NEW.tenant_id AND id=resource_key;
 IF NOT FOUND THEN
   IF TG_TABLE_SCHEMA='zhiban_bridge' THEN RETURN NULL; END IF;
   RAISE EXCEPTION 'Content resource missing' USING ERRCODE='23514';
 END IF;
 IF r.last_publication_no<>(SELECT coalesce(max(p.publication_no),0) FROM zhiban_content.publications p
      WHERE p.tenant_id=r.tenant_id AND p.resource_id=r.id)
    OR (r.active_publication_id IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM zhiban_content.publications p JOIN zhiban_bridge.resource_slots s
        ON s.tenant_id=p.tenant_id AND s.slot_id=p.bridge_slot_id
      JOIN zhiban_bridge.resource_generations g ON g.tenant_id=p.tenant_id AND g.generation_id=p.bridge_generation_id
      WHERE p.tenant_id=r.tenant_id AND p.id=r.active_publication_id AND p.resource_id=r.id
       AND p.publication_no=r.last_publication_no AND s.activity_id=r.id AND s.owner_membership_id=r.created_by
       AND s.active_generation_id=g.generation_id AND g.state='ACTIVE'
       AND ((r.state='PUBLISHED' AND s.state='ENABLED') OR (r.state='WITHDRAWN' AND s.state='SUSPENDED')))) THEN
   RAISE EXCEPTION 'Content active pointer inconsistent' USING ERRCODE='23514';
 END IF;
 -- A preparation cannot be hidden by cancelling a content operation before
 -- registering its Bridge reference. Every resource prepare has exactly one
 -- durable content reservation, even if that reservation safely terminates.
 IF EXISTS(SELECT 1 FROM zhiban_bridge.operations b JOIN zhiban_bridge.resource_slots s
    ON s.tenant_id=b.tenant_id AND s.slot_id=b.slot_id
   WHERE s.tenant_id=r.tenant_id AND s.activity_id=r.id AND b.operation='PREPARE_CONTENT'
    AND NOT EXISTS(SELECT 1 FROM zhiban_content.operations co
      WHERE co.tenant_id=r.tenant_id AND co.resource_id=r.id AND co.action='PUBLISH_CONTENT'
       AND co.prepare_operation_id=b.operation_id)) THEN
   RAISE EXCEPTION 'Unbound Bridge preparation' USING ERRCODE='23514';
 END IF;
 -- Every activation, including a still PENDING generation, belongs to exactly
 -- one content publish with the same preparation/slot/generation. Checking
 -- only ACTIVE generations or nullable forward references releases the fence
 -- prematurely when an unregistered activation has an unresolved outcome.
 IF EXISTS(SELECT 1 FROM zhiban_bridge.operations b JOIN zhiban_bridge.resource_slots s
    ON s.tenant_id=b.tenant_id AND s.slot_id=b.slot_id
   WHERE s.tenant_id=r.tenant_id AND s.activity_id=r.id AND b.operation='ACTIVATE_GENERATION'
    AND (SELECT count(*) FROM zhiban_content.operations co
      JOIN zhiban_bridge.operations prep ON prep.tenant_id=co.tenant_id AND prep.operation_id=co.prepare_operation_id
      WHERE co.tenant_id=r.tenant_id AND co.resource_id=r.id AND co.action='PUBLISH_CONTENT'
       AND co.bridge_operation_id=b.operation_id AND prep.operation='PREPARE_CONTENT'
       AND prep.slot_id=b.slot_id AND prep.generation_id=b.generation_id)<>1) THEN
   RAISE EXCEPTION 'Unbound Bridge activation' USING ERRCODE='23514';
 END IF;
 -- Reverse edge covers first publication and every deployment slot, including
 -- SUSPENDED slots retaining ACTIVE history after withdrawal.
 IF EXISTS(SELECT 1 FROM zhiban_bridge.resource_slots s
   JOIN zhiban_bridge.resource_generations g ON g.tenant_id=s.tenant_id AND g.slot_id=s.slot_id
   WHERE s.tenant_id=r.tenant_id AND s.activity_id=r.id AND g.state='ACTIVE'
    AND NOT EXISTS(SELECT 1 FROM zhiban_content.publications p
      JOIN zhiban_content.operations co ON co.tenant_id=p.tenant_id AND co.result_publication_id=p.id
      WHERE p.tenant_id=r.tenant_id AND p.id=r.active_publication_id AND p.resource_id=r.id
       AND p.bridge_slot_id=s.slot_id AND p.bridge_generation_id=g.generation_id
       AND s.active_generation_id=g.generation_id AND s.owner_membership_id=r.created_by
       AND co.action='PUBLISH_CONTENT' AND co.state='SUCCEEDED'
       AND ((r.state='PUBLISHED' AND s.state='ENABLED') OR (r.state='WITHDRAWN' AND s.state='SUSPENDED')))) THEN
   RAISE EXCEPTION 'Unbound active Bridge generation' USING ERRCODE='23514';
 END IF;
 -- History binds both preparation and activation, not just a successful prepare.
 IF EXISTS(SELECT 1 FROM zhiban_content.publications p WHERE p.tenant_id=r.tenant_id AND p.resource_id=r.id AND (
   p.source_revision>=r.revision OR NOT EXISTS(
    SELECT 1 FROM zhiban_bridge.resource_slots s JOIN zhiban_bridge.resource_generations g
      ON g.tenant_id=s.tenant_id AND g.slot_id=s.slot_id
    JOIN zhiban_bridge.operations prep ON prep.tenant_id=p.tenant_id AND prep.operation_id=p.prepare_operation_id
    JOIN zhiban_bridge.operations act ON act.tenant_id=p.tenant_id AND act.operation_id=p.activation_operation_id
    JOIN zhiban_content.operations co ON co.tenant_id=p.tenant_id AND co.result_publication_id=p.id
    WHERE s.tenant_id=p.tenant_id AND s.slot_id=p.bridge_slot_id AND s.activity_id=r.id
      AND s.owner_membership_id=r.created_by AND g.generation_id=p.bridge_generation_id
      AND g.owner_membership_id=r.created_by AND g.content_digest=p.content_digest
      AND g.content_digest=co.expected_native_digest
      AND prep.slot_id=s.slot_id AND act.slot_id=s.slot_id
      AND prep.generation_id=g.generation_id AND act.generation_id=g.generation_id
      AND prep.result_generation_id=g.generation_id AND act.result_generation_id=g.generation_id
      AND prep.operation='PREPARE_CONTENT' AND act.operation='ACTIVATE_GENERATION'
      AND prep.state='SUCCEEDED' AND act.state='SUCCEEDED' AND prep.dispatch_started_at IS NOT NULL
      AND prep.actor_kind='USER' AND act.actor_kind='USER'
      AND prep.actor_membership_id=p.published_by AND act.actor_membership_id=p.published_by
      AND co.resource_id=r.id AND co.action='PUBLISH_CONTENT' AND co.state='SUCCEEDED'
      AND co.actor_id=p.published_by AND co.source_revision=p.source_revision
      AND co.prepare_operation_id=prep.operation_id AND co.bridge_operation_id=act.operation_id
      AND co.result_revision=p.source_revision+1 AND co.completed_at=p.published_at))) THEN
   RAISE EXCEPTION 'Content publication provenance inconsistent' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM zhiban_content.operations co WHERE co.tenant_id=r.tenant_id AND co.resource_id=r.id AND (
   co.source_revision>r.revision OR
   (co.action='PUBLISH_CONTENT' AND co.state IN ('RESERVED','OUTCOME_UNKNOWN') AND co.prepare_operation_id IS NULL) OR
   (co.action='PUBLISH_CONTENT' AND co.state='FAILED' AND (
     EXISTS(SELECT 1 FROM zhiban_bridge.operations b WHERE b.tenant_id=co.tenant_id
       AND b.operation_id=co.prepare_operation_id AND b.state NOT IN ('SUCCEEDED','FAILED')) OR
     EXISTS(SELECT 1 FROM zhiban_bridge.operations b WHERE b.tenant_id=co.tenant_id
       AND b.operation_id=co.bridge_operation_id AND b.state<>'FAILED'))) OR
   (co.prepare_operation_id IS NOT NULL AND NOT EXISTS(
     SELECT 1 FROM zhiban_bridge.operations b JOIN zhiban_bridge.resource_slots s
      ON s.tenant_id=b.tenant_id AND s.slot_id=b.slot_id
     JOIN zhiban_bridge.resource_generations g ON g.tenant_id=b.tenant_id AND g.generation_id=b.generation_id AND g.slot_id=b.slot_id
     WHERE b.tenant_id=co.tenant_id AND b.operation_id=co.prepare_operation_id
      AND b.created_at>=co.created_at AND g.content_digest=co.expected_native_digest
      AND b.operation='PREPARE_CONTENT' AND b.actor_kind='USER' AND b.actor_membership_id=co.actor_id
      AND s.activity_id=r.id AND s.owner_membership_id=r.created_by)) OR
   (co.prepare_operation_id IS NOT NULL AND co.bridge_operation_id IS NOT NULL AND NOT EXISTS(
     SELECT 1 FROM zhiban_bridge.operations prep JOIN zhiban_bridge.operations act
       ON act.tenant_id=prep.tenant_id AND act.slot_id=prep.slot_id AND act.generation_id=prep.generation_id
     WHERE prep.tenant_id=co.tenant_id AND prep.operation_id=co.prepare_operation_id
       AND act.operation_id=co.bridge_operation_id)) OR
   (co.bridge_operation_id IS NOT NULL AND NOT EXISTS(
     SELECT 1 FROM zhiban_bridge.operations b JOIN zhiban_bridge.resource_slots s
      ON s.tenant_id=b.tenant_id AND s.slot_id=b.slot_id
     WHERE b.tenant_id=co.tenant_id AND b.operation_id=co.bridge_operation_id
      AND b.operation=CASE co.action WHEN 'WITHDRAW_CONTENT' THEN 'SUSPEND' ELSE 'ACTIVATE_GENERATION' END
      AND b.actor_kind='USER' AND b.actor_membership_id=co.actor_id AND s.activity_id=r.id
      AND s.owner_membership_id=r.created_by
      AND (co.state<>'SUCCEEDED' OR b.state='SUCCEEDED')
      AND (co.action<>'WITHDRAW_CONTENT' OR EXISTS(SELECT 1 FROM zhiban_content.publications p
        WHERE p.tenant_id=co.tenant_id AND p.resource_id=r.id AND p.bridge_slot_id=b.slot_id
          AND p.bridge_generation_id=b.generation_id AND p.source_revision<co.source_revision)))) OR
   (co.state='SUCCEEDED' AND (co.result_revision>r.revision OR
      (co.action='CREATE_CONTENT' AND (co.result_revision<>1 OR co.actor_id<>r.created_by)) OR
      (co.action IN ('SAVE_CONTENT','WITHDRAW_CONTENT') AND co.result_revision NOT IN (co.source_revision,co.source_revision+1)) OR
      (co.action='PUBLISH_CONTENT' AND (co.result_revision<>co.source_revision+1 OR NOT EXISTS(
       SELECT 1 FROM zhiban_content.publications p WHERE p.tenant_id=co.tenant_id AND p.id=co.result_publication_id
        AND p.resource_id=r.id AND p.prepare_operation_id=co.prepare_operation_id
        AND p.activation_operation_id=co.bridge_operation_id))))) OR
   NOT EXISTS(SELECT 1 FROM zhiban_content.audit_events a WHERE a.tenant_id=co.tenant_id AND a.operation_id=co.id
     AND a.resource_id=r.id AND a.actor_id=co.actor_id AND (
       (co.state='RESERVED' AND a.event_type='PUBLISH_RESERVED' AND a.occurred_at=co.created_at
        AND a.revision_before=co.source_revision AND a.revision_after=co.source_revision) OR
       (co.state='OUTCOME_UNKNOWN' AND a.event_type='OUTCOME_QUARANTINED'
        AND a.revision_before=co.source_revision AND a.revision_after=co.source_revision) OR
       (co.state='FAILED' AND a.event_type='OPERATION_FAILED' AND a.occurred_at=co.completed_at
        AND a.revision_before=co.source_revision AND a.revision_after=co.source_revision) OR
       (co.state='SUCCEEDED' AND a.occurred_at=co.completed_at AND a.revision_after=co.result_revision AND (
        (co.action='CREATE_CONTENT' AND a.event_type='CONTENT_CREATED' AND a.revision_before IS NULL) OR
        (co.action<>'CREATE_CONTENT' AND a.revision_before=co.source_revision AND
          a.event_type=CASE WHEN co.result_revision=co.source_revision THEN 'COMMAND_NOOP'
            WHEN co.action='SAVE_CONTENT' THEN 'DRAFT_SAVED'
            WHEN co.action='PUBLISH_CONTENT' THEN 'CONTENT_PUBLISHED' ELSE 'CONTENT_WITHDRAWN' END))))))) THEN
   RAISE EXCEPTION 'Content operation/audit inconsistent' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM zhiban_content.operations co WHERE co.tenant_id=r.tenant_id AND co.resource_id=r.id
    AND co.state='SUCCEEDED' AND co.result_revision=r.revision AND co.actor_id=r.updated_by AND co.completed_at=r.updated_at
    AND (co.action='CREATE_CONTENT' OR co.result_revision>co.source_revision)) THEN
   RAISE EXCEPTION 'Content latest mutation receipt missing' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_SCHEMA='zhiban_content' THEN
   IF TG_TABLE_NAME='audit_events' THEN
     SELECT * INTO o FROM zhiban_content.operations WHERE tenant_id=NEW.tenant_id AND id=NEW.operation_id;
     IF NOT FOUND OR o.resource_id IS DISTINCT FROM NEW.resource_id OR o.actor_id IS DISTINCT FROM NEW.actor_id
        OR NEW.occurred_at<o.created_at OR (o.completed_at IS NOT NULL AND NEW.occurred_at>o.completed_at)
        OR NEW.revision_after>r.revision
        OR NOT coalesce(CASE NEW.event_type
          WHEN 'CONTENT_CREATED' THEN o.action='CREATE_CONTENT' AND NEW.occurred_at=o.completed_at AND NEW.revision_before IS NULL AND NEW.revision_after=1
          WHEN 'PUBLISH_RESERVED' THEN o.action='PUBLISH_CONTENT' AND NEW.occurred_at=o.created_at AND NEW.revision_before=o.source_revision AND NEW.revision_after=o.source_revision
          WHEN 'OUTCOME_QUARANTINED' THEN o.action='PUBLISH_CONTENT' AND NEW.revision_before=o.source_revision AND NEW.revision_after=o.source_revision
          WHEN 'OPERATION_FAILED' THEN o.state='FAILED' AND NEW.occurred_at=o.completed_at AND NEW.revision_before=o.source_revision AND NEW.revision_after=o.source_revision
          ELSE o.state='SUCCEEDED' AND NEW.occurred_at=o.completed_at AND NEW.revision_before=o.source_revision AND NEW.revision_after=o.result_revision
            AND NEW.event_type=CASE WHEN o.result_revision=o.source_revision THEN 'COMMAND_NOOP'
              WHEN o.action='SAVE_CONTENT' THEN 'DRAFT_SAVED' WHEN o.action='PUBLISH_CONTENT' THEN 'CONTENT_PUBLISHED'
              WHEN o.action='WITHDRAW_CONTENT' THEN 'CONTENT_WITHDRAWN' ELSE NULL END END,false) THEN
       RAISE EXCEPTION 'Content audit binding inconsistent' USING ERRCODE='23514';
     END IF;
   END IF;
 END IF;
 RETURN NULL;
END;
$$;
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['resources','publications','operations','audit_events'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER content_link_consistency AFTER INSERT OR UPDATE ON zhiban_content.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_content.link_consistency()',table_name);
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['resource_slots','resource_generations','operations'] LOOP
  EXECUTE format('CREATE CONSTRAINT TRIGGER content_link_consistency AFTER INSERT OR UPDATE ON zhiban_bridge.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_content.link_consistency()',table_name);
 END LOOP;
END $$;
