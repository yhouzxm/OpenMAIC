-- 0010 is applied/checksummed: repair locking through the existing restricted helper.
-- No new function signature, role/table grant or OUTCOME/CANCEL source dependency.
CREATE OR REPLACE FUNCTION zhiban_identity.identity_recovery_actor_guard(p_case_id uuid,p_session_digest text,p_mode text)
RETURNS TABLE(actor_user_id uuid,actor_user_revision bigint,actor_slot_revision bigint,actor_security_epoch bigint,
 admin_grant_revision bigint,absolute_expires_at bigint,idle_expires_at bigint,grant_valid_until bigint)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE c zhiban_identity.identity_recovery_cases%ROWTYPE; s zhiban_identity.sessions%ROWTYPE;
 slot zhiban_identity.credential_slots%ROWTYPE; target zhiban_identity.credential_slots%ROWTYPE;
 g zhiban_identity.system_admin_grants%ROWTYPE; ur bigint; st text; at_time bigint; u uuid; pd text; source_count integer;
BEGIN
 IF session_user<>'zhiban_auth_runtime' OR p_case_id IS NULL OR p_session_digest IS NULL
 OR p_session_digest !~ '^[a-f0-9]{64}$' OR p_mode IS NULL OR p_mode NOT IN ('LIVE','OUTCOME','CANCEL') THEN
 RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM zhiban_identity.identity_recovery_cases WHERE case_id=p_case_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
 SELECT policy_digest INTO pd FROM zhiban_identity.identity_recovery_policy WHERE environment_ref=c.environment_ref;
 PERFORM zhiban_identity.identity_recovery_gate(c.environment_ref,pd);
 IF p_mode='LIVE' AND NOT (SELECT enabled FROM zhiban_identity.identity_recovery_policy WHERE environment_ref=c.environment_ref) THEN
 RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
 IF p_mode='LIVE' THEN
 PERFORM zhiban_identity.identity_recovery_user_locks(p_case_id,p_session_digest,
 ARRAY[c.enrollment_source_id,c.appointment_source_id,c.contact_source_id]);
 ELSE
 SELECT repository_revision,status INTO ur,st FROM zhiban_identity.users WHERE user_id=c.actor_user_id FOR SHARE NOWAIT;
 IF st IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
 END IF;
 IF NOT pg_try_advisory_xact_lock_shared(hashtextextended('zhiban-session-user:'||c.actor_user_id::text,0)) THEN
 RAISE EXCEPTION 'Recovery busy' USING ERRCODE='55P03'; END IF;
 IF p_mode='LIVE' THEN
 FOR u IN SELECT x FROM unnest(ARRAY[c.actor_user_id,c.subject_user_id]) x ORDER BY x LOOP
 IF u=c.subject_user_id THEN
 SELECT * INTO target FROM zhiban_identity.credential_slots WHERE user_id=u FOR UPDATE NOWAIT;
 ELSE
 SELECT * INTO slot FROM zhiban_identity.credential_slots WHERE user_id=u FOR SHARE NOWAIT;
 END IF;
 END LOOP;
 ELSE
 SELECT * INTO slot FROM zhiban_identity.credential_slots WHERE user_id=c.actor_user_id FOR SHARE NOWAIT;
 END IF;
 SELECT * INTO s FROM zhiban_identity.sessions WHERE token_digest=p_session_digest FOR SHARE NOWAIT;
 SELECT repository_revision INTO ur FROM zhiban_identity.users WHERE user_id=c.actor_user_id;
 at_time:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF s.user_id IS DISTINCT FROM c.actor_user_id OR s.revoked_at IS NOT NULL OR slot.active_credential_id IS NULL
 OR s.user_revision IS DISTINCT FROM ur OR s.security_epoch IS DISTINCT FROM slot.security_epoch
 OR at_time<s.last_seen_at OR at_time>=s.absolute_expires_at OR at_time>=s.idle_expires_at THEN
 RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
 IF p_mode='LIVE' THEN
 SELECT * INTO g FROM zhiban_identity.system_admin_grants WHERE grant_id=c.actor_admin_grant_id FOR SHARE NOWAIT;
 IF target.repository_revision IS DISTINCT FROM c.expected_slot_revision
 OR target.security_epoch IS DISTINCT FROM c.expected_security_epoch OR target.generation IS DISTINCT FROM c.expected_generation
 OR target.active_credential_id IS DISTINCT FROM c.expected_credential_id
 OR ur<>c.expected_actor_user_revision OR slot.repository_revision<>c.expected_actor_slot_revision
 OR slot.security_epoch<>c.expected_actor_security_epoch OR g.repository_revision IS DISTINCT FROM c.expected_admin_grant_revision
 OR (SELECT repository_revision FROM zhiban_identity.users WHERE user_id=c.subject_user_id)<>c.expected_subject_user_revision
 OR (SELECT repository_revision FROM zhiban_identity.users WHERE user_id=c.verifier_user_id)<>c.expected_verifier_user_revision THEN
 RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
 ELSE
 SELECT * INTO g FROM zhiban_identity.system_admin_grants
 WHERE user_id=c.actor_user_id AND revoked_at IS NULL AND valid_from<=at_time AND (valid_until IS NULL OR valid_until>at_time)
 ORDER BY grant_id LIMIT 1 FOR SHARE NOWAIT;
 END IF;
 IF g.user_id IS DISTINCT FROM c.actor_user_id OR g.revoked_at IS NOT NULL OR at_time<g.valid_from
 OR (g.valid_until IS NOT NULL AND at_time>=g.valid_until) THEN
 RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
 -- The LIVE case supplies the only three source IDs; no generic source-lock capability.
 IF p_mode='LIVE' THEN
 PERFORM source_id FROM zhiban_identity.identity_recovery_sources
 WHERE environment_ref=c.environment_ref
 AND source_id=ANY(ARRAY[c.enrollment_source_id,c.appointment_source_id,c.contact_source_id])
 ORDER BY source_id FOR SHARE NOWAIT;
 GET DIAGNOSTICS source_count=ROW_COUNT;
 IF source_count<>3 THEN RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN QUERY SELECT c.actor_user_id,ur,slot.repository_revision,slot.security_epoch,g.repository_revision,
 s.absolute_expires_at,s.idle_expires_at,g.valid_until;
END $$;
