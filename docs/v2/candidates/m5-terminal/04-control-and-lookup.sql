-- UNAPPLIED: controller entry points never perform terminal Business DML.
CREATE FUNCTION zhiban_reconcile.open_window(p_deployment uuid,p_service text,p_window uuid,p_nonce text,p_secret text)
RETURNS uuid LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE i zhiban_reconcile.installations%ROWTYPE;o jsonb;n bigint;t bigint;allow jsonb;
BEGIN
 PERFORM zhiban_reconcile.controller_context(p_deployment,p_secret);
 PERFORM 1 FROM zhiban_reconcile.services WHERE service_ref=p_service AND deployment_id=p_deployment FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Service scope rejected'; END IF;
 SELECT * INTO i FROM zhiban_reconcile.installations WHERE deployment_id=p_deployment;
 IF NOT i.ready THEN RAISE EXCEPTION 'Reviewed installation required'; END IF;
 SELECT epoch INTO n FROM zhiban_reconcile.epoch_counters WHERE deployment_id=p_deployment FOR UPDATE;
 IF n IS NULL OR n=9223372036854775807 THEN RAISE EXCEPTION 'Epoch exhausted/unseeded'; END IF;
 PERFORM 1 FROM zhiban_reconcile.window_database_claims WHERE cluster_identifier=i.cluster_identifier AND database_oid IN(i.business_oid,i.native_oid) ORDER BY database_oid FOR UPDATE;
 IF (SELECT count(*) FROM zhiban_reconcile.window_database_claims WHERE cluster_identifier=i.cluster_identifier
  AND database_oid IN(i.business_oid,i.native_oid) AND current_window_id IS NULL)<>2 THEN RAISE EXCEPTION 'Database already claimed'; END IF;
 o:=zhiban_reconcile_catalog.observe(i.business_oid,i.native_oid);t:=zhiban_reconcile.now_ms();
 IF o->>'cluster' IS DISTINCT FROM i.cluster_identifier THEN RAISE EXCEPTION 'Cluster mismatch'; END IF;
 SELECT jsonb_agg(b ORDER BY ord) INTO allow FROM jsonb_array_elements(o->'backends') WITH ORDINALITY q(b,ord)
 WHERE b->>'role' IN('zhiban_reconcile_controller','zhiban_reconcile_issuer','zhiban_reconcile_executor','zhiban_reconcile_native_proof');
 INSERT INTO zhiban_reconcile.windows(window_id,service_ref,deployment_id,epoch,phase,cluster_identifier,business_oid,native_oid,postmaster_start,
  nonce_digest,build_digest,allowlist,lease_until,created_at)
 VALUES(p_window,p_service,p_deployment,n+1,'PREPARING',i.cluster_identifier,i.business_oid,i.native_oid,(o->>'postmasterStart')::timestamptz,
  zhiban_reconcile.secret_digest(p_nonce),i.implementation_digest,allow,t+60000,t);
 UPDATE zhiban_reconcile.epoch_counters SET epoch=n+1 WHERE deployment_id=p_deployment;
 UPDATE zhiban_reconcile.window_database_claims SET current_window_id=p_window WHERE cluster_identifier=i.cluster_identifier AND database_oid IN(i.business_oid,i.native_oid);
 INSERT INTO zhiban_reconcile.control_events(deployment_id,window_id,event_type,actor_role,occurred_at,provenance_digest,facts)
 VALUES(p_deployment,p_window,'WINDOW_OPENED',session_user,t,zhiban_reconcile.secret_digest(p_nonce),jsonb_build_object('epoch',(n+1)::text));
 RETURN p_window;
