-- UNAPPLIED. Helpers owned by zhiban_identity_owner unless explicitly noted.
CREATE FUNCTION zhiban_reconcile.now_ms() RETURNS bigint
LANGUAGE sql VOLATILE PARALLEL UNSAFE SET search_path=pg_catalog,pg_temp AS $$
 SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint
$$;
CREATE FUNCTION zhiban_reconcile.digest(p_value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
 SELECT encode(sha256(convert_to(p_value::text,'UTF8')),'hex')
$$;
CREATE FUNCTION zhiban_reconcile.secret_digest(p_secret text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_secret !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Capability rejected' USING ERRCODE='42501'; END IF;
 RETURN encode(sha256(convert_to(p_secret,'UTF8')),'hex');
END $$;
CREATE FUNCTION zhiban_reconcile.tenant_context(p_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,zhiban_reconcile,zhiban_identity,pg_temp SET row_security=on AS $$
BEGIN
 IF current_setting('transaction_isolation')<>'read committed' OR p_tenant IS DISTINCT FROM zhiban_identity.current_tenant_id()
    OR zhiban_identity.is_uuid_v7(p_tenant) IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Reconcile tenant context rejected' USING ERRCODE='42501';
 END IF;
END $$;
CREATE FUNCTION zhiban_reconcile.controller_context(p_deployment uuid,p_secret text) RETURNS void
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE a zhiban_reconcile.controller_authorizations%ROWTYPE; observed jsonb;
BEGIN
 IF session_user<>'zhiban_reconcile_controller' OR current_setting('transaction_isolation')<>'read committed' THEN
  RAISE EXCEPTION 'Controller rejected' USING ERRCODE='42501';
 END IF;
 SELECT * INTO a FROM zhiban_reconcile.controller_authorizations WHERE deployment_id=p_deployment FOR SHARE;
 IF NOT FOUND OR a.status<>'ACTIVE' OR a.expires_at<=zhiban_reconcile.now_ms()
    OR a.token_digest IS DISTINCT FROM zhiban_reconcile.secret_digest(p_secret) OR a.backend_pid<>pg_backend_pid() THEN
  RAISE EXCEPTION 'Controller rejected' USING ERRCODE='42501';
 END IF;
 observed:=zhiban_reconcile_catalog.observe((SELECT business_oid FROM zhiban_reconcile.installations WHERE deployment_id=p_deployment),
                                          (SELECT native_oid FROM zhiban_reconcile.installations WHERE deployment_id=p_deployment));
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(observed->'backends') b
  WHERE (b->>'pid')::integer=a.backend_pid AND (b->>'start')::timestamptz=a.backend_start AND b->>'role'=session_user) THEN
  RAISE EXCEPTION 'Controller backend rejected' USING ERRCODE='42501';
 END IF;
END $$;
CREATE FUNCTION zhiban_reconcile.assert_barrier(p_window uuid) RETURNS void
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
DECLARE w zhiban_reconcile.windows%ROWTYPE;i zhiban_reconcile.installations%ROWTYPE;o jsonb;
BEGIN
 SELECT * INTO w FROM zhiban_reconcile.windows WHERE window_id=p_window;
 SELECT * INTO i FROM zhiban_reconcile.installations WHERE deployment_id=w.deployment_id;
 o:=zhiban_reconcile_catalog.observe(w.business_oid,w.native_oid);
 IF w.window_id IS NULL OR i.deployment_id IS NULL OR NOT i.ready OR w.phase NOT IN('DRAINED','PROVING','SETTLING')
  OR w.lease_until<=zhiban_reconcile.now_ms() OR w.barrier_at IS NULL OR w.barrier_at>zhiban_reconcile.now_ms()
  OR zhiban_reconcile.now_ms()-w.barrier_at>10000 OR w.barrier_seq<=0
  OR w.cluster_identifier IS DISTINCT FROM o->>'cluster' OR w.cluster_identifier<>i.cluster_identifier
  OR w.business_oid<>i.business_oid OR w.native_oid<>i.native_oid
  OR w.postmaster_start IS DISTINCT FROM (o->>'postmasterStart')::timestamptz
  OR (o->>'pg')::integer NOT BETWEEN 160000 AND 169999
  OR jsonb_array_length(o->'databases')<>2
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(o->'databases') d WHERE (d->>'allowConnections')::boolean)
  OR (o->>'writerLogins')::integer<>0 OR (o->>'subscriptions')::integer<>0 OR (o->>'preparedEnabled')::boolean OR (o->>'prepared')::integer<>0
  OR o->'backends' IS DISTINCT FROM w.allowlist
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(o->'backends') b WHERE b->>'type'<>'client backend')
  OR (SELECT count(*) FROM zhiban_reconcile.window_database_claims c WHERE c.current_window_id=w.window_id
       AND c.cluster_identifier=w.cluster_identifier AND c.database_oid IN(w.business_oid,w.native_oid))<>2 THEN
  RAISE EXCEPTION 'Offline barrier unavailable' USING ERRCODE='42501';
 END IF;
