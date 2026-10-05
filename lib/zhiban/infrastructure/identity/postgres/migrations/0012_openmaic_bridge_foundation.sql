-- B9-P01--P08. Business writes remain closed until real Activity contracts exist.
CREATE SCHEMA zhiban_bridge AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_bridge FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_bridge, zhiban_identity TO zhiban_bridge_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.current_tenant_id(), zhiban_identity.is_uuid_v7(uuid) TO zhiban_bridge_runtime;

CREATE TABLE zhiban_bridge.deployment_registry (
  deployment_id uuid PRIMARY KEY CHECK (zhiban_identity.is_uuid_v7(deployment_id)),
  deployment_ref text COLLATE "C" NOT NULL UNIQUE CHECK (octet_length(deployment_ref) BETWEEN 1 AND 256 AND deployment_ref !~ '[[:cntrl:]]'),
  official_sha text NOT NULL CHECK (official_sha ~ '^[0-9a-f]{40}$'),
  storage_version text NOT NULL CHECK (storage_version='0.31.1'),
  dsl_version text NOT NULL CHECK (dsl_version='0.11.2'),
  renderer_version text NOT NULL CHECK (renderer_version='0.1.11'),
  provisioning_digest text COLLATE "C" NOT NULL CHECK (provisioning_digest ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('CANDIDATE','VERIFIED','DISABLED')),
  repository_revision bigint NOT NULL CHECK (repository_revision>=1),
  created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
  updated_at bigint NOT NULL CHECK (updated_at BETWEEN created_at AND 8640000000000000)
);
CREATE TABLE zhiban_bridge.resource_slots (
  tenant_id uuid NOT NULL REFERENCES zhiban_identity.tenants(tenant_id) ON DELETE RESTRICT,
  slot_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(slot_id)),
  activity_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(activity_id)),
  deployment_id uuid NOT NULL REFERENCES zhiban_bridge.deployment_registry(deployment_id) ON DELETE RESTRICT,
  owner_membership_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('ENABLED','SUSPENDED','TRANSFERRING','RETIRED')),
  last_generation bigint NOT NULL CHECK (last_generation>=0),
  active_generation_id uuid CHECK (active_generation_id IS NULL OR zhiban_identity.is_uuid_v7(active_generation_id)),
  repository_revision bigint NOT NULL CHECK (repository_revision>=1),
  created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
  updated_at bigint NOT NULL CHECK (updated_at BETWEEN created_at AND 8640000000000000),
  retired_at bigint CHECK (retired_at BETWEEN created_at AND updated_at),
  PRIMARY KEY(tenant_id,slot_id), UNIQUE(tenant_id,activity_id,deployment_id), UNIQUE(tenant_id,slot_id,deployment_id),
  FOREIGN KEY(tenant_id,owner_membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id) ON DELETE RESTRICT,
  CHECK ((state='RETIRED')=(retired_at IS NOT NULL)),
  CHECK (state<>'RETIRED' OR active_generation_id IS NULL),
  CHECK (state<>'ENABLED' OR active_generation_id IS NOT NULL)
);
CREATE TABLE zhiban_bridge.resource_generations (
  tenant_id uuid NOT NULL REFERENCES zhiban_identity.tenants(tenant_id) ON DELETE RESTRICT,
  generation_id uuid NOT NULL CHECK(zhiban_identity.is_uuid_v7(generation_id)),
  slot_id uuid NOT NULL, deployment_id uuid NOT NULL, owner_membership_id uuid NOT NULL,
  generation bigint NOT NULL CHECK(generation>=1),
  owner_handle text COLLATE "C" NOT NULL CHECK(owner_handle ~ '^[A-Za-z0-9_-]{43}$' AND octet_length(owner_handle)=43),
  stage_ref text COLLATE "C" NOT NULL CHECK(octet_length(stage_ref) BETWEEN 1 AND 256 AND stage_ref !~ '[[:cntrl:]]'),
  content_digest text COLLATE "C" NOT NULL CHECK(content_digest ~ '^[0-9a-f]{64}$'),
  dsl_version text NOT NULL CHECK(dsl_version='0.11.2'),
  state text NOT NULL CHECK(state IN ('PENDING','ACTIVE','ORPHAN','RETIRED')),
  repository_revision bigint NOT NULL CHECK(repository_revision>=1),
  created_at bigint NOT NULL CHECK(created_at BETWEEN 0 AND 8640000000000000),
  updated_at bigint NOT NULL CHECK(updated_at BETWEEN created_at AND 8640000000000000),
  activated_at bigint CHECK(activated_at BETWEEN created_at AND updated_at),
  terminal_at bigint CHECK(terminal_at BETWEEN created_at AND updated_at),
  PRIMARY KEY(tenant_id,generation_id), UNIQUE(tenant_id,slot_id,generation), UNIQUE(tenant_id,slot_id,generation_id),
  UNIQUE(deployment_id,stage_ref), UNIQUE(deployment_id,owner_handle),
  FOREIGN KEY(tenant_id,slot_id,deployment_id) REFERENCES zhiban_bridge.resource_slots(tenant_id,slot_id,deployment_id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,owner_membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id) ON DELETE RESTRICT,
  CHECK (((state='PENDING' AND activated_at IS NULL AND terminal_at IS NULL)
    OR (state='ACTIVE' AND activated_at IS NOT NULL AND terminal_at IS NULL)
    OR (state='RETIRED' AND activated_at IS NOT NULL AND terminal_at>=activated_at)
    OR (state='ORPHAN' AND terminal_at IS NOT NULL AND (activated_at IS NULL OR terminal_at>=activated_at))) IS TRUE)
);
ALTER TABLE zhiban_bridge.resource_slots ADD CONSTRAINT slot_current_generation_fk
  FOREIGN KEY(tenant_id,slot_id,active_generation_id) REFERENCES zhiban_bridge.resource_generations(tenant_id,slot_id,generation_id)
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX bridge_single_active ON zhiban_bridge.resource_generations(tenant_id,slot_id) WHERE state='ACTIVE';
CREATE TABLE zhiban_bridge.scene_bindings (
  tenant_id uuid NOT NULL REFERENCES zhiban_identity.tenants(tenant_id) ON DELETE RESTRICT,
  scene_binding_id uuid NOT NULL CHECK(zhiban_identity.is_uuid_v7(scene_binding_id)), generation_id uuid NOT NULL,
  scene_ref text COLLATE "C" NOT NULL CHECK(octet_length(scene_ref) BETWEEN 1 AND 256 AND scene_ref !~ '[[:cntrl:]]'),
  scene_ordinal bigint NOT NULL CHECK(scene_ordinal BETWEEN 0 AND 63),
  scene_digest text COLLATE "C" NOT NULL CHECK(scene_digest ~ '^[0-9a-f]{64}$'),
  created_at bigint NOT NULL CHECK(created_at BETWEEN 0 AND 8640000000000000),
  PRIMARY KEY(tenant_id,scene_binding_id), UNIQUE(tenant_id,generation_id,scene_ref), UNIQUE(tenant_id,generation_id,scene_ordinal),
  UNIQUE(tenant_id,generation_id,scene_binding_id),
  FOREIGN KEY(tenant_id,generation_id) REFERENCES zhiban_bridge.resource_generations(tenant_id,generation_id) ON DELETE RESTRICT
);
CREATE TABLE zhiban_bridge.asset_bindings (
  tenant_id uuid NOT NULL REFERENCES zhiban_identity.tenants(tenant_id) ON DELETE RESTRICT,
  asset_binding_id uuid NOT NULL CHECK(zhiban_identity.is_uuid_v7(asset_binding_id)),
  generation_id uuid NOT NULL, scene_binding_id uuid NOT NULL, deployment_id uuid NOT NULL REFERENCES zhiban_bridge.deployment_registry(deployment_id) ON DELETE RESTRICT,
  principal_handle text COLLATE "C" NOT NULL CHECK(principal_handle ~ '^[A-Za-z0-9_-]{43}$' AND octet_length(principal_handle)=43),
  asset_ref text COLLATE "C" NOT NULL CHECK(octet_length(asset_ref) BETWEEN 1 AND 256 AND asset_ref !~ '[[:cntrl:]]'),
  purpose text NOT NULL CHECK(purpose IN ('IMAGE','AUDIO','VIDEO','POSTER','BACKGROUND')),
  mime text NOT NULL CHECK(mime IN ('image/png','audio/wav','video/webm')),
  byte_length bigint NOT NULL CHECK(byte_length BETWEEN 1 AND 4194304),
  byte_digest text COLLATE "C" NOT NULL CHECK(byte_digest ~ '^[0-9a-f]{64}$'),
  provider_revision bigint NOT NULL CHECK(provider_revision>=1),
  created_at bigint NOT NULL CHECK(created_at BETWEEN 0 AND 8640000000000000),
  PRIMARY KEY(tenant_id,asset_binding_id), UNIQUE(deployment_id,asset_ref),
  UNIQUE(tenant_id,generation_id,scene_binding_id,purpose,asset_ref),
  FOREIGN KEY(tenant_id,generation_id,scene_binding_id) REFERENCES zhiban_bridge.scene_bindings(tenant_id,generation_id,scene_binding_id) ON DELETE RESTRICT,
  CHECK ((purpose IN ('IMAGE','POSTER','BACKGROUND') AND mime='image/png') OR (purpose='AUDIO' AND mime='audio/wav') OR (purpose='VIDEO' AND mime='video/webm'))
);
CREATE TABLE zhiban_bridge.operations (
  tenant_id uuid NOT NULL REFERENCES zhiban_identity.tenants(tenant_id) ON DELETE RESTRICT,
  operation_id uuid NOT NULL CHECK(zhiban_identity.is_uuid_v7(operation_id)), slot_id uuid NOT NULL, generation_id uuid,
  actor_kind text NOT NULL CHECK(actor_kind IN ('USER','SERVICE_RECONCILE')),
  actor_user_id uuid REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT, actor_membership_id uuid,
  service_ref text COLLATE "C" CHECK(octet_length(service_ref) BETWEEN 1 AND 256 AND service_ref !~ '[[:cntrl:]]'),
  operation text NOT NULL CHECK(operation IN ('PREPARE_CONTENT','PREPARE_ASSET','ACTIVATE_GENERATION','SUSPEND','RETIRE','TRANSFER','RECONCILE')),
  actor_key text COLLATE "C" NOT NULL CHECK(octet_length(actor_key) BETWEEN 1 AND 256 AND actor_key !~ '[[:cntrl:]]'),
  key_digest text COLLATE "C" NOT NULL CHECK(key_digest ~ '^[0-9a-f]{64}$'),
  intent_digest text COLLATE "C" NOT NULL CHECK(intent_digest ~ '^[0-9a-f]{64}$'),
  expected_slot_revision bigint NOT NULL CHECK(expected_slot_revision>=1),
  reserved_slot_revision bigint NOT NULL CHECK(reserved_slot_revision>expected_slot_revision AND reserved_slot_revision-expected_slot_revision=1),
  expected_authorization_version bigint CHECK(expected_authorization_version BETWEEN 0 AND 9007199254740991),
  state text NOT NULL CHECK(state IN ('RESERVED','SUCCEEDED','FAILED','OUTCOME_UNKNOWN')),
  repository_revision bigint NOT NULL CHECK(repository_revision>=1),
  reserved_stage_ref text COLLATE "C" CHECK(octet_length(reserved_stage_ref) BETWEEN 1 AND 256 AND reserved_stage_ref !~ '[[:cntrl:]]'),
  result_asset_ref text COLLATE "C" CHECK(octet_length(result_asset_ref) BETWEEN 1 AND 256 AND result_asset_ref !~ '[[:cntrl:]]'),
  result_generation_id uuid, result_slot_revision bigint CHECK(result_slot_revision>=reserved_slot_revision),
  created_at bigint NOT NULL CHECK(created_at BETWEEN 0 AND 8640000000000000),
  updated_at bigint NOT NULL CHECK(updated_at BETWEEN created_at AND 8640000000000000),
  dispatch_started_at bigint CHECK(dispatch_started_at BETWEEN created_at AND updated_at),
  completed_at bigint CHECK(completed_at BETWEEN created_at AND updated_at),
  reason text NOT NULL CHECK(reason IN ('NONE','DENIED','STALE','INVALID_CONTENT','STORAGE_FAILURE','UNKNOWN_OUTCOME','INTEGRITY_FAILURE')),
  PRIMARY KEY(tenant_id,operation_id), UNIQUE(tenant_id,actor_key,slot_id,operation,key_digest),
  FOREIGN KEY(tenant_id,slot_id) REFERENCES zhiban_bridge.resource_slots(tenant_id,slot_id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,generation_id) REFERENCES zhiban_bridge.resource_generations(tenant_id,generation_id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,result_generation_id) REFERENCES zhiban_bridge.resource_generations(tenant_id,generation_id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,actor_membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id) ON DELETE RESTRICT,
  CHECK ((actor_kind='USER' AND actor_user_id IS NOT NULL AND actor_membership_id IS NOT NULL AND expected_authorization_version IS NOT NULL AND service_ref IS NULL AND actor_key='user:'||actor_user_id::text)
    OR (actor_kind='SERVICE_RECONCILE' AND actor_user_id IS NULL AND actor_membership_id IS NULL AND expected_authorization_version IS NULL AND service_ref IS NOT NULL AND actor_key='service:'||service_ref AND operation='RECONCILE')),
  CHECK ((state IN ('RESERVED','OUTCOME_UNKNOWN'))=(completed_at IS NULL)),
  CHECK ((reserved_stage_ref IS NOT NULL)=(operation IN ('PREPARE_CONTENT','TRANSFER'))),
  CHECK (state<>'OUTCOME_UNKNOWN' OR reason='UNKNOWN_OUTCOME'),
  CHECK (state<>'SUCCEEDED' OR (reason='NONE' AND result_slot_revision IS NOT NULL)),
  CHECK (state<>'FAILED' OR reason<>'NONE')
  ,CHECK (state='SUCCEEDED' OR (result_asset_ref IS NULL AND result_generation_id IS NULL AND result_slot_revision IS NULL))
  ,CHECK (result_asset_ref IS NULL OR (state='SUCCEEDED' AND operation='PREPARE_ASSET'))
  ,CHECK (operation<>'PREPARE_ASSET' OR state<>'SUCCEEDED' OR result_asset_ref IS NOT NULL)
  ,CHECK (operation NOT IN ('PREPARE_CONTENT','PREPARE_ASSET','TRANSFER') OR state NOT IN ('SUCCEEDED','OUTCOME_UNKNOWN') OR dispatch_started_at IS NOT NULL)
);
CREATE TABLE zhiban_bridge.audit_events (
  tenant_id uuid NOT NULL REFERENCES zhiban_identity.tenants(tenant_id) ON DELETE RESTRICT,
  event_id uuid NOT NULL CHECK(zhiban_identity.is_uuid_v7(event_id)), slot_id uuid NOT NULL, operation_id uuid NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('GENERATION_RESERVED','GENERATION_PREPARED','GENERATION_ACTIVATED','MAPPING_SUSPENDED','MAPPING_RETIRED','TRANSFER_STARTED','TRANSFER_COMPLETED','OPERATION_FAILED','OUTCOME_QUARANTINED','OUTCOME_RECONCILED')),
  actor_kind text NOT NULL CHECK(actor_kind IN ('USER','SERVICE_RECONCILE')),
  actor_user_id uuid REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT, actor_membership_id uuid, service_ref text COLLATE "C",
  request_id text COLLATE "C" NOT NULL CHECK(octet_length(request_id) BETWEEN 1 AND 256 AND request_id !~ '[[:cntrl:]]'),
  slot_revision_before bigint CHECK(slot_revision_before>=1), slot_revision_after bigint NOT NULL CHECK(slot_revision_after>=1),
  occurred_at bigint NOT NULL CHECK(occurred_at BETWEEN 0 AND 8640000000000000),
  reason text NOT NULL CHECK(reason IN ('NONE','DENIED','STALE','INVALID_CONTENT','STORAGE_FAILURE','UNKNOWN_OUTCOME','INTEGRITY_FAILURE')),
  PRIMARY KEY(tenant_id,event_id),
  FOREIGN KEY(tenant_id,slot_id) REFERENCES zhiban_bridge.resource_slots(tenant_id,slot_id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,operation_id) REFERENCES zhiban_bridge.operations(tenant_id,operation_id) ON DELETE RESTRICT,
  FOREIGN KEY(tenant_id,actor_membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id) ON DELETE RESTRICT,
  CHECK ((actor_kind='USER' AND actor_user_id IS NOT NULL AND actor_membership_id IS NOT NULL AND service_ref IS NULL)
    OR (actor_kind='SERVICE_RECONCILE' AND actor_user_id IS NULL AND actor_membership_id IS NULL AND service_ref IS NOT NULL AND octet_length(service_ref) BETWEEN 1 AND 256 AND service_ref !~ '[[:cntrl:]]')),
  CHECK (slot_revision_before IS NOT NULL OR event_type='GENERATION_RESERVED')
);

