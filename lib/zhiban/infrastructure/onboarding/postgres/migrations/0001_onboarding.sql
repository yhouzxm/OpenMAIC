-- G4 successor: ordinary first-password claims; no changes to frozen Identity objects.
CREATE SCHEMA zhiban_onboarding AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_onboarding FROM PUBLIC;
CREATE TABLE zhiban_onboarding.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL);
CREATE TABLE zhiban_onboarding.requests(
 tenant_id uuid NOT NULL REFERENCES zhiban_identity.tenants(tenant_id),id uuid NOT NULL CHECK(zhiban_identity.is_uuid_v7(id)),requester_member_id uuid NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),subject_reference text NOT NULL CHECK(length(subject_reference) BETWEEN 1 AND 120),requested_role text NOT NULL CHECK(requested_role IN('STUDENT','TEACHER')),request_digest text NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN('REQUESTED','WITHDRAWN','APPROVED','READY','CLAIMED','REVOKED')),revision bigint NOT NULL CHECK(revision>0),planned_user_id uuid,control_approval_id uuid,control_command_id uuid,control_manifest_digest text,source_ref uuid,claim_id uuid,expires_at bigint,created_at bigint NOT NULL,updated_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(id),UNIQUE(planned_user_id),FOREIGN KEY(tenant_id,requester_member_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id),
 CHECK((state IN('REQUESTED','WITHDRAWN'))=(planned_user_id IS NULL)),CHECK((planned_user_id IS NULL)=(control_approval_id IS NULL)),CHECK((planned_user_id IS NULL)=(control_command_id IS NULL)),CHECK((planned_user_id IS NULL)=(control_manifest_digest IS NULL)),CHECK((planned_user_id IS NULL)=(source_ref IS NULL)),CHECK((claim_id IS NULL)=(expires_at IS NULL)),CHECK((state IN('READY','CLAIMED','REVOKED'))=(claim_id IS NOT NULL))
);
CREATE TABLE zhiban_onboarding.claims(
 id uuid PRIMARY KEY CHECK(zhiban_identity.is_uuid_v7(id)),request_id uuid NOT NULL REFERENCES zhiban_onboarding.requests(id),tenant_id uuid NOT NULL REFERENCES zhiban_identity.tenants(tenant_id),tenant_revision bigint NOT NULL,target_user_id uuid NOT NULL REFERENCES zhiban_identity.users(user_id),expected_user_revision bigint NOT NULL CHECK(expected_user_revision>0),
 ticket_digest text NOT NULL UNIQUE CHECK(ticket_digest~'^[a-f0-9]{64}$'),source_ref uuid NOT NULL UNIQUE,source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),subject_binding_ref text NOT NULL,recipient_delivery_ref text NOT NULL,operator_user_id uuid NOT NULL REFERENCES zhiban_identity.users(user_id),operator_user_revision bigint NOT NULL,system_admin_grant_id uuid NOT NULL REFERENCES zhiban_identity.system_admin_grants(grant_id),admin_grant_revision bigint NOT NULL,
 issued_at bigint NOT NULL,expires_at bigint NOT NULL CHECK(expires_at>issued_at AND expires_at-issued_at<=1800000),supersedes_claim_id uuid REFERENCES zhiban_onboarding.claims(id),state text NOT NULL CHECK(state IN('READY','CLAIMED','REVOKED')),revision bigint NOT NULL CHECK(revision>0),credential_id uuid REFERENCES zhiban_identity.credentials(credential_id) DEFERRABLE INITIALLY DEFERRED,credential_event_id bigint REFERENCES zhiban_identity.audit_events(event_id) DEFERRABLE INITIALLY DEFERRED,finished_at bigint,
 CHECK((state='CLAIMED')=(credential_id IS NOT NULL)),CHECK((credential_id IS NULL)=(credential_event_id IS NULL)),CHECK((state='READY')=(finished_at IS NULL))
);
CREATE UNIQUE INDEX ordinary_one_ready_claim ON zhiban_onboarding.claims(target_user_id) WHERE state='READY';
CREATE TABLE zhiban_onboarding.events(tenant_id uuid NOT NULL,id uuid NOT NULL,request_id uuid NOT NULL REFERENCES zhiban_onboarding.requests(id),action text NOT NULL,actor_ref text NOT NULL,facts jsonb NOT NULL,created_at bigint NOT NULL,PRIMARY KEY(tenant_id,id));
CREATE TABLE zhiban_onboarding.commands(tenant_id uuid NOT NULL,command_key text NOT NULL,actor_id uuid NOT NULL,payload_digest text NOT NULL,result jsonb NOT NULL,created_at bigint NOT NULL,PRIMARY KEY(tenant_id,command_key));
REVOKE ALL ON ALL TABLES IN SCHEMA zhiban_onboarding FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_onboarding TO zhiban_academic_runtime,zhiban_auth_runtime,zhiban_control_runtime;
GRANT SELECT ON zhiban_onboarding.schema_migrations TO zhiban_academic_runtime,zhiban_auth_runtime,zhiban_control_runtime;
DO $$ DECLARE n text;BEGIN FOREACH n IN ARRAY ARRAY['requests','claims','events','commands'] LOOP
 EXECUTE format('ALTER TABLE zhiban_onboarding.%I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('ALTER TABLE zhiban_onboarding.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY owner_internal ON zhiban_onboarding.%I TO zhiban_identity_owner USING(true) WITH CHECK(true)',n);
 END LOOP;END$$;
CREATE POLICY request_tenant_read ON zhiban_onboarding.requests FOR SELECT TO zhiban_academic_runtime USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY request_tenant_create ON zhiban_onboarding.requests FOR INSERT TO zhiban_academic_runtime WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND state='REQUESTED' AND revision=1 AND planned_user_id IS NULL);
CREATE POLICY request_tenant_withdraw ON zhiban_onboarding.requests FOR UPDATE TO zhiban_academic_runtime USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND state='REQUESTED') WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND state='WITHDRAWN');
CREATE POLICY request_control ON zhiban_onboarding.requests TO zhiban_control_runtime USING(true) WITH CHECK(true);
GRANT SELECT ON zhiban_onboarding.requests TO zhiban_academic_runtime,zhiban_control_runtime;
GRANT INSERT(tenant_id,id,requester_member_id,name,subject_reference,requested_role,request_digest,state,revision,created_at,updated_at) ON zhiban_onboarding.requests TO zhiban_academic_runtime;
GRANT UPDATE(state,revision,updated_at) ON zhiban_onboarding.requests TO zhiban_academic_runtime;
GRANT UPDATE(state,revision,updated_at,planned_user_id,control_approval_id,control_command_id,control_manifest_digest,source_ref) ON zhiban_onboarding.requests TO zhiban_control_runtime;
DO $$ DECLARE n text;BEGIN FOREACH n IN ARRAY ARRAY['events','commands'] LOOP
 EXECUTE format('CREATE POLICY tenant_records ON zhiban_onboarding.%I TO zhiban_academic_runtime USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',n);
 EXECUTE format('GRANT SELECT,INSERT ON zhiban_onboarding.%I TO zhiban_academic_runtime',n);
 END LOOP;END$$;
