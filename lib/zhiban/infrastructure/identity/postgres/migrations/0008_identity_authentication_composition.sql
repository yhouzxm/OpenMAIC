-- B8-S01--S06 only. No changes to applied migrations or runtime role graph.
CREATE TABLE zhiban_identity.admission_policies (
  purpose text COLLATE "C" PRIMARY KEY CHECK (purpose IN ('LOGIN','REAUTHENTICATE','PASSWORD_CHANGE','INITIAL_PROVISION')),
  policy_digest text NOT NULL UNIQUE CHECK (octet_length(policy_digest)=64 AND policy_digest ~ '^[0-9a-f]{64}$'),
  approval_ref text COLLATE "C" NOT NULL CHECK (approval_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  environment_ref text COLLATE "C" NOT NULL CHECK (environment_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
  window_ms bigint NOT NULL CHECK (window_ms BETWEEN 1 AND 3600000),
  global_limit bigint NOT NULL CHECK (global_limit BETWEEN 1 AND 1000000),
  ip_limit bigint CHECK (ip_limit BETWEEN 1 AND 1000000),
  locator_limit bigint CHECK (locator_limit BETWEEN 1 AND 1000000),
  pair_limit bigint CHECK (pair_limit BETWEEN 1 AND 1000000),
  user_limit bigint CHECK (user_limit BETWEEN 1 AND 1000000),
  max_buckets bigint NOT NULL CHECK (max_buckets BETWEEN 1 AND 1000000),
  CHECK ((CASE purpose
    WHEN 'LOGIN' THEN ip_limit IS NOT NULL AND locator_limit IS NOT NULL AND pair_limit IS NOT NULL AND user_limit IS NULL
    WHEN 'INITIAL_PROVISION' THEN user_limit IS NOT NULL AND ip_limit IS NULL AND locator_limit IS NULL AND pair_limit IS NULL
    ELSE ip_limit IS NOT NULL AND locator_limit IS NOT NULL AND pair_limit IS NOT NULL AND user_limit IS NOT NULL END) IS TRUE)
);
CREATE TABLE zhiban_identity.admission_gate (
  purpose text PRIMARY KEY REFERENCES zhiban_identity.admission_policies(purpose) ON DELETE RESTRICT,
  bucket_count bigint NOT NULL DEFAULT 0 CHECK (bucket_count BETWEEN 0 AND 1000000),
  repository_revision bigint NOT NULL DEFAULT 1 CHECK (repository_revision > 0)
);
CREATE TABLE zhiban_identity.admission_buckets (
  purpose text NOT NULL REFERENCES zhiban_identity.admission_gate(purpose) ON DELETE RESTRICT,
  dimension text NOT NULL CHECK (dimension IN ('GLOBAL','IP','LOCATOR','IP_LOCATOR','USER')),
  key_hmac text NOT NULL CHECK (octet_length(key_hmac)=64 AND key_hmac ~ '^[0-9a-f]{64}$'),
  window_start bigint NOT NULL CHECK (window_start BETWEEN 0 AND 8640000000000000),
  expires_at bigint NOT NULL CHECK (expires_at > window_start AND expires_at <= 8640000000000000),
  used_count bigint NOT NULL CHECK (used_count BETWEEN 1 AND 1000000),
  PRIMARY KEY (purpose,dimension,key_hmac,window_start)
);
CREATE INDEX admission_buckets_expiry_idx ON zhiban_identity.admission_buckets(purpose,expires_at,dimension,key_hmac,window_start);

CREATE TABLE zhiban_identity.identity_credential_provisions (
  approval_id uuid PRIMARY KEY CHECK (zhiban_identity.is_uuid_v7(approval_id)),
  command_id uuid NOT NULL UNIQUE CHECK (zhiban_identity.is_uuid_v7(command_id)),
  user_id uuid NOT NULL UNIQUE CHECK (zhiban_identity.is_uuid_v7(user_id)) REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT,
  expected_user_revision bigint NOT NULL CHECK (expected_user_revision>0),
  purpose text NOT NULL CHECK (purpose='FIRST_PASSWORD'),
  environment_ref text COLLATE "C" NOT NULL CHECK (environment_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  approval_ref text COLLATE "C" NOT NULL CHECK (approval_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  operator_ref text COLLATE "C" NOT NULL CHECK (operator_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  approver_ref text COLLATE "C" NOT NULL CHECK (approver_ref ~ '^[A-Za-z0-9._:-]{1,128}$' AND approver_ref<>operator_ref),
  request_id text COLLATE "C" NOT NULL CHECK (request_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  manifest_digest text NOT NULL CHECK (octet_length(manifest_digest)=64 AND manifest_digest ~ '^[0-9a-f]{64}$'),
  issued_at bigint NOT NULL CHECK (issued_at BETWEEN 0 AND 8640000000000000),
  expires_at bigint NOT NULL CHECK (expires_at > issued_at AND expires_at-issued_at<=86400000 AND expires_at<=8640000000000000),
  consumed_at bigint,
  credential_id uuid UNIQUE CHECK (credential_id IS NULL OR zhiban_identity.is_uuid_v7(credential_id)),
  credential_event_id bigint UNIQUE REFERENCES zhiban_identity.audit_events(event_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (user_id,credential_id) REFERENCES zhiban_identity.credentials(user_id,credential_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK (((consumed_at IS NULL AND credential_id IS NULL AND credential_event_id IS NULL)
    OR (consumed_at IS NOT NULL AND credential_id IS NOT NULL AND credential_event_id IS NOT NULL
      AND issued_at<=consumed_at AND consumed_at<expires_at)) IS TRUE)
);
CREATE TABLE zhiban_identity.identity_platform_bootstrap (
  singleton_key text PRIMARY KEY CHECK (singleton_key='PLATFORM'),
  repository_revision bigint NOT NULL CHECK (repository_revision>0),
  approval_id uuid UNIQUE CHECK (approval_id IS NULL OR zhiban_identity.is_uuid_v7(approval_id)),
  command_id uuid UNIQUE CHECK (command_id IS NULL OR zhiban_identity.is_uuid_v7(command_id)),
  environment_ref text COLLATE "C" CHECK (environment_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  approval_ref text COLLATE "C" CHECK (approval_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  operator_ref text COLLATE "C" CHECK (operator_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  approver_ref text COLLATE "C" CHECK (approver_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  request_id text COLLATE "C" CHECK (request_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
  manifest_digest text CHECK (octet_length(manifest_digest)=64 AND manifest_digest ~ '^[0-9a-f]{64}$'),
  target_user_id uuid CHECK (target_user_id IS NULL OR zhiban_identity.is_uuid_v7(target_user_id)) REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT,
  user_revision bigint CHECK (user_revision>0),
  system_admin_grant_id uuid UNIQUE CHECK (system_admin_grant_id IS NULL OR zhiban_identity.is_uuid_v7(system_admin_grant_id)) REFERENCES zhiban_identity.system_admin_grants(grant_id) ON DELETE RESTRICT,
  issued_at bigint, expires_at bigint, completed_at bigint,
  created_user boolean,
  user_created_event_id bigint UNIQUE REFERENCES zhiban_identity.audit_events(event_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  grant_created_event_id bigint UNIQUE REFERENCES zhiban_identity.audit_events(event_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  credential_provision_id uuid UNIQUE CHECK (credential_provision_id IS NULL OR zhiban_identity.is_uuid_v7(credential_provision_id)) REFERENCES zhiban_identity.identity_credential_provisions(approval_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  CHECK ((
    (repository_revision=1 AND approval_id IS NULL AND command_id IS NULL AND environment_ref IS NULL AND approval_ref IS NULL
      AND operator_ref IS NULL AND approver_ref IS NULL AND request_id IS NULL AND manifest_digest IS NULL AND target_user_id IS NULL
      AND user_revision IS NULL AND system_admin_grant_id IS NULL AND issued_at IS NULL AND expires_at IS NULL AND completed_at IS NULL
      AND created_user IS NULL AND user_created_event_id IS NULL AND grant_created_event_id IS NULL AND credential_provision_id IS NULL)
    OR (repository_revision=2 AND approval_id IS NOT NULL AND command_id IS NOT NULL AND environment_ref IS NOT NULL AND approval_ref IS NOT NULL
      AND operator_ref IS NOT NULL AND approver_ref IS NOT NULL AND operator_ref<>approver_ref AND request_id IS NOT NULL AND manifest_digest IS NOT NULL
      AND target_user_id IS NOT NULL AND user_revision IS NOT NULL AND system_admin_grant_id IS NOT NULL
      AND issued_at BETWEEN 0 AND 8640000000000000 AND expires_at<=8640000000000000
      AND expires_at>issued_at AND expires_at-issued_at<=86400000 AND issued_at<=completed_at AND completed_at<expires_at
      AND created_user IS NOT NULL AND (user_created_event_id IS NOT NULL)=created_user
      AND grant_created_event_id IS NOT NULL AND credential_provision_id IS NOT NULL)) IS TRUE)
);
-- Seed precedes consistency triggers: no migrator business-identity exception.
INSERT INTO zhiban_identity.identity_platform_bootstrap(singleton_key,repository_revision) VALUES('PLATFORM',1);

CREATE FUNCTION zhiban_identity.identity_admission_policy_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,zhiban_identity,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Immutable admission policy' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER identity_admission_policy_immutable BEFORE UPDATE OR DELETE ON zhiban_identity.admission_policies
  FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_admission_policy_immutable();
CREATE FUNCTION zhiban_identity.identity_bootstrap_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,zhiban_identity,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.repository_revision<>1 OR NEW.repository_revision<>2 OR NEW.approval_id IS NULL THEN
    RAISE EXCEPTION 'Bootstrap transition rejected' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER identity_bootstrap_guard BEFORE UPDATE OR DELETE ON zhiban_identity.identity_platform_bootstrap
  FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_bootstrap_guard();
CREATE FUNCTION zhiban_identity.identity_provision_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,zhiban_identity,pg_temp AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Provision transition rejected' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.consumed_at IS NOT NULL OR NEW.credential_id IS NOT NULL OR NEW.credential_event_id IS NOT NULL THEN
      RAISE EXCEPTION 'Provision transition rejected' USING ERRCODE='23514';
    END IF;
  ELSE
    IF OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL
      OR (to_jsonb(NEW)-'consumed_at'-'credential_id'-'credential_event_id')
        IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at'-'credential_id'-'credential_event_id') THEN
      RAISE EXCEPTION 'Provision transition rejected' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER identity_provision_guard BEFORE INSERT OR UPDATE OR DELETE ON zhiban_identity.identity_credential_provisions
  FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_provision_guard();

CREATE FUNCTION zhiban_identity.identity_auth_user_anchor(p_user_id uuid)
RETURNS TABLE(user_id uuid,user_status text,user_revision bigint)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE v_user zhiban_identity.users%ROWTYPE;
BEGIN
  IF session_user<>'zhiban_auth_runtime' OR zhiban_identity.is_uuid_v7(p_user_id) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Authentication rejected' USING ERRCODE='42501';
  END IF;
  SELECT u.* INTO v_user FROM zhiban_identity.users AS u WHERE u.user_id=p_user_id FOR SHARE;
  IF (v_user.user_id=p_user_id AND v_user.status='ACTIVE' AND v_user.repository_revision>0
    AND v_user.disabled_at IS NULL AND v_user.disabled_reason IS NULL
    AND v_user.created_at>=0 AND v_user.updated_at>=v_user.created_at AND v_user.updated_at<=8640000000000000) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Authentication rejected' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT v_user.user_id,v_user.status,v_user.repository_revision;
END;
$$;
CREATE FUNCTION zhiban_identity.identity_platform_bootstrap_lock()
RETURNS void LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
BEGIN
  IF session_user<>'zhiban_control_runtime' THEN RAISE EXCEPTION 'Bootstrap rejected' USING ERRCODE='42501'; END IF;
  LOCK TABLE zhiban_identity.system_admin_grants IN SHARE ROW EXCLUSIVE MODE;
END;
$$;

CREATE POLICY memberships_identity_discovery_owner_read ON zhiban_identity.memberships
  FOR SELECT TO zhiban_identity_owner USING (user_id=CASE
    WHEN octet_length(current_setting('app.identity_discovery_user',true))=36
      AND current_setting('app.identity_discovery_user',true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    THEN current_setting('app.identity_discovery_user',true)::uuid ELSE NULL::uuid END);
CREATE INDEX memberships_identity_discovery_idx ON zhiban_identity.memberships(user_id,membership_id);
CREATE FUNCTION zhiban_identity.identity_session_guard(p_digest text,p_expected_user_id uuid)
RETURNS TABLE(user_id uuid,user_revision bigint,security_epoch bigint,absolute_expires_at bigint,idle_expires_at bigint)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE v_session zhiban_identity.sessions%ROWTYPE; v_user zhiban_identity.users%ROWTYPE;
  v_slot zhiban_identity.credential_slots%ROWTYPE; v_now bigint;
BEGIN
  IF session_user NOT IN ('zhiban_runtime','zhiban_control_runtime') OR p_digest IS NULL
    OR octet_length(p_digest)<>64 OR p_digest !~ '^[0-9a-f]{64}$'
    OR zhiban_identity.is_uuid_v7(p_expected_user_id) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Authentication rejected' USING ERRCODE='42501';
  END IF;
  SELECT s.* INTO v_session FROM zhiban_identity.sessions AS s WHERE s.token_digest=p_digest;
  IF v_session.user_id IS DISTINCT FROM p_expected_user_id THEN RAISE EXCEPTION 'Authentication rejected' USING ERRCODE='42501'; END IF;
  SELECT u.* INTO v_user FROM zhiban_identity.users AS u WHERE u.user_id=p_expected_user_id FOR SHARE;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('zhiban-session-user:' || v_session.user_id::text,0));
  SELECT c.* INTO v_slot FROM zhiban_identity.credential_slots AS c WHERE c.user_id=v_session.user_id FOR SHARE;
  SELECT s.* INTO v_session FROM zhiban_identity.sessions AS s WHERE s.token_digest=p_digest FOR SHARE;
  v_now:=floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint;
  IF (v_user.user_id IS NOT NULL AND v_user.status='ACTIVE' AND v_user.repository_revision>0
    AND v_user.created_at>=0 AND v_user.updated_at>=v_user.created_at AND v_user.updated_at<=8640000000000000
    AND v_user.disabled_at IS NULL AND v_user.disabled_reason IS NULL
    AND v_session.user_id=v_user.user_id AND v_session.user_revision=v_user.repository_revision
    AND v_session.security_epoch=v_slot.security_epoch AND v_session.revoked_at IS NULL
    AND v_session.repository_revision>0 AND v_session.security_epoch>0 AND v_slot.repository_revision>0
    AND v_slot.generation>0 AND v_slot.credential_type='PASSWORD' AND v_slot.active_credential_id IS NOT NULL
    AND v_slot.created_at>=0 AND v_slot.updated_at>=v_slot.created_at AND v_slot.updated_at<=8640000000000000
    AND v_session.session_id ~ '^ses_[A-Za-z0-9_-]{43}$' AND octet_length(v_session.session_id)=47
    AND v_session.token_digest=p_digest AND v_session.created_at>=0
    AND v_session.created_at<=v_session.last_seen_at AND v_now>=v_session.last_seen_at
    AND v_now<v_session.idle_expires_at AND v_session.idle_expires_at<=v_session.absolute_expires_at
    AND v_session.absolute_expires_at<=8640000000000000 AND v_now BETWEEN 0 AND 8640000000000000
    AND EXISTS (SELECT 1 FROM zhiban_identity.credentials AS c
      WHERE c.user_id=v_user.user_id AND c.credential_id=v_slot.active_credential_id AND c.status='ACTIVE'
        AND c.credential_type='PASSWORD' AND c.generation=v_slot.generation AND c.slot_revision=v_slot.repository_revision
        AND c.created_at>=v_slot.created_at AND c.updated_at>=c.created_at AND c.updated_at<=v_slot.updated_at
        AND c.replaced_at IS NULL AND c.revoked_at IS NULL AND c.replaced_by_credential_id IS NULL)) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Authentication rejected' USING ERRCODE='42501';
  END IF;
  IF v_user.user_id<>p_expected_user_id THEN RAISE EXCEPTION 'Authentication rejected' USING ERRCODE='42501'; END IF;
  RETURN QUERY SELECT v_user.user_id,v_user.repository_revision,v_slot.security_epoch,
    v_session.absolute_expires_at,v_session.idle_expires_at;
END;
$$;

CREATE FUNCTION zhiban_identity.identity_session_spaces(p_digest text,p_after_membership_id uuid,p_limit integer)
RETURNS TABLE(tenant_id uuid,tenant_code text,tenant_display_name text,membership_id uuid)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE v_session zhiban_identity.sessions%ROWTYPE; v_user zhiban_identity.users%ROWTYPE;
  v_slot zhiban_identity.credential_slots%ROWTYPE; v_now bigint; v_count integer; v_prior text;
BEGIN
  IF session_user<>'zhiban_auth_runtime' OR p_digest IS NULL OR octet_length(p_digest)<>64 OR p_digest !~ '^[0-9a-f]{64}$'
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50
    OR (p_after_membership_id IS NOT NULL AND zhiban_identity.is_uuid_v7(p_after_membership_id) IS DISTINCT FROM TRUE) THEN
    RAISE EXCEPTION 'Authentication rejected' USING ERRCODE='42501';
  END IF;
  SELECT s.* INTO v_session FROM zhiban_identity.sessions AS s WHERE s.token_digest=p_digest;
  IF v_session.user_id IS NULL THEN RAISE EXCEPTION 'Authentication rejected' USING ERRCODE='42501'; END IF;
  SELECT u.* INTO v_user FROM zhiban_identity.users AS u WHERE u.user_id=v_session.user_id FOR SHARE;
  PERFORM pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('zhiban-session-user:' || v_session.user_id::text,0));
  SELECT c.* INTO v_slot FROM zhiban_identity.credential_slots AS c WHERE c.user_id=v_session.user_id FOR SHARE;
  SELECT s.* INTO v_session FROM zhiban_identity.sessions AS s WHERE s.token_digest=p_digest FOR SHARE;
  v_now:=floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint;
  IF (v_user.user_id IS NOT NULL AND v_user.status='ACTIVE' AND v_user.repository_revision>0
    AND v_user.created_at>=0 AND v_user.updated_at>=v_user.created_at AND v_user.updated_at<=8640000000000000
    AND v_user.disabled_at IS NULL AND v_user.disabled_reason IS NULL
    AND v_session.user_id=v_user.user_id AND v_session.user_revision=v_user.repository_revision
    AND v_session.security_epoch=v_slot.security_epoch AND v_session.revoked_at IS NULL
    AND v_session.repository_revision>0 AND v_session.security_epoch>0 AND v_slot.repository_revision>0
    AND v_slot.generation>0 AND v_slot.credential_type='PASSWORD' AND v_slot.active_credential_id IS NOT NULL
    AND v_slot.created_at>=0 AND v_slot.updated_at>=v_slot.created_at AND v_slot.updated_at<=8640000000000000
    AND v_session.session_id ~ '^ses_[A-Za-z0-9_-]{43}$' AND octet_length(v_session.session_id)=47
    AND v_session.token_digest=p_digest AND v_session.created_at>=0
    AND v_session.created_at<=v_session.last_seen_at AND v_now>=v_session.last_seen_at
    AND v_now<v_session.idle_expires_at AND v_session.idle_expires_at<=v_session.absolute_expires_at
    AND v_session.absolute_expires_at<=8640000000000000 AND v_now BETWEEN 0 AND 8640000000000000
    AND EXISTS (SELECT 1 FROM zhiban_identity.credentials AS c
      WHERE c.user_id=v_user.user_id AND c.credential_id=v_slot.active_credential_id AND c.status='ACTIVE'
        AND c.credential_type='PASSWORD' AND c.generation=v_slot.generation AND c.slot_revision=v_slot.repository_revision
        AND c.created_at>=v_slot.created_at AND c.updated_at>=c.created_at AND c.updated_at<=v_slot.updated_at
        AND c.replaced_at IS NULL AND c.revoked_at IS NULL AND c.replaced_by_credential_id IS NULL)) IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Authentication rejected' USING ERRCODE='42501';
  END IF;
  v_prior:=current_setting('app.identity_discovery_user',true);
  BEGIN
    PERFORM pg_catalog.set_config('app.identity_discovery_user',v_user.user_id::text,true);
    SELECT count(*)::integer INTO v_count FROM (
      SELECT m.membership_id FROM zhiban_identity.memberships AS m
      WHERE m.user_id=v_user.user_id ORDER BY m.membership_id LIMIT 1001) AS bounded;
    IF v_count>1000 THEN RAISE EXCEPTION 'Discovery capacity rejected' USING ERRCODE='42501'; END IF;
    RETURN QUERY SELECT t.tenant_id,t.code,t.display_name,m.membership_id
      FROM zhiban_identity.memberships AS m JOIN zhiban_identity.tenants AS t ON t.tenant_id=m.tenant_id
      WHERE m.user_id=v_user.user_id AND m.status='ACTIVE' AND t.status='ACTIVE'
        AND (p_after_membership_id IS NULL OR m.membership_id>p_after_membership_id)
      ORDER BY m.membership_id LIMIT p_limit;
    v_now:=floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint;
    IF v_now<v_session.last_seen_at OR v_now>=v_session.idle_expires_at OR v_now>=v_session.absolute_expires_at THEN
      RAISE EXCEPTION 'Authentication rejected' USING ERRCODE='42501';
    END IF;
    PERFORM pg_catalog.set_config('app.identity_discovery_user',coalesce(v_prior,''),true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_catalog.set_config('app.identity_discovery_user',coalesce(v_prior,''),true);
    RAISE;
  END;
END;
$$;
CREATE FUNCTION zhiban_identity.identity_admission_reserve(p_purpose text,p_policy_digest text,p_keys text[])
RETURNS boolean LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE v_policy zhiban_identity.admission_policies%ROWTYPE; v_gate zhiban_identity.admission_gate%ROWTYPE;
  v_dims text[]; v_limits bigint[]; v_new bigint:=0; v_count bigint;
  v_now bigint; v_start bigint; v_end bigint; v_i integer;
BEGIN
  IF session_user<>'zhiban_auth_runtime' OR p_purpose IS NULL OR p_policy_digest IS NULL
    OR octet_length(p_policy_digest)<>64 OR p_policy_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Admission rejected' USING ERRCODE='42501';
  END IF;
  SELECT g.* INTO v_gate FROM zhiban_identity.admission_gate AS g WHERE g.purpose=p_purpose FOR UPDATE;
  SELECT p.* INTO v_policy FROM zhiban_identity.admission_policies AS p WHERE p.purpose=p_purpose;
  IF v_gate.purpose IS NULL OR v_policy.policy_digest IS DISTINCT FROM p_policy_digest THEN
    RAISE EXCEPTION 'Admission rejected' USING ERRCODE='42501';
  END IF;
  IF p_purpose='INITIAL_PROVISION' THEN v_dims:=ARRAY['GLOBAL','USER']; v_limits:=ARRAY[v_policy.global_limit,v_policy.user_limit];
  ELSE
    v_dims:=ARRAY['GLOBAL','IP','LOCATOR','IP_LOCATOR'];
    v_limits:=ARRAY[v_policy.global_limit,v_policy.ip_limit,v_policy.locator_limit,v_policy.pair_limit];
    IF p_purpose<>'LOGIN' THEN v_dims:=v_dims||ARRAY['USER']; v_limits:=v_limits||ARRAY[v_policy.user_limit]; END IF;
  END IF;
  IF p_keys IS NULL OR array_ndims(p_keys) IS DISTINCT FROM 1 OR array_lower(p_keys,1) IS DISTINCT FROM 1
    OR cardinality(p_keys)<>cardinality(v_dims) OR EXISTS (SELECT 1 FROM unnest(p_keys) AS k(value)
      WHERE k.value IS NULL OR octet_length(k.value)<>64 OR k.value !~ '^[0-9a-f]{64}$') THEN
    RAISE EXCEPTION 'Admission rejected' USING ERRCODE='42501';
  END IF;
  v_now:=floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint;
  IF v_now NOT BETWEEN 0 AND 8640000000000000 THEN RAISE EXCEPTION 'Admission rejected' USING ERRCODE='42501'; END IF;
  v_start:=(v_now/v_policy.window_ms)*v_policy.window_ms; v_end:=v_start+v_policy.window_ms;
  IF v_end>8640000000000000 OR v_gate.repository_revision=9223372036854775807 THEN RETURN FALSE; END IF;
  FOR v_i IN 1..cardinality(v_dims) LOOP
    SELECT b.used_count INTO v_count FROM zhiban_identity.admission_buckets AS b
      WHERE b.purpose=p_purpose AND b.dimension=v_dims[v_i] AND b.key_hmac=p_keys[v_i] AND b.window_start=v_start;
    IF v_count IS NULL THEN v_new:=v_new+1; v_count:=0; END IF;
    IF v_count>=v_limits[v_i] THEN RETURN FALSE; END IF;
  END LOOP;
  IF v_gate.bucket_count+v_new>v_policy.max_buckets THEN RETURN FALSE; END IF;
  FOR v_i IN 1..cardinality(v_dims) LOOP
    INSERT INTO zhiban_identity.admission_buckets(purpose,dimension,key_hmac,window_start,expires_at,used_count)
      VALUES(p_purpose,v_dims[v_i],p_keys[v_i],v_start,v_end,1)
      ON CONFLICT(purpose,dimension,key_hmac,window_start) DO UPDATE SET used_count=zhiban_identity.admission_buckets.used_count+1;
  END LOOP;
  UPDATE zhiban_identity.admission_gate SET bucket_count=bucket_count+v_new,repository_revision=repository_revision+1 WHERE purpose=p_purpose;
  RETURN TRUE;
END;
$$;
CREATE FUNCTION zhiban_identity.identity_admission_prune(p_purpose text,p_policy_digest text,p_limit integer)
RETURNS integer LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE v_gate zhiban_identity.admission_gate%ROWTYPE; v_policy zhiban_identity.admission_policies%ROWTYPE;
  v_now bigint; v_deleted integer;
BEGIN
  IF session_user<>'zhiban_auth_runtime' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500
    OR p_purpose IS NULL OR p_policy_digest IS NULL OR octet_length(p_policy_digest)<>64 OR p_policy_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Admission rejected' USING ERRCODE='42501';
  END IF;
  SELECT g.* INTO v_gate FROM zhiban_identity.admission_gate AS g WHERE g.purpose=p_purpose FOR UPDATE;
  SELECT p.* INTO v_policy FROM zhiban_identity.admission_policies AS p WHERE p.purpose=p_purpose;
  IF v_gate.purpose IS NULL OR v_policy.policy_digest IS DISTINCT FROM p_policy_digest THEN
    RAISE EXCEPTION 'Admission rejected' USING ERRCODE='42501';
  END IF;
  v_now:=floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint;
  IF v_now NOT BETWEEN 0 AND 8640000000000000 THEN RAISE EXCEPTION 'Admission rejected' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM zhiban_identity.admission_buckets WHERE purpose=p_purpose AND expires_at<=v_now) THEN RETURN 0; END IF;
  IF v_gate.repository_revision=9223372036854775807 THEN RAISE EXCEPTION 'Admission exhausted' USING ERRCODE='42501'; END IF;
  WITH selected AS (SELECT b.purpose,b.dimension,b.key_hmac,b.window_start FROM zhiban_identity.admission_buckets AS b
    WHERE b.purpose=p_purpose AND b.expires_at<=v_now ORDER BY b.expires_at,b.dimension,b.key_hmac,b.window_start LIMIT p_limit)
  DELETE FROM zhiban_identity.admission_buckets AS b USING selected AS s
    WHERE b.purpose=s.purpose AND b.dimension=s.dimension AND b.key_hmac=s.key_hmac AND b.window_start=s.window_start;
  GET DIAGNOSTICS v_deleted=ROW_COUNT;
  UPDATE zhiban_identity.admission_gate SET bucket_count=bucket_count-v_deleted,repository_revision=repository_revision+1 WHERE purpose=p_purpose;
  RETURN v_deleted;
END;
$$;

CREATE FUNCTION zhiban_identity.identity_bootstrap_consistency()
RETURNS trigger LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE b zhiban_identity.identity_platform_bootstrap%ROWTYPE; v_now bigint;
BEGIN
  IF session_user<>'zhiban_control_runtime' THEN RAISE EXCEPTION 'Bootstrap rejected' USING ERRCODE='42501'; END IF;
  SELECT a.* INTO b FROM zhiban_identity.identity_platform_bootstrap AS a WHERE a.singleton_key='PLATFORM';
  v_now:=floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint;
  IF b.repository_revision IS DISTINCT FROM 2 OR v_now<b.completed_at OR v_now>=b.expires_at
    OR NOT EXISTS (SELECT 1 FROM zhiban_identity.users AS u WHERE u.user_id=b.target_user_id AND u.status='ACTIVE'
      AND u.repository_revision=b.user_revision AND u.updated_at<=b.completed_at
      AND (NOT b.created_user OR (u.created_at=b.completed_at AND u.repository_revision=1)))
    OR NOT EXISTS (SELECT 1 FROM zhiban_identity.system_admin_grants AS g WHERE g.grant_id=b.system_admin_grant_id
      AND g.user_id=b.target_user_id AND g.created_at=b.completed_at AND g.valid_from=b.completed_at
      AND g.revoked_at IS NULL AND g.repository_revision=1 AND (g.valid_until IS NULL OR g.valid_until>v_now))
    OR NOT EXISTS (SELECT 1 FROM zhiban_identity.identity_credential_provisions AS p
      WHERE p.approval_id=b.credential_provision_id AND p.user_id=b.target_user_id AND p.expected_user_revision=b.user_revision
        AND p.command_id=b.command_id AND p.environment_ref=b.environment_ref AND p.approval_ref=b.approval_ref
        AND p.operator_ref=b.operator_ref AND p.approver_ref=b.approver_ref AND p.request_id=b.request_id
        AND p.manifest_digest=b.manifest_digest AND p.issued_at=b.issued_at AND p.expires_at=b.expires_at AND p.consumed_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM zhiban_identity.audit_events AS e WHERE e.event_id=b.grant_created_event_id
      AND e.event_type='SYSTEM_ADMIN_GRANT_GRANTED' AND e.subject_user_id=b.target_user_id
      AND e.event_scope='GLOBAL' AND e.tenant_id IS NULL AND e.actor_type='SERVICE' AND e.actor_service_code='identity_bootstrap'
      AND e.reason='ADMIN_REQUEST' AND e.request_id=b.request_id AND e.occurred_at=b.completed_at
      AND e.event_payload=jsonb_build_object('grantId',b.system_admin_grant_id::text))
    OR (b.created_user AND NOT EXISTS (SELECT 1 FROM zhiban_identity.audit_events AS e WHERE e.event_id=b.user_created_event_id
      AND e.event_type='USER_CREATED' AND e.subject_user_id=b.target_user_id AND e.event_scope='GLOBAL' AND e.tenant_id IS NULL
      AND e.actor_type='SERVICE' AND e.actor_service_code='identity_bootstrap' AND e.reason='ADMIN_REQUEST'
      AND e.request_id=b.request_id AND e.occurred_at=b.completed_at AND e.event_payload='{}'::jsonb)) THEN
    RAISE EXCEPTION 'Bootstrap consistency rejected' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER identity_bootstrap_consistency AFTER UPDATE OR INSERT ON zhiban_identity.identity_platform_bootstrap
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_bootstrap_consistency();
CREATE FUNCTION zhiban_identity.identity_provision_consistency()
RETURNS trigger LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE p zhiban_identity.identity_credential_provisions%ROWTYPE; v_now bigint;
BEGIN
  IF session_user NOT IN ('zhiban_control_runtime','zhiban_auth_runtime') THEN RAISE EXCEPTION 'Provision rejected' USING ERRCODE='42501'; END IF;
  SELECT a.* INTO p FROM zhiban_identity.identity_credential_provisions AS a WHERE a.approval_id=NEW.approval_id;
  IF NOT EXISTS (SELECT 1 FROM zhiban_identity.identity_platform_bootstrap AS b WHERE b.singleton_key='PLATFORM'
    AND b.repository_revision=2 AND b.credential_provision_id=p.approval_id AND b.target_user_id=p.user_id
    AND b.user_revision=p.expected_user_revision AND b.command_id=p.command_id AND b.environment_ref=p.environment_ref
    AND b.approval_ref=p.approval_ref AND b.operator_ref=p.operator_ref AND b.approver_ref=p.approver_ref
    AND b.request_id=p.request_id AND b.manifest_digest=p.manifest_digest AND b.issued_at=p.issued_at AND b.expires_at=p.expires_at) THEN
    RAISE EXCEPTION 'Provision consistency rejected' USING ERRCODE='23514';
  END IF;
  IF p.consumed_at IS NOT NULL THEN
    v_now:=floor(extract(epoch FROM pg_catalog.clock_timestamp())*1000)::bigint;
    IF session_user<>'zhiban_auth_runtime' OR v_now<p.consumed_at OR v_now>=p.expires_at
      OR NOT EXISTS (SELECT 1 FROM zhiban_identity.users AS u WHERE u.user_id=p.user_id AND u.status='ACTIVE' AND u.repository_revision=p.expected_user_revision)
      OR NOT EXISTS (SELECT 1 FROM zhiban_identity.credential_slots AS s JOIN zhiban_identity.credentials AS c
        ON c.user_id=s.user_id AND c.credential_id=s.active_credential_id
        WHERE s.user_id=p.user_id AND s.generation=1 AND s.repository_revision=1 AND s.security_epoch=1
          AND s.created_at=p.consumed_at AND s.updated_at=p.consumed_at
          AND c.credential_id=p.credential_id AND c.generation=1 AND c.slot_revision=1 AND c.status='ACTIVE'
          AND c.created_at=p.consumed_at AND c.updated_at=p.consumed_at)
      OR NOT EXISTS (SELECT 1 FROM zhiban_identity.audit_events AS e WHERE e.event_id=p.credential_event_id
        AND e.event_type='CREDENTIAL_CREATED' AND e.subject_user_id=p.user_id AND e.event_scope='GLOBAL' AND e.tenant_id IS NULL
        AND e.actor_type='SERVICE' AND e.actor_service_code='identity_provision' AND e.reason='ADMIN_REQUEST'
        AND e.request_id=p.request_id AND e.occurred_at=p.consumed_at
        AND e.event_payload=jsonb_build_object('credentialId',p.credential_id::text,'repositoryRevisionAfter','1','securityEpochAfter','1')) THEN
      RAISE EXCEPTION 'Provision consistency rejected' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER identity_provision_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_credential_provisions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_provision_consistency();

REVOKE ALL ON zhiban_identity.admission_policies,zhiban_identity.admission_gate,zhiban_identity.admission_buckets,
  zhiban_identity.identity_platform_bootstrap,zhiban_identity.identity_credential_provisions
  FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
GRANT SELECT ON zhiban_identity.admission_policies,zhiban_identity.identity_platform_bootstrap,zhiban_identity.identity_credential_provisions TO zhiban_control_runtime;
GRANT INSERT(purpose,policy_digest,approval_ref,environment_ref,created_at,window_ms,global_limit,ip_limit,locator_limit,pair_limit,user_limit,max_buckets)
  ON zhiban_identity.admission_policies TO zhiban_control_runtime;
GRANT INSERT(purpose) ON zhiban_identity.admission_gate TO zhiban_control_runtime;
GRANT UPDATE(repository_revision,approval_id,command_id,environment_ref,approval_ref,operator_ref,approver_ref,request_id,manifest_digest,
  target_user_id,user_revision,system_admin_grant_id,issued_at,expires_at,completed_at,created_user,user_created_event_id,grant_created_event_id,credential_provision_id)
  ON zhiban_identity.identity_platform_bootstrap TO zhiban_control_runtime;
GRANT INSERT(approval_id,command_id,user_id,expected_user_revision,purpose,environment_ref,approval_ref,operator_ref,approver_ref,request_id,manifest_digest,issued_at,expires_at)
  ON zhiban_identity.identity_credential_provisions TO zhiban_control_runtime;
GRANT SELECT ON zhiban_identity.identity_credential_provisions TO zhiban_auth_runtime;
GRANT UPDATE(consumed_at,credential_id,credential_event_id) ON zhiban_identity.identity_credential_provisions TO zhiban_auth_runtime;
GRANT INSERT(event_id) ON zhiban_identity.audit_events TO zhiban_auth_runtime,zhiban_control_runtime;
REVOKE ALL ON FUNCTION zhiban_identity.identity_auth_user_anchor(uuid) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
REVOKE ALL ON FUNCTION zhiban_identity.identity_session_guard(text,uuid) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
REVOKE ALL ON FUNCTION zhiban_identity.identity_session_spaces(text,uuid,integer) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
REVOKE ALL ON FUNCTION zhiban_identity.identity_platform_bootstrap_lock() FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
REVOKE ALL ON FUNCTION zhiban_identity.identity_admission_reserve(text,text,text[]) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
REVOKE ALL ON FUNCTION zhiban_identity.identity_admission_prune(text,text,integer) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
REVOKE ALL ON FUNCTION zhiban_identity.identity_bootstrap_consistency() FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
REVOKE ALL ON FUNCTION zhiban_identity.identity_provision_consistency() FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
REVOKE ALL ON FUNCTION zhiban_identity.identity_bootstrap_guard() FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
REVOKE ALL ON FUNCTION zhiban_identity.identity_provision_guard() FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
REVOKE ALL ON FUNCTION zhiban_identity.identity_admission_policy_immutable() FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.identity_auth_user_anchor(uuid),zhiban_identity.identity_session_spaces(text,uuid,integer),
  zhiban_identity.identity_admission_reserve(text,text,text[]),zhiban_identity.identity_admission_prune(text,text,integer) TO zhiban_auth_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.identity_session_guard(text,uuid) TO zhiban_runtime,zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.identity_platform_bootstrap_lock() TO zhiban_control_runtime;
CREATE POLICY audit_identity_provenance_owner_read ON zhiban_identity.audit_events
  FOR SELECT TO zhiban_identity_owner USING (event_scope='GLOBAL' AND tenant_id IS NULL AND (
    EXISTS (SELECT 1 FROM zhiban_identity.identity_platform_bootstrap AS b WHERE b.target_user_id=subject_user_id
      AND ((b.user_created_event_id=event_id AND event_type='USER_CREATED')
        OR (b.grant_created_event_id=event_id AND event_type='SYSTEM_ADMIN_GRANT_GRANTED')))
    OR EXISTS (SELECT 1 FROM zhiban_identity.identity_credential_provisions AS p WHERE p.user_id=subject_user_id
      AND p.credential_event_id=event_id AND event_type='CREDENTIAL_CREATED')));
