-- UNAPPLIED; current authority is checked independently from historical audits.
CREATE FUNCTION zhiban_reconcile.issue_grant(p_tenant uuid,p_window uuid,p_operation uuid,p_grant uuid,p_request uuid,p_secret text,p_approval text,p_proposal text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE w zhiban_reconcile.windows%ROWTYPE;v zhiban_reconcile.services%ROWTYPE;x jsonb;t bigint;
BEGIN
 IF session_user<>'zhiban_reconcile_issuer' THEN RAISE EXCEPTION 'Issuer rejected' USING ERRCODE='42501'; END IF;
 PERFORM zhiban_reconcile.tenant_context(p_tenant);
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=p_window;
 SELECT * INTO v FROM zhiban_reconcile.services WHERE service_ref=w.service_ref FOR SHARE;
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=p_window FOR UPDATE;
 PERFORM zhiban_reconcile.assert_barrier(p_window);
 IF v.status IS DISTINCT FROM 'ACTIVE' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w.allowlist) b
  WHERE (b->>'pid')::integer=pg_backend_pid() AND b->>'role'=session_user AND b->>'databaseOid'=w.business_oid::text) THEN
  RAISE EXCEPTION 'Issuer scope rejected' USING ERRCODE='42501'; END IF;
 x:=zhiban_reconcile.lock_target(p_tenant,p_operation);t:=zhiban_reconcile.now_ms();
 IF zhiban_reconcile.digest(x) IS DISTINCT FROM p_proposal THEN RAISE EXCEPTION 'Approved proposal changed'; END IF;
 IF x->'slot'->>'deployment_id'<>w.deployment_id::text OR w.build_digest<>x->'bindings'->>'implementation_digest' THEN RAISE EXCEPTION 'Source binding rejected'; END IF;
 INSERT INTO zhiban_reconcile.grants(tenant_id,grant_id,resource_id,offering_id,content_operation_id,prepare_operation_id,slot_id,generation_id,
  window_id,epoch,service_ref,authorization_version,capability,request_id,token_digest,proposal_digest,approval_digest,
  source_revision,source_digest,expected_native_digest,key_digest,intent_digest,content_state,prepare_state,prepare_revision,generation_revision,slot_revision,
  owner_handle,stage_ref,scene_digest,source_snapshot,bindings_digest,issued_at,expires_at,status)
 VALUES(p_tenant,p_grant,(x->'resource'->>'id')::uuid,(x->'resource'->>'offering_id')::uuid,p_operation,(x->'prepare'->>'operation_id')::uuid,
  (x->'slot'->>'slot_id')::uuid,(x->'generation'->>'generation_id')::uuid,p_window,w.epoch,v.service_ref,v.authorization_version,
  'CANCEL_UNPUBLISHED_NATIVE_RETAINED_V1',p_request,zhiban_reconcile.secret_digest(p_secret),zhiban_reconcile.digest(x),p_approval,
  (x->'content'->>'source_revision')::bigint,x->'content'->>'source_digest',x->'content'->>'expected_native_digest',x->'content'->>'key_digest',x->'content'->>'intent_digest',
  x->'content'->>'state',x->'prepare'->>'state',(x->'prepare'->>'repository_revision')::bigint,(x->'generation'->>'repository_revision')::bigint,
  (x->'slot'->>'repository_revision')::bigint,x->'generation'->>'owner_handle',x->'generation'->>'stage_ref',zhiban_reconcile.digest(x->'scenes'),x,
  zhiban_reconcile.digest(x->'bindings'),t,t+300000,'ISSUED');
 INSERT INTO zhiban_reconcile.attempts VALUES(p_tenant,p_grant,p_grant,'GRANT_ISSUED',session_user,t);
 RETURN jsonb_build_object('grantId',p_grant,'proposalSha256',zhiban_reconcile.digest(x),'expiresAt',(t+300000)::text,'windowId',p_window,'epoch',w.epoch::text);
