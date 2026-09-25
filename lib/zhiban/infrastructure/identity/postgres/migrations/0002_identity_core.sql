CREATE FUNCTION zhiban_identity.is_uuid_v7(value uuid)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp
AS $$
  SELECT value IS NOT NULL
    AND substring(value::text FROM 15 FOR 1) = '7'
    AND substring(value::text FROM 20 FOR 1) ~ '^[89ab]$'
$$;
REVOKE ALL ON FUNCTION zhiban_identity.is_uuid_v7(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zhiban_identity.is_uuid_v7(uuid)
  TO zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime;

CREATE TABLE zhiban_identity.users (
  user_id uuid PRIMARY KEY CHECK (zhiban_identity.is_uuid_v7(user_id)),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED')),
  created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
  updated_at bigint NOT NULL CHECK (updated_at BETWEEN 0 AND 8640000000000000 AND updated_at >= created_at),
  disabled_at bigint CHECK (disabled_at BETWEEN 0 AND 8640000000000000),
  disabled_reason text,
  repository_revision bigint NOT NULL DEFAULT 1 CHECK (repository_revision >= 1),
  CONSTRAINT users_disabled_shape CHECK (
    (status = 'ACTIVE' AND disabled_at IS NULL AND disabled_reason IS NULL)
    OR (status = 'DISABLED' AND disabled_at IS NOT NULL AND disabled_at BETWEEN created_at AND updated_at
        AND disabled_reason IS NOT NULL AND btrim(disabled_reason) <> '')
  )
);

CREATE TABLE zhiban_identity.tenants (
  tenant_id uuid PRIMARY KEY CHECK (zhiban_identity.is_uuid_v7(tenant_id)),
  code text COLLATE "C" NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_-]{0,63}$'),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'DISABLED', 'ARCHIVED')),
  created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
  updated_at bigint NOT NULL CHECK (updated_at BETWEEN 0 AND 8640000000000000 AND updated_at >= created_at),
  disabled_at bigint CHECK (disabled_at BETWEEN 0 AND 8640000000000000),
  disabled_reason text,
  repository_revision bigint NOT NULL DEFAULT 1 CHECK (repository_revision >= 1),
  CONSTRAINT tenants_disabled_shape CHECK (
    (status = 'ACTIVE' AND disabled_at IS NULL AND disabled_reason IS NULL)
    OR (status = 'DISABLED' AND disabled_at IS NOT NULL AND disabled_at BETWEEN created_at AND updated_at
        AND disabled_reason IS NOT NULL AND btrim(disabled_reason) <> '')
    OR (status = 'ARCHIVED' AND
        ((disabled_at IS NULL AND disabled_reason IS NULL)
         OR (disabled_at IS NOT NULL AND disabled_at BETWEEN created_at AND updated_at
             AND disabled_reason IS NOT NULL AND btrim(disabled_reason) <> '')))
  )
);

CREATE TABLE zhiban_identity.memberships (
  membership_id uuid PRIMARY KEY CHECK (zhiban_identity.is_uuid_v7(membership_id)),
  tenant_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(tenant_id))
    REFERENCES zhiban_identity.tenants(tenant_id) ON DELETE RESTRICT,
  user_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(user_id))
    REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('PENDING', 'ACTIVE', 'DISABLED', 'LEFT')),
  authorization_version bigint NOT NULL DEFAULT 0
    CHECK (authorization_version BETWEEN 0 AND 9007199254740991),
  repository_revision bigint NOT NULL DEFAULT 1 CHECK (repository_revision >= 1),
  created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
  updated_at bigint NOT NULL CHECK (updated_at BETWEEN 0 AND 8640000000000000 AND updated_at >= created_at),
  disabled_at bigint CHECK (disabled_at BETWEEN 0 AND 8640000000000000),
  disabled_reason text,
  CONSTRAINT memberships_disabled_shape CHECK (
    (status = 'DISABLED' AND disabled_at IS NOT NULL AND disabled_at BETWEEN created_at AND updated_at
     AND disabled_reason IS NOT NULL AND btrim(disabled_reason) <> '')
    OR (status <> 'DISABLED' AND disabled_at IS NULL AND disabled_reason IS NULL)
  ),
  CONSTRAINT memberships_tenant_user_unique UNIQUE (tenant_id, user_id),
  CONSTRAINT memberships_tenant_id_unique UNIQUE (tenant_id, membership_id)
);

