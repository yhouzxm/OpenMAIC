-- Global User-owned sessions. No tenant RLS; existing auth-only digest ACL remains.
-- NULL bindings preserve historical fixtures/rows but are NEVER authenticatable.
ALTER TABLE zhiban_identity.sessions
  ADD COLUMN security_epoch bigint CHECK (security_epoch >= 1),
  ADD COLUMN user_revision bigint CHECK (user_revision >= 1),
  ADD CONSTRAINT sessions_binding_pair CHECK ((security_epoch IS NULL) = (user_revision IS NULL)),
  ADD CONSTRAINT sessions_bound_shape CHECK (security_epoch IS NULL OR (
    session_id ~ '^ses_[A-Za-z0-9_-]{43}$' AND token_digest ~ '^[0-9a-f]{64}$'
    AND created_at <= last_seen_at AND last_seen_at < absolute_expires_at
    AND last_seen_at < idle_expires_at AND idle_expires_at <= absolute_expires_at));

CREATE FUNCTION zhiban_identity.session_binding_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp
AS $$
DECLARE current_epoch bigint; active_id uuid; current_user_revision bigint; user_status text;
BEGIN
  -- Enforce digest format for EVERY new row, even an unbound legacy-shaped one.
  -- Old malformed rows remain immutable and unauthenticatable, not silently repaired.
  IF TG_OP = 'INSERT' AND NEW.token_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Session digest format rejected' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.security_epoch IS DISTINCT FROM OLD.security_epoch
       OR NEW.user_revision IS DISTINCT FROM OLD.user_revision
       OR (OLD.security_epoch IS NOT NULL AND (
         NEW.last_seen_at < OLD.last_seen_at OR NEW.idle_expires_at < OLD.idle_expires_at)) THEN
      RAISE EXCEPTION 'Session binding or monotonicity violation' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.security_epoch IS NOT NULL THEN
    -- Insert/FK key-share completes before the repository User barrier. Existing
    -- control repositories acquire FOR UPDATE first; reversing this order can
    -- deadlock an INSERT FK check with their BEFORE UPDATE barrier.
    SELECT security_epoch, active_credential_id INTO current_epoch, active_id
      FROM zhiban_identity.credential_slots WHERE user_id = NEW.user_id FOR SHARE;
    SELECT status, repository_revision INTO user_status, current_user_revision
      FROM zhiban_identity.users WHERE user_id = NEW.user_id;
    IF active_id IS NULL OR current_epoch IS DISTINCT FROM NEW.security_epoch
       OR user_status IS DISTINCT FROM 'ACTIVE'
       OR current_user_revision IS DISTINCT FROM NEW.user_revision THEN
      RAISE EXCEPTION 'Session authentication binding rejected' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION zhiban_identity.session_binding_guard() FROM PUBLIC;
CREATE TRIGGER sessions_binding_guard BEFORE INSERT OR UPDATE ON zhiban_identity.sessions
  FOR EACH ROW EXECUTE FUNCTION zhiban_identity.session_binding_guard();

-- No UPDATE privilege on users is granted to auth. An invoker trigger on the
-- existing control mutation path provides the shared/exclusive User barrier.
CREATE FUNCTION zhiban_identity.session_user_barrier()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('zhiban-session-user:' || NEW.user_id::text, 0));
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION zhiban_identity.session_user_barrier() FROM PUBLIC;
CREATE TRIGGER users_session_barrier BEFORE UPDATE ON zhiban_identity.users
  FOR EACH ROW EXECUTE FUNCTION zhiban_identity.session_user_barrier();

GRANT SELECT (created_at, last_seen_at) ON zhiban_identity.sessions TO zhiban_control_runtime;
CREATE FUNCTION zhiban_identity.session_user_disable()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, zhiban_identity, pg_temp
AS $$
DECLARE revoked_session record;
BEGIN
  IF NEW.status = 'DISABLED' AND OLD.status <> 'DISABLED' THEN
    FOR revoked_session IN
      UPDATE zhiban_identity.sessions
        SET revoked_at = greatest(NEW.updated_at, created_at, last_seen_at),
            repository_revision = repository_revision + 1
        WHERE user_id = NEW.user_id AND revoked_at IS NULL
        RETURNING session_id, revoked_at
    LOOP
      INSERT INTO zhiban_identity.audit_events
        (event_shape_version,event_type,event_scope,occurred_at,actor_type,reason,subject_user_id,event_payload)
        VALUES (1,'SESSION_REVOKED','GLOBAL',revoked_session.revoked_at,'SYSTEM','SECURITY_POLICY',
          NEW.user_id,jsonb_build_object('sessionId',revoked_session.session_id));
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION zhiban_identity.session_user_disable() FROM PUBLIC;
CREATE TRIGGER users_session_disable AFTER UPDATE ON zhiban_identity.users
  FOR EACH ROW EXECUTE FUNCTION zhiban_identity.session_user_disable();