END $$;
CREATE FUNCTION zhiban_reconcile.lock_grant(p_tenant uuid,p_grant uuid,p_secret text)
RETURNS zhiban_reconcile.grants LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE a zhiban_reconcile.grants%ROWTYPE;v zhiban_reconcile.services%ROWTYPE;w zhiban_reconcile.windows%ROWTYPE;
BEGIN
 PERFORM zhiban_reconcile.tenant_context(p_tenant);
 SELECT * INTO a FROM zhiban_reconcile.grants WHERE tenant_id=p_tenant AND grant_id=p_grant;
 SELECT * INTO v FROM zhiban_reconcile.services WHERE service_ref=a.service_ref FOR SHARE;
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=a.window_id FOR UPDATE;
 SELECT * INTO a FROM zhiban_reconcile.grants WHERE tenant_id=p_tenant AND grant_id=p_grant FOR UPDATE;
 IF a.grant_id IS NULL OR a.status<>'ISSUED' OR a.expires_at<=zhiban_reconcile.now_ms()
  OR a.token_digest IS DISTINCT FROM zhiban_reconcile.secret_digest(p_secret) OR v.status IS DISTINCT FROM 'ACTIVE'
  OR v.authorization_version<>a.authorization_version OR w.epoch<>a.epoch OR w.service_ref<>a.service_ref
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w.allowlist) b WHERE (b->>'pid')::integer=pg_backend_pid() AND b->>'role'=session_user) THEN
  RAISE EXCEPTION 'Current grant rejected' USING ERRCODE='42501';
 END IF;
 PERFORM zhiban_reconcile.assert_barrier(a.window_id);
 RETURN a;
END $$;
CREATE FUNCTION zhiban_reconcile.revoke_grant(p_tenant uuid,p_grant uuid,p_event uuid) RETURNS void
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE a zhiban_reconcile.grants%ROWTYPE;
BEGIN
 IF session_user<>'zhiban_reconcile_issuer' THEN RAISE EXCEPTION 'Issuer rejected'; END IF;
 PERFORM zhiban_reconcile.tenant_context(p_tenant);
 SELECT * INTO a FROM zhiban_reconcile.grants WHERE tenant_id=p_tenant AND grant_id=p_grant;
 PERFORM 1 FROM zhiban_reconcile.services WHERE service_ref=a.service_ref FOR UPDATE;
 PERFORM 1 FROM zhiban_reconcile.windows WHERE window_id=a.window_id FOR UPDATE;
 SELECT * INTO a FROM zhiban_reconcile.grants WHERE tenant_id=p_tenant AND grant_id=p_grant FOR UPDATE;
 IF a.grant_id IS NULL THEN RAISE EXCEPTION 'Grant not found'; END IF;
 IF a.status='ISSUED' THEN
  UPDATE zhiban_reconcile.grants SET status='REVOKED' WHERE tenant_id=p_tenant AND grant_id=p_grant;
  INSERT INTO zhiban_reconcile.attempts VALUES(p_tenant,p_event,p_grant,'GRANT_REVOKED',session_user,zhiban_reconcile.now_ms());
 END IF;