END $$;
CREATE FUNCTION zhiban_reconcile.renew_barrier(p_window uuid,p_secret text) RETURNS bigint
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE w zhiban_reconcile.windows%ROWTYPE;i zhiban_reconcile.installations%ROWTYPE;o jsonb;t bigint;
BEGIN
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=p_window;
 PERFORM zhiban_reconcile.controller_context(w.deployment_id,p_secret);
 PERFORM 1 FROM zhiban_reconcile.services WHERE service_ref=w.service_ref FOR SHARE;
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=p_window FOR UPDATE;
 SELECT * INTO i FROM zhiban_reconcile.installations WHERE deployment_id=w.deployment_id;
 IF w.phase NOT IN('PREPARING','DRAINED','PROVING','SETTLING') OR (w.phase<>'PREPARING' AND w.lease_until<=zhiban_reconcile.now_ms()) THEN RAISE EXCEPTION 'Window cannot be revived'; END IF;
 o:=zhiban_reconcile_catalog.observe(w.business_oid,w.native_oid);t:=zhiban_reconcile.now_ms();
 IF w.phase='PREPARING' THEN
  -- Preclosed bootstrap may register the NEW maintained clients; never refresh after DRAINED.
  UPDATE zhiban_reconcile.windows SET allowlist=(SELECT jsonb_agg(b ORDER BY ord) FROM jsonb_array_elements(o->'backends') WITH ORDINALITY q(b,ord)
   WHERE b->>'role' IN('zhiban_reconcile_controller','zhiban_reconcile_issuer','zhiban_reconcile_executor','zhiban_reconcile_native_proof')) WHERE window_id=p_window;
 END IF;
 UPDATE zhiban_reconcile.windows SET phase=CASE WHEN phase='PREPARING' THEN 'DRAINED' ELSE phase END,
  barrier_seq=barrier_seq+1,barrier_at=t,lease_until=t+60000 WHERE window_id=p_window;
 PERFORM zhiban_reconcile.assert_barrier(p_window);
 INSERT INTO zhiban_reconcile.control_events(deployment_id,window_id,event_type,actor_role,occurred_at,provenance_digest,facts)
 VALUES(w.deployment_id,p_window,'BARRIER_CHECKED',session_user,t,w.nonce_digest,jsonb_build_object('epoch',w.epoch::text));
 RETURN w.barrier_seq+1;