CREATE FUNCTION zhiban_bridge.business_resource_ready(p_tenant_id uuid,p_activity_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog,zhiban_bridge,zhiban_identity,pg_temp AS $$ SELECT FALSE $$;

CREATE FUNCTION zhiban_bridge.resource_gate_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,zhiban_bridge,zhiban_identity,pg_temp AS $$
DECLARE v_slot zhiban_bridge.resource_slots%ROWTYPE; v_generation zhiban_bridge.resource_generations%ROWTYPE; v_slot_id uuid;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Bridge change rejected' USING ERRCODE='23514'; END IF;
  IF NEW.tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id()
    OR current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'Bridge context rejected' USING ERRCODE='42501';
  END IF;
  IF TG_TABLE_NAME='resource_slots' THEN
    IF zhiban_bridge.business_resource_ready(NEW.tenant_id,NEW.activity_id) IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Bridge resource unavailable' USING ERRCODE='42501';
    END IF;
  ELSE
    IF TG_TABLE_NAME IN ('resource_generations','operations','audit_events') THEN v_slot_id:=NEW.slot_id;
    ELSE
      SELECT g.slot_id INTO v_slot_id FROM zhiban_bridge.resource_generations AS g WHERE g.tenant_id=NEW.tenant_id AND g.generation_id=NEW.generation_id;
    END IF;
    SELECT s.* INTO v_slot FROM zhiban_bridge.resource_slots AS s WHERE s.tenant_id=NEW.tenant_id AND s.slot_id=v_slot_id FOR UPDATE;
    IF v_slot.slot_id IS NULL OR zhiban_bridge.business_resource_ready(NEW.tenant_id,v_slot.activity_id) IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Bridge resource unavailable' USING ERRCODE='42501';
    END IF;
    IF TG_TABLE_NAME IN ('scene_bindings','asset_bindings') THEN
      SELECT g.* INTO v_generation FROM zhiban_bridge.resource_generations AS g WHERE g.tenant_id=NEW.tenant_id AND g.generation_id=NEW.generation_id FOR UPDATE;
      IF v_generation.state IS DISTINCT FROM 'PENDING' OR NEW.created_at<v_generation.created_at THEN
        RAISE EXCEPTION 'Bridge candidate rejected' USING ERRCODE='23514';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION zhiban_bridge.slot_cas_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,zhiban_bridge,zhiban_identity,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Bridge slot rejected' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'SUSPENDED' OR NEW.last_generation<>0 OR NEW.active_generation_id IS NOT NULL OR NEW.repository_revision<>1 THEN
      RAISE EXCEPTION 'Bridge slot rejected' USING ERRCODE='23514';
    END IF;
  ELSE
    IF OLD.state='RETIRED' OR OLD.repository_revision=9223372036854775807
      OR NEW.repository_revision<>OLD.repository_revision+1 OR NEW.updated_at<OLD.updated_at
      OR NEW.last_generation<OLD.last_generation OR NEW.last_generation-OLD.last_generation>1
      OR (to_jsonb(NEW)-ARRAY['owner_membership_id','state','last_generation','active_generation_id','repository_revision','updated_at','retired_at'])
        IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['owner_membership_id','state','last_generation','active_generation_id','repository_revision','updated_at','retired_at'])
      OR (NEW.owner_membership_id<>OLD.owner_membership_id AND OLD.state<>'TRANSFERRING') THEN
      RAISE EXCEPTION 'Bridge slot rejected' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION zhiban_bridge.mapping_history_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,zhiban_bridge,zhiban_identity,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' OR TG_TABLE_NAME IN ('scene_bindings','asset_bindings') THEN
    RAISE EXCEPTION 'Bridge history rejected' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'PENDING' OR NEW.repository_revision<>1 OR NEW.activated_at IS NOT NULL
      OR NEW.terminal_at IS NOT NULL OR NEW.updated_at<>NEW.created_at THEN
      RAISE EXCEPTION 'Bridge history rejected' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.state IN ('ORPHAN','RETIRED') OR OLD.repository_revision=9223372036854775807
    OR NEW.repository_revision<>OLD.repository_revision+1 OR NEW.updated_at<OLD.updated_at
    OR NOT ((OLD.state='PENDING' AND NEW.state IN ('ACTIVE','ORPHAN')) OR (OLD.state='ACTIVE' AND NEW.state IN ('RETIRED','ORPHAN')))
    OR (OLD.activated_at IS NOT NULL AND NEW.activated_at IS DISTINCT FROM OLD.activated_at)
    OR (to_jsonb(NEW)-ARRAY['state','repository_revision','updated_at','activated_at','terminal_at'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','repository_revision','updated_at','activated_at','terminal_at']) THEN
    RAISE EXCEPTION 'Bridge history rejected' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION zhiban_bridge.operation_history_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,zhiban_bridge,zhiban_identity,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'RESERVED' OR NEW.repository_revision<>1 OR NEW.dispatch_started_at IS NOT NULL
      OR NEW.completed_at IS NOT NULL OR NEW.result_asset_ref IS NOT NULL OR NEW.result_generation_id IS NOT NULL
      OR NEW.result_slot_revision IS NOT NULL OR NEW.reason<>'NONE' OR NEW.updated_at<>NEW.created_at THEN
      RAISE EXCEPTION 'Bridge operation rejected' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' OR OLD.state IN ('SUCCEEDED','FAILED') OR OLD.repository_revision=9223372036854775807
    OR NEW.repository_revision<>OLD.repository_revision+1 OR NEW.updated_at<OLD.updated_at
    OR (OLD.dispatch_started_at IS NOT NULL AND NEW.dispatch_started_at IS DISTINCT FROM OLD.dispatch_started_at)
    OR NOT ((OLD.state='RESERVED' AND NEW.state IN ('RESERVED','SUCCEEDED','FAILED','OUTCOME_UNKNOWN')) OR (OLD.state='OUTCOME_UNKNOWN' AND NEW.state IN ('SUCCEEDED','FAILED')))
    OR (NEW.state='RESERVED' AND (OLD.dispatch_started_at IS NOT NULL OR NEW.dispatch_started_at IS NULL))
    OR (to_jsonb(NEW)-ARRAY['state','repository_revision','updated_at','dispatch_started_at','completed_at','reason','result_asset_ref','result_generation_id','result_slot_revision'])
      IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','repository_revision','updated_at','dispatch_started_at','completed_at','reason','result_asset_ref','result_generation_id','result_slot_revision']) THEN
    RAISE EXCEPTION 'Bridge operation rejected' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION zhiban_bridge.audit_immutability_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,zhiban_bridge,zhiban_identity,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Bridge audit immutable' USING ERRCODE='23514'; END;
$$;

CREATE FUNCTION zhiban_bridge.mapping_consistency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
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
  IF TG_TABLE_NAME='resource_slots' AND (TG_OP='UPDATE' OR NEW.last_generation>0)
    AND NOT EXISTS(SELECT 1 FROM zhiban_bridge.audit_events AS e WHERE e.tenant_id=NEW.tenant_id AND e.slot_id=NEW.slot_id AND e.slot_revision_after=NEW.repository_revision) THEN
    RAISE EXCEPTION 'Bridge mutation audit missing' USING ERRCODE='23514';
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

CREATE POLICY memberships_bridge_owner_lock ON zhiban_identity.memberships FOR UPDATE TO zhiban_identity_owner
  USING(session_user='zhiban_bridge_runtime' AND tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(false);
CREATE POLICY grants_bridge_owner_lock ON zhiban_identity.role_grants FOR UPDATE TO zhiban_identity_owner
  USING(session_user='zhiban_bridge_runtime' AND tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(false);

CREATE FUNCTION zhiban_identity.bridge_identity_context(p_tenant_id uuid,p_digest text,p_expected_user_id uuid,p_actor_membership_id uuid,p_related_membership_ids uuid[])
RETURNS TABLE(membership_id uuid,user_id uuid,user_status text,user_revision bigint,membership_status text,membership_revision bigint,
  authorization_version bigint,tenant_revision bigint,security_epoch bigint,absolute_expires_at bigint,idle_expires_at bigint,evaluated_at bigint,effective_grants jsonb)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE v_ids uuid[]; v_users uuid[]; v_actor zhiban_identity.memberships%ROWTYPE; v_member zhiban_identity.memberships%ROWTYPE;
  v_user zhiban_identity.users%ROWTYPE; v_actor_user zhiban_identity.users%ROWTYPE; v_tenant zhiban_identity.tenants%ROWTYPE;
  v_slot zhiban_identity.credential_slots%ROWTYPE; v_session zhiban_identity.sessions%ROWTYPE;
  v_grant zhiban_identity.role_grants%ROWTYPE; v_grants jsonb:='[]'::jsonb; v_now bigint; v_count integer;
BEGIN
  IF session_user<>'zhiban_bridge_runtime' OR p_tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id()
    OR zhiban_identity.is_uuid_v7(p_tenant_id) IS DISTINCT FROM TRUE OR zhiban_identity.is_uuid_v7(p_expected_user_id) IS DISTINCT FROM TRUE
    OR zhiban_identity.is_uuid_v7(p_actor_membership_id) IS DISTINCT FROM TRUE OR p_digest IS NULL OR octet_length(p_digest)<>64 OR p_digest !~ '^[0-9a-f]{64}$'
    OR p_related_membership_ids IS NULL OR cardinality(p_related_membership_ids)>2
    OR EXISTS(SELECT 1 FROM unnest(p_related_membership_ids) AS i(id) WHERE zhiban_identity.is_uuid_v7(i.id) IS DISTINCT FROM TRUE)
    OR cardinality(p_related_membership_ids)<>(SELECT count(DISTINCT i.id) FROM unnest(p_related_membership_ids) AS i(id)) THEN
    RAISE EXCEPTION 'Bridge context rejected' USING ERRCODE='42501';
  END IF;
  SELECT array_agg(i.id ORDER BY i.id) INTO v_ids FROM (SELECT DISTINCT unnest(p_related_membership_ids||ARRAY[p_actor_membership_id]) AS id) AS i;
  SELECT t.* INTO v_tenant FROM zhiban_identity.tenants AS t WHERE t.tenant_id=p_tenant_id FOR SHARE;
  IF (v_tenant.status='ACTIVE' AND v_tenant.repository_revision>0 AND v_tenant.disabled_at IS NULL AND v_tenant.disabled_reason IS NULL
    AND v_tenant.created_at>=0 AND v_tenant.updated_at BETWEEN v_tenant.created_at AND 8640000000000000) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Bridge context rejected' USING ERRCODE='42501';
  END IF;
  SELECT array_agg(DISTINCT m.user_id ORDER BY m.user_id),count(*) INTO v_users,v_count FROM zhiban_identity.memberships AS m WHERE m.tenant_id=p_tenant_id AND m.membership_id=ANY(v_ids);
  IF v_count<>cardinality(v_ids) THEN RAISE EXCEPTION 'Bridge context rejected' USING ERRCODE='42501'; END IF;
  FOR v_user IN SELECT u.* FROM zhiban_identity.users AS u WHERE u.user_id=ANY(v_users) ORDER BY u.user_id FOR SHARE LOOP
    IF (zhiban_identity.is_uuid_v7(v_user.user_id) AND v_user.repository_revision>0 AND v_user.status IN ('ACTIVE','DISABLED')
      AND v_user.created_at>=0 AND v_user.updated_at BETWEEN v_user.created_at AND 8640000000000000
      AND ((v_user.status='ACTIVE' AND v_user.disabled_at IS NULL AND v_user.disabled_reason IS NULL)
        OR (v_user.status='DISABLED' AND v_user.disabled_at BETWEEN v_user.created_at AND v_user.updated_at AND btrim(v_user.disabled_reason)<>''))) IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Bridge context rejected' USING ERRCODE='42501';
    END IF;
    IF v_user.user_id=p_expected_user_id THEN v_actor_user:=v_user; END IF;
  END LOOP;
  IF v_actor_user.status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Bridge context rejected' USING ERRCODE='42501'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('zhiban-session-user:'||p_expected_user_id::text,0));
  SELECT c.* INTO v_slot FROM zhiban_identity.credential_slots AS c WHERE c.user_id=p_expected_user_id FOR SHARE;
  SELECT s.* INTO v_session FROM zhiban_identity.sessions AS s WHERE s.token_digest=p_digest FOR SHARE;
  v_now:=floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint;
  IF (v_session.user_id=p_expected_user_id AND v_session.user_revision=v_actor_user.repository_revision AND v_session.revoked_at IS NULL
    AND v_session.repository_revision>0 AND v_session.security_epoch>0 AND v_session.security_epoch=v_slot.security_epoch
    AND v_slot.repository_revision>0 AND v_slot.generation>0 AND v_slot.credential_type='PASSWORD' AND v_slot.active_credential_id IS NOT NULL
    AND v_slot.created_at>=0 AND v_slot.updated_at BETWEEN v_slot.created_at AND 8640000000000000
    AND v_session.session_id ~ '^ses_[A-Za-z0-9_-]{43}$' AND octet_length(v_session.session_id)=47 AND v_session.token_digest=p_digest
    AND v_session.created_at>=0 AND v_session.last_seen_at>=v_session.created_at AND v_now>=v_session.last_seen_at
    AND v_now<v_session.idle_expires_at AND v_session.idle_expires_at<=v_session.absolute_expires_at AND v_session.absolute_expires_at<=8640000000000000
    AND EXISTS(SELECT 1 FROM zhiban_identity.credentials AS c WHERE c.user_id=p_expected_user_id AND c.credential_id=v_slot.active_credential_id
      AND c.status='ACTIVE' AND c.credential_type='PASSWORD' AND c.generation=v_slot.generation AND c.slot_revision=v_slot.repository_revision
      AND c.created_at>=v_slot.created_at AND c.updated_at BETWEEN c.created_at AND v_slot.updated_at AND c.replaced_at IS NULL AND c.revoked_at IS NULL AND c.replaced_by_credential_id IS NULL)) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Bridge context rejected' USING ERRCODE='42501';
  END IF;
  FOR v_member IN SELECT m.* FROM zhiban_identity.memberships AS m WHERE m.tenant_id=p_tenant_id AND m.membership_id=ANY(v_ids) ORDER BY m.membership_id FOR SHARE LOOP
    IF (v_member.user_id=ANY(v_users) AND v_member.repository_revision>0 AND v_member.authorization_version BETWEEN 0 AND 9007199254740991
      AND v_member.status IN ('PENDING','ACTIVE','DISABLED','LEFT') AND v_member.created_at>=0 AND v_member.updated_at BETWEEN v_member.created_at AND 8640000000000000
      AND ((v_member.status='DISABLED' AND v_member.disabled_at BETWEEN v_member.created_at AND v_member.updated_at AND btrim(v_member.disabled_reason)<>'')
        OR (v_member.status<>'DISABLED' AND v_member.disabled_at IS NULL AND v_member.disabled_reason IS NULL))) IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Bridge context rejected' USING ERRCODE='42501';
    END IF;
    IF v_member.membership_id=p_actor_membership_id THEN v_actor:=v_member; END IF;
  END LOOP;
  IF v_actor.user_id IS DISTINCT FROM p_expected_user_id OR v_actor.status IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Bridge context rejected' USING ERRCODE='42501'; END IF;
  FOR v_grant IN SELECT g.* FROM zhiban_identity.role_grants AS g WHERE g.tenant_id=p_tenant_id AND g.membership_id=p_actor_membership_id ORDER BY g.grant_id FOR SHARE LOOP
    IF (zhiban_identity.is_uuid_v7(v_grant.grant_id) AND v_grant.role_code IN ('STUDENT','TEACHER','TENANT_ADMIN')
      AND ((v_grant.scope_kind IN ('SELF','TENANT') AND v_grant.scope_id IS NULL) OR (v_grant.scope_kind IN ('CLASS','COURSE') AND zhiban_identity.is_uuid_v7(v_grant.scope_id)))
      AND v_grant.created_at>=0 AND v_grant.valid_from BETWEEN v_grant.created_at AND 8640000000000000
      AND (v_grant.valid_until IS NULL OR v_grant.valid_until BETWEEN v_grant.valid_from+1 AND 8640000000000000)
      AND (v_grant.revoked_at IS NULL OR v_grant.revoked_at BETWEEN v_grant.created_at AND 8640000000000000)) IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'Bridge context rejected' USING ERRCODE='42501';
    END IF;
    IF v_grant.revoked_at IS NULL AND v_grant.valid_from<=v_now AND (v_grant.valid_until IS NULL OR v_now<v_grant.valid_until) THEN
      v_grants:=v_grants||jsonb_build_array(jsonb_build_object('grantId',v_grant.grant_id,'roleCode',v_grant.role_code,'scopeKind',v_grant.scope_kind,'scopeId',v_grant.scope_id,'validFrom',v_grant.valid_from,'validUntil',v_grant.valid_until));
      IF jsonb_array_length(v_grants)>64 THEN RAISE EXCEPTION 'Bridge context rejected' USING ERRCODE='42501'; END IF;
    END IF;
  END LOOP;
  v_now:=floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint;
  IF v_now<v_session.last_seen_at OR v_now>=v_session.idle_expires_at OR v_now>=v_session.absolute_expires_at THEN RAISE EXCEPTION 'Bridge context rejected' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(g.entry ORDER BY g.entry->>'grantId'),'[]'::jsonb) INTO v_grants
    FROM jsonb_array_elements(v_grants) AS g(entry)
    WHERE (g.entry->>'validFrom')::bigint<=v_now AND ((g.entry->>'validUntil') IS NULL OR v_now<(g.entry->>'validUntil')::bigint);
  RETURN QUERY SELECT m.membership_id,m.user_id,u.status,u.repository_revision,m.status,m.repository_revision,m.authorization_version,
    v_tenant.repository_revision,v_slot.security_epoch,v_session.absolute_expires_at,v_session.idle_expires_at,v_now,
    CASE WHEN m.membership_id=p_actor_membership_id THEN v_grants ELSE '[]'::jsonb END
    FROM zhiban_identity.memberships AS m JOIN zhiban_identity.users AS u ON u.user_id=m.user_id WHERE m.tenant_id=p_tenant_id AND m.membership_id=ANY(v_ids) ORDER BY m.membership_id;
END;
$$;
REVOKE ALL ON FUNCTION zhiban_identity.bridge_identity_context(uuid,text,uuid,uuid,uuid[]) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.bridge_identity_context(uuid,text,uuid,uuid,uuid[]) TO zhiban_bridge_runtime;

DO $$ DECLARE v_table text; BEGIN
  FOREACH v_table IN ARRAY ARRAY['resource_slots','resource_generations','scene_bindings','asset_bindings','operations','audit_events'] LOOP
    EXECUTE format('ALTER TABLE zhiban_bridge.%I ENABLE ROW LEVEL SECURITY',v_table);
    EXECUTE format('ALTER TABLE zhiban_bridge.%I FORCE ROW LEVEL SECURITY',v_table);
    EXECUTE format('CREATE POLICY bridge_read ON zhiban_bridge.%I FOR SELECT TO zhiban_bridge_runtime,zhiban_identity_owner USING(tenant_id=zhiban_identity.current_tenant_id())',v_table);
    EXECUTE format('CREATE POLICY bridge_insert ON zhiban_bridge.%I FOR INSERT TO zhiban_bridge_runtime,zhiban_identity_owner WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',v_table);
    EXECUTE format('CREATE POLICY bridge_update ON zhiban_bridge.%I FOR UPDATE TO zhiban_bridge_runtime,zhiban_identity_owner USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',v_table);
    EXECUTE format('CREATE TRIGGER bridge_resource_gate BEFORE INSERT OR UPDATE OR DELETE ON zhiban_bridge.%I FOR EACH ROW EXECUTE FUNCTION zhiban_bridge.resource_gate_guard()',v_table);
    EXECUTE format('CREATE CONSTRAINT TRIGGER bridge_consistency AFTER INSERT OR UPDATE ON zhiban_bridge.%I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_bridge.mapping_consistency()',v_table);
  END LOOP;
END; $$;
CREATE TRIGGER bridge_slot_history BEFORE INSERT OR UPDATE OR DELETE ON zhiban_bridge.resource_slots FOR EACH ROW EXECUTE FUNCTION zhiban_bridge.slot_cas_guard();
CREATE TRIGGER bridge_generation_history BEFORE INSERT OR UPDATE OR DELETE ON zhiban_bridge.resource_generations FOR EACH ROW EXECUTE FUNCTION zhiban_bridge.mapping_history_guard();
CREATE TRIGGER bridge_scene_history BEFORE UPDATE OR DELETE ON zhiban_bridge.scene_bindings FOR EACH ROW EXECUTE FUNCTION zhiban_bridge.mapping_history_guard();
CREATE TRIGGER bridge_asset_history BEFORE UPDATE OR DELETE ON zhiban_bridge.asset_bindings FOR EACH ROW EXECUTE FUNCTION zhiban_bridge.mapping_history_guard();
CREATE TRIGGER bridge_operation_history BEFORE INSERT OR UPDATE OR DELETE ON zhiban_bridge.operations FOR EACH ROW EXECUTE FUNCTION zhiban_bridge.operation_history_guard();
CREATE TRIGGER bridge_audit_history BEFORE UPDATE OR DELETE ON zhiban_bridge.audit_events FOR EACH ROW EXECUTE FUNCTION zhiban_bridge.audit_immutability_guard();
REVOKE ALL ON ALL TABLES IN SCHEMA zhiban_bridge FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime,zhiban_bridge_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA zhiban_bridge FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime,zhiban_bridge_runtime;
GRANT SELECT ON ALL TABLES IN SCHEMA zhiban_bridge TO zhiban_bridge_runtime;
GRANT INSERT ON zhiban_bridge.resource_slots,zhiban_bridge.resource_generations,zhiban_bridge.scene_bindings,zhiban_bridge.asset_bindings,zhiban_bridge.operations,zhiban_bridge.audit_events TO zhiban_bridge_runtime;
GRANT UPDATE(owner_membership_id,state,last_generation,active_generation_id,repository_revision,updated_at,retired_at) ON zhiban_bridge.resource_slots TO zhiban_bridge_runtime;
GRANT UPDATE(state,repository_revision,updated_at,activated_at,terminal_at) ON zhiban_bridge.resource_generations TO zhiban_bridge_runtime;
GRANT UPDATE(state,repository_revision,updated_at,dispatch_started_at,completed_at,reason,result_asset_ref,result_generation_id,result_slot_revision) ON zhiban_bridge.operations TO zhiban_bridge_runtime;
GRANT EXECUTE ON FUNCTION zhiban_bridge.business_resource_ready(uuid,uuid) TO zhiban_bridge_runtime;
