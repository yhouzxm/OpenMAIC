-- Approved E8-P01–P08. Global security records; no tenant RLS or enabled seed.
CREATE TABLE zhiban_identity.identity_recovery_policy (
 environment_ref text PRIMARY KEY CHECK (environment_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
 policy_digest text NOT NULL CHECK (policy_digest ~ '^[a-f0-9]{64}$'),
 approval_ref text NOT NULL CHECK (approval_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
 enabled boolean NOT NULL DEFAULT false,
 repository_revision bigint NOT NULL CHECK (repository_revision>0),
 created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
 updated_at bigint NOT NULL CHECK (updated_at BETWEEN created_at AND 8640000000000000),
 window_ms integer NOT NULL CHECK (window_ms BETWEEN 1 AND 3600000),
 global_limit integer NOT NULL CHECK (global_limit BETWEEN 1 AND 1000000),
 site_limit integer NOT NULL CHECK (site_limit BETWEEN 1 AND 1000000),
 subject_limit integer NOT NULL CHECK (subject_limit BETWEEN 1 AND 1000000),
 max_buckets integer NOT NULL CHECK (max_buckets BETWEEN 1 AND 1000000),
 max_live_cases integer NOT NULL CHECK (max_live_cases BETWEEN 1 AND 256),
 max_registered_per_subject integer NOT NULL CHECK (max_registered_per_subject BETWEEN 1 AND 4),
 max_total_cases integer NOT NULL CHECK (max_total_cases BETWEEN 1 AND 1000000),
 max_pending_notifications integer NOT NULL CHECK (max_pending_notifications BETWEEN 1 AND 256),
 max_notification_age_ms integer NOT NULL CHECK (max_notification_age_ms BETWEEN 1 AND 86400000),
 registered_ttl_ms integer NOT NULL CHECK (registered_ttl_ms BETWEEN 1 AND 86400000),
 submission_ttl_ms integer NOT NULL CHECK (submission_ttl_ms BETWEEN 1 AND 300000),
 ceremony_ttl_ms integer NOT NULL CHECK (ceremony_ttl_ms BETWEEN 1 AND 600000),
 max_submissions integer NOT NULL CHECK (max_submissions BETWEEN 1 AND 256),
 max_attempts_per_ticket integer NOT NULL CHECK (max_attempts_per_ticket BETWEEN 1 AND 5),
 max_process_requests integer NOT NULL CHECK (max_process_requests BETWEEN 1 AND 64),
 body_timeout_ms integer NOT NULL CHECK (body_timeout_ms BETWEEN 1 AND 30000),
 statement_timeout_ms integer NOT NULL CHECK (statement_timeout_ms BETWEEN 1 AND 30000)
);
CREATE TABLE zhiban_identity.identity_recovery_sources (
 source_id uuid PRIMARY KEY CHECK (zhiban_identity.is_uuid_v7(source_id)),
 environment_ref text NOT NULL REFERENCES zhiban_identity.identity_recovery_policy ON DELETE RESTRICT,
 source_kind text NOT NULL CHECK (source_kind IN ('ENROLLMENT','APPOINTMENT','CONTACT')),
 source_ref text NOT NULL CHECK (source_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
 bound_user_id uuid NOT NULL REFERENCES zhiban_identity.users ON DELETE RESTRICT,
 source_version bigint NOT NULL CHECK (source_version>0),
 manifest_digest text NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
 issuer_ref text NOT NULL CHECK (issuer_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
 key_ref text NOT NULL CHECK (key_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
 attested_at bigint NOT NULL CHECK (attested_at BETWEEN 0 AND 8640000000000000),
 valid_until bigint NOT NULL CHECK (valid_until BETWEEN attested_at+1 AND 8640000000000000),
 state text NOT NULL CHECK (state IN ('CURRENT','BLOCKED')),
 repository_revision bigint NOT NULL CHECK (repository_revision>0),
 created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
 updated_at bigint NOT NULL CHECK (updated_at BETWEEN created_at AND 8640000000000000),
 blocked_at bigint CHECK (blocked_at BETWEEN created_at AND updated_at),
 CHECK ((state='CURRENT' AND blocked_at IS NULL) OR (state='BLOCKED' AND blocked_at IS NOT NULL)),
 UNIQUE(environment_ref,source_kind,source_ref,source_version),
 UNIQUE(source_id,environment_ref,source_kind,bound_user_id)
);
CREATE TABLE zhiban_identity.identity_recovery_cases (
 case_id uuid PRIMARY KEY CHECK (zhiban_identity.is_uuid_v7(case_id)),
 environment_ref text NOT NULL REFERENCES zhiban_identity.identity_recovery_policy ON DELETE RESTRICT,
 site_ref text NOT NULL CHECK (site_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
 subject_user_id uuid NOT NULL REFERENCES zhiban_identity.users ON DELETE RESTRICT,
 verifier_user_id uuid NOT NULL REFERENCES zhiban_identity.users ON DELETE RESTRICT,
 actor_user_id uuid NOT NULL REFERENCES zhiban_identity.users ON DELETE RESTRICT,
 enrollment_source_id uuid NOT NULL, appointment_source_id uuid NOT NULL, contact_source_id uuid NOT NULL,
 enrollment_kind text NOT NULL DEFAULT 'ENROLLMENT' CHECK (enrollment_kind='ENROLLMENT'),
 appointment_kind text NOT NULL DEFAULT 'APPOINTMENT' CHECK (appointment_kind='APPOINTMENT'),
 contact_kind text NOT NULL DEFAULT 'CONTACT' CHECK (contact_kind='CONTACT'),
 expected_enrollment_source_revision bigint NOT NULL CHECK (expected_enrollment_source_revision>0),
 expected_appointment_source_revision bigint NOT NULL CHECK (expected_appointment_source_revision>0),
 expected_contact_source_revision bigint NOT NULL CHECK (expected_contact_source_revision>0),
 registration_manifest_digest text NOT NULL CHECK (registration_manifest_digest ~ '^[a-f0-9]{64}$'),
 registration_key_ref text NOT NULL CHECK (registration_key_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
 approval_ref text NOT NULL CHECK (approval_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
 approval_manifest_digest text CHECK (approval_manifest_digest ~ '^[a-f0-9]{64}$'),
 approval_key_ref text CHECK (approval_key_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
 intent text NOT NULL CHECK (intent IN ('REPLACE_ACTIVE_PASSWORD','REESTABLISH_REVOKED_PASSWORD')),
 security_clearance_ref text CHECK (security_clearance_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
 expected_subject_user_revision bigint NOT NULL CHECK (expected_subject_user_revision>0),
 expected_verifier_user_revision bigint NOT NULL CHECK (expected_verifier_user_revision>0),
 expected_slot_revision bigint NOT NULL CHECK (expected_slot_revision>0),
 expected_security_epoch bigint NOT NULL CHECK (expected_security_epoch>0),
 expected_credential_id uuid, expected_generation bigint NOT NULL CHECK (expected_generation>0),
 expected_actor_user_revision bigint NOT NULL CHECK (expected_actor_user_revision>0),
 expected_actor_slot_revision bigint NOT NULL CHECK (expected_actor_slot_revision>0),
 expected_actor_security_epoch bigint NOT NULL CHECK (expected_actor_security_epoch>0),
 actor_admin_grant_id uuid NOT NULL REFERENCES zhiban_identity.system_admin_grants(grant_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
 expected_admin_grant_revision bigint NOT NULL CHECK (expected_admin_grant_revision>0),
 state text NOT NULL CHECK (state IN ('REGISTERED','VERIFIED','APPROVED','TICKET_ISSUED','COMPLETED','REJECTED','CANCELLED','EXPIRED')),
 repository_revision bigint NOT NULL CHECK (repository_revision>0),
 ticket_generation bigint NOT NULL CHECK (ticket_generation>=0),
 created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
 registered_expires_at bigint NOT NULL CHECK (registered_expires_at BETWEEN created_at+1 AND 8640000000000000),
 verified_at bigint, approved_at bigint, expires_at bigint, completed_at bigint, terminal_at bigint,
 terminal_reason text CHECK (terminal_reason IN ('SOURCE_BLOCKED','USER_REQUEST','VERIFICATION_REJECTED','DEADLINE_REACHED','DELIVERY_FAILED','SECURITY_POLICY')),
 pre_notice_receipt_ref text CHECK (pre_notice_receipt_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
 delivery_receipt_ref text CHECK (delivery_receipt_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
 UNIQUE(environment_ref,approval_ref),
 CHECK (subject_user_id<>actor_user_id AND subject_user_id<>verifier_user_id AND actor_user_id<>verifier_user_id),
 CHECK ((intent='REPLACE_ACTIVE_PASSWORD' AND expected_credential_id IS NOT NULL AND security_clearance_ref IS NULL)
 OR (intent='REESTABLISH_REVOKED_PASSWORD' AND expected_credential_id IS NULL AND security_clearance_ref IS NOT NULL)),
 FOREIGN KEY (subject_user_id,expected_credential_id) REFERENCES zhiban_identity.credentials(user_id,credential_id) ON DELETE RESTRICT,
 FOREIGN KEY (enrollment_source_id,environment_ref,enrollment_kind,subject_user_id)
 REFERENCES zhiban_identity.identity_recovery_sources(source_id,environment_ref,source_kind,bound_user_id) ON DELETE RESTRICT,
 FOREIGN KEY (appointment_source_id,environment_ref,appointment_kind,verifier_user_id)
 REFERENCES zhiban_identity.identity_recovery_sources(source_id,environment_ref,source_kind,bound_user_id) ON DELETE RESTRICT,
 FOREIGN KEY (contact_source_id,environment_ref,contact_kind,subject_user_id)
 REFERENCES zhiban_identity.identity_recovery_sources(source_id,environment_ref,source_kind,bound_user_id) ON DELETE RESTRICT,
 CHECK ((verified_at IS NULL)=(expires_at IS NULL)),
 CHECK (verified_at IS NULL OR
 (verified_at BETWEEN created_at AND 8640000000000000-1800000 AND expires_at=verified_at+1800000)),
 CHECK (approved_at IS NULL OR (verified_at IS NOT NULL AND approved_at BETWEEN verified_at AND expires_at-1)),
 CHECK ((approval_manifest_digest IS NULL)=(approval_key_ref IS NULL)),
 CHECK (completed_at IS NULL OR (completed_at BETWEEN approved_at AND expires_at-1)),
 CHECK (terminal_at IS NULL OR terminal_at BETWEEN created_at AND 8640000000000000),
 CHECK ((state IN ('COMPLETED','REJECTED','CANCELLED','EXPIRED'))=(terminal_at IS NOT NULL)),
 CHECK ((state IN ('REJECTED','CANCELLED','EXPIRED'))=(terminal_reason IS NOT NULL)),
 CHECK ((state='COMPLETED')=(completed_at IS NOT NULL)),
 CHECK (state NOT IN ('VERIFIED','APPROVED','TICKET_ISSUED','COMPLETED') OR verified_at IS NOT NULL),
 CHECK (state NOT IN ('APPROVED','TICKET_ISSUED','COMPLETED') OR
 (approved_at IS NOT NULL AND approval_manifest_digest IS NOT NULL AND pre_notice_receipt_ref IS NOT NULL)),
 CHECK (state NOT IN ('TICKET_ISSUED','COMPLETED') OR (ticket_generation>0 AND delivery_receipt_ref IS NOT NULL))
);
CREATE TABLE zhiban_identity.identity_recovery_tickets (
 ticket_id uuid PRIMARY KEY CHECK (zhiban_identity.is_uuid_v7(ticket_id)),
 case_id uuid NOT NULL REFERENCES zhiban_identity.identity_recovery_cases ON DELETE RESTRICT,
 ticket_generation bigint NOT NULL CHECK (ticket_generation>0),
 ticket_digest text NOT NULL UNIQUE CHECK (ticket_digest ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK (state IN ('ACTIVE','CANCELLED','CONSUMED','EXPIRED')),
 attempts bigint NOT NULL CHECK (attempts BETWEEN 0 AND 5),
 created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
 expires_at bigint NOT NULL CHECK (expires_at BETWEEN 0 AND 8640000000000000 AND expires_at BETWEEN created_at+1 AND created_at+600000),
 terminal_at bigint CHECK (terminal_at BETWEEN created_at AND 8640000000000000),
 repository_revision bigint NOT NULL CHECK (repository_revision>0),
 CHECK ((state='ACTIVE')=(terminal_at IS NULL)),
 UNIQUE(case_id,ticket_id), UNIQUE(case_id,ticket_generation)
);
CREATE UNIQUE INDEX identity_recovery_live_ticket ON zhiban_identity.identity_recovery_tickets(case_id) WHERE state='ACTIVE';
CREATE TABLE zhiban_identity.identity_recovery_events (
 case_id uuid NOT NULL REFERENCES zhiban_identity.identity_recovery_cases ON DELETE RESTRICT,
 case_revision bigint NOT NULL CHECK (case_revision>0),
 event_id uuid NOT NULL UNIQUE CHECK (zhiban_identity.is_uuid_v7(event_id)),
 event_type text NOT NULL CHECK (event_type IN ('REGISTERED','VERIFIED','APPROVED','TICKET_ISSUED','TICKET_REISSUED','COMPLETED','REJECTED','CANCELLED','EXPIRED')),
 occurred_at bigint NOT NULL CHECK (occurred_at BETWEEN 0 AND 8640000000000000),
 actor_user_id uuid REFERENCES zhiban_identity.users ON DELETE RESTRICT,
 service_code text CHECK (service_code='recovery_source_block'),
 request_id text NOT NULL CHECK (request_id ~ '^[A-Za-z0-9._:-]{1,128}$'),
 ticket_id uuid, source_id uuid REFERENCES zhiban_identity.identity_recovery_sources ON DELETE RESTRICT,
 receipt_ref text CHECK (receipt_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
 CHECK ((actor_user_id IS NULL)<>(service_code IS NULL)),
 FOREIGN KEY (case_id,ticket_id) REFERENCES zhiban_identity.identity_recovery_tickets(case_id,ticket_id) ON DELETE RESTRICT,
 PRIMARY KEY(case_id,case_revision)
);
CREATE TABLE zhiban_identity.identity_recovery_outcomes (
 case_id uuid PRIMARY KEY REFERENCES zhiban_identity.identity_recovery_cases ON DELETE RESTRICT,
 command_id uuid NOT NULL UNIQUE CHECK (zhiban_identity.is_uuid_v7(command_id)),
 ticket_id uuid NOT NULL UNIQUE,
 completed_case_revision bigint NOT NULL CHECK (completed_case_revision>0),
 ticket_generation bigint NOT NULL CHECK (ticket_generation>0),
 actor_user_id uuid NOT NULL REFERENCES zhiban_identity.users ON DELETE RESTRICT,
 subject_user_id uuid NOT NULL REFERENCES zhiban_identity.users ON DELETE RESTRICT,
 prior_credential_id uuid, credential_id uuid NOT NULL,
 generation_before bigint NOT NULL CHECK (generation_before>0),
 generation_after bigint NOT NULL CHECK (generation_after=generation_before+1),
 slot_revision_before bigint NOT NULL CHECK (slot_revision_before>0),
 slot_revision_after bigint NOT NULL CHECK (slot_revision_after=slot_revision_before+1),
 security_epoch_before bigint NOT NULL CHECK (security_epoch_before>0),
 security_epoch_after bigint NOT NULL CHECK (security_epoch_after=security_epoch_before+1),
 credential_event_id bigint NOT NULL UNIQUE REFERENCES zhiban_identity.audit_events ON DELETE RESTRICT,
 completed_at bigint NOT NULL CHECK (completed_at BETWEEN 0 AND 8640000000000000),
 FOREIGN KEY (subject_user_id,prior_credential_id) REFERENCES zhiban_identity.credentials(user_id,credential_id) ON DELETE RESTRICT,
 FOREIGN KEY (subject_user_id,credential_id) REFERENCES zhiban_identity.credentials(user_id,credential_id) ON DELETE RESTRICT,
 FOREIGN KEY (case_id,ticket_id) REFERENCES zhiban_identity.identity_recovery_tickets(case_id,ticket_id) ON DELETE RESTRICT
);
CREATE TABLE zhiban_identity.identity_recovery_notifications (
 case_id uuid NOT NULL REFERENCES zhiban_identity.identity_recovery_cases ON DELETE RESTRICT,
 notice_kind text NOT NULL CHECK (notice_kind IN ('PRE_RESET','COMPLETED')),
 route_source_id uuid NOT NULL REFERENCES zhiban_identity.identity_recovery_sources ON DELETE RESTRICT,
 route_source_revision bigint NOT NULL CHECK (route_source_revision>0),
 verifier_user_id uuid NOT NULL REFERENCES zhiban_identity.users ON DELETE RESTRICT,
 state text NOT NULL CHECK (state IN ('PENDING','ACKNOWLEDGED')),
 created_at bigint NOT NULL CHECK (created_at BETWEEN 0 AND 8640000000000000),
 due_at bigint NOT NULL CHECK (due_at BETWEEN 0 AND 8640000000000000 AND due_at BETWEEN created_at+1 AND created_at+86400000),
 acknowledged_at bigint CHECK (acknowledged_at BETWEEN created_at AND 8640000000000000),
 receipt_ref text CHECK (receipt_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
 repository_revision bigint NOT NULL CHECK (repository_revision>0),
 CHECK ((state='ACKNOWLEDGED' AND acknowledged_at IS NOT NULL AND receipt_ref IS NOT NULL)
 OR (state='PENDING' AND acknowledged_at IS NULL AND receipt_ref IS NULL)),
 CHECK (notice_kind<>'PRE_RESET' OR state='ACKNOWLEDGED'),
 PRIMARY KEY(case_id,notice_kind)
);
CREATE TABLE zhiban_identity.identity_recovery_admission_buckets (
 environment_ref text NOT NULL REFERENCES zhiban_identity.identity_recovery_policy ON DELETE RESTRICT,
 phase text NOT NULL CHECK (phase IN ('REGISTER','ISSUE','SUBMIT','COMPLETE','READ','ACK')),
 dimension text NOT NULL CHECK (dimension IN ('GLOBAL','SITE','SUBJECT')),
 key_hmac text NOT NULL CHECK (key_hmac ~ '^[a-f0-9]{64}$'),
 window_start bigint NOT NULL CHECK (window_start BETWEEN 0 AND 8640000000000000),
 used integer NOT NULL CHECK (used BETWEEN 1 AND 1000000),
 expires_at bigint NOT NULL CHECK (expires_at BETWEEN window_start+1 AND 8640000000000000),
 PRIMARY KEY(environment_ref,phase,dimension,key_hmac,window_start)
);
CREATE INDEX identity_recovery_case_deadline ON zhiban_identity.identity_recovery_cases(environment_ref,state,expires_at);
CREATE INDEX identity_recovery_case_subject ON zhiban_identity.identity_recovery_cases(subject_user_id,state);
CREATE INDEX identity_recovery_case_enrollment ON zhiban_identity.identity_recovery_cases(enrollment_source_id,state);
CREATE INDEX identity_recovery_case_appointment ON zhiban_identity.identity_recovery_cases(appointment_source_id,state);
CREATE INDEX identity_recovery_case_contact ON zhiban_identity.identity_recovery_cases(contact_source_id,state);
CREATE INDEX identity_recovery_notice_due ON zhiban_identity.identity_recovery_notifications(state,due_at,case_id);
CREATE INDEX identity_recovery_bucket_expiry ON zhiban_identity.identity_recovery_admission_buckets(expires_at);

CREATE FUNCTION zhiban_identity.identity_recovery_gate(p_environment text,p_policy_digest text)
RETURNS TABLE(policy_revision bigint,enabled boolean,checked_at bigint)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE p zhiban_identity.identity_recovery_policy%ROWTYPE;
BEGIN
 IF session_user NOT IN ('zhiban_auth_runtime','zhiban_control_runtime') OR p_environment IS NULL
 OR p_policy_digest IS NULL THEN RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO p FROM zhiban_identity.identity_recovery_policy WHERE environment_ref=p_environment FOR UPDATE NOWAIT;
 IF NOT FOUND OR p.policy_digest IS DISTINCT FROM p_policy_digest
 OR floor(extract(epoch FROM clock_timestamp())*1000)::bigint<p.updated_at THEN
 RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
 RETURN QUERY SELECT p.repository_revision,p.enabled,floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
END $$;

CREATE FUNCTION zhiban_identity.identity_recovery_user_locks(p_case_id uuid,p_session_digest text,p_source_ids uuid[])
RETURNS TABLE(user_id uuid,user_revision bigint)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE c zhiban_identity.identity_recovery_cases%ROWTYPE;
 e zhiban_identity.identity_recovery_sources%ROWTYPE; a zhiban_identity.identity_recovery_sources%ROWTYPE;
 n zhiban_identity.identity_recovery_sources%ROWTYPE; actor uuid; u uuid; r bigint; st text; at_time bigint; pd text;
BEGIN
 IF session_user<>'zhiban_auth_runtime' OR p_case_id IS NULL OR p_session_digest IS NULL
 OR p_session_digest !~ '^[a-f0-9]{64}$' OR array_ndims(p_source_ids) IS DISTINCT FROM 1
 OR array_length(p_source_ids,1) IS DISTINCT FROM 3 OR array_lower(p_source_ids,1)<>1 THEN
 RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM zhiban_identity.identity_recovery_sources WHERE source_id=p_source_ids[1];
 SELECT * INTO a FROM zhiban_identity.identity_recovery_sources WHERE source_id=p_source_ids[2];
 SELECT * INTO n FROM zhiban_identity.identity_recovery_sources WHERE source_id=p_source_ids[3];
 IF e.source_kind IS DISTINCT FROM 'ENROLLMENT' OR a.source_kind IS DISTINCT FROM 'APPOINTMENT'
 OR n.source_kind IS DISTINCT FROM 'CONTACT' OR e.environment_ref IS DISTINCT FROM a.environment_ref
 OR e.environment_ref IS DISTINCT FROM n.environment_ref OR e.bound_user_id IS DISTINCT FROM n.bound_user_id THEN
 RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
 SELECT policy_digest INTO pd FROM zhiban_identity.identity_recovery_policy WHERE environment_ref=e.environment_ref;
 PERFORM zhiban_identity.identity_recovery_gate(e.environment_ref,pd);
 IF NOT (SELECT enabled FROM zhiban_identity.identity_recovery_policy WHERE environment_ref=e.environment_ref) THEN
 RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
 at_time:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF EXISTS(SELECT 1 FROM zhiban_identity.identity_recovery_sources WHERE source_id=ANY(p_source_ids)
 AND (state<>'CURRENT' OR at_time<attested_at OR at_time>=valid_until)) THEN
 RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
 SELECT s.user_id INTO actor FROM zhiban_identity.sessions s WHERE s.token_digest=p_session_digest;
 SELECT * INTO c FROM zhiban_identity.identity_recovery_cases WHERE case_id=p_case_id;
 IF actor IS NULL OR actor=e.bound_user_id OR actor=a.bound_user_id OR e.bound_user_id=a.bound_user_id
 OR (c.case_id IS NOT NULL AND (c.actor_user_id<>actor OR c.subject_user_id<>e.bound_user_id
 OR c.verifier_user_id<>a.bound_user_id OR ARRAY[c.enrollment_source_id,c.appointment_source_id,c.contact_source_id]<>p_source_ids
 OR c.state NOT IN ('REGISTERED','VERIFIED','APPROVED','TICKET_ISSUED'))) THEN
 RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
 FOR u IN SELECT x FROM unnest(ARRAY[e.bound_user_id,a.bound_user_id,actor]) x ORDER BY x LOOP
  IF u=e.bound_user_id THEN
   SELECT repository_revision,status INTO r,st FROM zhiban_identity.users WHERE users.user_id=u FOR UPDATE NOWAIT;
  ELSE
   SELECT repository_revision,status INTO r,st FROM zhiban_identity.users WHERE users.user_id=u FOR SHARE NOWAIT;
  END IF;
  IF NOT FOUND OR st<>'ACTIVE' THEN RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
  user_id:=u; user_revision:=r; RETURN NEXT;
 END LOOP;
 -- A separate statement after the strong User lock excludes FK INSERT phantoms.
 IF EXISTS(SELECT 1 FROM zhiban_identity.system_admin_grants g WHERE g.user_id=e.bound_user_id) THEN
 RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
END $$;

CREATE FUNCTION zhiban_identity.identity_recovery_actor_guard(p_case_id uuid,p_session_digest text,p_mode text)
RETURNS TABLE(actor_user_id uuid,actor_user_revision bigint,actor_slot_revision bigint,actor_security_epoch bigint,
 admin_grant_revision bigint,absolute_expires_at bigint,idle_expires_at bigint,grant_valid_until bigint)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE c zhiban_identity.identity_recovery_cases%ROWTYPE; s zhiban_identity.sessions%ROWTYPE;
 slot zhiban_identity.credential_slots%ROWTYPE; target zhiban_identity.credential_slots%ROWTYPE;
 g zhiban_identity.system_admin_grants%ROWTYPE; ur bigint; st text; at_time bigint; u uuid; pd text;
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
 RETURN QUERY SELECT c.actor_user_id,ur,slot.repository_revision,slot.security_epoch,g.repository_revision,
 s.absolute_expires_at,s.idle_expires_at,g.valid_until;
END $$;


CREATE FUNCTION zhiban_identity.identity_recovery_transition_guard()
RETURNS trigger LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE allowed text[]; p zhiban_identity.identity_recovery_policy%ROWTYPE; env text; at_time bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Immutable recovery history' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='identity_recovery_policy' THEN
  IF TG_OP='INSERT' THEN
   IF NEW.enabled OR NEW.repository_revision<>1 THEN RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
  ELSE
   IF (to_jsonb(NEW)-ARRAY['enabled','repository_revision','updated_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['enabled','repository_revision','updated_at'])
   OR NEW.repository_revision<>OLD.repository_revision+1 OR NEW.updated_at<OLD.updated_at THEN
   RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME IN ('identity_recovery_events','identity_recovery_outcomes') THEN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Immutable recovery history' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.repository_revision<>1 THEN RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='identity_recovery_sources' THEN
   IF NEW.state<>'CURRENT' OR EXISTS(SELECT 1 FROM zhiban_identity.identity_recovery_sources s
    WHERE s.environment_ref=NEW.environment_ref AND s.source_kind=NEW.source_kind AND s.source_ref=NEW.source_ref
    AND (s.state='CURRENT' OR s.source_version>=NEW.source_version)) THEN
    RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='identity_recovery_cases' THEN
   IF NEW.state<>'REGISTERED' OR NEW.ticket_generation<>0 OR NEW.verified_at IS NOT NULL
    OR NEW.approved_at IS NOT NULL OR NEW.approval_manifest_digest IS NOT NULL THEN
    RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='identity_recovery_tickets' THEN
   IF NEW.state<>'ACTIVE' OR NEW.attempts<>0 THEN
    RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF NEW.repository_revision<>OLD.repository_revision+1 THEN
   RAISE EXCEPTION 'Recovery stale' USING ERRCODE='23514'; END IF;
  CASE TG_TABLE_NAME
  WHEN 'identity_recovery_sources' THEN
   allowed:=ARRAY['state','repository_revision','updated_at','blocked_at'];
   IF OLD.state<>'CURRENT' OR NEW.state<>'BLOCKED' OR NEW.updated_at<OLD.updated_at THEN
   RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
  WHEN 'identity_recovery_cases' THEN
   allowed:=ARRAY['state','repository_revision','terminal_at','terminal_reason'];
   IF OLD.state='REGISTERED' AND NEW.state='VERIFIED' THEN allowed:=allowed||ARRAY['verified_at','expires_at']; END IF;
   IF OLD.state='VERIFIED' AND NEW.state='APPROVED' THEN
    allowed:=allowed||ARRAY['approved_at','pre_notice_receipt_ref','approval_manifest_digest','approval_key_ref']; END IF;
   IF NEW.state='TICKET_ISSUED' THEN allowed:=allowed||ARRAY['ticket_generation','delivery_receipt_ref']; END IF;
   IF NEW.state='COMPLETED' THEN allowed:=allowed||ARRAY['completed_at']; END IF;
   IF OLD.state IN ('COMPLETED','CANCELLED','EXPIRED','REJECTED') OR NOT (
    (OLD.state='REGISTERED' AND NEW.state='VERIFIED') OR (OLD.state='VERIFIED' AND NEW.state='APPROVED')
    OR (OLD.state='APPROVED' AND NEW.state='TICKET_ISSUED')
    OR (OLD.state='TICKET_ISSUED' AND NEW.state IN ('TICKET_ISSUED','COMPLETED'))
    OR NEW.state IN ('CANCELLED','EXPIRED','REJECTED'))
    OR (OLD.verified_at IS NOT NULL AND (NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at))
    OR (OLD.approved_at IS NOT NULL AND (NEW.approved_at IS DISTINCT FROM OLD.approved_at
      OR NEW.approval_manifest_digest IS DISTINCT FROM OLD.approval_manifest_digest OR NEW.approval_key_ref IS DISTINCT FROM OLD.approval_key_ref
      OR NEW.pre_notice_receipt_ref IS DISTINCT FROM OLD.pre_notice_receipt_ref))
    OR NEW.ticket_generation<>OLD.ticket_generation+(CASE WHEN NEW.state='TICKET_ISSUED' THEN 1 ELSE 0 END) THEN
   RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
  WHEN 'identity_recovery_tickets' THEN
   allowed:=ARRAY['state','attempts','terminal_at','repository_revision'];
   IF OLD.state<>'ACTIVE' OR NEW.attempts<OLD.attempts OR NEW.attempts>OLD.attempts+1
   OR (NEW.state='ACTIVE' AND NEW.attempts<>OLD.attempts+1)
   OR (NEW.state<>'ACTIVE' AND NEW.attempts<>OLD.attempts) THEN
   RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
  WHEN 'identity_recovery_notifications' THEN
   allowed:=ARRAY['state','acknowledged_at','receipt_ref','repository_revision'];
   IF OLD.state<>'PENDING' OR NEW.state<>'ACKNOWLEDGED' THEN
   RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
  ELSE RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514';
  END CASE;
  IF (to_jsonb(NEW)-allowed) IS DISTINCT FROM (to_jsonb(OLD)-allowed) THEN
  RAISE EXCEPTION 'Immutable recovery binding' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME IN ('identity_recovery_sources','identity_recovery_cases') THEN env:=NEW.environment_ref;
 ELSE SELECT environment_ref INTO env FROM zhiban_identity.identity_recovery_cases WHERE case_id=NEW.case_id; END IF;
 SELECT * INTO p FROM zhiban_identity.identity_recovery_policy WHERE environment_ref=env FOR UPDATE NOWAIT;
 at_time:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF TG_TABLE_NAME='identity_recovery_cases' AND NEW.state IN ('REGISTERED','VERIFIED','APPROVED','TICKET_ISSUED','COMPLETED') THEN
  IF NOT p.enabled OR at_time<NEW.created_at
  OR (NEW.state='REGISTERED' AND (NEW.registered_expires_at<>NEW.created_at+p.registered_ttl_ms
    OR (SELECT count(*) FROM zhiban_identity.identity_recovery_cases WHERE environment_ref=env)>=p.max_total_cases
    OR (SELECT count(*) FROM zhiban_identity.identity_recovery_cases WHERE subject_user_id=NEW.subject_user_id
       AND state='REGISTERED' AND registered_expires_at>at_time)>=p.max_registered_per_subject))
  OR (NEW.state IN ('VERIFIED','APPROVED','TICKET_ISSUED','COMPLETED') AND at_time>=NEW.expires_at)
  OR (TG_OP='INSERT' AND (SELECT count(*) FROM zhiban_identity.identity_recovery_cases WHERE environment_ref=env
    AND ((state='REGISTERED' AND registered_expires_at>at_time) OR
    (state IN ('VERIFIED','APPROVED','TICKET_ISSUED') AND expires_at>at_time)))>=p.max_live_cases)
  OR (SELECT count(*) FROM zhiban_identity.identity_recovery_notifications n
     JOIN zhiban_identity.identity_recovery_cases c ON c.case_id=n.case_id
     WHERE c.environment_ref=env AND n.state='PENDING')>=p.max_pending_notifications
  OR EXISTS(SELECT 1 FROM zhiban_identity.identity_recovery_notifications n
     JOIN zhiban_identity.identity_recovery_cases c ON c.case_id=n.case_id
     WHERE c.environment_ref=env AND n.state='PENDING' AND n.due_at<=at_time) THEN
  RAISE EXCEPTION 'Recovery unavailable' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION zhiban_identity.identity_recovery_consistency()
RETURNS trigger LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE c zhiban_identity.identity_recovery_cases%ROWTYPE; o zhiban_identity.identity_recovery_outcomes%ROWTYPE;
 t zhiban_identity.identity_recovery_tickets%ROWTYPE; cr zhiban_identity.credentials%ROWTYPE; a zhiban_identity.audit_events%ROWTYPE;
 cid uuid; newly_completed boolean; at_time bigint;
BEGIN
 IF TG_TABLE_NAME='identity_recovery_sources' THEN
  IF NEW.state='BLOCKED' AND EXISTS(SELECT 1 FROM zhiban_identity.identity_recovery_cases q
    WHERE NEW.source_id IN(q.enrollment_source_id,q.appointment_source_id,q.contact_source_id)
    AND ((q.state='REGISTERED' AND q.registered_expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint)
    OR(q.state IN('VERIFIED','APPROVED','TICKET_ISSUED') AND q.expires_at>floor(extract(epoch FROM clock_timestamp())*1000)::bigint))) THEN
   RAISE EXCEPTION 'Recovery source revocation incomplete' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 cid:=NEW.case_id;
 SELECT * INTO c FROM zhiban_identity.identity_recovery_cases WHERE case_id=cid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM zhiban_identity.identity_recovery_events WHERE case_id=cid)<>c.repository_revision
 OR (SELECT max(case_revision) FROM zhiban_identity.identity_recovery_events WHERE case_id=cid) IS DISTINCT FROM c.repository_revision
 OR NOT EXISTS(SELECT 1 FROM zhiban_identity.identity_recovery_events
   WHERE case_id=cid AND case_revision=c.repository_revision
   AND event_type=(CASE WHEN c.state='TICKET_ISSUED' AND c.ticket_generation>1 THEN 'TICKET_REISSUED' ELSE c.state END))
 OR NOT EXISTS(SELECT 1 FROM zhiban_identity.system_admin_grants g WHERE g.grant_id=c.actor_admin_grant_id AND g.user_id=c.actor_user_id) THEN
 RAISE EXCEPTION 'Recovery provenance mismatch' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM zhiban_identity.identity_recovery_events e WHERE e.case_id=cid
  AND (e.occurred_at<c.created_at OR (e.actor_user_id IS NOT NULL AND e.actor_user_id<>c.actor_user_id)
  OR (e.service_code IS NOT NULL AND (e.event_type<>'CANCELLED' OR e.source_id IS NULL
   OR e.source_id NOT IN(c.enrollment_source_id,c.appointment_source_id,c.contact_source_id))))) THEN
 RAISE EXCEPTION 'Recovery provenance mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO t FROM zhiban_identity.identity_recovery_tickets WHERE case_id=cid AND state='ACTIVE';
 IF (c.state='TICKET_ISSUED') IS DISTINCT FROM (t.ticket_id IS NOT NULL)
 OR (t.ticket_id IS NOT NULL AND (t.ticket_generation<>c.ticket_generation OR t.expires_at>c.expires_at))
 OR (c.state IN('APPROVED','TICKET_ISSUED','COMPLETED') AND NOT EXISTS(
 SELECT 1 FROM zhiban_identity.identity_recovery_notifications n WHERE n.case_id=cid AND notice_kind='PRE_RESET'
 AND n.state='ACKNOWLEDGED' AND n.receipt_ref=c.pre_notice_receipt_ref))
 OR EXISTS(SELECT 1 FROM zhiban_identity.identity_recovery_notifications n WHERE n.case_id=cid
 AND (n.route_source_id<>c.contact_source_id OR n.route_source_revision<>c.expected_contact_source_revision
 OR n.verifier_user_id<>c.verifier_user_id)) THEN
 RAISE EXCEPTION 'Recovery ticket/notice mismatch' USING ERRCODE='23514'; END IF;
 SELECT * INTO o FROM zhiban_identity.identity_recovery_outcomes WHERE case_id=cid;
 IF (c.state='COMPLETED') IS DISTINCT FROM (o.case_id IS NOT NULL) THEN
 RAISE EXCEPTION 'Recovery outcome mismatch' USING ERRCODE='23514'; END IF;
 IF c.state='COMPLETED' THEN
  SELECT * INTO t FROM zhiban_identity.identity_recovery_tickets WHERE ticket_id=o.ticket_id;
  SELECT * INTO cr FROM zhiban_identity.credentials WHERE credential_id=o.credential_id;
  SELECT * INTO a FROM zhiban_identity.audit_events WHERE event_id=o.credential_event_id;
  IF o.completed_case_revision<>c.repository_revision OR o.ticket_generation<>c.ticket_generation
  OR o.actor_user_id<>c.actor_user_id OR o.subject_user_id<>c.subject_user_id OR o.completed_at<>c.completed_at
  OR o.slot_revision_before<>c.expected_slot_revision OR o.security_epoch_before<>c.expected_security_epoch
  OR o.generation_before<>c.expected_generation OR o.prior_credential_id IS DISTINCT FROM c.expected_credential_id
  OR t.state IS DISTINCT FROM 'CONSUMED' OR t.terminal_at<>o.completed_at
  OR cr.user_id IS DISTINCT FROM o.subject_user_id OR cr.generation IS DISTINCT FROM o.generation_after
  OR cr.created_at IS DISTINCT FROM o.completed_at OR cr.slot_revision<o.slot_revision_after
  OR a.event_type IS DISTINCT FROM 'CREDENTIAL_REPLACED' OR a.reason IS DISTINCT FROM 'ACCOUNT_RECOVERY'
  OR a.actor_user_id IS DISTINCT FROM o.actor_user_id OR a.subject_user_id IS DISTINCT FROM o.subject_user_id
  OR a.occurred_at IS DISTINCT FROM o.completed_at
  OR a.event_payload IS DISTINCT FROM jsonb_build_object('priorCredentialId',o.prior_credential_id,'credentialId',o.credential_id,
    'repositoryRevisionBefore',o.slot_revision_before::text,'repositoryRevisionAfter',o.slot_revision_after::text,
    'securityEpochBefore',o.security_epoch_before::text,'securityEpochAfter',o.security_epoch_after::text)
  OR NOT EXISTS(SELECT 1 FROM zhiban_identity.identity_recovery_notifications WHERE case_id=cid AND notice_kind='COMPLETED')
  OR (o.prior_credential_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM zhiban_identity.credentials
    WHERE credential_id=o.prior_credential_id AND status='REPLACED' AND replaced_by_credential_id=o.credential_id)) THEN
  RAISE EXCEPTION 'Recovery completion mismatch' USING ERRCODE='23514'; END IF;
  newly_completed:=false;
  IF TG_TABLE_NAME='identity_recovery_cases' AND TG_OP='UPDATE' THEN
   newly_completed:=OLD.state<>'COMPLETED';
  END IF;
  IF newly_completed THEN
   at_time:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
   IF at_time>=c.expires_at OR at_time>=t.expires_at OR cr.status<>'ACTIVE'
   OR NOT EXISTS(SELECT 1 FROM zhiban_identity.credential_slots s WHERE s.user_id=o.subject_user_id
   AND s.active_credential_id=o.credential_id AND s.repository_revision=o.slot_revision_after
   AND s.security_epoch=o.security_epoch_after AND s.generation=o.generation_after)
   OR NOT EXISTS(SELECT 1 FROM zhiban_identity.identity_recovery_notifications WHERE case_id=cid AND notice_kind='COMPLETED' AND state='PENDING') THEN
   RAISE EXCEPTION 'Recovery completion mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NULL;
END $$;

CREATE FUNCTION zhiban_identity.identity_recovery_source_block(p_source_id uuid,p_expected_revision bigint,p_request_id text,p_event_ids uuid[])
RETURNS void LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE s zhiban_identity.identity_recovery_sources%ROWTYPE; c record; pd text; at_time bigint; cap integer; event_index integer:=0;
BEGIN
 IF session_user<>'zhiban_control_runtime' OR p_source_id IS NULL OR p_expected_revision IS NULL OR p_expected_revision<1
 OR p_request_id IS NULL OR p_request_id !~ '^[A-Za-z0-9._:-]{1,128}$'
 OR p_event_ids IS NULL OR cardinality(p_event_ids)>256
 OR (cardinality(p_event_ids)>0 AND (array_ndims(p_event_ids) IS DISTINCT FROM 1 OR array_lower(p_event_ids,1)<>1))
 OR EXISTS(SELECT 1 FROM unnest(p_event_ids) e WHERE e IS NULL OR NOT zhiban_identity.is_uuid_v7(e))
 OR cardinality(p_event_ids)<>(SELECT count(DISTINCT e) FROM unnest(p_event_ids) e) THEN
 RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO s FROM zhiban_identity.identity_recovery_sources WHERE source_id=p_source_id;
 SELECT policy_digest,max_live_cases INTO pd,cap FROM zhiban_identity.identity_recovery_policy WHERE environment_ref=s.environment_ref;
 PERFORM zhiban_identity.identity_recovery_gate(s.environment_ref,pd);
 SELECT * INTO s FROM zhiban_identity.identity_recovery_sources WHERE source_id=p_source_id FOR UPDATE NOWAIT;
 IF s.repository_revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Recovery stale' USING ERRCODE='23514'; END IF;
 IF s.state='BLOCKED' THEN RETURN; END IF;
 at_time:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF (SELECT count(*) FROM zhiban_identity.identity_recovery_cases q
 WHERE p_source_id IN(q.enrollment_source_id,q.appointment_source_id,q.contact_source_id)
 AND ((q.state='REGISTERED' AND q.registered_expires_at>at_time)
 OR(q.state IN('VERIFIED','APPROVED','TICKET_ISSUED') AND q.expires_at>at_time)))>cap THEN
 RAISE EXCEPTION 'Recovery unavailable' USING ERRCODE='23514'; END IF;
 UPDATE zhiban_identity.identity_recovery_sources SET state='BLOCKED',blocked_at=at_time,updated_at=at_time,
 repository_revision=repository_revision+1 WHERE source_id=p_source_id;
 FOR c IN SELECT * FROM zhiban_identity.identity_recovery_cases q
 WHERE p_source_id IN(q.enrollment_source_id,q.appointment_source_id,q.contact_source_id)
 AND ((q.state='REGISTERED' AND q.registered_expires_at>at_time)
 OR(q.state IN('VERIFIED','APPROVED','TICKET_ISSUED') AND q.expires_at>at_time))
 ORDER BY case_id FOR UPDATE NOWAIT LOOP
 UPDATE zhiban_identity.identity_recovery_tickets SET state='CANCELLED',terminal_at=at_time,repository_revision=repository_revision+1
 WHERE case_id=c.case_id AND state='ACTIVE';
 UPDATE zhiban_identity.identity_recovery_cases SET state='CANCELLED',terminal_at=at_time,terminal_reason='SOURCE_BLOCKED',
 repository_revision=repository_revision+1 WHERE case_id=c.case_id;
 event_index:=event_index+1;
 IF event_index>cardinality(p_event_ids) THEN RAISE EXCEPTION 'Recovery event capacity rejected' USING ERRCODE='23514'; END IF;
 INSERT INTO zhiban_identity.identity_recovery_events
 (case_id,case_revision,event_id,event_type,occurred_at,service_code,request_id,source_id)
 VALUES(c.case_id,c.repository_revision+1,p_event_ids[event_index],
 'CANCELLED',at_time,'recovery_source_block',p_request_id,p_source_id);
 END LOOP;
END $$;

CREATE FUNCTION zhiban_identity.identity_recovery_reserve(p_environment text,p_policy_digest text,p_phase text,p_keys text[])
RETURNS boolean LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE p zhiban_identity.identity_recovery_policy%ROWTYPE; at_time bigint; ws bigint; i integer; used_count integer; cap integer;
 dims text[]:=ARRAY['GLOBAL','SITE','SUBJECT'];
BEGIN
 IF session_user<>'zhiban_auth_runtime' OR p_phase IS NULL OR p_phase NOT IN('REGISTER','ISSUE','SUBMIT','COMPLETE','READ','ACK')
 OR array_ndims(p_keys) IS DISTINCT FROM 1 OR array_length(p_keys,1) IS DISTINCT FROM 3
 OR array_lower(p_keys,1)<>1 OR EXISTS(SELECT 1 FROM unnest(p_keys) k WHERE k IS NULL OR k !~ '^[a-f0-9]{64}$') THEN
 RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='42501'; END IF;
 PERFORM zhiban_identity.identity_recovery_gate(p_environment,p_policy_digest);
 SELECT * INTO p FROM zhiban_identity.identity_recovery_policy WHERE environment_ref=p_environment;
 at_time:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint; ws:=at_time-(at_time%p.window_ms);
 IF at_time<p.updated_at OR (NOT p.enabled AND p_phase NOT IN('READ','ACK')) THEN RETURN false; END IF;
 IF (SELECT count(*) FROM zhiban_identity.identity_recovery_admission_buckets WHERE environment_ref=p_environment)
 +(SELECT count(*) FROM generate_series(1,3) j WHERE NOT EXISTS(
 SELECT 1 FROM zhiban_identity.identity_recovery_admission_buckets b WHERE b.environment_ref=p_environment
 AND b.phase=p_phase AND b.dimension=dims[j] AND b.key_hmac=p_keys[j] AND b.window_start=ws))>p.max_buckets THEN RETURN false; END IF;
 FOR i IN 1..3 LOOP
 cap:=CASE i WHEN 1 THEN p.global_limit WHEN 2 THEN p.site_limit ELSE p.subject_limit END;
 SELECT used INTO used_count FROM zhiban_identity.identity_recovery_admission_buckets b WHERE b.environment_ref=p_environment
 AND b.phase=p_phase AND b.dimension=dims[i] AND b.key_hmac=p_keys[i] AND b.window_start=ws;
 IF coalesce(used_count,0)>=cap THEN RETURN false; END IF;
 END LOOP;
 FOR i IN 1..3 LOOP
 INSERT INTO zhiban_identity.identity_recovery_admission_buckets VALUES(p_environment,p_phase,dims[i],p_keys[i],ws,1,ws+p.window_ms)
 ON CONFLICT(environment_ref,phase,dimension,key_hmac,window_start) DO UPDATE SET used=identity_recovery_admission_buckets.used+1;
 END LOOP;
 RETURN true;
END $$;
CREATE FUNCTION zhiban_identity.identity_recovery_prune(p_environment text,p_policy_digest text,p_limit integer)
RETURNS integer LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE affected integer;
BEGIN
 IF session_user<>'zhiban_auth_runtime' OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
 RAISE EXCEPTION 'Recovery rejected' USING ERRCODE='42501'; END IF;
 PERFORM zhiban_identity.identity_recovery_gate(p_environment,p_policy_digest);
 DELETE FROM zhiban_identity.identity_recovery_admission_buckets WHERE ctid IN(
 SELECT ctid FROM zhiban_identity.identity_recovery_admission_buckets WHERE environment_ref=p_environment
 AND expires_at<=floor(extract(epoch FROM clock_timestamp())*1000)::bigint ORDER BY expires_at LIMIT p_limit);
 GET DIAGNOSTICS affected=ROW_COUNT; RETURN affected;
END $$;

CREATE POLICY audit_recovery_owner_read ON zhiban_identity.audit_events FOR SELECT TO zhiban_identity_owner
USING (event_scope='GLOBAL' AND event_type='CREDENTIAL_REPLACED' AND reason='ACCOUNT_RECOVERY' AND actor_type='USER'
 AND EXISTS(SELECT 1 FROM zhiban_identity.identity_recovery_outcomes o WHERE o.credential_event_id=audit_events.event_id
 AND o.actor_user_id=audit_events.actor_user_id AND o.subject_user_id=audit_events.subject_user_id AND o.completed_at=audit_events.occurred_at));
CREATE TRIGGER identity_recovery_policy_guard BEFORE INSERT OR UPDATE OR DELETE ON zhiban_identity.identity_recovery_policy
FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_recovery_transition_guard();
CREATE TRIGGER identity_recovery_sources_guard BEFORE INSERT OR UPDATE OR DELETE ON zhiban_identity.identity_recovery_sources
FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_recovery_transition_guard();
CREATE TRIGGER identity_recovery_cases_guard BEFORE INSERT OR UPDATE OR DELETE ON zhiban_identity.identity_recovery_cases
FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_recovery_transition_guard();
CREATE TRIGGER identity_recovery_tickets_guard BEFORE INSERT OR UPDATE OR DELETE ON zhiban_identity.identity_recovery_tickets
FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_recovery_transition_guard();
CREATE TRIGGER identity_recovery_events_guard BEFORE INSERT OR UPDATE OR DELETE ON zhiban_identity.identity_recovery_events
FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_recovery_transition_guard();
CREATE TRIGGER identity_recovery_outcomes_guard BEFORE INSERT OR UPDATE OR DELETE ON zhiban_identity.identity_recovery_outcomes
FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_recovery_transition_guard();
CREATE TRIGGER identity_recovery_notifications_guard BEFORE INSERT OR UPDATE OR DELETE ON zhiban_identity.identity_recovery_notifications
FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_recovery_transition_guard();
CREATE CONSTRAINT TRIGGER identity_recovery_sources_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_recovery_sources
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_recovery_consistency();
CREATE CONSTRAINT TRIGGER identity_recovery_cases_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_recovery_cases
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_recovery_consistency();
CREATE CONSTRAINT TRIGGER identity_recovery_tickets_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_recovery_tickets
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_recovery_consistency();
CREATE CONSTRAINT TRIGGER identity_recovery_events_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_recovery_events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_recovery_consistency();
CREATE CONSTRAINT TRIGGER identity_recovery_outcomes_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_recovery_outcomes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_recovery_consistency();
CREATE CONSTRAINT TRIGGER identity_recovery_notifications_consistency AFTER INSERT OR UPDATE ON zhiban_identity.identity_recovery_notifications
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_identity.identity_recovery_consistency();
REVOKE ALL ON zhiban_identity.identity_recovery_policy,zhiban_identity.identity_recovery_sources,zhiban_identity.identity_recovery_cases,zhiban_identity.identity_recovery_tickets,zhiban_identity.identity_recovery_events,zhiban_identity.identity_recovery_outcomes,zhiban_identity.identity_recovery_notifications,zhiban_identity.identity_recovery_admission_buckets FROM PUBLIC,zhiban_runtime,zhiban_control_runtime,zhiban_auth_runtime;
GRANT SELECT ON zhiban_identity.identity_recovery_policy,zhiban_identity.identity_recovery_sources,zhiban_identity.identity_recovery_cases,zhiban_identity.identity_recovery_tickets,zhiban_identity.identity_recovery_events,zhiban_identity.identity_recovery_outcomes,zhiban_identity.identity_recovery_notifications TO zhiban_auth_runtime;
GRANT SELECT ON zhiban_identity.identity_recovery_policy,zhiban_identity.identity_recovery_sources TO zhiban_control_runtime;
GRANT INSERT (source_id,environment_ref,source_kind,source_ref,bound_user_id,source_version,manifest_digest,issuer_ref,key_ref,attested_at,valid_until,state,repository_revision,created_at,updated_at) ON zhiban_identity.identity_recovery_sources TO zhiban_control_runtime;
GRANT INSERT (environment_ref,policy_digest,approval_ref,created_at,updated_at,repository_revision,window_ms,global_limit,site_limit,subject_limit,max_buckets,max_live_cases,max_registered_per_subject,max_total_cases,max_pending_notifications,max_notification_age_ms,registered_ttl_ms,submission_ttl_ms,ceremony_ttl_ms,max_submissions,max_attempts_per_ticket,max_process_requests,body_timeout_ms,statement_timeout_ms) ON zhiban_identity.identity_recovery_policy TO zhiban_control_runtime;
GRANT UPDATE(enabled,repository_revision,updated_at) ON zhiban_identity.identity_recovery_policy TO zhiban_control_runtime;
GRANT INSERT (case_id,environment_ref,site_ref,subject_user_id,verifier_user_id,actor_user_id,enrollment_source_id,appointment_source_id,contact_source_id,expected_enrollment_source_revision,expected_appointment_source_revision,expected_contact_source_revision,registration_manifest_digest,registration_key_ref,approval_ref,intent,security_clearance_ref,expected_subject_user_revision,expected_verifier_user_revision,expected_slot_revision,expected_security_epoch,expected_credential_id,expected_generation,expected_actor_user_revision,expected_actor_slot_revision,expected_actor_security_epoch,actor_admin_grant_id,expected_admin_grant_revision,state,repository_revision,ticket_generation,created_at,registered_expires_at) ON zhiban_identity.identity_recovery_cases TO zhiban_auth_runtime;
GRANT UPDATE(state,repository_revision,ticket_generation,verified_at,approved_at,expires_at,completed_at,terminal_at,terminal_reason,pre_notice_receipt_ref,delivery_receipt_ref,approval_manifest_digest,approval_key_ref) ON zhiban_identity.identity_recovery_cases TO zhiban_auth_runtime;
GRANT INSERT(ticket_id,case_id,ticket_generation,ticket_digest,state,attempts,created_at,expires_at,repository_revision) ON zhiban_identity.identity_recovery_tickets TO zhiban_auth_runtime;
GRANT UPDATE(state,attempts,terminal_at,repository_revision) ON zhiban_identity.identity_recovery_tickets TO zhiban_auth_runtime;
GRANT INSERT(case_id,case_revision,event_id,event_type,occurred_at,actor_user_id,request_id,ticket_id,source_id,receipt_ref) ON zhiban_identity.identity_recovery_events TO zhiban_auth_runtime;
GRANT INSERT(case_id,command_id,ticket_id,completed_case_revision,ticket_generation,actor_user_id,subject_user_id,prior_credential_id,credential_id,generation_before,generation_after,slot_revision_before,slot_revision_after,security_epoch_before,security_epoch_after,credential_event_id,completed_at) ON zhiban_identity.identity_recovery_outcomes TO zhiban_auth_runtime;
GRANT INSERT(case_id,notice_kind,route_source_id,route_source_revision,verifier_user_id,state,created_at,due_at,acknowledged_at,receipt_ref,repository_revision) ON zhiban_identity.identity_recovery_notifications TO zhiban_auth_runtime;
GRANT UPDATE(state,acknowledged_at,receipt_ref,repository_revision) ON zhiban_identity.identity_recovery_notifications TO zhiban_auth_runtime;
ALTER FUNCTION zhiban_identity.identity_recovery_gate(text,text) OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_recovery_gate(text,text) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
ALTER FUNCTION zhiban_identity.identity_recovery_user_locks(uuid,text,uuid[]) OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_recovery_user_locks(uuid,text,uuid[]) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
ALTER FUNCTION zhiban_identity.identity_recovery_actor_guard(uuid,text,text) OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_recovery_actor_guard(uuid,text,text) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
ALTER FUNCTION zhiban_identity.identity_recovery_source_block(uuid,bigint,text,uuid[]) OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_recovery_source_block(uuid,bigint,text,uuid[]) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
ALTER FUNCTION zhiban_identity.identity_recovery_reserve(text,text,text,text[]) OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_recovery_reserve(text,text,text,text[]) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
ALTER FUNCTION zhiban_identity.identity_recovery_prune(text,text,integer) OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_recovery_prune(text,text,integer) FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
ALTER FUNCTION zhiban_identity.identity_recovery_transition_guard() OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_recovery_transition_guard() FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
ALTER FUNCTION zhiban_identity.identity_recovery_consistency() OWNER TO zhiban_identity_owner;
REVOKE ALL ON FUNCTION zhiban_identity.identity_recovery_consistency() FROM PUBLIC,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.identity_recovery_gate(text,text) TO zhiban_auth_runtime,zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.identity_recovery_user_locks(uuid,text,uuid[]) TO zhiban_auth_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.identity_recovery_actor_guard(uuid,text,text) TO zhiban_auth_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.identity_recovery_source_block(uuid,bigint,text,uuid[]) TO zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.identity_recovery_reserve(text,text,text,text[]) TO zhiban_auth_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.identity_recovery_prune(text,text,integer) TO zhiban_auth_runtime;