END $$;
CREATE FUNCTION zhiban_reconcile.takeover_blocked_window(p_old uuid,p_new uuid,p_request uuid,p_nonce text,p_secret text)
RETURNS uuid LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE w zhiban_reconcile.windows%ROWTYPE;i zhiban_reconcile.installations%ROWTYPE;o jsonb;n bigint;t bigint;allow jsonb;
BEGIN
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=p_old;
 PERFORM zhiban_reconcile.controller_context(w.deployment_id,p_secret);
 PERFORM 1 FROM zhiban_reconcile.services WHERE service_ref=w.service_ref FOR UPDATE;
 SELECT epoch INTO n FROM zhiban_reconcile.epoch_counters WHERE deployment_id=w.deployment_id FOR UPDATE;
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=p_old FOR UPDATE;
 IF w.phase IN('CLOSED','SUPERSEDED') OR n IS NULL OR n=9223372036854775807 THEN RAISE EXCEPTION 'Old window is not current'; END IF;
 SELECT * INTO i FROM zhiban_reconcile.installations WHERE deployment_id=w.deployment_id;
 PERFORM 1 FROM zhiban_reconcile.window_database_claims WHERE cluster_identifier=w.cluster_identifier AND database_oid IN(w.business_oid,w.native_oid) ORDER BY database_oid FOR UPDATE;
 IF (SELECT count(*) FROM zhiban_reconcile.window_database_claims WHERE cluster_identifier=w.cluster_identifier AND database_oid IN(w.business_oid,w.native_oid) AND current_window_id=p_old)<>2 THEN RAISE EXCEPTION 'Claim mismatch'; END IF;
 o:=zhiban_reconcile_catalog.observe(w.business_oid,w.native_oid);t:=zhiban_reconcile.now_ms();
 -- Only the fresh controller may exist. Native remains closed; Business temporary admission only.
 IF o->>'cluster' IS DISTINCT FROM i.cluster_identifier OR jsonb_array_length(o->'databases')<>2
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o->'databases') d WHERE d->>'oid'=i.business_oid::text AND (d->>'allowConnections')::boolean)
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(o->'databases') d WHERE d->>'oid'=i.native_oid::text AND NOT (d->>'allowConnections')::boolean)
  OR (o->>'writerLogins')::integer<>0 OR (o->>'subscriptions')::integer<>0 OR (o->>'preparedEnabled')::boolean OR (o->>'prepared')::integer<>0
  OR jsonb_array_length(o->'backends')<>1 OR o->'backends'->0->>'role'<>session_user
  OR (o->'backends'->0->>'pid')::integer<>pg_backend_pid()
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(w.allowlist) b WHERE b->>'pid'=o->'backends'->0->>'pid' AND b->>'start'=o->'backends'->0->>'start') THEN
  RAISE EXCEPTION 'Recovery bootstrap/drain rejected';
 END IF;
 PERFORM 1 FROM zhiban_reconcile.grants WHERE window_id=p_old ORDER BY grant_id FOR UPDATE;
 UPDATE zhiban_reconcile.grants SET status='REVOKED' WHERE window_id=p_old AND status='ISSUED';
 UPDATE zhiban_reconcile.windows SET phase='BLOCKED' WHERE window_id=p_old;
 UPDATE zhiban_reconcile.windows SET phase='SUPERSEDED',successor_id=p_new WHERE window_id=p_old;
 INSERT INTO zhiban_reconcile.windows(window_id,service_ref,deployment_id,epoch,phase,predecessor_id,takeover_request_id,
  cluster_identifier,business_oid,native_oid,postmaster_start,nonce_digest,build_digest,allowlist,lease_until,created_at)
 VALUES(p_new,w.service_ref,w.deployment_id,n+1,'PREPARING',p_old,p_request,i.cluster_identifier,i.business_oid,i.native_oid,
  (o->>'postmasterStart')::timestamptz,zhiban_reconcile.secret_digest(p_nonce),i.implementation_digest,o->'backends',t+60000,t);
 UPDATE zhiban_reconcile.epoch_counters SET epoch=n+1 WHERE deployment_id=w.deployment_id;
 UPDATE zhiban_reconcile.window_database_claims SET current_window_id=p_new WHERE current_window_id=p_old;
 INSERT INTO zhiban_reconcile.control_events(deployment_id,window_id,event_type,actor_role,occurred_at,provenance_digest,facts)
 VALUES(w.deployment_id,p_old,'WINDOW_SUPERSEDED',session_user,t,zhiban_reconcile.secret_digest(p_nonce),jsonb_build_object('successor',p_new,'takeoverRequest',p_request,'epoch',(n+1)::text));
 SET CONSTRAINTS ALL IMMEDIATE;
 RETURN p_new;
END $$;
CREATE FUNCTION zhiban_reconcile.begin_resume(p_window uuid,p_secret text) RETURNS void
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE w zhiban_reconcile.windows%ROWTYPE;
BEGIN
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=p_window;
 PERFORM zhiban_reconcile.controller_context(w.deployment_id,p_secret);
 PERFORM 1 FROM zhiban_reconcile.services WHERE service_ref=w.service_ref FOR UPDATE;
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=p_window FOR UPDATE;
 IF w.phase NOT IN('DRAINED','PROVING','SETTLING') THEN RAISE EXCEPTION 'Normal resume rejected'; END IF;
 PERFORM 1 FROM zhiban_reconcile.grants WHERE window_id=p_window ORDER BY grant_id FOR UPDATE;
 UPDATE zhiban_reconcile.grants SET status='REVOKED' WHERE window_id=p_window AND status='ISSUED';
 UPDATE zhiban_reconcile.windows SET phase='RESUMING' WHERE window_id=p_window;
 INSERT INTO zhiban_reconcile.control_events(deployment_id,window_id,event_type,actor_role,occurred_at,provenance_digest,facts)
 VALUES(w.deployment_id,p_window,'RESUMING',session_user,zhiban_reconcile.now_ms(),w.nonce_digest,'{}');
