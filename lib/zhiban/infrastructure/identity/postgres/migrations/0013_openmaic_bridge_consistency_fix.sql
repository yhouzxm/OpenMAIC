-- 0012 is already applied. Preserve its checksum and all function privileges.
-- Repair only shared-trigger record-field dispatch; mapping/audit rules are unchanged.
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
    IF v_op.slot_id IS DISTINCT FROM NEW.slot_id OR v_op.actor_kind IS DISTINCT FROM NEW.actor_kind
      OR v_op.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR v_op.actor_membership_id IS DISTINCT FROM NEW.actor_membership_id
      OR v_op.service_ref IS DISTINCT FROM NEW.service_ref OR NEW.slot_revision_after>v_slot.repository_revision
      OR NEW.occurred_at<v_op.created_at OR NEW.occurred_at>v_op.updated_at THEN
      RAISE EXCEPTION 'Bridge audit inconsistent' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