END $$;
CREATE FUNCTION zhiban_reconcile.register_proof(p_tenant uuid,p_grant uuid,p_secret text,p_proof uuid,p_document_digest text,p_manifest_digest text,p_observations jsonb)
RETURNS uuid LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE a zhiban_reconcile.grants%ROWTYPE;w zhiban_reconcile.windows%ROWTYPE;t bigint;
BEGIN
 IF session_user<>'zhiban_reconcile_executor' THEN RAISE EXCEPTION 'Proof worker rejected'; END IF;
 a:=zhiban_reconcile.lock_grant(p_tenant,p_grant,p_secret);
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=a.window_id;t:=zhiban_reconcile.now_ms();
 IF p_document_digest IS DISTINCT FROM a.expected_native_digest OR jsonb_typeof(p_observations)<>'array' OR jsonb_array_length(p_observations)<>2
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_observations) WITH ORDINALITY q(o,ord)
    WHERE NOT (o ?& ARRAY['method','isolation','transactionMode','outcome','epoch','bindingsDigest','startedAt','endedAt','barrierBefore','barrierAfter','backendPid','backendStart','leaseId'])
     OR (SELECT count(*) FROM jsonb_object_keys(o))<>13 OR o->>'method' IS DISTINCT FROM CASE ord WHEN 1 THEN 'readFreshnessManifest' ELSE 'loadDocument' END
     OR o->>'isolation' IS DISTINCT FROM 'read committed' OR o->>'transactionMode' IS DISTINCT FROM 'read write'
     OR o->>'outcome' IS DISTINCT FROM 'COMMITTED' OR o->>'epoch' IS DISTINCT FROM a.epoch::text
     OR o->>'bindingsDigest' IS DISTINCT FROM a.bindings_digest::text
     OR o->>'startedAt' IS NULL OR o->>'endedAt' IS NULL OR o->>'barrierBefore' IS NULL OR o->>'barrierAfter' IS NULL
     OR (o->>'startedAt')::bigint<a.issued_at OR (o->>'endedAt')::bigint<(o->>'startedAt')::bigint
     OR (o->>'endedAt')::bigint>t OR t-(o->>'endedAt')::bigint>10000
     OR (o->>'barrierBefore')::bigint<=0 OR (o->>'barrierAfter')::bigint<(o->>'barrierBefore')::bigint
     OR (o->>'barrierAfter')::bigint>w.barrier_seq OR o->>'leaseId' IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w.allowlist) b
       WHERE b->>'role'='zhiban_reconcile_native_proof' AND b->>'databaseOid'=w.native_oid::text
        AND b->>'pid'=o->>'backendPid' AND b->>'start'=o->>'backendStart'))
  OR p_observations->0->>'leaseId' IS NULL OR p_observations->1->>'leaseId' IS NULL
  OR p_observations->0->>'leaseId'=p_observations->1->>'leaseId'
  OR (p_observations->0->>'endedAt')::bigint>(p_observations->1->>'startedAt')::bigint
  OR (p_observations->1->>'barrierBefore')::bigint<(p_observations->0->>'barrierAfter')::bigint THEN
  RAISE EXCEPTION 'Full public observation rejected' USING ERRCODE='23514';
 END IF;
 INSERT INTO zhiban_reconcile.proofs VALUES(p_tenant,p_proof,p_grant,a.window_id,a.epoch,'FULL_PUBLIC_DOCUMENT_MATCH',
  a.expected_native_digest,p_document_digest,p_manifest_digest,p_observations,t,a.expires_at);
 RETURN p_proof;