END $$;
CREATE FUNCTION zhiban_reconcile.complete_resume(p_window uuid,p_secret text) RETURNS void
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE w zhiban_reconcile.windows%ROWTYPE;o jsonb;
BEGIN
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=p_window;
 PERFORM zhiban_reconcile.controller_context(w.deployment_id,p_secret);
 PERFORM 1 FROM zhiban_reconcile.services WHERE service_ref=w.service_ref FOR UPDATE;
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=p_window FOR UPDATE;
 PERFORM 1 FROM zhiban_reconcile.window_database_claims WHERE current_window_id=p_window ORDER BY database_oid FOR UPDATE;
 o:=zhiban_reconcile_catalog.observe(w.business_oid,w.native_oid);
 IF w.phase<>'RESUMING' OR jsonb_array_length(o->'databases')<>2
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(o->'databases') d WHERE NOT (d->>'allowConnections')::boolean)
  OR EXISTS(SELECT 1 FROM zhiban_reconcile.grants WHERE window_id=p_window AND status='ISSUED') THEN RAISE EXCEPTION 'Resume incomplete'; END IF;
 UPDATE zhiban_reconcile.windows SET phase='CLOSED' WHERE window_id=p_window;
 UPDATE zhiban_reconcile.window_database_claims SET current_window_id=NULL WHERE current_window_id=p_window;
 INSERT INTO zhiban_reconcile.control_events(deployment_id,window_id,event_type,actor_role,occurred_at,provenance_digest,facts)
 VALUES(w.deployment_id,p_window,'CLOSED',session_user,zhiban_reconcile.now_ms(),w.nonce_digest,'{}');
END $$;
CREATE FUNCTION zhiban_reconcile.set_service_status(p_service text,p_status text,p_provenance text,p_secret text) RETURNS bigint
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE v zhiban_reconcile.services%ROWTYPE;t bigint;
BEGIN
 SELECT * INTO v FROM zhiban_reconcile.services WHERE service_ref=p_service;
 PERFORM zhiban_reconcile.controller_context(v.deployment_id,p_secret);
 SELECT * INTO v FROM zhiban_reconcile.services WHERE service_ref=p_service FOR UPDATE;
 IF p_status NOT IN('ACTIVE','REVOKED') OR p_status IS NULL OR v.authorization_version=9223372036854775807 THEN RAISE EXCEPTION 'Service transition rejected'; END IF;
 t:=zhiban_reconcile.now_ms();
 INSERT INTO zhiban_reconcile.service_versions VALUES(p_service,v.authorization_version+1,p_status,p_provenance,t);
 UPDATE zhiban_reconcile.services SET authorization_version=authorization_version+1,status=p_status WHERE service_ref=p_service;
 INSERT INTO zhiban_reconcile.control_events(deployment_id,event_type,actor_role,occurred_at,provenance_digest,facts)
 VALUES(v.deployment_id,'SERVICE_VERSION',session_user,t,p_provenance,jsonb_build_object('service',p_service,'version',(v.authorization_version+1)::text));
 RETURN v.authorization_version+1;