CREATE POLICY control_events ON zhiban_onboarding.events TO zhiban_control_runtime USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON zhiban_onboarding.events TO zhiban_control_runtime;

-- Only the independent trusted control broker calls this after the original USER_CREATE receipt.
CREATE FUNCTION zhiban_onboarding.register_claim(p_request uuid,p_expected bigint,p_manifest jsonb,p_source_digest text,p_ticket_digest text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE SET search_path=pg_catalog,zhiban_onboarding,pg_temp SET row_security=on AS $$
DECLARE r zhiban_onboarding.requests%ROWTYPE;m jsonb:=p_manifest;u zhiban_identity.users%ROWTYPE;g zhiban_identity.system_admin_grants%ROWTYPE;v_tenant_revision bigint;at bigint;prior zhiban_onboarding.claims%ROWTYPE;cid uuid:=(p_manifest->>'claimId')::uuid;
BEGIN
 IF session_user<>'zhiban_control_runtime' OR m->>'kind' IS DISTINCT FROM 'ORDINARY_FIRST_PASSWORD' OR m->>'evidenceOrigin' IS DISTINCT FROM 'LOCAL' OR m->>'githubActions' IS DISTINCT FROM 'false' OR zhiban_identity.is_uuid_v7(cid) IS DISTINCT FROM TRUE OR zhiban_identity.is_uuid_v7((m->>'sourceRef')::uuid) IS DISTINCT FROM TRUE OR p_source_digest!~'^[a-f0-9]{64}$' OR p_ticket_digest!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Claim rejected' USING ERRCODE='42501';END IF;
 PERFORM user_id FROM zhiban_identity.users WHERE user_id IN((m->>'operatorUserId')::uuid,(m->>'userId')::uuid) ORDER BY user_id FOR UPDATE;
 SELECT * INTO u FROM zhiban_identity.users WHERE user_id=(m->>'userId')::uuid;
 IF u.user_id IS NULL OR u.status<>'ACTIVE' OR u.repository_revision<>(m->>'expectedUserRevision')::bigint OR EXISTS(SELECT 1 FROM zhiban_identity.system_admin_grants WHERE user_id=u.user_id) OR EXISTS(SELECT 1 FROM zhiban_identity.credential_slots WHERE user_id=u.user_id) THEN RAISE EXCEPTION 'Claim rejected' USING ERRCODE='42501';END IF;
 SELECT repository_revision INTO v_tenant_revision FROM zhiban_identity.tenants WHERE tenant_id=(SELECT tenant_id FROM zhiban_onboarding.requests WHERE id=p_request) AND status='ACTIVE' FOR SHARE;
 SELECT * INTO g FROM zhiban_identity.system_admin_grants WHERE grant_id=(m->>'systemAdminGrantId')::uuid FOR SHARE;
 at:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF v_tenant_revision IS NULL OR NOT EXISTS(SELECT 1 FROM zhiban_identity.users WHERE user_id=g.user_id AND status='ACTIVE' AND repository_revision=(m->>'operatorUserRevision')::bigint) OR g.user_id IS DISTINCT FROM (m->>'operatorUserId')::uuid OR g.repository_revision IS DISTINCT FROM (m->>'adminGrantRevision')::bigint OR g.revoked_at IS NOT NULL OR g.valid_from>at OR (g.valid_until IS NOT NULL AND g.valid_until<=at) OR (m->>'issuedAt')::bigint>at OR (m->>'expiresAt')::bigint<=at OR (m->>'expiresAt')::bigint-(m->>'issuedAt')::bigint>1800000 THEN RAISE EXCEPTION 'Claim rejected' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM zhiban_onboarding.requests WHERE id=p_request FOR UPDATE;
 IF r.id IS NULL OR p_expected IS NULL OR r.id IS DISTINCT FROM (m->>'requestId')::uuid OR r.revision<>p_expected OR r.state NOT IN('APPROVED','READY','REVOKED') OR r.request_digest IS DISTINCT FROM m->>'requestDigest' OR r.planned_user_id IS DISTINCT FROM u.user_id OR r.control_approval_id IS DISTINCT FROM (m->>'controlApprovalId')::uuid OR r.control_command_id IS DISTINCT FROM (m->>'controlCommandId')::uuid OR r.control_manifest_digest IS DISTINCT FROM m->>'controlManifestDigest' THEN RAISE EXCEPTION 'Claim changed' USING ERRCODE='40001';END IF;
 IF NOT EXISTS(SELECT 1 FROM zhiban_identity.identity_control_commands c JOIN zhiban_identity.identity_control_command_effects e ON e.command_id=c.command_id JOIN zhiban_identity.identity_control_approvals a ON a.approval_id=c.approval_id WHERE c.command_id=r.control_command_id AND c.action='USER_CREATE' AND c.approval_id=r.control_approval_id AND a.manifest_digest=r.control_manifest_digest AND a.planned_user_id=u.user_id AND e.target_user_id=u.user_id AND e.after_revision=u.repository_revision AND e.after_status='ACTIVE') THEN RAISE EXCEPTION 'Creation proof rejected' USING ERRCODE='42501';END IF;
 IF r.claim_id IS NOT NULL THEN
  SELECT * INTO prior FROM zhiban_onboarding.claims WHERE id=r.claim_id FOR UPDATE;
  IF prior.state='CLAIMED' OR (m->>'supersedesClaimId')::uuid IS DISTINCT FROM prior.id THEN RAISE EXCEPTION 'Claim changed' USING ERRCODE='40001';END IF;
  UPDATE zhiban_onboarding.claims SET state='REVOKED',revision=revision+1,finished_at=at WHERE id=prior.id AND state='READY';
 ELSIF m->>'supersedesClaimId' IS NOT NULL THEN RAISE EXCEPTION 'Claim rejected' USING ERRCODE='42501';END IF;
 INSERT INTO zhiban_onboarding.claims(id,request_id,tenant_id,tenant_revision,target_user_id,expected_user_revision,ticket_digest,source_ref,source_digest,subject_binding_ref,recipient_delivery_ref,operator_user_id,operator_user_revision,system_admin_grant_id,admin_grant_revision,issued_at,expires_at,supersedes_claim_id,state,revision)
 VALUES(cid,r.id,r.tenant_id,v_tenant_revision,u.user_id,u.repository_revision,p_ticket_digest,(m->>'sourceRef')::uuid,p_source_digest,m->>'subjectBindingRef',m->>'recipientDeliveryRef',g.user_id,(m->>'operatorUserRevision')::bigint,g.grant_id,g.repository_revision,(m->>'issuedAt')::bigint,(m->>'expiresAt')::bigint,(m->>'supersedesClaimId')::uuid,'READY',1);
 UPDATE zhiban_onboarding.requests SET state='READY',revision=revision+1,claim_id=cid,expires_at=(m->>'expiresAt')::bigint,updated_at=at WHERE id=r.id;
 INSERT INTO zhiban_onboarding.events VALUES(r.tenant_id,cid,r.id,'DELIVERY_READY',m->>'operatorUserId',jsonb_build_object('claimId',cid,'sourceRef',m->>'sourceRef','sourceDigest',p_source_digest),at);
 RETURN cid;
END$$;

CREATE FUNCTION zhiban_onboarding.creation_proved(p_request uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE SET search_path=pg_catalog,zhiban_onboarding,pg_temp SET row_security=on AS $$
BEGIN
 IF session_user<>'zhiban_control_runtime' THEN RAISE EXCEPTION 'Creation proof rejected' USING ERRCODE='42501';END IF;
 RETURN EXISTS(SELECT 1 FROM zhiban_onboarding.requests r JOIN zhiban_identity.identity_control_commands c ON c.command_id=r.control_command_id JOIN zhiban_identity.identity_control_command_effects e ON e.command_id=c.command_id JOIN zhiban_identity.identity_control_approvals a ON a.approval_id=c.approval_id JOIN zhiban_identity.users u ON u.user_id=r.planned_user_id WHERE r.id=p_request AND c.action='USER_CREATE' AND c.approval_id=r.control_approval_id AND a.manifest_digest=r.control_manifest_digest AND a.planned_user_id=u.user_id AND e.target_user_id=u.user_id AND e.after_revision=u.repository_revision AND e.after_status='ACTIVE' AND u.status='ACTIVE');
END$$;

-- No token lookup by UserId and no unrestricted auth-role table SELECT.
CREATE FUNCTION zhiban_onboarding.lock_claim(p_id uuid,p_digest text,p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE SET search_path=pg_catalog,zhiban_onboarding,pg_temp SET row_security=on AS $$
DECLARE hint zhiban_onboarding.claims%ROWTYPE;c zhiban_onboarding.claims%ROWTYPE;u zhiban_identity.users%ROWTYPE;g zhiban_identity.system_admin_grants%ROWTYPE;at bigint;v_tenant bigint;label text;
BEGIN
 IF session_user<>'zhiban_auth_runtime' OR p_digest!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Claim rejected' USING ERRCODE='42501';END IF;
 SELECT * INTO hint FROM zhiban_onboarding.claims WHERE id=p_id AND ticket_digest=p_digest;
 IF hint.id IS NULL THEN RAISE EXCEPTION 'Claim rejected' USING ERRCODE='42501';END IF;
 PERFORM user_id FROM zhiban_identity.users WHERE user_id IN(hint.operator_user_id,hint.target_user_id) ORDER BY user_id FOR UPDATE;
 SELECT * INTO u FROM zhiban_identity.users WHERE user_id=hint.target_user_id;
 IF u.status<>'ACTIVE' OR u.repository_revision<>hint.expected_user_revision OR EXISTS(SELECT 1 FROM zhiban_identity.system_admin_grants WHERE user_id=u.user_id) THEN RAISE EXCEPTION 'Claim rejected' USING ERRCODE='42501';END IF;
 SELECT repository_revision INTO v_tenant FROM zhiban_identity.tenants WHERE tenant_id=hint.tenant_id AND status='ACTIVE' FOR SHARE;
 SELECT * INTO g FROM zhiban_identity.system_admin_grants WHERE grant_id=hint.system_admin_grant_id FOR SHARE;
 at:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF v_tenant IS DISTINCT FROM hint.tenant_revision OR g.user_id IS DISTINCT FROM hint.operator_user_id OR g.repository_revision IS DISTINCT FROM hint.admin_grant_revision OR g.revoked_at IS NOT NULL OR g.valid_from>at OR (g.valid_until IS NOT NULL AND g.valid_until<=at) OR NOT EXISTS(SELECT 1 FROM zhiban_identity.users WHERE user_id=g.user_id AND status='ACTIVE' AND repository_revision=hint.operator_user_revision) THEN RAISE EXCEPTION 'Claim rejected' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('zhiban-session-user:'||u.user_id::text,0));
 SELECT * INTO c FROM zhiban_onboarding.claims WHERE id=p_id AND ticket_digest=p_digest FOR UPDATE;
 IF c.id IS NULL OR c.state='REVOKED' OR c.expires_at<=at OR c.issued_at>at OR (p_revision IS NOT NULL AND c.revision<>p_revision) THEN RAISE EXCEPTION 'Claim rejected' USING ERRCODE='42501';END IF;
 SELECT name INTO label FROM zhiban_onboarding.requests WHERE id=c.request_id;
 RETURN jsonb_build_object('claimId',c.id,'requestId',c.request_id,'tenantId',c.tenant_id,'userId',c.target_user_id,'name',label,'state',c.state,'revision',c.revision::text,'expiresAt',c.expires_at,'at',at);
END$$;
CREATE FUNCTION zhiban_onboarding.complete_claim(p_id uuid,p_digest text,p_revision bigint,p_credential uuid,p_event bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE SET search_path=pg_catalog,zhiban_onboarding,pg_temp SET row_security=on AS $$
DECLARE ctx jsonb;at bigint;rid uuid;tid uuid;
BEGIN
 IF session_user<>'zhiban_auth_runtime' OR p_revision IS NULL THEN RAISE EXCEPTION 'Claim rejected' USING ERRCODE='42501';END IF;
 ctx:=zhiban_onboarding.lock_claim(p_id,p_digest,p_revision);at:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF ctx->>'state'<>'READY' OR (ctx->>'expiresAt')::bigint<=at OR NOT EXISTS(SELECT 1 FROM zhiban_identity.credential_slots WHERE user_id=(ctx->>'userId')::uuid AND active_credential_id=p_credential AND generation=1 AND repository_revision=1 AND security_epoch=1) THEN RAISE EXCEPTION 'Claim rejected' USING ERRCODE='42501';END IF;
 UPDATE zhiban_onboarding.claims SET state='CLAIMED',revision=revision+1,credential_id=p_credential,credential_event_id=p_event,finished_at=at WHERE id=p_id;
 rid:=(ctx->>'requestId')::uuid;tid:=(ctx->>'tenantId')::uuid;
 UPDATE zhiban_onboarding.requests SET state='CLAIMED',revision=revision+1,updated_at=at WHERE id=rid AND claim_id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Claim changed' USING ERRCODE='40001';END IF;
 INSERT INTO zhiban_onboarding.events VALUES(tid,p_credential,rid,'PASSWORD_SET_BY_RECIPIENT',(ctx->>'userId'),jsonb_build_object('claimId',p_id,'credentialId',p_credential,'credentialEventId',p_event),at);
END$$;
CREATE FUNCTION zhiban_onboarding.revoke_claim(p_id uuid,p_operator uuid,p_grant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE SET search_path=pg_catalog,zhiban_onboarding,pg_temp SET row_security=on AS $$
DECLARE c zhiban_onboarding.claims%ROWTYPE;g zhiban_identity.system_admin_grants%ROWTYPE;at bigint;
BEGIN
 IF session_user<>'zhiban_control_runtime' THEN RAISE EXCEPTION 'Claim rejected' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM zhiban_onboarding.claims WHERE id=p_id;
 IF c.id IS NULL THEN RAISE EXCEPTION 'Claim rejected' USING ERRCODE='42501';END IF;
 PERFORM user_id FROM zhiban_identity.users WHERE user_id IN(p_operator,c.target_user_id) ORDER BY user_id FOR UPDATE;
 SELECT * INTO g FROM zhiban_identity.system_admin_grants WHERE grant_id=p_grant AND user_id=p_operator FOR SHARE;
 at:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF g.grant_id IS NULL OR g.revoked_at IS NOT NULL OR g.valid_from>at OR (g.valid_until IS NOT NULL AND g.valid_until<=at) OR NOT EXISTS(SELECT 1 FROM zhiban_identity.users WHERE user_id=p_operator AND status='ACTIVE') THEN RAISE EXCEPTION 'Claim rejected' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM zhiban_onboarding.claims WHERE id=p_id FOR UPDATE;
 IF c.state<>'READY' THEN RAISE EXCEPTION 'Claim changed' USING ERRCODE='40001';END IF;
 UPDATE zhiban_onboarding.claims SET state='REVOKED',revision=revision+1,finished_at=at WHERE id=p_id;
 UPDATE zhiban_onboarding.requests SET state='REVOKED',revision=revision+1,updated_at=at WHERE id=c.request_id AND claim_id=p_id;
 INSERT INTO zhiban_onboarding.events VALUES(c.tenant_id,gen_random_uuid(),c.request_id,'DELIVERY_REVOKED',p_operator::text,jsonb_build_object('claimId',p_id),at);
END$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA zhiban_onboarding FROM PUBLIC,zhiban_academic_runtime,zhiban_auth_runtime,zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_onboarding.creation_proved(uuid),zhiban_onboarding.register_claim(uuid,bigint,jsonb,text,text),zhiban_onboarding.revoke_claim(uuid,uuid,uuid) TO zhiban_control_runtime;
GRANT EXECUTE ON FUNCTION zhiban_onboarding.lock_claim(uuid,text,bigint),zhiban_onboarding.complete_claim(uuid,text,bigint,uuid,bigint) TO zhiban_auth_runtime;
