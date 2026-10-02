-- 0004 is already applicable and checksummed. Repair only the trigger's runtime
-- SQL alias ambiguity with its implicit OLD record; do not rewrite 0004.
CREATE OR REPLACE FUNCTION zhiban_identity.credential_consistency() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
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
    OR EXISTS (SELECT 1 FROM zhiban_identity.credentials prior_credential JOIN zhiban_identity.credentials successor
      ON prior_credential.user_id = successor.user_id AND prior_credential.replaced_by_credential_id = successor.credential_id
      WHERE prior_credential.user_id = NEW.user_id AND (successor.generation <= prior_credential.generation OR successor.created_at < prior_credential.replaced_at)) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Inconsistent credential pointer';
  END IF;
  RETURN NULL;
END $$;