CREATE TABLE zhiban_identity.role_grants (
  grant_id uuid PRIMARY KEY CHECK (zhiban_identity.is_uuid_v7(grant_id)),
  tenant_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(tenant_id)),
  membership_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(membership_id)),
  grant_ordinal bigint NOT NULL CHECK (grant_ordinal >= 0),
  role_code text NOT NULL CHECK (role_code IN ('STUDENT', 'TEACHER', 'TENANT_ADMIN')),
  scope_kind text NOT NULL CHECK (scope_kind IN ('SELF', 'TENANT', 'CLASS', 'COURSE')),
  scope_id uuid CHECK (scope_id IS NULL OR zhiban_identity.is_uuid_v7(scope_id)),
  created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
  valid_from bigint NOT NULL CHECK (valid_from BETWEEN 0 AND 8640000000000000 AND valid_from >= created_at),
  valid_until bigint CHECK (valid_until BETWEEN 0 AND 8640000000000000 AND valid_until > valid_from),
  revoked_at bigint CHECK (revoked_at BETWEEN 0 AND 8640000000000000 AND revoked_at >= created_at),
  CONSTRAINT role_grants_scope_shape CHECK (
    (scope_kind IN ('SELF', 'TENANT') AND scope_id IS NULL)
    OR (scope_kind IN ('CLASS', 'COURSE') AND scope_id IS NOT NULL)
  ),
  CONSTRAINT role_grants_membership_tenant_fk FOREIGN KEY (tenant_id, membership_id)
    REFERENCES zhiban_identity.memberships(tenant_id, membership_id) ON DELETE RESTRICT,
  CONSTRAINT role_grants_ordinal_unique UNIQUE (tenant_id, membership_id, grant_ordinal)
);

CREATE TABLE zhiban_identity.system_admin_grants (
  grant_id uuid PRIMARY KEY CHECK (zhiban_identity.is_uuid_v7(grant_id)),
  user_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(user_id))
    REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT,
  created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
  valid_from bigint NOT NULL CHECK (valid_from BETWEEN 0 AND 8640000000000000 AND valid_from >= created_at),
  valid_until bigint CHECK (valid_until BETWEEN 0 AND 8640000000000000 AND valid_until > valid_from),
  revoked_at bigint CHECK (revoked_at BETWEEN 0 AND 8640000000000000 AND revoked_at >= created_at),
  repository_revision bigint NOT NULL DEFAULT 1 CHECK (repository_revision >= 1)
);
CREATE INDEX system_admin_grants_user_idx ON zhiban_identity.system_admin_grants(user_id);

CREATE TABLE zhiban_identity.sessions (
  session_id text PRIMARY KEY CHECK (btrim(session_id) <> ''),
  user_id uuid NOT NULL CHECK (zhiban_identity.is_uuid_v7(user_id))
    REFERENCES zhiban_identity.users(user_id) ON DELETE RESTRICT,
  token_digest text NOT NULL UNIQUE CHECK (btrim(token_digest) <> ''),
  created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
  last_seen_at bigint NOT NULL CHECK (last_seen_at BETWEEN 0 AND 8640000000000000),
  absolute_expires_at bigint NOT NULL CHECK (absolute_expires_at BETWEEN 0 AND 8640000000000000),
  idle_expires_at bigint NOT NULL CHECK (idle_expires_at BETWEEN 0 AND 8640000000000000),
  revoked_at bigint CHECK (revoked_at BETWEEN 0 AND 8640000000000000),
  repository_revision bigint NOT NULL DEFAULT 1 CHECK (repository_revision >= 1)
);
CREATE INDEX sessions_active_user_idx ON zhiban_identity.sessions(user_id)
  WHERE revoked_at IS NULL;

