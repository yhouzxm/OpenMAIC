CREATE FUNCTION zhiban_identity.audit_uuid_json(value jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp
AS $$
  SELECT jsonb_typeof(value) = 'string'
    AND (value #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$$;

CREATE FUNCTION zhiban_identity.audit_instant_json(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp
AS $$
DECLARE number_value numeric;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'number' THEN RETURN FALSE; END IF;
  number_value := (value #>> '{}')::numeric;
  RETURN number_value = trunc(number_value) AND number_value BETWEEN 0 AND 8640000000000000;
EXCEPTION WHEN numeric_value_out_of_range OR invalid_text_representation THEN RETURN FALSE;
END;
$$;

CREATE FUNCTION zhiban_identity.audit_scope_json(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp
AS $$
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object'
     OR NOT (value ?& ARRAY['type','scopeId'])
     OR (value - 'type' - 'scopeId') <> '{}'::jsonb THEN RETURN FALSE; END IF;
  IF value->>'type' IN ('SELF','TENANT') THEN RETURN value->'scopeId' = 'null'::jsonb; END IF;
  IF value->>'type' IN ('CLASS','COURSE') THEN
    RETURN zhiban_identity.audit_uuid_json(value->'scopeId');
  END IF;
  RETURN FALSE;
END;
$$;

CREATE FUNCTION zhiban_identity.audit_grant_json(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp
AS $$
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object'
     OR NOT (value ?& ARRAY['id','roleCode','scope','validFrom','validUntil'])
     OR (value - 'id' - 'roleCode' - 'scope' - 'validFrom' - 'validUntil') <> '{}'::jsonb
     OR zhiban_identity.audit_uuid_json(value->'id') IS DISTINCT FROM TRUE
     OR jsonb_typeof(value->'roleCode') IS DISTINCT FROM 'string'
     OR value->>'roleCode' NOT IN ('STUDENT','TEACHER','TENANT_ADMIN')
     OR zhiban_identity.audit_scope_json(value->'scope') IS DISTINCT FROM TRUE
     OR zhiban_identity.audit_instant_json(value->'validFrom') IS DISTINCT FROM TRUE THEN
    RETURN FALSE;
  END IF;
  IF value->'validUntil' = 'null'::jsonb THEN RETURN TRUE; END IF;
  RETURN zhiban_identity.audit_instant_json(value->'validUntil') IS TRUE
    AND (value->>'validUntil')::numeric > (value->>'validFrom')::numeric;
END;
$$;

CREATE FUNCTION zhiban_identity.audit_id_array_json(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp
AS $$
DECLARE item jsonb; seen text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
  FOR item IN SELECT jsonb_array_elements(value) LOOP
    IF zhiban_identity.audit_uuid_json(item) IS DISTINCT FROM TRUE
       OR (item #>> '{}') = ANY(seen) THEN RETURN FALSE; END IF;
    seen := array_append(seen, item #>> '{}');
  END LOOP;
  RETURN TRUE;
END;
$$;

CREATE FUNCTION zhiban_identity.audit_grant_array_json(value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp
AS $$
DECLARE item jsonb; seen text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
  FOR item IN SELECT jsonb_array_elements(value) LOOP
    IF zhiban_identity.audit_grant_json(item) IS DISTINCT FROM TRUE
       OR item->>'id' = ANY(seen) THEN RETURN FALSE; END IF;
    seen := array_append(seen, item->>'id');
  END LOOP;
  RETURN TRUE;
END;
$$;

CREATE FUNCTION zhiban_identity.audit_payload_valid(event_type text, value jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp
AS $$
DECLARE item jsonb;
BEGIN
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' THEN RETURN FALSE; END IF;
  IF event_type IN (
    'USER_CREATED','USER_DISABLED','USER_RESTORED',
    'TENANT_CREATED','TENANT_DISABLED','TENANT_RESTORED',
    'MEMBERSHIP_DISABLED','MEMBERSHIP_LEFT','AUTHENTICATION_REJECTED'
  ) THEN RETURN value = '{}'::jsonb; END IF;

  IF event_type = 'MEMBERSHIP_REACTIVATED' THEN
    IF NOT (value ?& ARRAY['mode','priorGrantIds','approvedGrants'])
       OR (value - 'mode' - 'priorGrantIds' - 'approvedGrants') <> '{}'::jsonb
       OR value->>'mode' IS NULL
       OR value->>'mode' NOT IN ('PRESERVE_EXISTING_VALID_GRANTS','REPLACE_GRANTS') THEN
      RETURN FALSE;
    END IF;
    IF zhiban_identity.audit_id_array_json(value->'priorGrantIds') IS DISTINCT FROM TRUE
       OR zhiban_identity.audit_grant_array_json(value->'approvedGrants') IS DISTINCT FROM TRUE THEN
      RETURN FALSE;
    END IF;
    FOR item IN SELECT jsonb_array_elements(value->'approvedGrants') LOOP
      IF value->>'mode' = 'REPLACE_GRANTS'
         AND (value->'priorGrantIds') @> jsonb_build_array(item->'id') THEN RETURN FALSE; END IF;
      IF value->>'mode' = 'PRESERVE_EXISTING_VALID_GRANTS'
         AND NOT ((value->'priorGrantIds') @> jsonb_build_array(item->'id')) THEN RETURN FALSE; END IF;
    END LOOP;
    RETURN TRUE;
  END IF;

  IF event_type IN ('MEMBERSHIP_ACTIVATED','MEMBERSHIP_REJOINED','ROLE_GRANTS_REPLACED') THEN
    IF NOT (value ?& ARRAY['priorGrantIds','approvedGrants'])
       OR (value - 'priorGrantIds' - 'approvedGrants') <> '{}'::jsonb
       OR zhiban_identity.audit_id_array_json(value->'priorGrantIds') IS DISTINCT FROM TRUE
       OR zhiban_identity.audit_grant_array_json(value->'approvedGrants') IS DISTINCT FROM TRUE THEN
      RETURN FALSE;
    END IF;
    FOR item IN SELECT jsonb_array_elements(value->'approvedGrants') LOOP
      IF (value->'priorGrantIds') @> jsonb_build_array(item->'id') THEN RETURN FALSE; END IF;
    END LOOP;
    RETURN TRUE;
  END IF;

  IF event_type IN ('ROLE_GRANT_GRANTED','ROLE_GRANT_REVOKED') THEN
    RETURN value ? 'grant' AND (value - 'grant') = '{}'::jsonb
      AND zhiban_identity.audit_grant_json(value->'grant') IS TRUE;
  END IF;
  IF event_type IN ('SYSTEM_ADMIN_GRANT_GRANTED','SYSTEM_ADMIN_GRANT_REVOKED') THEN
    RETURN value ? 'grantId' AND (value - 'grantId') = '{}'::jsonb
      AND zhiban_identity.audit_uuid_json(value->'grantId') IS TRUE;
  END IF;
  IF event_type = 'SESSION_REVOKED' THEN
    RETURN value ? 'sessionId' AND (value - 'sessionId') = '{}'::jsonb
      AND jsonb_typeof(value->'sessionId') = 'string'
      AND btrim(value->>'sessionId') <> '';
  END IF;
  RETURN FALSE;
END;
$$;

CREATE FUNCTION zhiban_identity.current_tenant_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp
AS $$
  SELECT CASE
    WHEN current_setting('app.tenant_id', true) ~
      '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN current_setting('app.tenant_id', true)::uuid
    ELSE NULL::uuid
  END
$$;

CREATE TABLE zhiban_identity.audit_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_shape_version integer NOT NULL CHECK (event_shape_version = 1),
  event_type text NOT NULL CHECK (event_type IN (
    'USER_CREATED','USER_DISABLED','USER_RESTORED',
    'TENANT_CREATED','TENANT_DISABLED','TENANT_RESTORED',
    'MEMBERSHIP_DISABLED','MEMBERSHIP_LEFT','MEMBERSHIP_REACTIVATED',
    'MEMBERSHIP_ACTIVATED','MEMBERSHIP_REJOINED','ROLE_GRANTS_REPLACED',
    'ROLE_GRANT_GRANTED','ROLE_GRANT_REVOKED',
    'SYSTEM_ADMIN_GRANT_GRANTED','SYSTEM_ADMIN_GRANT_REVOKED',
    'SESSION_REVOKED','AUTHENTICATION_REJECTED'
  )),
  event_scope text NOT NULL CHECK (event_scope IN ('GLOBAL','TENANT')),
  occurred_at bigint NOT NULL CHECK (occurred_at BETWEEN 0 AND 8640000000000000),
  actor_type text NOT NULL CHECK (actor_type IN ('USER','SERVICE','SYSTEM')),
  actor_user_id uuid CHECK (actor_user_id IS NULL OR zhiban_identity.is_uuid_v7(actor_user_id)),
  actor_service_code text,
  request_id text CHECK (request_id IS NULL OR request_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  reason text NOT NULL CHECK (reason IN (
    'ADMIN_REQUEST','USER_REQUEST','ACCESS_REVIEW','SECURITY_POLICY',
    'INVITATION_EXPIRED','ACCOUNT_RECOVERY','CREDENTIAL_REJECTED','SYSTEM_MAINTENANCE'
  )),
  tenant_id uuid REFERENCES zhiban_identity.tenants(tenant_id) ON DELETE RESTRICT
    CHECK (tenant_id IS NULL OR zhiban_identity.is_uuid_v7(tenant_id)),
  subject_user_id uuid CHECK (subject_user_id IS NULL OR zhiban_identity.is_uuid_v7(subject_user_id)),
  subject_membership_id uuid CHECK (subject_membership_id IS NULL OR zhiban_identity.is_uuid_v7(subject_membership_id)),
  authorization_version_before bigint,
  authorization_version_after bigint,
  event_payload jsonb NOT NULL,
  CONSTRAINT audit_actor_shape CHECK ((
    (actor_type = 'USER' AND actor_user_id IS NOT NULL AND actor_service_code IS NULL)
    OR (actor_type = 'SERVICE' AND actor_user_id IS NULL AND actor_service_code IS NOT NULL
        AND actor_service_code ~ '^[a-z][a-z0-9_-]{0,63}$')
    OR (actor_type = 'SYSTEM' AND actor_user_id IS NULL AND actor_service_code IS NULL)
  ) IS TRUE),
  CONSTRAINT audit_ownership_shape CHECK ((
    (event_type IN ('MEMBERSHIP_DISABLED','MEMBERSHIP_LEFT','MEMBERSHIP_REACTIVATED',
       'MEMBERSHIP_ACTIVATED','MEMBERSHIP_REJOINED','ROLE_GRANTS_REPLACED',
       'ROLE_GRANT_GRANTED','ROLE_GRANT_REVOKED')
       AND event_scope = 'TENANT' AND tenant_id IS NOT NULL
       AND subject_user_id IS NOT NULL AND subject_membership_id IS NOT NULL
       AND authorization_version_before BETWEEN 0 AND 9007199254740991
       AND authorization_version_after BETWEEN 0 AND 9007199254740991
       AND authorization_version_after > authorization_version_before)
    OR (event_type NOT IN ('MEMBERSHIP_DISABLED','MEMBERSHIP_LEFT','MEMBERSHIP_REACTIVATED',
       'MEMBERSHIP_ACTIVATED','MEMBERSHIP_REJOINED','ROLE_GRANTS_REPLACED',
       'ROLE_GRANT_GRANTED','ROLE_GRANT_REVOKED')
       AND event_scope = 'GLOBAL' AND subject_membership_id IS NULL
       AND authorization_version_before IS NULL AND authorization_version_after IS NULL
       AND ((event_type IN ('TENANT_CREATED','TENANT_DISABLED','TENANT_RESTORED')
             AND tenant_id IS NOT NULL AND subject_user_id IS NULL)
         OR (event_type IN ('USER_CREATED','USER_DISABLED','USER_RESTORED',
             'SYSTEM_ADMIN_GRANT_GRANTED','SYSTEM_ADMIN_GRANT_REVOKED','SESSION_REVOKED')
             AND tenant_id IS NULL AND subject_user_id IS NOT NULL)
         OR (event_type = 'AUTHENTICATION_REJECTED'
             AND tenant_id IS NULL AND subject_user_id IS NULL)))
  ) IS TRUE),
  CONSTRAINT audit_closed_payload CHECK (zhiban_identity.audit_payload_valid(event_type, event_payload) IS TRUE)
);
CREATE INDEX audit_tenant_time_idx ON zhiban_identity.audit_events(tenant_id, occurred_at, event_id)
  WHERE event_scope = 'TENANT';

ALTER TABLE zhiban_identity.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhiban_identity.memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY memberships_select ON zhiban_identity.memberships FOR SELECT TO zhiban_runtime
  USING (tenant_id = zhiban_identity.current_tenant_id());
CREATE POLICY memberships_insert ON zhiban_identity.memberships FOR INSERT TO zhiban_runtime
  WITH CHECK (tenant_id = zhiban_identity.current_tenant_id());
CREATE POLICY memberships_update ON zhiban_identity.memberships FOR UPDATE TO zhiban_runtime
  USING (tenant_id = zhiban_identity.current_tenant_id())
  WITH CHECK (tenant_id = zhiban_identity.current_tenant_id());

ALTER TABLE zhiban_identity.role_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhiban_identity.role_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY role_grants_select ON zhiban_identity.role_grants FOR SELECT TO zhiban_runtime
  USING (tenant_id = zhiban_identity.current_tenant_id());
CREATE POLICY role_grants_insert ON zhiban_identity.role_grants FOR INSERT TO zhiban_runtime
  WITH CHECK (tenant_id = zhiban_identity.current_tenant_id());
CREATE POLICY role_grants_update ON zhiban_identity.role_grants FOR UPDATE TO zhiban_runtime
  USING (tenant_id = zhiban_identity.current_tenant_id())
  WITH CHECK (tenant_id = zhiban_identity.current_tenant_id());

ALTER TABLE zhiban_identity.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhiban_identity.audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_tenant_insert ON zhiban_identity.audit_events FOR INSERT TO zhiban_runtime
  WITH CHECK (event_scope = 'TENANT' AND tenant_id = zhiban_identity.current_tenant_id()
    AND event_type IN ('MEMBERSHIP_DISABLED','MEMBERSHIP_LEFT','MEMBERSHIP_REACTIVATED',
      'MEMBERSHIP_ACTIVATED','MEMBERSHIP_REJOINED','ROLE_GRANTS_REPLACED',
      'ROLE_GRANT_GRANTED','ROLE_GRANT_REVOKED'));
CREATE POLICY audit_auth_insert ON zhiban_identity.audit_events FOR INSERT TO zhiban_auth_runtime
  WITH CHECK (event_scope = 'GLOBAL'
    AND event_type IN ('AUTHENTICATION_REJECTED','SESSION_REVOKED'));
CREATE POLICY audit_control_insert ON zhiban_identity.audit_events FOR INSERT TO zhiban_control_runtime
  WITH CHECK (event_scope = 'GLOBAL'
    AND event_type IN ('USER_CREATED','USER_DISABLED','USER_RESTORED',
      'TENANT_CREATED','TENANT_DISABLED','TENANT_RESTORED',
      'SYSTEM_ADMIN_GRANT_GRANTED','SYSTEM_ADMIN_GRANT_REVOKED','SESSION_REVOKED'));

-- Normalize only Identity-owned objects before exact role-specific grants;
-- existing cluster roles may carry older explicit/default Identity ACLs.
REVOKE ALL ON ALL TABLES IN SCHEMA zhiban_identity FROM PUBLIC, zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA zhiban_identity FROM PUBLIC, zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA zhiban_identity FROM PUBLIC, zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.current_tenant_id() TO zhiban_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.audit_uuid_json(jsonb),
  zhiban_identity.audit_instant_json(jsonb),
  zhiban_identity.audit_scope_json(jsonb),
  zhiban_identity.audit_grant_json(jsonb),
  zhiban_identity.audit_id_array_json(jsonb),
  zhiban_identity.audit_grant_array_json(jsonb),
  zhiban_identity.audit_payload_valid(text, jsonb)
  TO zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.is_uuid_v7(uuid)
  TO zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime;

GRANT SELECT, INSERT ON zhiban_identity.memberships, zhiban_identity.role_grants TO zhiban_runtime;
GRANT UPDATE (status, authorization_version, repository_revision, updated_at, disabled_at, disabled_reason)
  ON zhiban_identity.memberships TO zhiban_runtime;
GRANT UPDATE (revoked_at) ON zhiban_identity.role_grants TO zhiban_runtime;

GRANT SELECT ON zhiban_identity.users TO zhiban_auth_runtime, zhiban_control_runtime;
GRANT INSERT ON zhiban_identity.users TO zhiban_control_runtime;
GRANT UPDATE (status, updated_at, disabled_at, disabled_reason, repository_revision)
  ON zhiban_identity.users TO zhiban_control_runtime;
GRANT SELECT, INSERT ON zhiban_identity.tenants TO zhiban_control_runtime;
GRANT UPDATE (status, updated_at, disabled_at, disabled_reason, repository_revision)
  ON zhiban_identity.tenants TO zhiban_control_runtime;
GRANT SELECT, INSERT ON zhiban_identity.system_admin_grants TO zhiban_control_runtime;
GRANT UPDATE (revoked_at, repository_revision)
  ON zhiban_identity.system_admin_grants TO zhiban_control_runtime;

GRANT SELECT, INSERT ON zhiban_identity.sessions TO zhiban_auth_runtime;
GRANT UPDATE (last_seen_at, idle_expires_at, revoked_at, repository_revision)
  ON zhiban_identity.sessions TO zhiban_auth_runtime;
GRANT SELECT (session_id, user_id, revoked_at, repository_revision)
  ON zhiban_identity.sessions TO zhiban_control_runtime;
GRANT UPDATE (revoked_at, repository_revision)
  ON zhiban_identity.sessions TO zhiban_control_runtime;

GRANT INSERT (event_shape_version, event_type, event_scope, occurred_at, actor_type,
  actor_user_id, actor_service_code, request_id, reason, tenant_id,
  subject_user_id, subject_membership_id, authorization_version_before,
  authorization_version_after, event_payload)
  ON zhiban_identity.audit_events TO zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime;
GRANT USAGE ON SEQUENCE zhiban_identity.audit_events_event_id_seq
  TO zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime;