END $$;
CREATE FUNCTION zhiban_reconcile.issue_result_lookup(p_tenant uuid,p_lookup uuid,p_deployment uuid,p_operation uuid,p_request uuid,p_role text,p_lookup_secret text,p_provenance text,p_controller_secret text)
RETURNS void LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,zhiban_content,zhiban_bridge,pg_temp SET row_security=on AS $$
DECLARE c zhiban_content.operations%ROWTYPE;t bigint;
BEGIN
 PERFORM zhiban_reconcile.controller_context(p_deployment,p_controller_secret);PERFORM zhiban_reconcile.tenant_context(p_tenant);
 SELECT * INTO c FROM zhiban_content.operations WHERE tenant_id=p_tenant AND id=p_operation;
 IF c.id IS NULL OR NOT EXISTS(SELECT 1 FROM zhiban_bridge.operations b JOIN zhiban_bridge.resource_slots s ON (s.tenant_id,s.slot_id)=(b.tenant_id,b.slot_id)
  WHERE b.tenant_id=p_tenant AND b.operation_id=c.prepare_operation_id AND s.deployment_id=p_deployment) THEN RAISE EXCEPTION 'Lookup scope rejected'; END IF;
 t:=zhiban_reconcile.now_ms();
 INSERT INTO zhiban_reconcile.lookup_permissions VALUES(p_tenant,p_lookup,p_deployment,c.resource_id,p_operation,p_request,p_role,
  zhiban_reconcile.secret_digest(p_lookup_secret),p_provenance,'ACTIVE',t,t+300000);
 INSERT INTO zhiban_reconcile.control_events(deployment_id,event_type,actor_role,occurred_at,provenance_digest,facts)
 VALUES(p_deployment,'LOOKUP_ISSUED',session_user,t,p_provenance,
  jsonb_build_object('tenantId',p_tenant,'lookupId',p_lookup,'operationId',p_operation,'requestId',p_request,'callerRole',p_role));
END $$;
CREATE FUNCTION zhiban_reconcile.revoke_result_lookup(p_tenant uuid,p_lookup uuid,p_provenance text,p_secret text) RETURNS void
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE a zhiban_reconcile.lookup_permissions%ROWTYPE;t bigint;
BEGIN
 PERFORM zhiban_reconcile.tenant_context(p_tenant);
 SELECT * INTO a FROM zhiban_reconcile.lookup_permissions WHERE tenant_id=p_tenant AND lookup_id=p_lookup;
 PERFORM zhiban_reconcile.controller_context(a.deployment_id,p_secret);
 SELECT * INTO a FROM zhiban_reconcile.lookup_permissions WHERE tenant_id=p_tenant AND lookup_id=p_lookup FOR UPDATE;
 IF a.lookup_id IS NULL THEN RAISE EXCEPTION 'Lookup scope rejected' USING ERRCODE='42501'; END IF;
 -- Repeated revoke is a successful no-op, not a second lifecycle event.
 IF a.status='REVOKED' THEN RETURN; END IF;
 t:=zhiban_reconcile.now_ms();
 UPDATE zhiban_reconcile.lookup_permissions SET status='REVOKED' WHERE tenant_id=p_tenant AND lookup_id=p_lookup;
 INSERT INTO zhiban_reconcile.control_events(deployment_id,event_type,actor_role,occurred_at,provenance_digest,facts)
 VALUES(a.deployment_id,'LOOKUP_REVOKED',session_user,t,p_provenance,
  jsonb_build_object('tenantId',p_tenant,'lookupId',p_lookup,'operationId',a.content_operation_id,'requestId',a.request_id,'callerRole',a.caller_role));
