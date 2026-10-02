-- Global password security records. No tenant RLS; authentication-only ACL.
CREATE TABLE zhiban_identity.credential_slots (
  user_id uuid PRIMARY KEY REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT CHECK (zhiban_identity.is_uuid_v7(user_id)),
  credential_type text NOT NULL CHECK (credential_type = 'PASSWORD'),
  active_credential_id uuid CHECK (active_credential_id IS NULL OR zhiban_identity.is_uuid_v7(active_credential_id)),
  generation bigint NOT NULL CHECK (generation > 0),
  repository_revision bigint NOT NULL DEFAULT 1 CHECK (repository_revision > 0),
  security_epoch bigint NOT NULL CHECK (security_epoch > 0),
  created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
  updated_at bigint NOT NULL CHECK (updated_at BETWEEN created_at AND 8640000000000000)
);
CREATE TABLE zhiban_identity.credentials (
  credential_id uuid PRIMARY KEY CHECK (zhiban_identity.is_uuid_v7(credential_id)),
  user_id uuid NOT NULL REFERENCES zhiban_identity.credential_slots(user_id) ON DELETE RESTRICT,
  credential_type text NOT NULL CHECK (credential_type = 'PASSWORD'),
  generation bigint NOT NULL CHECK (generation > 0),
  status text NOT NULL CHECK (status IN ('ACTIVE','REPLACED','REVOKED')),
  slot_revision bigint NOT NULL CHECK (slot_revision > 0),
  verifier_material text,
  created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
  updated_at bigint NOT NULL CHECK (updated_at BETWEEN created_at AND 8640000000000000),
  replaced_at bigint,
  revoked_at bigint,
  replaced_by_credential_id uuid,
  UNIQUE (user_id, credential_id), UNIQUE (user_id, generation),
  CONSTRAINT credential_successor_fk FOREIGN KEY (user_id, replaced_by_credential_id)
    REFERENCES zhiban_identity.credentials(user_id, credential_id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT credential_lifecycle CHECK ((
    (status = 'ACTIVE' AND verifier_material IS NOT NULL AND replaced_at IS NULL AND revoked_at IS NULL AND replaced_by_credential_id IS NULL)
    OR (status = 'REPLACED' AND verifier_material IS NULL AND replaced_at = updated_at AND revoked_at IS NULL AND replaced_by_credential_id IS NOT NULL AND replaced_by_credential_id <> credential_id)
    OR (status = 'REVOKED' AND verifier_material IS NULL AND revoked_at = updated_at AND replaced_at IS NULL AND replaced_by_credential_id IS NULL)
  ) IS TRUE),
  CONSTRAINT credential_verifier_shape CHECK (verifier_material IS NULL OR (
    octet_length(verifier_material) <= 1024 AND verifier_material ~ '^\$argon2id\$v=19\$m=(1945[6-9]|194[6-9][0-9]|19[5-9][0-9]{2}|[2-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-6]),t=[2-4],p=1\$[A-Za-z0-9+/]{22,43}\$[A-Za-z0-9+/]{43}$'))
);
ALTER TABLE zhiban_identity.credential_slots ADD CONSTRAINT credential_active_fk
  FOREIGN KEY (user_id, active_credential_id) REFERENCES zhiban_identity.credentials(user_id, credential_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE UNIQUE INDEX credential_one_active ON zhiban_identity.credentials(user_id) WHERE status = 'ACTIVE';
CREATE INDEX credential_history_idx ON zhiban_identity.credentials(user_id, created_at, credential_id);

CREATE FUNCTION zhiban_identity.credential_slot_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.repository_revision <> 1 OR NEW.security_epoch <> 1 OR NEW.generation <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid initial credential slot';
    END IF;
  ELSE
    IF NEW.user_id <> OLD.user_id OR NEW.credential_type <> OLD.credential_type OR NEW.created_at <> OLD.created_at
      OR OLD.repository_revision = 9223372036854775807 OR NEW.repository_revision <> OLD.repository_revision + 1
      OR NEW.updated_at < OLD.updated_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid credential slot mutation';
    END IF;
    IF NEW.active_credential_id IS DISTINCT FROM OLD.active_credential_id THEN
      IF OLD.security_epoch = 9223372036854775807 OR NEW.security_epoch <> OLD.security_epoch + 1
        OR NEW.generation <> OLD.generation + (CASE WHEN NEW.active_credential_id IS NULL THEN 0 ELSE 1 END) THEN
        RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid credential security mutation';
      END IF;
    ELSIF NEW.security_epoch <> OLD.security_epoch OR NEW.generation <> OLD.generation OR NEW.active_credential_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid technical rehash';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER credential_slot_guard BEFORE INSERT OR UPDATE ON zhiban_identity.credential_slots
  FOR EACH ROW EXECUTE FUNCTION zhiban_identity.credential_slot_guard();

CREATE FUNCTION zhiban_identity.credential_history_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp AS $$
DECLARE slot_generation bigint; current_revision bigint;
BEGIN
  -- Serialize all generation operations through the permanent aggregate anchor.
  SELECT generation, repository_revision INTO slot_generation, current_revision FROM zhiban_identity.credential_slots WHERE user_id = NEW.user_id FOR UPDATE;
  IF NEW.slot_revision IS DISTINCT FROM current_revision OR (TG_OP = 'UPDATE' AND NEW.slot_revision <= OLD.slot_revision) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Credential mutation requires parent CAS';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ACTIVE' OR NEW.generation <> slot_generation THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Invalid credential generation';
    END IF;
  ELSE
    IF OLD.status <> 'ACTIVE' OR NEW.credential_id <> OLD.credential_id OR NEW.user_id <> OLD.user_id
      OR NEW.credential_type <> OLD.credential_type OR NEW.generation <> OLD.generation
      OR NEW.created_at <> OLD.created_at OR NEW.updated_at < OLD.updated_at THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Immutable credential history';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER credential_history_guard BEFORE INSERT OR UPDATE ON zhiban_identity.credentials
  FOR EACH ROW EXECUTE FUNCTION zhiban_identity.credential_history_guard();

CREATE FUNCTION zhiban_identity.credential_consistency() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp AS $$
DECLARE anchor zhiban_identity.credential_slots%ROWTYPE; active_id uuid; active_count bigint; max_generation bigint;
BEGIN
  SELECT user_id, credential_type, active_credential_id, generation, repository_revision, security_epoch, created_at, updated_at
    INTO anchor FROM zhiban_identity.credential_slots WHERE user_id = NEW.user_id;
  SELECT count(*), max(generation) INTO active_count, max_generation FROM zhiban_identity.credentials WHERE user_id = NEW.user_id;
  IF active_count = 0 OR max_generation <> anchor.generation THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Incomplete credential aggregate';
  END IF;
  SELECT count(*) INTO active_count FROM zhiban_identity.credentials WHERE user_id = NEW.user_id AND status = 'ACTIVE';
  SELECT credential_id INTO active_id FROM zhiban_identity.credentials WHERE user_id = NEW.user_id AND status = 'ACTIVE';
  IF active_count > 1 OR active_id IS DISTINCT FROM anchor.active_credential_id
    OR NOT EXISTS (SELECT 1 FROM zhiban_identity.credentials WHERE user_id = NEW.user_id AND slot_revision = anchor.repository_revision)
    OR EXISTS (SELECT 1 FROM zhiban_identity.credentials WHERE user_id = NEW.user_id
      AND (created_at < anchor.created_at OR updated_at > anchor.updated_at OR (status = 'ACTIVE' AND generation <> anchor.generation)))
    OR EXISTS (SELECT 1 FROM zhiban_identity.credentials old JOIN zhiban_identity.credentials successor
      ON old.user_id = successor.user_id AND old.replaced_by_credential_id = successor.credential_id
      WHERE old.user_id = NEW.user_id AND (successor.generation <= old.generation OR successor.created_at < old.replaced_at)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Inconsistent credential pointer';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER credential_slot_consistency AFTER INSERT OR UPDATE ON zhiban_identity.credential_slots
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.credential_consistency();
CREATE CONSTRAINT TRIGGER credential_history_consistency AFTER INSERT OR UPDATE ON zhiban_identity.credentials
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.credential_consistency();

-- Add four closed events without changing any previously accepted payload shape.
ALTER FUNCTION zhiban_identity.audit_payload_valid(text, jsonb) RENAME TO audit_payload_valid_pre_credentials;
CREATE FUNCTION zhiban_identity.credential_decimal(v jsonb, positive boolean) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp AS $$
BEGIN
  IF jsonb_typeof(v) <> 'string' OR length(v #>> '{}') > 19 OR (v #>> '{}') !~ '^(0|[1-9][0-9]*)$' THEN RETURN false; END IF;
  RETURN (v #>> '{}')::numeric BETWEEN CASE WHEN positive THEN 1 ELSE 0 END AND 9223372036854775807;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION zhiban_identity.audit_payload_valid(kind text, p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp AS $$
DECLARE keys text[];
BEGIN
  IF kind NOT IN ('CREDENTIAL_CREATED','CREDENTIAL_REPLACED','CREDENTIAL_REVOKED','CREDENTIAL_REHASHED') THEN
    RETURN zhiban_identity.audit_payload_valid_pre_credentials(kind, p);
  END IF;
  IF jsonb_typeof(p) <> 'object' OR NOT zhiban_identity.audit_uuid_json(p->'credentialId') THEN RETURN false; END IF;
  keys := CASE kind
    WHEN 'CREDENTIAL_CREATED' THEN ARRAY['credentialId','repositoryRevisionAfter','securityEpochAfter']
    WHEN 'CREDENTIAL_REPLACED' THEN ARRAY['priorCredentialId','credentialId','repositoryRevisionBefore','repositoryRevisionAfter','securityEpochBefore','securityEpochAfter']
    WHEN 'CREDENTIAL_REVOKED' THEN ARRAY['credentialId','repositoryRevisionBefore','repositoryRevisionAfter','securityEpochBefore','securityEpochAfter']
    ELSE ARRAY['credentialId','repositoryRevisionBefore','repositoryRevisionAfter','securityEpoch'] END;
  IF NOT p ?& keys OR p - keys <> '{}'::jsonb OR NOT zhiban_identity.credential_decimal(p->'repositoryRevisionAfter', true) THEN RETURN false; END IF;
  IF kind = 'CREDENTIAL_CREATED' THEN RETURN p->>'repositoryRevisionAfter' = '1'
    AND zhiban_identity.credential_decimal(p->'securityEpochAfter', false) AND p->>'securityEpochAfter' = '1'; END IF;
  IF NOT zhiban_identity.credential_decimal(p->'repositoryRevisionBefore', true)
    OR (p->>'repositoryRevisionAfter')::numeric <> (p->>'repositoryRevisionBefore')::numeric + 1 THEN RETURN false; END IF;
  IF kind = 'CREDENTIAL_REHASHED' THEN RETURN zhiban_identity.credential_decimal(p->'securityEpoch', false); END IF;
  IF kind = 'CREDENTIAL_REPLACED' AND NOT (p->'priorCredentialId' = 'null'::jsonb OR
    (zhiban_identity.audit_uuid_json(p->'priorCredentialId') AND p->>'priorCredentialId' <> p->>'credentialId')) THEN RETURN false; END IF;
  RETURN zhiban_identity.credential_decimal(p->'securityEpochBefore', false)
    AND zhiban_identity.credential_decimal(p->'securityEpochAfter', false)
    AND (p->>'securityEpochAfter')::numeric = (p->>'securityEpochBefore')::numeric + 1;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE zhiban_identity.audit_events DROP CONSTRAINT audit_events_event_type_check;
ALTER TABLE zhiban_identity.audit_events ADD CONSTRAINT audit_events_event_type_check CHECK (
  event_type IN ('USER_CREATED','USER_DISABLED','USER_RESTORED','TENANT_CREATED','TENANT_DISABLED','TENANT_RESTORED',
    'MEMBERSHIP_DISABLED','MEMBERSHIP_LEFT','MEMBERSHIP_REACTIVATED','MEMBERSHIP_ACTIVATED','MEMBERSHIP_REJOINED','ROLE_GRANTS_REPLACED',
    'ROLE_GRANT_GRANTED','ROLE_GRANT_REVOKED','SYSTEM_ADMIN_GRANT_GRANTED','SYSTEM_ADMIN_GRANT_REVOKED','SESSION_REVOKED','AUTHENTICATION_REJECTED',
    'CREDENTIAL_CREATED','CREDENTIAL_REPLACED','CREDENTIAL_REVOKED','CREDENTIAL_REHASHED'));
-- Retain old ownership validation verbatim as a constraint and add only new global cases.
ALTER TABLE zhiban_identity.audit_events DROP CONSTRAINT audit_ownership_shape;
ALTER TABLE zhiban_identity.audit_events ADD CONSTRAINT audit_ownership_shape CHECK ((
  (event_type IN ('MEMBERSHIP_DISABLED','MEMBERSHIP_LEFT','MEMBERSHIP_REACTIVATED','MEMBERSHIP_ACTIVATED','MEMBERSHIP_REJOINED','ROLE_GRANTS_REPLACED','ROLE_GRANT_GRANTED','ROLE_GRANT_REVOKED')
    AND event_scope = 'TENANT' AND tenant_id IS NOT NULL AND subject_user_id IS NOT NULL AND subject_membership_id IS NOT NULL
    AND authorization_version_before BETWEEN 0 AND 9007199254740991 AND authorization_version_after BETWEEN 0 AND 9007199254740991 AND authorization_version_after > authorization_version_before)
  OR (event_type NOT IN ('MEMBERSHIP_DISABLED','MEMBERSHIP_LEFT','MEMBERSHIP_REACTIVATED','MEMBERSHIP_ACTIVATED','MEMBERSHIP_REJOINED','ROLE_GRANTS_REPLACED','ROLE_GRANT_GRANTED','ROLE_GRANT_REVOKED')
    AND event_scope = 'GLOBAL' AND subject_membership_id IS NULL AND authorization_version_before IS NULL AND authorization_version_after IS NULL
    AND ((event_type IN ('TENANT_CREATED','TENANT_DISABLED','TENANT_RESTORED') AND tenant_id IS NOT NULL AND subject_user_id IS NULL)
      OR (event_type IN ('USER_CREATED','USER_DISABLED','USER_RESTORED','SYSTEM_ADMIN_GRANT_GRANTED','SYSTEM_ADMIN_GRANT_REVOKED','SESSION_REVOKED',
        'CREDENTIAL_CREATED','CREDENTIAL_REPLACED','CREDENTIAL_REVOKED','CREDENTIAL_REHASHED') AND tenant_id IS NULL AND subject_user_id IS NOT NULL)
      OR (event_type = 'AUTHENTICATION_REJECTED' AND tenant_id IS NULL AND subject_user_id IS NULL)))
) IS TRUE);
ALTER TABLE zhiban_identity.audit_events DROP CONSTRAINT audit_closed_payload;
ALTER TABLE zhiban_identity.audit_events ADD CONSTRAINT audit_closed_payload CHECK (zhiban_identity.audit_payload_valid(event_type, event_payload) IS TRUE);
ALTER POLICY audit_auth_insert ON zhiban_identity.audit_events WITH CHECK (event_scope = 'GLOBAL' AND event_type IN (
  'AUTHENTICATION_REJECTED','SESSION_REVOKED','CREDENTIAL_CREATED','CREDENTIAL_REPLACED','CREDENTIAL_REVOKED','CREDENTIAL_REHASHED'));

REVOKE ALL ON zhiban_identity.credentials, zhiban_identity.credential_slots FROM PUBLIC, zhiban_runtime, zhiban_control_runtime, zhiban_auth_runtime;
GRANT SELECT, INSERT ON zhiban_identity.credentials, zhiban_identity.credential_slots TO zhiban_auth_runtime;
GRANT UPDATE (active_credential_id, generation, repository_revision, security_epoch, updated_at) ON zhiban_identity.credential_slots TO zhiban_auth_runtime;
GRANT UPDATE (status, verifier_material, slot_revision, updated_at, replaced_at, revoked_at, replaced_by_credential_id) ON zhiban_identity.credentials TO zhiban_auth_runtime;
REVOKE ALL ON FUNCTION zhiban_identity.credential_slot_guard(), zhiban_identity.credential_history_guard(),
  zhiban_identity.credential_consistency(), zhiban_identity.credential_decimal(jsonb, boolean), zhiban_identity.audit_payload_valid(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zhiban_identity.audit_payload_valid(text, jsonb), zhiban_identity.credential_decimal(jsonb, boolean)
  TO zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime;