END $$;
CREATE FUNCTION zhiban_reconcile.append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN RAISE EXCEPTION 'Reconcile history immutable' USING ERRCODE='23514'; END $$;
CREATE FUNCTION zhiban_reconcile.assert_resolution_history(p_tenant uuid,p_resolution uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,zhiban_content,zhiban_bridge,pg_temp SET row_security=on AS $$
DECLARE q record;
BEGIN
 IF p_tenant IS DISTINCT FROM zhiban_identity.current_tenant_id() THEN RETURN false; END IF;
 SELECT x.*,g AS grant_row,f AS proof_row,c AS content_row,b AS prepare_row,n AS generation_row,
  a AS content_audit,e AS bridge_audit,v.status AS version_status
 INTO q FROM zhiban_reconcile.resolutions x
 JOIN zhiban_reconcile.grants g ON (g.tenant_id,g.grant_id)=(x.tenant_id,x.grant_id)
 JOIN zhiban_reconcile.proofs f ON (f.tenant_id,f.proof_id)=(x.tenant_id,x.proof_id)
 JOIN zhiban_content.operations c ON (c.tenant_id,c.id)=(x.tenant_id,x.content_operation_id)
 JOIN zhiban_bridge.operations b ON (b.tenant_id,b.operation_id)=(x.tenant_id,x.prepare_operation_id)
 JOIN zhiban_bridge.resource_generations n ON (n.tenant_id,n.generation_id)=(x.tenant_id,x.generation_id)
 JOIN zhiban_content.audit_events a ON (a.tenant_id,a.id)=(x.tenant_id,x.content_audit_id)
 JOIN zhiban_bridge.audit_events e ON (e.tenant_id,e.event_id)=(x.tenant_id,x.bridge_audit_id)
 JOIN zhiban_reconcile.service_versions v ON (v.service_ref,v.authorization_version)=(x.service_ref,x.authorization_version)
 WHERE x.tenant_id=p_tenant AND x.resolution_id=p_resolution;
 IF NOT FOUND THEN RETURN false; END IF;
 RETURN coalesce(q.state='COMMITTED' AND q.reason='CANCELLED_UNPUBLISHED_NATIVE_RETAINED'
  AND q.version_status='ACTIVE'
  AND (q.grant_row).status='CONSUMED' AND (q.grant_row).consumed_resolution_id=q.resolution_id
  AND ((q.grant_row).resource_id,(q.grant_row).content_operation_id,(q.grant_row).prepare_operation_id,
       (q.grant_row).slot_id,(q.grant_row).generation_id,(q.grant_row).service_ref,(q.grant_row).authorization_version,(q.grant_row).request_id)
     =(q.resource_id,q.content_operation_id,q.prepare_operation_id,q.slot_id,q.generation_id,q.service_ref,q.authorization_version,q.request_id)
  AND (q.proof_row).grant_id=q.grant_id AND (q.proof_row).window_id=(q.grant_row).window_id
  AND (q.proof_row).epoch=(q.grant_row).epoch AND (q.proof_row).expected_digest=(q.grant_row).expected_native_digest
  AND (q.proof_row).document_digest=(q.proof_row).expected_digest
  AND (q.content_row).action='PUBLISH_CONTENT' AND (q.content_row).state='FAILED'
  AND (q.content_row).resource_id=q.resource_id AND (q.content_row).prepare_operation_id=q.prepare_operation_id
  AND (q.content_row).bridge_operation_id IS NULL AND (q.content_row).result_revision IS NULL AND (q.content_row).result_publication_id IS NULL
  AND (q.grant_row).issued_at<=q.completed_at AND (q.grant_row).expires_at>=q.completed_at
  AND (q.proof_row).observed_at<=q.completed_at AND (q.proof_row).expires_at>=q.completed_at
  AND (q.content_row).key_digest=(q.grant_row).key_digest AND (q.content_row).intent_digest=(q.grant_row).intent_digest
  AND (q.content_row).completed_at=q.completed_at AND (q.content_row).source_digest=(q.grant_row).source_digest
  AND (q.content_row).source_revision=(q.grant_row).source_revision AND (q.content_row).expected_native_digest=(q.grant_row).expected_native_digest
  AND (q.prepare_row).operation='PREPARE_CONTENT' AND (q.prepare_row).state='SUCCEEDED' AND (q.prepare_row).actor_kind='USER'
  AND (q.prepare_row).actor_membership_id=(q.content_row).actor_id AND (q.prepare_row).slot_id=q.slot_id
  AND (q.prepare_row).generation_id=q.generation_id AND (q.prepare_row).result_generation_id=q.generation_id
  AND (q.prepare_row).dispatch_started_at IS NOT NULL AND (q.prepare_row).reason='NONE'
  AND (q.prepare_row).key_digest=(q.grant_row).key_digest AND (q.prepare_row).intent_digest=(q.grant_row).intent_digest
  AND (q.prepare_row).result_slot_revision=q.slot_revision AND (q.prepare_row).completed_at=q.completed_at
  AND (q.prepare_row).updated_at=q.completed_at AND (q.prepare_row).repository_revision=q.prepare_revision_after
  AND q.prepare_revision_after=(q.grant_row).prepare_revision+1
  AND (q.generation_row).state='ORPHAN' AND (q.generation_row).activated_at IS NULL
  AND (q.generation_row).slot_id=q.slot_id AND (q.generation_row).content_digest=(q.grant_row).expected_native_digest
  AND (q.generation_row).owner_handle=(q.grant_row).owner_handle AND (q.generation_row).stage_ref=(q.grant_row).stage_ref
  AND (q.generation_row).updated_at=q.completed_at AND (q.generation_row).terminal_at=q.completed_at
  AND (q.generation_row).repository_revision=q.generation_revision_after AND q.generation_revision_after=(q.grant_row).generation_revision+1
  AND (q.content_audit).reconciliation_id=q.resolution_id AND (q.content_audit).actor_kind='SERVICE_RECONCILE'
  AND (q.content_audit).actor_id IS NULL AND (q.content_audit).service_ref=q.service_ref
  AND (q.content_audit).event_type='CONTENT_RECONCILED_UNPUBLISHED' AND (q.content_audit).resource_id=q.resource_id
  AND (q.content_audit).operation_id=q.content_operation_id AND (q.content_audit).occurred_at=q.completed_at
  AND (q.content_audit).revision_before=(q.grant_row).source_revision AND (q.content_audit).revision_after=(q.grant_row).source_revision
  AND (q.bridge_audit).reconciliation_id=q.resolution_id AND (q.bridge_audit).actor_kind='SERVICE_RECONCILE'
  AND (q.bridge_audit).actor_user_id IS NULL AND (q.bridge_audit).actor_membership_id IS NULL
  AND (q.bridge_audit).service_ref=q.service_ref AND (q.bridge_audit).event_type='OUTCOME_RECONCILED'
  AND (q.bridge_audit).slot_id=q.slot_id AND (q.bridge_audit).operation_id=q.prepare_operation_id
  AND (q.bridge_audit).reason='NONE' AND (q.bridge_audit).occurred_at=q.completed_at
  AND (q.bridge_audit).slot_revision_before=q.slot_revision AND (q.bridge_audit).slot_revision_after=q.slot_revision,false);
END $$;
CREATE FUNCTION zhiban_reconcile.resolved_content_audit(p_tenant uuid,p_operation uuid,p_audit uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
 SELECT coalesce(bool_or(zhiban_reconcile.assert_resolution_history(tenant_id,resolution_id)),false)
 FROM zhiban_reconcile.resolutions WHERE tenant_id=p_tenant AND content_operation_id=p_operation AND content_audit_id=p_audit
$$;
CREATE FUNCTION zhiban_reconcile.resolved_bridge_audit(p_tenant uuid,p_operation uuid,p_audit uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,zhiban_reconcile,pg_temp SET row_security=on AS $$
 SELECT coalesce(bool_or(zhiban_reconcile.assert_resolution_history(tenant_id,resolution_id)),false)
 FROM zhiban_reconcile.resolutions WHERE tenant_id=p_tenant AND prepare_operation_id=p_operation AND bridge_audit_id=p_audit
$$;
-- Match JS canonical() for this closed text document: sorted ASCII keys,
-- normalized numbers (coordinates are safe integers), ordered arrays.
CREATE FUNCTION zhiban_reconcile.canonical_text(p jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,zhiban_reconcile,pg_temp AS $$
DECLARE result text;
BEGIN
 CASE jsonb_typeof(p)
 WHEN 'object' THEN SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||zhiban_reconcile.canonical_text(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(p);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(zhiban_reconcile.canonical_text(value),',' ORDER BY ord),'')||']' INTO result FROM jsonb_array_elements(p) WITH ORDINALITY AS a(value,ord);
 WHEN 'number' THEN result:=trim_scale((p::text)::numeric)::text;
 ELSE result:=p::text;
 END CASE;
 RETURN result;
END $$;
CREATE FUNCTION zhiban_reconcile.document_digest(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog,zhiban_reconcile,pg_temp AS $$
 SELECT encode(sha256(convert_to(zhiban_reconcile.canonical_text(p),'UTF8')),'hex')
$$;
CREATE FUNCTION zhiban_reconcile.expected_document(p_draft jsonb,p_stage text,p_refs jsonb,p_at bigint) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE STRICT SET search_path=pg_catalog,zhiban_reconcile,pg_temp AS $$
DECLARE slide jsonb;element jsonb;elements jsonb;scenes jsonb:='[]';canvas jsonb;i integer:=0;
BEGIN
 FOR slide IN SELECT value FROM jsonb_array_elements(p_draft->'slides') LOOP
  elements:='[]';
  FOR element IN SELECT value FROM jsonb_array_elements(slide->'elements') LOOP
   elements:=elements||jsonb_build_array(jsonb_build_object('id',element->>'id','type','text','left',(element->>'x')::bigint,'top',(element->>'y')::bigint,
    'width',(element->>'width')::bigint,'height',(element->>'height')::bigint,'rotate',0,'content',element->>'text','defaultFontName','sans-serif','defaultColor','#111111'));
  END LOOP;
  canvas:=jsonb_build_object('id',slide->>'id','viewportSize',960,'viewportRatio',0.5625,'elements',elements,
   'background',jsonb_build_object('type','solid','color','#ffffff'),
   'theme',jsonb_build_object('backgroundColor','#ffffff','themeColors',jsonb_build_array('#111111'),'fontColor','#111111','fontName','sans-serif'));
  scenes:=scenes||jsonb_build_array(jsonb_build_object('id',p_refs->>i,'stageId',p_stage,'title','第 '||(i+1)||' 页','order',i,
   'type','slide','content',jsonb_build_object('type','slide','canvas',canvas)));
  i:=i+1;
 END LOOP;
 RETURN jsonb_build_object('dslVersion','0.11.2','stage',jsonb_build_object('id',p_stage,'name',p_draft->>'title','createdAt',p_at,'updatedAt',p_at),'scenes',scenes);
END $$;
-- Internal, no client EXECUTE. Locks full target in the documented order.
CREATE FUNCTION zhiban_reconcile.lock_target(p_tenant uuid,p_operation uuid) RETURNS jsonb
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_reconcile,zhiban_content,zhiban_bridge,zhiban_identity,zhiban_academic,pg_temp SET row_security=on AS $$
DECLARE c zhiban_content.operations%ROWTYPE;r zhiban_content.resources%ROWTYPE;b zhiban_bridge.operations%ROWTYPE;
 g zhiban_bridge.resource_generations%ROWTYPE;s zhiban_bridge.resource_slots%ROWTYPE;offer record;course record;
 scene_rows jsonb;refs jsonb;doc jsonb;dep record;
BEGIN
 PERFORM zhiban_reconcile.tenant_context(p_tenant);
 SELECT * INTO c FROM zhiban_content.operations WHERE tenant_id=p_tenant AND id=p_operation;
 SELECT * INTO r FROM zhiban_content.resources WHERE tenant_id=p_tenant AND id=c.resource_id;
 PERFORM 1 FROM zhiban_identity.tenants WHERE tenant_id=p_tenant AND status='ACTIVE' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Target rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO offer FROM zhiban_academic.offerings WHERE tenant_id=p_tenant AND id=r.offering_id FOR SHARE;
 SELECT * INTO course FROM zhiban_academic.courses WHERE tenant_id=p_tenant AND id=offer.course_id FOR SHARE;
 SELECT * INTO r FROM zhiban_content.resources WHERE tenant_id=p_tenant AND id=c.resource_id FOR UPDATE;
 SELECT * INTO b FROM zhiban_bridge.operations WHERE tenant_id=p_tenant AND operation_id=c.prepare_operation_id;
 SELECT * INTO s FROM zhiban_bridge.resource_slots WHERE tenant_id=p_tenant AND slot_id=b.slot_id FOR UPDATE;
 SELECT * INTO g FROM zhiban_bridge.resource_generations WHERE tenant_id=p_tenant AND generation_id=b.generation_id FOR UPDATE;
 SELECT * INTO c FROM zhiban_content.operations WHERE tenant_id=p_tenant AND id=p_operation FOR UPDATE;
 SELECT * INTO b FROM zhiban_bridge.operations WHERE tenant_id=p_tenant AND operation_id=c.prepare_operation_id FOR UPDATE;
 SELECT * INTO dep FROM zhiban_bridge.deployment_registry WHERE deployment_id=s.deployment_id;
 IF c.id IS NULL OR r.id IS NULL OR b.operation_id IS NULL OR g.generation_id IS NULL OR s.slot_id IS NULL
  OR offer.status IS DISTINCT FROM 'OPEN' OR course.status IS NULL OR course.status='ARCHIVED'
  OR c.action<>'PUBLISH_CONTENT' OR c.state NOT IN('RESERVED','OUTCOME_UNKNOWN')
  OR c.bridge_operation_id IS NOT NULL OR c.completed_at IS NOT NULL OR c.result_revision IS NOT NULL OR c.result_publication_id IS NOT NULL
  OR r.kind<>'SLIDE_CONTENT' OR r.policy_version<>'content-text-v1'
  OR r.revision<>c.source_revision OR zhiban_content.draft_digest(r.draft)<>c.source_digest
  OR b.operation<>'PREPARE_CONTENT' OR b.state NOT IN('RESERVED','OUTCOME_UNKNOWN') OR b.dispatch_started_at IS NULL
  OR b.actor_kind<>'USER' OR b.actor_membership_id<>c.actor_id OR b.intent_digest<>c.intent_digest OR b.key_digest<>c.key_digest
  OR b.result_generation_id IS NOT NULL OR b.result_slot_revision IS NOT NULL OR b.result_asset_ref IS NOT NULL
  OR b.completed_at IS NOT NULL OR b.reserved_stage_ref<>g.stage_ref OR b.created_at<c.created_at
  OR g.slot_id<>s.slot_id OR s.activity_id<>r.id OR s.owner_membership_id<>r.created_by OR g.owner_membership_id<>r.created_by
  OR g.deployment_id<>s.deployment_id OR dep.state IS DISTINCT FROM 'VERIFIED'
  OR g.state<>'PENDING' OR g.activated_at IS NOT NULL OR g.terminal_at IS NOT NULL OR g.content_digest<>c.expected_native_digest
  OR s.repository_revision<>b.reserved_slot_revision OR s.active_generation_id=g.generation_id
  OR b.repository_revision=9223372036854775807 OR g.repository_revision=9223372036854775807
  OR EXISTS(SELECT 1 FROM zhiban_bridge.operations WHERE tenant_id=p_tenant AND generation_id=g.generation_id AND operation='ACTIVATE_GENERATION')
  OR EXISTS(SELECT 1 FROM zhiban_content.publications WHERE tenant_id=p_tenant AND bridge_generation_id=g.generation_id)
  OR EXISTS(SELECT 1 FROM zhiban_bridge.asset_bindings WHERE tenant_id=p_tenant AND generation_id=g.generation_id) THEN
  RAISE EXCEPTION 'Target must remain isolated' USING ERRCODE='23514';
 END IF;
 SELECT jsonb_agg(to_jsonb(x) ORDER BY scene_ordinal),jsonb_agg(scene_ref ORDER BY scene_ordinal) INTO scene_rows,refs
 FROM zhiban_bridge.scene_bindings x WHERE tenant_id=p_tenant AND generation_id=g.generation_id;
 IF jsonb_array_length(scene_rows) IS NULL OR jsonb_array_length(scene_rows) NOT BETWEEN 1 AND 32
  OR jsonb_array_length(scene_rows)<>jsonb_array_length(r.draft->'slides') THEN RAISE EXCEPTION 'Scene proof rejected'; END IF;
 doc:=zhiban_reconcile.expected_document(r.draft,g.stage_ref,refs,c.created_at);
 IF zhiban_reconcile.document_digest(doc)<>c.expected_native_digest OR EXISTS(
  SELECT 1 FROM jsonb_array_elements(scene_rows) WITH ORDINALITY a(x,ord)
  WHERE (x->>'scene_ordinal')::bigint<>ord-1 OR x->>'scene_digest'<>zhiban_reconcile.document_digest(doc->'scenes'->(ord-1)::integer)) THEN
  RAISE EXCEPTION 'Recorded text document rejected' USING ERRCODE='23514';
 END IF;
 RETURN jsonb_build_object('resource',to_jsonb(r),'content',to_jsonb(c),'prepare',to_jsonb(b),'slot',to_jsonb(s),'generation',to_jsonb(g),
  'offering',to_jsonb(offer),'course',to_jsonb(course),'scenes',scene_rows,'deployment',to_jsonb(dep),
  'publications',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY publication_no) FROM zhiban_content.publications p WHERE tenant_id=p_tenant AND resource_id=r.id),'[]'),
  'bindings',(SELECT to_jsonb(i)-'ready' FROM zhiban_reconcile.installations i WHERE deployment_id=s.deployment_id));
END $$;