END $$;
CREATE FUNCTION zhiban_reconcile.read_resolution(p_tenant uuid,p_operation uuid,p_request uuid,p_lookup uuid,p_secret text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE a zhiban_reconcile.lookup_permissions%ROWTYPE;x zhiban_reconcile.resolutions%ROWTYPE;
BEGIN
 PERFORM zhiban_reconcile.tenant_context(p_tenant);
 IF session_user NOT IN('zhiban_reconcile_issuer','zhiban_reconcile_executor') THEN RAISE EXCEPTION 'Lookup caller rejected'; END IF;
 SELECT * INTO a FROM zhiban_reconcile.lookup_permissions WHERE tenant_id=p_tenant AND lookup_id=p_lookup FOR SHARE;
 IF a.lookup_id IS NULL OR a.status<>'ACTIVE' OR a.expires_at<=zhiban_reconcile.now_ms() OR a.caller_role<>session_user
  OR a.content_operation_id<>p_operation OR a.request_id<>p_request OR a.token_digest IS DISTINCT FROM zhiban_reconcile.secret_digest(p_secret) THEN RAISE EXCEPTION 'Lookup capability rejected'; END IF;
 SELECT * INTO x FROM zhiban_reconcile.resolutions WHERE tenant_id=p_tenant AND content_operation_id=p_operation AND request_id=p_request AND resource_id=a.resource_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','NOT_OBSERVED','replayAllowed',false); END IF;
 IF NOT zhiban_reconcile.assert_resolution_history(p_tenant,x.resolution_id) THEN RAISE EXCEPTION 'Historical result rejected'; END IF;
 RETURN to_jsonb(x)||jsonb_build_object('evidenceOrigin','LOCAL','githubActions',false,'replayAllowed',false,'publicationChanged',false);
END $$;
CREATE FUNCTION zhiban_reconcile.read_recovery_result(p_tenant uuid,p_operation uuid,p_request uuid,p_deployment uuid,p_secret text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,zhiban_bridge,pg_temp SET row_security=on AS $$
DECLARE x zhiban_reconcile.resolutions%ROWTYPE;
BEGIN
 PERFORM zhiban_reconcile.controller_context(p_deployment,p_secret);PERFORM zhiban_reconcile.tenant_context(p_tenant);
 SELECT q.* INTO x FROM zhiban_reconcile.resolutions q JOIN zhiban_bridge.resource_slots s ON (s.tenant_id,s.slot_id)=(q.tenant_id,q.slot_id)
 WHERE q.tenant_id=p_tenant AND q.content_operation_id=p_operation AND q.request_id=p_request AND s.deployment_id=p_deployment;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','NOT_OBSERVED','replayAllowed',false); END IF;
 IF NOT zhiban_reconcile.assert_resolution_history(p_tenant,x.resolution_id) THEN RAISE EXCEPTION 'Historical result rejected'; END IF;
 RETURN to_jsonb(x)||jsonb_build_object('evidenceOrigin','LOCAL','githubActions',false,'replayAllowed',false,'publicationChanged',false);
END $$;

-- Current controller authority; no raw window/claim table access or write replay.
CREATE FUNCTION zhiban_reconcile.read_takeover_result(p_deployment uuid,p_old uuid,p_new uuid,p_request uuid,p_secret text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE old_w zhiban_reconcile.windows%ROWTYPE;new_w zhiban_reconcile.windows%ROWTYPE;
 current_w zhiban_reconcile.windows%ROWTYPE;i zhiban_reconcile.installations%ROWTYPE;claims jsonb;
BEGIN
 PERFORM zhiban_reconcile.controller_context(p_deployment,p_secret);
 IF p_old IS NULL OR p_new IS NULL OR p_request IS NULL OR p_old=p_new THEN RAISE EXCEPTION 'Takeover lookup scope rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO old_w FROM zhiban_reconcile.windows WHERE deployment_id=p_deployment AND window_id=p_old;
 IF NOT FOUND THEN RAISE EXCEPTION 'Takeover lookup scope rejected' USING ERRCODE='42501'; END IF;
 -- Same lock order as takeover/resume. Stabilize historical pair and current claims.
 PERFORM 1 FROM zhiban_reconcile.services WHERE service_ref=old_w.service_ref FOR SHARE;
 PERFORM 1 FROM zhiban_reconcile.epoch_counters WHERE deployment_id=p_deployment FOR SHARE;
 PERFORM 1 FROM zhiban_reconcile.windows WHERE deployment_id=p_deployment AND window_id IN(p_old,p_new) ORDER BY window_id FOR SHARE;
 SELECT * INTO old_w FROM zhiban_reconcile.windows WHERE window_id=p_old;
 SELECT * INTO i FROM zhiban_reconcile.installations WHERE deployment_id=p_deployment;
 PERFORM 1 FROM zhiban_reconcile.window_database_claims WHERE cluster_identifier=i.cluster_identifier
  AND database_oid IN(i.business_oid,i.native_oid) ORDER BY database_oid FOR SHARE;
 SELECT jsonb_agg(jsonb_build_object('databaseOid',database_oid::text,'windowId',current_window_id) ORDER BY database_oid)
 INTO claims FROM zhiban_reconcile.window_database_claims WHERE cluster_identifier=i.cluster_identifier AND database_oid IN(i.business_oid,i.native_oid);
 IF jsonb_array_length(claims) IS DISTINCT FROM 2 OR claims->0->>'windowId' IS DISTINCT FROM claims->1->>'windowId' THEN
  RAISE EXCEPTION 'Current claims inconsistent' USING ERRCODE='23514'; END IF;
 SELECT * INTO current_w FROM zhiban_reconcile.windows WHERE deployment_id=p_deployment AND window_id=(claims->0->>'windowId')::uuid;
 IF claims->0->>'windowId' IS NOT NULL AND current_w.window_id IS NULL THEN RAISE EXCEPTION 'Current claims scope rejected' USING ERRCODE='23514'; END IF;
 SELECT * INTO new_w FROM zhiban_reconcile.windows WHERE deployment_id=p_deployment AND takeover_request_id=p_request;
 IF NOT FOUND THEN
  IF old_w.successor_id IS NOT NULL OR EXISTS(SELECT 1 FROM zhiban_reconcile.windows WHERE window_id=p_new) THEN
   RAISE EXCEPTION 'Takeover lookup scope rejected' USING ERRCODE='42501'; END IF;
  RETURN jsonb_build_object('status','NOT_OBSERVED','oldWindowId',p_old,'oldPhase',old_w.phase,'claims',claims,
   'currentWindowId',current_w.window_id,'currentEpoch',current_w.epoch::text,'replayAllowed',false,'evidenceOrigin','LOCAL','githubActions',false);
 END IF;
 IF new_w.window_id<>p_new OR new_w.predecessor_id IS DISTINCT FROM p_old OR old_w.successor_id IS DISTINCT FROM p_new
  OR old_w.phase<>'SUPERSEDED' OR new_w.epoch<=old_w.epoch THEN RAISE EXCEPTION 'Takeover lookup scope rejected' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('status','COMMITTED','oldWindowId',p_old,'newWindowId',p_new,'takeoverRequestId',p_request,
  'oldEpoch',old_w.epoch::text,'newEpoch',new_w.epoch::text,'newPhase',new_w.phase,
  'successorIsCurrent',current_w.window_id IS NOT DISTINCT FROM p_new,'claims',claims,
  'currentWindowId',current_w.window_id,'currentEpoch',current_w.epoch::text,'currentPhase',current_w.phase,
  'replayAllowed',false,'evidenceOrigin','LOCAL','githubActions',false);
END $$;

-- Exact historical CLOSED acknowledgement. Observation is never restore authority.
CREATE FUNCTION zhiban_reconcile.read_closed_result(p_deployment uuid,p_window uuid,p_epoch bigint,p_secret text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE w zhiban_reconcile.windows%ROWTYPE; i zhiban_reconcile.installations%ROWTYPE;
 claims jsonb; closed_event zhiban_reconcile.control_events%ROWTYPE; resume_event zhiban_reconcile.control_events%ROWTYPE;
BEGIN
 PERFORM zhiban_reconcile.controller_context(p_deployment,p_secret);
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE deployment_id=p_deployment AND window_id=p_window;
 IF NOT FOUND OR p_epoch IS NULL OR w.epoch IS DISTINCT FROM p_epoch THEN RAISE EXCEPTION 'Closed lookup scope rejected' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM zhiban_reconcile.services WHERE service_ref=w.service_ref FOR SHARE;
 PERFORM 1 FROM zhiban_reconcile.epoch_counters WHERE deployment_id=p_deployment FOR SHARE;
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=p_window FOR SHARE;
 SELECT * INTO i FROM zhiban_reconcile.installations WHERE deployment_id=p_deployment;
 IF w.cluster_identifier IS DISTINCT FROM i.cluster_identifier OR w.business_oid IS DISTINCT FROM i.business_oid OR w.native_oid IS DISTINCT FROM i.native_oid THEN
  RAISE EXCEPTION 'Closed lookup installation rejected' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM zhiban_reconcile.window_database_claims WHERE cluster_identifier=i.cluster_identifier AND database_oid IN(i.business_oid,i.native_oid) ORDER BY database_oid FOR SHARE;
 SELECT jsonb_agg(jsonb_build_object('databaseOid',database_oid::text,'windowId',current_window_id) ORDER BY database_oid)
 INTO claims FROM zhiban_reconcile.window_database_claims WHERE cluster_identifier=i.cluster_identifier AND database_oid IN(i.business_oid,i.native_oid);
 IF jsonb_array_length(claims) IS DISTINCT FROM 2 OR claims->0->>'windowId' IS DISTINCT FROM claims->1->>'windowId' THEN
  RAISE EXCEPTION 'Closed lookup claims inconsistent' USING ERRCODE='23514'; END IF;
 IF w.phase='CLOSED' THEN
  IF claims->0->>'windowId'=p_window::text OR EXISTS(SELECT 1 FROM zhiban_reconcile.grants WHERE window_id=p_window AND status='ISSUED')
   OR (SELECT count(*) FROM zhiban_reconcile.control_events WHERE deployment_id=p_deployment AND window_id=p_window AND event_type='CLOSED')<>1
   OR (SELECT count(*) FROM zhiban_reconcile.control_events WHERE deployment_id=p_deployment AND window_id=p_window AND event_type='RESUMING')<>1 THEN
   RAISE EXCEPTION 'Closed history inconsistent' USING ERRCODE='23514'; END IF;
  SELECT * INTO closed_event FROM zhiban_reconcile.control_events WHERE deployment_id=p_deployment AND window_id=p_window AND event_type='CLOSED';
  SELECT * INTO resume_event FROM zhiban_reconcile.control_events WHERE deployment_id=p_deployment AND window_id=p_window AND event_type='RESUMING';
  IF closed_event.actor_role<>'zhiban_reconcile_controller' OR resume_event.actor_role<>closed_event.actor_role
   OR closed_event.provenance_digest<>w.nonce_digest OR resume_event.provenance_digest<>w.nonce_digest
   OR resume_event.sequence>=closed_event.sequence OR resume_event.occurred_at>closed_event.occurred_at THEN
   RAISE EXCEPTION 'Closed audit mismatch' USING ERRCODE='23514'; END IF;
 ELSIF EXISTS(SELECT 1 FROM zhiban_reconcile.control_events WHERE deployment_id=p_deployment AND window_id=p_window AND event_type='CLOSED') THEN
  RAISE EXCEPTION 'Closed phase mismatch' USING ERRCODE='23514';
 END IF;
 RETURN jsonb_build_object('status',CASE WHEN w.phase='CLOSED' THEN 'COMMITTED_CLOSED' ELSE 'NOT_CLOSED' END,
  'deploymentId',p_deployment,'windowId',p_window,'epoch',w.epoch::text,'phase',w.phase,
  'closedEventSequence',closed_event.sequence::text,'closedAt',closed_event.occurred_at::text,
  'claims',claims,'currentWindowId',claims->0->>'windowId',
  'replayAllowed',false,'restoreAllowed',false,'clearMaintenanceFlagAllowed',false,'evidenceOrigin','LOCAL','githubActions',false);
END $$;