END $$;
CREATE FUNCTION zhiban_reconcile.finalize_cancel_unpublished(p_tenant uuid,p_grant uuid,p_secret text,p_resolution uuid,p_content_audit uuid,p_bridge_audit uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,zhiban_content,zhiban_bridge,pg_temp SET row_security=on AS $$
DECLARE a zhiban_reconcile.grants%ROWTYPE;f zhiban_reconcile.proofs%ROWTYPE;x jsonb;t bigint;
BEGIN
 IF session_user<>'zhiban_reconcile_executor' THEN RAISE EXCEPTION 'Executor rejected'; END IF;
 a:=zhiban_reconcile.lock_grant(p_tenant,p_grant,p_secret);
 SELECT * INTO f FROM zhiban_reconcile.proofs WHERE tenant_id=p_tenant AND grant_id=p_grant FOR SHARE;
 IF f.proof_id IS NULL OR f.expires_at<=zhiban_reconcile.now_ms() OR f.window_id<>a.window_id OR f.epoch<>a.epoch THEN RAISE EXCEPTION 'Proof missing/expired'; END IF;
 x:=zhiban_reconcile.lock_target(p_tenant,a.content_operation_id);
 IF x IS DISTINCT FROM a.source_snapshot OR zhiban_reconcile.digest(x)<>a.proposal_digest
  OR zhiban_reconcile.digest(x->'bindings')<>a.bindings_digest THEN RAISE EXCEPTION 'Target/source changed'; END IF;
 t:=zhiban_reconcile.now_ms();
 IF t<(x->'prepare'->>'updated_at')::bigint OR t<(x->'generation'->>'updated_at')::bigint OR t<a.issued_at THEN RAISE EXCEPTION 'Clock rejected'; END IF;
 INSERT INTO zhiban_reconcile.write_scopes VALUES(pg_backend_pid(),txid_current(),p_tenant,a.resource_id,a.content_operation_id,
  a.prepare_operation_id,a.generation_id,p_resolution,p_content_audit,p_bridge_audit,t);
 INSERT INTO zhiban_reconcile.resolutions VALUES(p_tenant,p_resolution,p_grant,f.proof_id,a.resource_id,a.content_operation_id,
  a.prepare_operation_id,a.generation_id,a.slot_id,a.service_ref,a.authorization_version,a.request_id,'COMMITTED',
  'CANCELLED_UNPUBLISHED_NATIVE_RETAINED',t,p_content_audit,p_bridge_audit,a.prepare_revision+1,a.generation_revision+1,a.slot_revision);
 UPDATE zhiban_bridge.operations SET state='SUCCEEDED',reason='NONE',result_generation_id=a.generation_id,result_slot_revision=a.slot_revision,
  completed_at=t,updated_at=t,repository_revision=repository_revision+1 WHERE tenant_id=p_tenant AND operation_id=a.prepare_operation_id;
 UPDATE zhiban_bridge.resource_generations SET state='ORPHAN',terminal_at=t,updated_at=t,repository_revision=repository_revision+1
  WHERE tenant_id=p_tenant AND generation_id=a.generation_id;
 UPDATE zhiban_content.operations SET state='FAILED',completed_at=t WHERE tenant_id=p_tenant AND id=a.content_operation_id;
 INSERT INTO zhiban_content.audit_events(tenant_id,id,resource_id,operation_id,actor_id,event_type,revision_before,revision_after,occurred_at,actor_kind,service_ref,reconciliation_id)
 VALUES(p_tenant,p_content_audit,a.resource_id,a.content_operation_id,NULL,'CONTENT_RECONCILED_UNPUBLISHED',a.source_revision,a.source_revision,t,'SERVICE_RECONCILE',a.service_ref,p_resolution);
 INSERT INTO zhiban_bridge.audit_events(tenant_id,event_id,slot_id,operation_id,event_type,actor_kind,actor_user_id,actor_membership_id,service_ref,
  request_id,slot_revision_before,slot_revision_after,occurred_at,reason,reconciliation_id)
 VALUES(p_tenant,p_bridge_audit,a.slot_id,a.prepare_operation_id,'OUTCOME_RECONCILED','SERVICE_RECONCILE',NULL,NULL,a.service_ref,
  a.request_id::text,a.slot_revision,a.slot_revision,t,'NONE',p_resolution);
 UPDATE zhiban_reconcile.grants SET status='CONSUMED',consumed_resolution_id=p_resolution WHERE tenant_id=p_tenant AND grant_id=p_grant;
 INSERT INTO zhiban_reconcile.attempts VALUES(p_tenant,p_resolution,p_grant,'COMMITTED',session_user,t);
 PERFORM zhiban_reconcile.assert_barrier(a.window_id);
 IF a.expires_at<=zhiban_reconcile.now_ms() THEN RAISE EXCEPTION 'Grant expired before final check'; END IF;
 SET CONSTRAINTS ALL IMMEDIATE;
 IF NOT zhiban_reconcile.assert_resolution_history(p_tenant,p_resolution) THEN RAISE EXCEPTION 'Resolution invariant rejected'; END IF;
 DELETE FROM zhiban_reconcile.write_scopes WHERE backend_pid=pg_backend_pid() AND transaction_id=txid_current();
 RETURN p_resolution;
END $$;

CREATE FUNCTION zhiban_reconcile.inspect_proposal(p_tenant uuid,p_window uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE w zhiban_reconcile.windows%ROWTYPE;x jsonb;
BEGIN
 IF session_user NOT IN('zhiban_reconcile_issuer','zhiban_reconcile_executor') THEN RAISE EXCEPTION 'Proposal caller rejected'; END IF;
 PERFORM zhiban_reconcile.tenant_context(p_tenant);
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=p_window;
 PERFORM 1 FROM zhiban_reconcile.services WHERE service_ref=w.service_ref FOR SHARE;
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=p_window FOR UPDATE;
 PERFORM zhiban_reconcile.assert_barrier(p_window);
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w.allowlist) b WHERE (b->>'pid')::integer=pg_backend_pid() AND b->>'role'=session_user) THEN RAISE EXCEPTION 'Proposal backend rejected'; END IF;
 x:=zhiban_reconcile.lock_target(p_tenant,p_operation);
 IF x->'slot'->>'deployment_id' IS DISTINCT FROM w.deployment_id::text THEN RAISE EXCEPTION 'Proposal scope rejected'; END IF;
 RETURN jsonb_build_object('tenantId',p_tenant,'operationId',p_operation,'resourceId',x->'resource'->>'id',
  'contentState',x->'content'->>'state','prepareState',x->'prepare'->>'state',
  'proposalSha256',zhiban_reconcile.digest(x),'expectedNativeDigest',x->'content'->>'expected_native_digest',
  'capability','CANCEL_UNPUBLISHED_NATIVE_RETAINED_V1','publicationChanged',false);
END $$;
