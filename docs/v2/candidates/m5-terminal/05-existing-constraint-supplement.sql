-- UNAPPLIED: narrowly scoped replacements, original trigger OIDs/ACL retained.
-- Source hashes: 4a30204e1ceb9b11e16af653ec35e1dbc9b142be92745b05a601db82441199d5 025318bf1759b6fb34c6a51992181f340efe16ae67d7cf597f5b09689f5c949c
CREATE OR REPLACE FUNCTION zhiban_content.operation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,zhiban_content,zhiban_identity,pg_temp AS $$
DECLARE r zhiban_content.resources%ROWTYPE;
BEGIN
 IF session_user NOT IN('zhiban_bridge_runtime','zhiban_reconcile_executor') OR NEW.tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id()
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

CREATE OR REPLACE FUNCTION zhiban_content.link_consistency() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,zhiban_content,zhiban_bridge,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE resource_key uuid; r zhiban_content.resources%ROWTYPE; o zhiban_content.operations%ROWTYPE;
BEGIN
 IF session_user NOT IN('zhiban_bridge_runtime','zhiban_reconcile_executor') OR NEW.tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id() THEN
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
     AND a.resource_id=r.id AND (a.actor_id=co.actor_id OR zhiban_reconcile.resolved_content_audit(co.tenant_id,co.id,a.id)) AND (
       (co.state='RESERVED' AND a.event_type='PUBLISH_RESERVED' AND a.occurred_at=co.created_at
        AND a.revision_before=co.source_revision AND a.revision_after=co.source_revision) OR
       (co.state='OUTCOME_UNKNOWN' AND a.event_type='OUTCOME_QUARANTINED'
        AND a.revision_before=co.source_revision AND a.revision_after=co.source_revision) OR
       (co.state='FAILED' AND a.event_type IN('OPERATION_FAILED','CONTENT_RECONCILED_UNPUBLISHED') AND a.occurred_at=co.completed_at
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
     IF NOT FOUND OR o.resource_id IS DISTINCT FROM NEW.resource_id OR (o.actor_id IS DISTINCT FROM NEW.actor_id AND NOT zhiban_reconcile.resolved_content_audit(NEW.tenant_id,NEW.operation_id,NEW.id))
        OR NEW.occurred_at<o.created_at OR (o.completed_at IS NOT NULL AND NEW.occurred_at>o.completed_at)
        OR NEW.revision_after>r.revision
        OR NOT coalesce(CASE NEW.event_type
          WHEN 'CONTENT_CREATED' THEN o.action='CREATE_CONTENT' AND NEW.occurred_at=o.completed_at AND NEW.revision_before IS NULL AND NEW.revision_after=1
          WHEN 'PUBLISH_RESERVED' THEN o.action='PUBLISH_CONTENT' AND NEW.occurred_at=o.created_at AND NEW.revision_before=o.source_revision AND NEW.revision_after=o.source_revision
          WHEN 'OUTCOME_QUARANTINED' THEN o.action='PUBLISH_CONTENT' AND NEW.revision_before=o.source_revision AND NEW.revision_after=o.source_revision
          WHEN 'CONTENT_RECONCILED_UNPUBLISHED' THEN o.state='FAILED' AND NEW.occurred_at=o.completed_at AND NEW.revision_before=o.source_revision AND NEW.revision_after=o.source_revision AND zhiban_reconcile.resolved_content_audit(NEW.tenant_id,NEW.operation_id,NEW.id)
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

CREATE OR REPLACE FUNCTION zhiban_bridge.mapping_consistency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,zhiban_bridge,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE v_slot_id uuid; v_slot zhiban_bridge.resource_slots%ROWTYPE; v_op zhiban_bridge.operations%ROWTYPE;
BEGIN
  IF NEW.tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id() THEN RAISE EXCEPTION 'Bridge context rejected' USING ERRCODE='42501'; END IF;
  IF TG_TABLE_NAME='resource_slots' THEN v_slot_id:=NEW.slot_id;
  ELSIF TG_TABLE_NAME IN ('resource_generations','operations','audit_events') THEN v_slot_id:=NEW.slot_id;
  ELSE SELECT g.slot_id INTO v_slot_id FROM zhiban_bridge.resource_generations AS g WHERE g.tenant_id=NEW.tenant_id AND g.generation_id=NEW.generation_id; END IF;
  SELECT s.* INTO v_slot FROM zhiban_bridge.resource_slots AS s WHERE s.tenant_id=NEW.tenant_id AND s.slot_id=v_slot_id;
  IF v_slot.slot_id IS NULL OR v_slot.last_generation<>(SELECT coalesce(max(g.generation),0) FROM zhiban_bridge.resource_generations AS g WHERE g.tenant_id=NEW.tenant_id AND g.slot_id=v_slot_id)
    OR EXISTS(SELECT 1 FROM zhiban_bridge.resource_generations AS g WHERE g.tenant_id=NEW.tenant_id AND g.slot_id=v_slot_id AND g.state='ACTIVE'
      AND (g.generation_id IS DISTINCT FROM v_slot.active_generation_id OR g.owner_membership_id<>v_slot.owner_membership_id OR v_slot.state='RETIRED'))
    OR (v_slot.active_generation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM zhiban_bridge.resource_generations AS g WHERE g.tenant_id=NEW.tenant_id AND g.slot_id=v_slot_id AND g.generation_id=v_slot.active_generation_id AND g.state='ACTIVE'))
    OR EXISTS(SELECT 1 FROM zhiban_bridge.asset_bindings AS a JOIN zhiban_bridge.resource_generations AS g ON g.tenant_id=a.tenant_id AND g.generation_id=a.generation_id
      WHERE g.tenant_id=NEW.tenant_id AND g.slot_id=v_slot_id AND (a.deployment_id<>g.deployment_id OR a.principal_handle<>g.owner_handle))
    OR EXISTS(SELECT 1 FROM zhiban_bridge.asset_bindings AS a JOIN zhiban_bridge.resource_generations AS g ON g.tenant_id=a.tenant_id AND g.generation_id=a.generation_id
      WHERE g.tenant_id=NEW.tenant_id AND g.slot_id=v_slot_id GROUP BY a.generation_id HAVING sum(a.byte_length)>33554432)
    OR EXISTS(SELECT 1 FROM zhiban_bridge.asset_bindings AS a JOIN zhiban_bridge.resource_generations AS g ON g.tenant_id=a.tenant_id AND g.generation_id=a.generation_id
      WHERE g.tenant_id=NEW.tenant_id AND g.slot_id=v_slot_id GROUP BY a.scene_binding_id HAVING count(*)>32)
    OR EXISTS(SELECT 1 FROM zhiban_bridge.resource_generations AS g WHERE g.tenant_id=NEW.tenant_id AND g.slot_id=v_slot_id AND g.state='ACTIVE'
      AND (NOT EXISTS(SELECT 1 FROM zhiban_bridge.operations AS o WHERE o.tenant_id=g.tenant_id AND o.generation_id=g.generation_id AND o.operation IN ('PREPARE_CONTENT','TRANSFER') AND o.state='SUCCEEDED' AND o.dispatch_started_at IS NOT NULL)
        OR (SELECT count(*) FROM zhiban_bridge.scene_bindings AS b WHERE b.tenant_id=g.tenant_id AND b.generation_id=g.generation_id)=0
        OR (SELECT min(b.scene_ordinal) FROM zhiban_bridge.scene_bindings AS b WHERE b.tenant_id=g.tenant_id AND b.generation_id=g.generation_id)<>0
        OR (SELECT max(b.scene_ordinal)+1 FROM zhiban_bridge.scene_bindings AS b WHERE b.tenant_id=g.tenant_id AND b.generation_id=g.generation_id)
          <>(SELECT count(*) FROM zhiban_bridge.scene_bindings AS b WHERE b.tenant_id=g.tenant_id AND b.generation_id=g.generation_id))) THEN
    RAISE EXCEPTION 'Bridge mapping inconsistent' USING ERRCODE='23514';
  END IF;
  -- Separate table dispatch from record-field access: other trigger rows lack these fields.
  IF TG_TABLE_NAME='resource_slots' THEN
    IF (TG_OP='UPDATE' OR NEW.last_generation>0)
      AND NOT EXISTS(SELECT 1 FROM zhiban_bridge.audit_events AS e WHERE e.tenant_id=NEW.tenant_id AND e.slot_id=NEW.slot_id AND e.slot_revision_after=NEW.repository_revision) THEN
      RAISE EXCEPTION 'Bridge mutation audit missing' USING ERRCODE='23514';
    END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM zhiban_bridge.operations AS o WHERE o.tenant_id=NEW.tenant_id AND o.slot_id=v_slot_id AND (
    (o.actor_kind='USER' AND NOT EXISTS(SELECT 1 FROM zhiban_identity.memberships AS m WHERE m.tenant_id=o.tenant_id AND m.membership_id=o.actor_membership_id AND m.user_id=o.actor_user_id))
    OR (o.generation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM zhiban_bridge.resource_generations AS g WHERE g.tenant_id=o.tenant_id AND g.generation_id=o.generation_id AND g.slot_id=o.slot_id))
    OR (o.result_generation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM zhiban_bridge.resource_generations AS g WHERE g.tenant_id=o.tenant_id AND g.generation_id=o.result_generation_id AND g.slot_id=o.slot_id))
    OR (o.state='SUCCEEDED' AND o.operation='PREPARE_ASSET' AND NOT EXISTS(SELECT 1 FROM zhiban_bridge.asset_bindings AS a WHERE a.tenant_id=o.tenant_id AND a.generation_id=o.generation_id AND a.asset_ref=o.result_asset_ref))
    OR NOT EXISTS(SELECT 1 FROM zhiban_bridge.audit_events AS e WHERE e.tenant_id=o.tenant_id AND e.operation_id=o.operation_id AND e.slot_id=o.slot_id)
    OR (o.state IN ('SUCCEEDED','FAILED','OUTCOME_UNKNOWN') AND NOT EXISTS(
      SELECT 1 FROM zhiban_bridge.audit_events AS e WHERE e.tenant_id=o.tenant_id AND e.operation_id=o.operation_id
        AND e.occurred_at=o.updated_at AND e.reason=o.reason AND
        ((o.state='FAILED' AND e.event_type IN ('OPERATION_FAILED','OUTCOME_RECONCILED'))
          OR (o.state='OUTCOME_UNKNOWN' AND e.event_type='OUTCOME_QUARANTINED')
          OR (o.state='SUCCEEDED' AND e.slot_revision_after=o.result_slot_revision AND e.event_type IN ('GENERATION_PREPARED','GENERATION_ACTIVATED','MAPPING_SUSPENDED','MAPPING_RETIRED','TRANSFER_COMPLETED','OUTCOME_RECONCILED'))))))) THEN
    RAISE EXCEPTION 'Bridge operation inconsistent' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='audit_events' THEN
    SELECT o.* INTO v_op FROM zhiban_bridge.operations AS o WHERE o.tenant_id=NEW.tenant_id AND o.operation_id=NEW.operation_id;
    IF v_op.slot_id IS DISTINCT FROM NEW.slot_id OR ((v_op.actor_kind IS DISTINCT FROM NEW.actor_kind
      OR v_op.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR v_op.actor_membership_id IS DISTINCT FROM NEW.actor_membership_id
      OR v_op.service_ref IS DISTINCT FROM NEW.service_ref)
      AND NOT zhiban_reconcile.resolved_bridge_audit(NEW.tenant_id,NEW.operation_id,NEW.event_id)) OR NEW.slot_revision_after>v_slot.repository_revision
      OR NEW.occurred_at<v_op.created_at OR NEW.occurred_at>v_op.updated_at THEN
      RAISE EXCEPTION 'Bridge audit inconsistent' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
