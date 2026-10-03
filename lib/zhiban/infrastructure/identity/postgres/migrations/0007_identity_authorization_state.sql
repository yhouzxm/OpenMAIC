-- A7-03: the sole approved SECURITY DEFINER exception. No business DML.
-- Applied by the existing transactional owner/migrator runner, never at startup.
CREATE POLICY memberships_authorization_owner_read
  ON zhiban_identity.memberships FOR SELECT TO zhiban_identity_owner
  USING (tenant_id = zhiban_identity.current_tenant_id());
CREATE POLICY grants_authorization_owner_read
  ON zhiban_identity.role_grants FOR SELECT TO zhiban_identity_owner
  USING (tenant_id = zhiban_identity.current_tenant_id());

CREATE FUNCTION zhiban_identity.authorization_state(
  p_tenant_id uuid, p_actor_membership_id uuid,
  p_target_membership_ids uuid[], p_mode text
)
RETURNS TABLE (
  fact_kind text, tenant_id uuid, tenant_status text, tenant_revision bigint,
  membership_id uuid, user_id uuid, user_status text, user_revision bigint
)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path = pg_catalog, zhiban_identity, pg_temp
SET row_security = on
AS $$
DECLARE
  v_tenant zhiban_identity.tenants%ROWTYPE;
  v_user zhiban_identity.users%ROWTYPE;
  v_members uuid[];
  v_users uuid[];
  v_id uuid;
BEGIN
  IF session_user <> 'zhiban_runtime'
     OR p_tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id()
     OR zhiban_identity.is_uuid_v7(p_tenant_id) IS DISTINCT FROM TRUE
     OR zhiban_identity.is_uuid_v7(p_actor_membership_id) IS DISTINCT FROM TRUE
     OR p_mode IS NULL OR p_mode NOT IN ('READ_CONTEXT','GUARD_MEMBERSHIP')
     OR p_target_membership_ids IS NULL
     OR cardinality(p_target_membership_ids) > 2
     OR EXISTS (SELECT 1 FROM unnest(p_target_membership_ids) AS t(id)
                WHERE zhiban_identity.is_uuid_v7(t.id) IS DISTINCT FROM TRUE)
     OR (SELECT count(DISTINCT t.id) FROM unnest(p_target_membership_ids) AS t(id))
        <> cardinality(p_target_membership_ids) THEN
    RAISE EXCEPTION 'Authorization context rejected' USING ERRCODE = '42501';
  END IF;
  IF p_mode = 'GUARD_MEMBERSHIP' THEN
    SELECT t.* INTO v_tenant FROM zhiban_identity.tenants AS t
      WHERE t.tenant_id = p_tenant_id FOR UPDATE;
  ELSE
    SELECT t.* INTO v_tenant FROM zhiban_identity.tenants AS t
      WHERE t.tenant_id = p_tenant_id;
  END IF;
  IF v_tenant.tenant_id IS NULL OR v_tenant.status <> 'ACTIVE'
     OR NOT EXISTS (SELECT 1 FROM zhiban_identity.memberships AS m
         WHERE m.tenant_id = p_tenant_id AND m.membership_id = p_actor_membership_id
           AND m.status = 'ACTIVE')
     OR EXISTS (SELECT 1 FROM unnest(p_target_membership_ids) AS target(id)
         WHERE NOT EXISTS (SELECT 1 FROM zhiban_identity.memberships AS m
           WHERE m.tenant_id = p_tenant_id AND m.membership_id = target.id)) THEN
    RAISE EXCEPTION 'Authorization context rejected' USING ERRCODE = '42501';
  END IF;
  SELECT array_agg(DISTINCT m.membership_id ORDER BY m.membership_id),
         array_agg(DISTINCT m.user_id ORDER BY m.user_id)
    INTO v_members, v_users
    FROM zhiban_identity.memberships AS m
    WHERE m.tenant_id = p_tenant_id AND (
      m.membership_id = p_actor_membership_id
      OR m.membership_id = ANY(p_target_membership_ids)
      OR (p_mode = 'GUARD_MEMBERSHIP' AND m.status = 'ACTIVE'
          AND EXISTS (SELECT 1 FROM zhiban_identity.role_grants AS g
            WHERE g.tenant_id = p_tenant_id AND g.membership_id = m.membership_id
              AND g.role_code = 'TENANT_ADMIN' AND g.revoked_at IS NULL))
    );
  IF v_users IS NULL OR cardinality(v_users) > 256 THEN
    RAISE EXCEPTION 'Authorization context rejected' USING ERRCODE = '42501';
  END IF;
  -- SHARE, not KEY SHARE: block status UPDATE as well as deletion.
  IF p_mode = 'GUARD_MEMBERSHIP' THEN
    FOREACH v_id IN ARRAY v_users LOOP
      SELECT u.* INTO v_user FROM zhiban_identity.users AS u
        WHERE u.user_id = v_id FOR SHARE;
      IF v_user.user_id IS NULL THEN
        RAISE EXCEPTION 'Authorization context rejected' USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;
  RETURN QUERY SELECT 'TENANT'::text, p_tenant_id, v_tenant.status,
    v_tenant.repository_revision, NULL::uuid, NULL::uuid, NULL::text, NULL::bigint;
  RETURN QUERY SELECT 'USER'::text, p_tenant_id, NULL::text, NULL::bigint,
    m.membership_id, u.user_id, u.status, u.repository_revision
    FROM zhiban_identity.memberships AS m
    JOIN zhiban_identity.users AS u ON u.user_id = m.user_id
    WHERE m.tenant_id = p_tenant_id AND m.membership_id = ANY(v_members)
    ORDER BY m.membership_id;
END;
$$;
ALTER FUNCTION zhiban_identity.authorization_state(uuid,uuid,uuid[],text)
  OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.authorization_state(uuid,uuid,uuid[],text)
  FROM PUBLIC, zhiban_auth_runtime, zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.authorization_state(uuid,uuid,uuid[],text)
  TO zhiban_runtime;
