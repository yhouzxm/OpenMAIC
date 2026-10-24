-- All SECURITY DEFINER helpers have fixed owner/search_path/RLS; no tenant DML.
CREATE FUNCTION zhiban_handoff.assert_clear(p_approval uuid,p_controller_secret text,p_clear_secret text,p_expected_status text DEFAULT 'ISSUED') RETURNS void
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_handoff,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE a zhiban_handoff.clear_authorizations%ROWTYPE;h zhiban_handoff.host_read_authorizations%ROWTYPE;
 w zhiban_reconcile.windows%ROWTYPE;i zhiban_reconcile.installations%ROWTYPE;o jsonb;ack jsonb;n bigint;
BEGIN
 SELECT * INTO a FROM zhiban_handoff.clear_authorizations WHERE approval_id=p_approval;
 IF NOT FOUND THEN RAISE EXCEPTION 'Clear scope rejected' USING ERRCODE='42501'; END IF;
 PERFORM zhiban_reconcile.controller_context(a.deployment_id,p_controller_secret);
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=a.window_id AND deployment_id=a.deployment_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Window scope rejected' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM zhiban_reconcile.services WHERE service_ref=w.service_ref FOR SHARE;
 SELECT epoch INTO n FROM zhiban_reconcile.epoch_counters WHERE deployment_id=a.deployment_id FOR SHARE;
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=a.window_id FOR SHARE;
 SELECT * INTO i FROM zhiban_reconcile.installations WHERE deployment_id=a.deployment_id;
 PERFORM 1 FROM zhiban_reconcile.window_database_claims WHERE cluster_identifier=i.cluster_identifier AND database_oid IN(i.business_oid,i.native_oid) ORDER BY database_oid FOR SHARE;
 SELECT * INTO h FROM zhiban_handoff.host_read_authorizations WHERE deployment_id=a.deployment_id AND release_id=a.release_id FOR SHARE;
 SELECT * INTO a FROM zhiban_handoff.clear_authorizations WHERE approval_id=p_approval FOR UPDATE;
 IF p_expected_status NOT IN('ISSUED','CONSUMED') OR a.status IS DISTINCT FROM p_expected_status OR a.expires_at<=zhiban_reconcile.now_ms() OR a.issued_at>zhiban_reconcile.now_ms()
  OR a.token_digest IS DISTINCT FROM zhiban_reconcile.secret_digest(p_clear_secret)
  OR a.backend_pid<>pg_backend_pid() OR h.status IS DISTINCT FROM 'ACTIVE' OR h.epoch IS DISTINCT FROM a.epoch
  OR n IS DISTINCT FROM a.epoch OR w.epoch IS DISTINCT FROM a.epoch OR w.phase IS DISTINCT FROM 'CLOSED'
  OR (SELECT count(*) FROM zhiban_reconcile.window_database_claims WHERE cluster_identifier=i.cluster_identifier AND database_oid IN(i.business_oid,i.native_oid) AND current_window_id IS NULL)<>2
  OR EXISTS(SELECT 1 FROM zhiban_reconcile.windows WHERE deployment_id=a.deployment_id AND phase NOT IN('CLOSED','SUPERSEDED')) THEN
  RAISE EXCEPTION 'Current clear capability rejected' USING ERRCODE='42501'; END IF;
 ack:=zhiban_reconcile.read_closed_result(a.deployment_id,a.window_id,a.epoch,p_controller_secret);
 IF ack->>'status' IS DISTINCT FROM 'COMMITTED_CLOSED' THEN RAISE EXCEPTION 'CLOSED required'; END IF;
 o:=zhiban_reconcile_catalog.observe(i.business_oid,i.native_oid);
 IF o->>'cluster' IS DISTINCT FROM i.cluster_identifier OR (o->>'postmasterStart')::timestamptz IS DISTINCT FROM a.postmaster_start
  OR (o->>'pg')::integer NOT BETWEEN 160000 AND 169999
  OR jsonb_array_length(o->'databases') IS DISTINCT FROM 2 OR EXISTS(SELECT 1 FROM jsonb_array_elements(o->'databases') d WHERE NOT (d->>'allowConnections')::boolean)
  OR (o->>'preparedEnabled')::boolean OR (o->>'prepared')::integer<>0 OR (o->>'subscriptions')::integer<>0
  OR jsonb_array_length(o->'backends')<>1 OR o->'backends'->0->>'role'<>session_user
  OR (o->'backends'->0->>'pid')::integer<>pg_backend_pid()
  OR (o->'backends'->0->>'start')::timestamptz IS DISTINCT FROM a.backend_start
  OR (SELECT count(*) FROM pg_roles WHERE rolcanlogin AND rolname IN('zhiban_auth_runtime','zhiban_runtime','zhiban_control_runtime','zhiban_academic_runtime','zhiban_bridge_runtime','zhiban_openmaic_runtime'))<>6
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolcanlogin AND rolname NOT IN('postgres','zhiban_auth_runtime','zhiban_runtime','zhiban_control_runtime','zhiban_academic_runtime','zhiban_bridge_runtime','zhiban_openmaic_runtime'))
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolcanlogin AND rolname IN('zhiban_migrator','zhiban_openmaic_migrator','zhiban_identity_owner','zhiban_openmaic_owner','zhiban_reconcile_controller','zhiban_reconcile_issuer','zhiban_reconcile_executor','zhiban_reconcile_native_proof','zhiban_reconcile_observer')) THEN
  RAISE EXCEPTION 'Final clear physical barrier rejected' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION zhiban_handoff.begin_clear(p_approval uuid,p_controller_secret text,p_clear_secret text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_handoff,zhiban_reconcile,pg_temp SET row_security=on AS $$
BEGIN
 PERFORM zhiban_handoff.assert_clear(p_approval,p_controller_secret,p_clear_secret);
 INSERT INTO zhiban_handoff.guard_scopes VALUES(pg_backend_pid(),txid_current(),p_approval);
 RETURN jsonb_build_object('status','LOCKED_PENDING','approvalId',p_approval,'launchAllowed',false,'evidenceOrigin','LOCAL');
END $$;
CREATE FUNCTION zhiban_handoff.commit_clear(p_approval uuid,p_controller_secret text,p_clear_secret text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_handoff,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE a zhiban_handoff.clear_authorizations%ROWTYPE;
BEGIN
 -- Recheck after any staging/fsync; statement/result alone is never COMMIT proof.
 PERFORM zhiban_handoff.assert_clear(p_approval,p_controller_secret,p_clear_secret);
 IF NOT EXISTS(SELECT 1 FROM zhiban_handoff.guard_scopes WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current() AND approval_id=p_approval) THEN RAISE EXCEPTION 'Same guarded transaction required' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM zhiban_handoff.clear_authorizations WHERE approval_id=p_approval;
 INSERT INTO zhiban_handoff.clear_commits VALUES(a.approval_id,a.deployment_id,a.release_id,a.window_id,a.epoch,a.fence_id,a.fence_sequence,a.target_gate_digest,a.approval_digest,session_user,pg_backend_pid(),a.backend_start,a.postmaster_start,zhiban_reconcile.now_ms());
 UPDATE zhiban_handoff.clear_authorizations SET status='CONSUMED' WHERE approval_id=p_approval;
 DELETE FROM zhiban_handoff.guard_scopes WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 RETURN jsonb_build_object('status','COMMIT_PENDING','approvalId',p_approval,'targetGateSha256',a.target_gate_digest,'launchAllowed',false,'evidenceOrigin','LOCAL');
END $$;
CREATE FUNCTION zhiban_handoff.read_clear_result(p_approval uuid,p_controller_secret text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_handoff,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE a zhiban_handoff.clear_authorizations%ROWTYPE;c zhiban_handoff.clear_commits%ROWTYPE;
BEGIN
 SELECT * INTO a FROM zhiban_handoff.clear_authorizations WHERE approval_id=p_approval;
 IF NOT FOUND THEN RAISE EXCEPTION 'Exact lookup scope rejected' USING ERRCODE='42501'; END IF;
 -- Fresh current recovery controller suffices; no expired write token is reused.
 PERFORM zhiban_reconcile.controller_context(a.deployment_id,p_controller_secret);
 SELECT * INTO c FROM zhiban_handoff.clear_commits WHERE approval_id=p_approval;
 RETURN jsonb_build_object('status',CASE WHEN FOUND THEN 'COMMITTED' ELSE 'NOT_OBSERVED' END,'approvalId',p_approval,
  'releaseId',a.release_id,'fenceId',a.fence_id,'fenceSequence',a.fence_sequence::text,
  'targetGateSha256',c.target_gate_digest,'recordedAt',c.recorded_at::text,
  'replayAllowed',false,'publishGateAllowed',false,'launchAllowed',false,'evidenceOrigin','LOCAL','githubActions',false);
END $$;
CREATE FUNCTION zhiban_handoff.inspect_host_installation(p_deployment uuid,p_release uuid,p_read_secret text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_handoff,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE h zhiban_handoff.host_read_authorizations%ROWTYPE;i zhiban_reconcile.installations%ROWTYPE;
 c zhiban_handoff.clear_commits%ROWTYPE;n bigint;empty_claims boolean;ledgers jsonb;o jsonb;
BEGIN
 IF session_user<>'zhiban_control_runtime' OR current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Host facts role rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO h FROM zhiban_handoff.host_read_authorizations WHERE deployment_id=p_deployment AND release_id=p_release;
 IF NOT FOUND OR h.status NOT IN('REGISTERED','ACTIVE') OR h.token_digest IS DISTINCT FROM zhiban_reconcile.secret_digest(p_read_secret) THEN RAISE EXCEPTION 'Exact host read permission rejected' USING ERRCODE='42501'; END IF;
 SELECT epoch INTO n FROM zhiban_reconcile.epoch_counters WHERE deployment_id=p_deployment FOR SHARE;
 SELECT * INTO i FROM zhiban_reconcile.installations WHERE deployment_id=p_deployment;
 PERFORM 1 FROM zhiban_reconcile.window_database_claims WHERE cluster_identifier=i.cluster_identifier AND database_oid IN(i.business_oid,i.native_oid) ORDER BY database_oid FOR SHARE;
 SELECT * INTO h FROM zhiban_handoff.host_read_authorizations WHERE deployment_id=p_deployment AND release_id=p_release FOR SHARE;
 IF h.status NOT IN('REGISTERED','ACTIVE') OR h.token_digest IS DISTINCT FROM zhiban_reconcile.secret_digest(p_read_secret) OR h.epoch IS DISTINCT FROM n THEN RAISE EXCEPTION 'Host generation stale' USING ERRCODE='42501'; END IF;
 empty_claims:=(SELECT count(*) FROM zhiban_reconcile.window_database_claims WHERE cluster_identifier=i.cluster_identifier AND database_oid IN(i.business_oid,i.native_oid) AND current_window_id IS NULL)=2;
 SELECT * INTO c FROM zhiban_handoff.clear_commits WHERE deployment_id=p_deployment ORDER BY fence_sequence DESC LIMIT 1;
 o:=zhiban_reconcile_catalog.observe(i.business_oid,i.native_oid);
 SELECT jsonb_agg(to_jsonb(x) ORDER BY context,version) INTO ledgers FROM (
  SELECT 'identity' context,version,checksum FROM zhiban_identity.schema_migrations UNION ALL
  SELECT 'academic',version,checksum FROM zhiban_academic.schema_migrations UNION ALL
  SELECT 'learning',version,checksum FROM zhiban_learning.schema_migrations UNION ALL
  SELECT 'assessment',version,checksum FROM zhiban_assessment.schema_migrations UNION ALL
  SELECT 'content',version,checksum FROM zhiban_content.schema_migrations UNION ALL
  SELECT 'handoff',version,checksum FROM zhiban_handoff.schema_migrations) x;
 RETURN jsonb_build_object('profile','ordinary-host-after-terminal-local-v1','releaseId',p_release,
  'credentialGenerationId',h.credential_generation_id,'cluster',o->>'cluster','pg',o->'pg','databases',o->'databases',
  'epoch',n::text,'claimsEmpty',empty_claims,'ledgers',ledgers,'installationReady',i.ready,
  'artifactManifestSha256',h.artifact_manifest_digest,'handoffReceiptSha256',h.handoff_receipt_digest,
  'configurationSha256',h.configuration_digest,'profileSha256',h.profile_digest,'sourceSha256',h.source_digest,
  'readPermissionPhase',h.status,
  'activationStatus',CASE WHEN h.status='ACTIVE' AND c.release_id=p_release AND c.approval_id IS NOT NULL AND empty_claims AND c.epoch=n THEN 'COMMITTED' ELSE 'REGISTERED_UNACTIVATED' END,
  'approvalId',c.approval_id,'fenceId',c.fence_id,'fenceSequence',c.fence_sequence::text,'targetGateSha256',c.target_gate_digest,
  'postmasterStart',o->>'postmasterStart','terminalActionsAllowed',false,'evidenceOrigin','LOCAL','githubActions',false);
END $$;
-- Guard-only COMMIT, a half-consumed approval, or mutation of immutable history rejects.
CREATE FUNCTION zhiban_handoff.check_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,zhiban_handoff,pg_temp SET row_security=on AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM zhiban_handoff.guard_scopes WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current())
  OR EXISTS(SELECT 1 FROM zhiban_handoff.clear_authorizations a LEFT JOIN zhiban_handoff.clear_commits c USING(approval_id)
   WHERE (a.status='CONSUMED') IS DISTINCT FROM (c.approval_id IS NOT NULL)
    OR (c.approval_id IS NOT NULL AND (a.deployment_id,a.release_id,a.window_id,a.epoch,a.fence_id,a.fence_sequence,a.target_gate_digest,a.approval_digest,a.backend_pid,a.backend_start,a.postmaster_start)
     IS DISTINCT FROM (c.deployment_id,c.release_id,c.window_id,c.epoch,c.fence_id,c.fence_sequence,c.target_gate_digest,c.approval_digest,c.backend_pid,c.backend_start,c.postmaster_start))) THEN
  RAISE EXCEPTION 'Handoff commit consistency rejected' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION zhiban_handoff.immutable_commit() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN RAISE EXCEPTION 'Immutable clear history' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_clear_commit BEFORE UPDATE OR DELETE ON zhiban_handoff.clear_commits FOR EACH ROW EXECUTE FUNCTION zhiban_handoff.immutable_commit();
CREATE CONSTRAINT TRIGGER guard_commit_consistency AFTER INSERT OR DELETE ON zhiban_handoff.guard_scopes DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_handoff.check_history();
CREATE CONSTRAINT TRIGGER approval_commit_consistency AFTER INSERT OR UPDATE ON zhiban_handoff.clear_authorizations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_handoff.check_history();
CREATE CONSTRAINT TRIGGER clear_commit_consistency AFTER INSERT ON zhiban_handoff.clear_commits DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION zhiban_handoff.check_history();

CREATE FUNCTION zhiban_handoff.authorization_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Authorization history cannot be deleted'; END IF;
 IF TG_OP='INSERT' THEN
  IF (TG_TABLE_NAME='host_read_authorizations' AND NEW.status<>'REGISTERED')
   OR (TG_TABLE_NAME='clear_authorizations' AND NEW.status<>'ISSUED') THEN
   RAISE EXCEPTION 'Initial authorization state rejected' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='host_read_authorizations' THEN
  -- Owner bootstrap may seal exactly one late receipt digest after validation.
  IF OLD.status='REGISTERED' AND NEW.status='ACTIVE' AND OLD.handoff_receipt_digest IS NULL AND NEW.handoff_receipt_digest IS NOT NULL
   AND (to_jsonb(OLD)-ARRAY['status','handoff_receipt_digest']) IS NOT DISTINCT FROM (to_jsonb(NEW)-ARRAY['status','handoff_receipt_digest']) THEN RETURN NEW; END IF;
  IF (to_jsonb(OLD)-'status') IS DISTINCT FROM (to_jsonb(NEW)-'status') OR OLD.status NOT IN('REGISTERED','ACTIVE') OR NEW.status<>'REVOKED' THEN
   RAISE EXCEPTION 'Immutable authorization binding/state rejected' USING ERRCODE='23514'; END IF;
 ELSIF (to_jsonb(OLD)-'status') IS DISTINCT FROM (to_jsonb(NEW)-'status') OR OLD.status<>'ISSUED'
  OR NEW.status NOT IN('REVOKED','CONSUMED') OR (NEW.status='CONSUMED' AND session_user<>'zhiban_reconcile_controller') THEN
  RAISE EXCEPTION 'Immutable authorization binding/state rejected' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER host_authorization_guard BEFORE INSERT OR UPDATE OR DELETE ON zhiban_handoff.host_read_authorizations FOR EACH ROW EXECUTE FUNCTION zhiban_handoff.authorization_guard();
CREATE TRIGGER clear_authorization_guard BEFORE INSERT OR UPDATE OR DELETE ON zhiban_handoff.clear_authorizations FOR EACH ROW EXECUTE FUNCTION zhiban_handoff.authorization_guard();

-- Automatic, atomic seed/seal/revoke/consume control audit; no tenant audit exemption.
CREATE FUNCTION zhiban_handoff.audit_authorization() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,zhiban_handoff,zhiban_reconcile,pg_temp SET row_security=on AS $$
BEGIN
 INSERT INTO zhiban_handoff.authorization_events(authorization_kind,deployment_id,scope_id,old_status,new_status,binding_digest,actor_role,occurred_at)
 VALUES(CASE WHEN TG_TABLE_NAME='host_read_authorizations' THEN 'HOST' ELSE 'CLEAR' END,NEW.deployment_id,
  CASE WHEN TG_TABLE_NAME='host_read_authorizations' THEN (to_jsonb(NEW)->>'release_id')::uuid ELSE (to_jsonb(NEW)->>'approval_id')::uuid END,
  CASE WHEN TG_OP='UPDATE' THEN OLD.status ELSE NULL END,NEW.status,zhiban_reconcile.digest(to_jsonb(NEW)),session_user,zhiban_reconcile.now_ms());
 RETURN NEW;
END $$;
CREATE TRIGGER host_authorization_audit AFTER INSERT OR UPDATE ON zhiban_handoff.host_read_authorizations FOR EACH ROW EXECUTE FUNCTION zhiban_handoff.audit_authorization();
CREATE TRIGGER clear_authorization_audit AFTER INSERT OR UPDATE ON zhiban_handoff.clear_authorizations FOR EACH ROW EXECUTE FUNCTION zhiban_handoff.audit_authorization();
CREATE TRIGGER immutable_authorization_events BEFORE UPDATE OR DELETE ON zhiban_handoff.authorization_events FOR EACH ROW EXECUTE FUNCTION zhiban_handoff.immutable_commit();

-- Fresh bounded publication check AFTER a known control COMMIT; never consumes/replays.
CREATE FUNCTION zhiban_handoff.verify_clear_publication(p_approval uuid,p_controller_secret text,p_clear_secret text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_handoff,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE c zhiban_handoff.clear_commits%ROWTYPE;
BEGIN
 PERFORM zhiban_handoff.assert_clear(p_approval,p_controller_secret,p_clear_secret,'CONSUMED');
 SELECT * INTO c FROM zhiban_handoff.clear_commits WHERE approval_id=p_approval;
 IF NOT FOUND OR EXISTS(SELECT 1 FROM zhiban_handoff.clear_commits WHERE deployment_id=c.deployment_id AND fence_sequence>c.fence_sequence) THEN
  RAISE EXCEPTION 'Current committed publication scope rejected' USING ERRCODE='42501';
 END IF;
 RETURN jsonb_build_object('status','COMMITTED_CURRENT','approvalId',c.approval_id,'releaseId',c.release_id,
  'fenceId',c.fence_id,'fenceSequence',c.fence_sequence::text,'targetGateSha256',c.target_gate_digest,'launchAllowed',false,'replayAllowed',false);
END $$;