CREATE FUNCTION zhiban_identity.guard_membership_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp
AS $$
BEGIN
  IF NEW.membership_id IS DISTINCT FROM OLD.membership_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.updated_at < OLD.updated_at
     OR NEW.authorization_version < OLD.authorization_version
     OR NEW.repository_revision <> OLD.repository_revision + 1 THEN
    RAISE EXCEPTION 'Membership immutable identity or version violation' USING ERRCODE = '23514';
  END IF;
  IF NEW.authorization_version = OLD.authorization_version
     AND (NEW.status IS DISTINCT FROM OLD.status
       OR NEW.disabled_at IS DISTINCT FROM OLD.disabled_at
       OR NEW.disabled_reason IS DISTINCT FROM OLD.disabled_reason) THEN
    RAISE EXCEPTION 'Membership authorization changed without version' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION zhiban_identity.guard_membership_update() FROM PUBLIC;
CREATE TRIGGER memberships_immutable_guard BEFORE UPDATE ON zhiban_identity.memberships
  FOR EACH ROW EXECUTE FUNCTION zhiban_identity.guard_membership_update();

CREATE FUNCTION zhiban_identity.guard_role_grant_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp
AS $$
BEGIN
  IF NEW.grant_id IS DISTINCT FROM OLD.grant_id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.membership_id IS DISTINCT FROM OLD.membership_id
     OR NEW.grant_ordinal IS DISTINCT FROM OLD.grant_ordinal
     OR NEW.role_code IS DISTINCT FROM OLD.role_code
     OR NEW.scope_kind IS DISTINCT FROM OLD.scope_kind
     OR NEW.scope_id IS DISTINCT FROM OLD.scope_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at) THEN
    RAISE EXCEPTION 'RoleGrant history is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION zhiban_identity.guard_role_grant_update() FROM PUBLIC;
CREATE TRIGGER role_grants_immutable_guard BEFORE UPDATE ON zhiban_identity.role_grants
  FOR EACH ROW EXECUTE FUNCTION zhiban_identity.guard_role_grant_update();

CREATE FUNCTION zhiban_identity.guard_system_admin_grant_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp
AS $$
BEGIN
  IF NEW.grant_id IS DISTINCT FROM OLD.grant_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
     OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
     OR NEW.repository_revision <> OLD.repository_revision + 1 THEN
    RAISE EXCEPTION 'SystemAdminGrant history is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION zhiban_identity.guard_system_admin_grant_update() FROM PUBLIC;
CREATE TRIGGER system_admin_grants_immutable_guard
  BEFORE UPDATE ON zhiban_identity.system_admin_grants
  FOR EACH ROW EXECUTE FUNCTION zhiban_identity.guard_system_admin_grant_update();

CREATE FUNCTION zhiban_identity.guard_session_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp
AS $$
BEGIN
  IF NEW.session_id IS DISTINCT FROM OLD.session_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.token_digest IS DISTINCT FROM OLD.token_digest
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.absolute_expires_at IS DISTINCT FROM OLD.absolute_expires_at
     OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
     OR NEW.repository_revision <> OLD.repository_revision + 1 THEN
    RAISE EXCEPTION 'Session identity or revocation violation' USING ERRCODE = '23514';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND
     (NEW.last_seen_at IS DISTINCT FROM OLD.last_seen_at
      OR NEW.idle_expires_at IS DISTINCT FROM OLD.idle_expires_at) THEN
    RAISE EXCEPTION 'Revoked session cannot be touched' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION zhiban_identity.guard_session_update() FROM PUBLIC;
CREATE TRIGGER sessions_immutable_guard BEFORE UPDATE ON zhiban_identity.sessions
  FOR EACH ROW EXECUTE FUNCTION zhiban_identity.guard_session_update();

REVOKE ALL ON ALL TABLES IN SCHEMA zhiban_identity FROM PUBLIC, zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA zhiban_identity FROM PUBLIC, zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA zhiban_identity FROM PUBLIC, zhiban_runtime, zhiban_auth_runtime, zhiban_control_runtime;
