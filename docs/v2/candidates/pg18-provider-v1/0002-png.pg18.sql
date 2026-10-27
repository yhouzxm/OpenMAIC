-- Additive M5-C candidate. Never edit/reapply Content 0001 or Identity migrations.
DO $$ BEGIN
 IF current_user<>'zhiban_identity_owner' OR current_setting('server_version_num')::int NOT BETWEEN 180000 AND 189999
 THEN RAISE EXCEPTION 'PG18 owner required'; END IF;
END $$;
CREATE TABLE zhiban_content.png_schema_migrations(version text PRIMARY KEY CHECK(version='0002'),checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
REVOKE ALL ON zhiban_content.png_schema_migrations FROM PUBLIC;
GRANT SELECT ON zhiban_content.png_schema_migrations TO zhiban_bridge_runtime;
-- Preserve the exact old validator and its text-only semantics.
ALTER FUNCTION zhiban_content.valid_draft(jsonb) RENAME TO valid_text_draft;
CREATE FUNCTION zhiban_content.valid_draft(d jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path=pg_catalog,zhiban_content,pg_temp AS $$
DECLARE s jsonb; e jsonb; es jsonb; ss jsonb:='[]'; keys text[];
BEGIN
 IF jsonb_typeof(d->'slides')<>'array' OR jsonb_array_length(d->'slides') NOT BETWEEN 1 AND 32 THEN RETURN false; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(d->'slides') LOOP
  IF jsonb_typeof(s->'elements')<>'array' THEN RETURN false; END IF;
  es:='[]';
  FOR e IN SELECT value FROM jsonb_array_elements(s->'elements') LOOP
   IF e ? 'assetId' THEN
    SELECT array_agg(k ORDER BY k) INTO keys FROM jsonb_object_keys(e) k;
    IF keys IS DISTINCT FROM ARRAY['assetId','height','id','width','x','y']::text[] OR jsonb_typeof(e->'assetId')<>'string'
     OR (e->>'assetId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN RETURN false; END IF;
    e:=(e-'assetId')||jsonb_build_object('text','');
   END IF;
   es:=es||jsonb_build_array(e);
  END LOOP;
  ss:=ss||jsonb_build_array(jsonb_set(s,'{elements}',es));
 END LOOP;
 RETURN octet_length(d::text)<=262144 AND zhiban_content.valid_text_draft(jsonb_set(d,'{slides}',ss));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
ALTER TABLE zhiban_content.resources DROP CONSTRAINT resources_draft_check;
ALTER TABLE zhiban_content.resources DROP CONSTRAINT resources_policy_version_check;
ALTER TABLE zhiban_content.publications DROP CONSTRAINT publications_policy_version_check;
ALTER TABLE zhiban_content.resources ADD CONSTRAINT resources_policy_version_check CHECK(policy_version IN ('content-text-v1','content-png-v1'));
ALTER TABLE zhiban_content.resources ADD CONSTRAINT resources_draft_check CHECK(zhiban_content.valid_draft(draft) AND (policy_version='content-png-v1' OR zhiban_content.valid_text_draft(draft)));
ALTER TABLE zhiban_content.publications ADD CONSTRAINT publications_policy_version_check CHECK(policy_version IN ('content-text-v1','content-png-v1'));
CREATE TABLE zhiban_content.png_uploads(
 tenant_id uuid NOT NULL,id uuid NOT NULL CHECK(zhiban_identity.is_uuid_v7(id)),resource_id uuid NOT NULL,actor_id uuid NOT NULL,
 key_digest text NOT NULL CHECK(key_digest ~ '^[a-f0-9]{64}$'),byte_digest text NOT NULL CHECK(byte_digest ~ '^[a-f0-9]{64}$'),
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 4194304),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 4096),height integer NOT NULL CHECK(height BETWEEN 1 AND 4096),
 created_at bigint NOT NULL CHECK(created_at BETWEEN 0 AND 8640000000000000),
 CHECK(width::bigint*height<=4194304),CHECK(byte_digest=encode(sha256(bytes),'hex')),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,resource_id,id),UNIQUE(tenant_id,resource_id,actor_id,key_digest),
 FOREIGN KEY(tenant_id,resource_id) REFERENCES zhiban_content.resources(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_content.png_asset_operations(
 tenant_id uuid NOT NULL,operation_id uuid NOT NULL,parent_operation_id uuid NOT NULL,generation_id uuid NOT NULL,resource_id uuid NOT NULL,element_id uuid NOT NULL,upload_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,operation_id),UNIQUE(tenant_id,parent_operation_id,element_id),
 FOREIGN KEY(tenant_id,operation_id) REFERENCES zhiban_bridge.operations(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,parent_operation_id) REFERENCES zhiban_bridge.operations(tenant_id,operation_id),
 FOREIGN KEY(tenant_id,generation_id) REFERENCES zhiban_bridge.resource_generations(tenant_id,generation_id),
 FOREIGN KEY(tenant_id,resource_id,upload_id) REFERENCES zhiban_content.png_uploads(tenant_id,resource_id,id)
);
CREATE TABLE zhiban_content.png_publication_refs(
 tenant_id uuid NOT NULL,generation_id uuid NOT NULL,asset_binding_id uuid NOT NULL,resource_id uuid NOT NULL,
 upload_id uuid NOT NULL,slide_id uuid NOT NULL,element_id uuid NOT NULL,prepare_asset_operation_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,generation_id,element_id),UNIQUE(tenant_id,asset_binding_id),UNIQUE(tenant_id,prepare_asset_operation_id),
 FOREIGN KEY(tenant_id,generation_id) REFERENCES zhiban_bridge.resource_generations(tenant_id,generation_id),
 FOREIGN KEY(tenant_id,asset_binding_id) REFERENCES zhiban_bridge.asset_bindings(tenant_id,asset_binding_id),
 FOREIGN KEY(tenant_id,resource_id,upload_id) REFERENCES zhiban_content.png_uploads(tenant_id,resource_id,id),
 FOREIGN KEY(tenant_id,prepare_asset_operation_id) REFERENCES zhiban_content.png_asset_operations(tenant_id,operation_id)
);
CREATE FUNCTION zhiban_content.png_insert_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,zhiban_content,pg_temp AS $$
DECLARE r zhiban_content.resources%ROWTYPE;
BEGIN
 IF session_user<>'zhiban_bridge_runtime' OR NEW.tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id() THEN RAISE EXCEPTION 'PNG tenant rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM zhiban_content.resources WHERE tenant_id=NEW.tenant_id AND id=NEW.resource_id FOR UPDATE;
 IF NOT FOUND OR r.policy_version<>'content-png-v1' THEN RAISE EXCEPTION 'PNG source rejected' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='png_uploads' THEN
  IF (SELECT coalesce(sum(octet_length(bytes)),0) FROM zhiban_content.png_uploads WHERE tenant_id=NEW.tenant_id AND resource_id=NEW.resource_id)+octet_length(NEW.bytes)>33554432
   OR (SELECT count(*) FROM zhiban_content.png_uploads WHERE tenant_id=NEW.tenant_id AND resource_id=NEW.resource_id)>=128
   OR EXISTS(SELECT 1 FROM zhiban_content.operations WHERE tenant_id=NEW.tenant_id AND resource_id=NEW.resource_id AND state IN ('RESERVED','OUTCOME_UNKNOWN'))
  THEN RAISE EXCEPTION 'PNG quota/fence rejected' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='png_asset_operations' THEN
  IF NOT EXISTS(SELECT 1 FROM zhiban_bridge.operations o JOIN zhiban_bridge.operations parent ON parent.tenant_id=o.tenant_id AND parent.operation_id=NEW.parent_operation_id
    JOIN zhiban_content.operations co ON co.tenant_id=parent.tenant_id AND co.prepare_operation_id=parent.operation_id
    WHERE o.tenant_id=NEW.tenant_id AND o.operation_id=NEW.operation_id AND o.operation='PREPARE_ASSET' AND o.state='RESERVED' AND o.generation_id=NEW.generation_id
      AND o.slot_id=parent.slot_id AND parent.generation_id=NEW.generation_id AND parent.operation='PREPARE_CONTENT' AND parent.state='RESERVED' AND parent.dispatch_started_at IS NOT NULL
      AND co.resource_id=NEW.resource_id AND co.state='RESERVED' AND o.actor_membership_id=parent.actor_membership_id AND o.expected_authorization_version=parent.expected_authorization_version)
   THEN RAISE EXCEPTION 'PNG child rejected' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM zhiban_bridge.asset_bindings a JOIN zhiban_bridge.scene_bindings s ON s.tenant_id=a.tenant_id AND s.scene_binding_id=a.scene_binding_id
   JOIN zhiban_bridge.resource_generations g ON g.tenant_id=a.tenant_id AND g.generation_id=a.generation_id
   JOIN zhiban_bridge.resource_slots slot ON slot.tenant_id=g.tenant_id AND slot.slot_id=g.slot_id
   JOIN zhiban_bridge.operations o ON o.tenant_id=a.tenant_id AND o.operation_id=NEW.prepare_asset_operation_id
   JOIN zhiban_content.png_uploads u ON u.tenant_id=a.tenant_id AND u.id=NEW.upload_id AND u.resource_id=NEW.resource_id
   WHERE a.tenant_id=NEW.tenant_id AND a.asset_binding_id=NEW.asset_binding_id AND a.generation_id=NEW.generation_id
    AND slot.activity_id=NEW.resource_id AND g.state='PENDING' AND a.purpose='IMAGE' AND a.mime='image/png'
    AND a.byte_digest=u.byte_digest AND a.byte_length=octet_length(u.bytes) AND a.principal_handle=g.owner_handle AND a.deployment_id=g.deployment_id
    AND o.operation='PREPARE_ASSET' AND o.generation_id=g.generation_id AND o.state='SUCCEEDED' AND o.dispatch_started_at IS NOT NULL AND o.result_asset_ref=a.asset_ref
    AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.draft->'slides') ds,LATERAL jsonb_array_elements(ds->'elements') e
      WHERE ds->>'id'=NEW.slide_id::text AND e->>'id'=NEW.element_id::text AND e->>'assetId'=NEW.upload_id::text))
   THEN RAISE EXCEPTION 'PNG binding rejected' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['png_uploads','png_publication_refs','png_asset_operations'] LOOP
  EXECUTE format('ALTER TABLE zhiban_content.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE zhiban_content.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY png_read ON zhiban_content.%I FOR SELECT TO zhiban_bridge_runtime,zhiban_identity_owner USING(session_user=''zhiban_bridge_runtime'' AND tenant_id=zhiban_identity.current_tenant_id())',n);
  EXECUTE format('CREATE POLICY png_insert ON zhiban_content.%I FOR INSERT TO zhiban_bridge_runtime WITH CHECK(session_user=''zhiban_bridge_runtime'' AND tenant_id=zhiban_identity.current_tenant_id())',n);
  EXECUTE format('CREATE TRIGGER png_insert_guard BEFORE INSERT ON zhiban_content.%I FOR EACH ROW EXECUTE FUNCTION zhiban_content.png_insert_guard()',n);
  EXECUTE format('CREATE TRIGGER png_immutable BEFORE UPDATE OR DELETE ON zhiban_content.%I FOR EACH ROW EXECUTE FUNCTION zhiban_content.append_only()',n);
  EXECUTE format('REVOKE ALL ON zhiban_content.%I FROM PUBLIC',n);
  EXECUTE format('GRANT SELECT,INSERT ON zhiban_content.%I TO zhiban_bridge_runtime',n);
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION zhiban_content.valid_draft(jsonb),zhiban_content.png_insert_guard() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zhiban_content.valid_draft(jsonb) TO zhiban_bridge_runtime;
CREATE OR REPLACE FUNCTION zhiban_content.lock_business_context(
 p_tenant_id uuid,p_resource_id uuid,p_offering_id uuid,p_actor_membership_id uuid,p_action text
) RETURNS TABLE(course_id uuid,course_status text,course_revision bigint,offering_status text,offering_revision bigint,
 relationship_id uuid,relationship_revision bigint,valid_from bigint,valid_until bigint,evaluated_at bigint)
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_content,zhiban_academic,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE v_o zhiban_academic.offerings%ROWTYPE; v_c zhiban_academic.courses%ROWTYPE;
 v_relation record; v_now bigint;
BEGIN
 IF session_user<>'zhiban_bridge_runtime' OR p_tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id()
    OR zhiban_identity.is_uuid_v7(p_tenant_id) IS DISTINCT FROM TRUE
    OR zhiban_identity.is_uuid_v7(p_offering_id) IS DISTINCT FROM TRUE
    OR zhiban_identity.is_uuid_v7(p_actor_membership_id) IS DISTINCT FROM TRUE
    OR p_action IS NULL OR p_action NOT IN ('TEACHER_WRITE','TEACHER_WITHDRAW','TEACHER_READ','STUDENT_READ')
    OR (p_resource_id IS NULL AND p_action<>'TEACHER_WRITE')
    OR (p_resource_id IS NOT NULL AND zhiban_identity.is_uuid_v7(p_resource_id) IS DISTINCT FROM TRUE) THEN
   RAISE EXCEPTION 'Content business context rejected' USING ERRCODE='42501';
 END IF;
 SELECT o.* INTO v_o FROM zhiban_academic.offerings o WHERE o.tenant_id=p_tenant_id AND o.id=p_offering_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Content business context rejected' USING ERRCODE='42501'; END IF;
 SELECT c.* INTO v_c FROM zhiban_academic.courses c WHERE c.tenant_id=p_tenant_id AND c.id=v_o.course_id FOR SHARE;
 IF NOT FOUND OR v_c.status='ARCHIVED' OR (p_action='TEACHER_WRITE' AND v_o.status<>'OPEN') THEN
   RAISE EXCEPTION 'Content business context rejected' USING ERRCODE='42501';
 END IF;
 IF p_resource_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM zhiban_content.resources r
     WHERE r.tenant_id=p_tenant_id AND r.id=p_resource_id AND r.offering_id=p_offering_id
       AND r.kind='SLIDE_CONTENT' AND r.policy_version IN ('content-text-v1','content-png-v1')) THEN
   RAISE EXCEPTION 'Content business context rejected' USING ERRCODE='42501';
 END IF;
 IF p_action='STUDENT_READ' THEN
   SELECT e.id,e.revision,e.valid_from,e.valid_until INTO v_relation FROM zhiban_academic.enrollments e
    WHERE e.tenant_id=p_tenant_id AND e.offering_id=p_offering_id AND e.membership_id=p_actor_membership_id
      AND e.status='ACTIVE' ORDER BY e.id FOR SHARE;
 ELSE
   SELECT a.id,a.revision,a.valid_from,a.valid_until INTO v_relation FROM zhiban_academic.assignments a
    WHERE a.tenant_id=p_tenant_id AND a.offering_id=p_offering_id AND a.membership_id=p_actor_membership_id
      AND a.status='ACTIVE' ORDER BY a.id FOR SHARE;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'Content business context rejected' USING ERRCODE='42501'; END IF;
 v_now:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF v_relation.valid_from>v_now OR v_relation.valid_until IS NOT NULL THEN
   RAISE EXCEPTION 'Content business context rejected' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT v_c.id,v_c.status,v_c.revision,v_o.status,v_o.revision,
    v_relation.id::uuid,v_relation.revision::bigint,v_relation.valid_from::bigint,v_relation.valid_until::bigint,v_now;
 -- This is ONLY locked business facts. Caller MUST first invoke existing private
 -- Identity guard on THIS client and check a single current grant role+scope.
 -- NULL resource is only the CREATE path; the server allocates the resource ID.
END;
$$;
CREATE OR REPLACE FUNCTION zhiban_bridge.business_resource_ready(p_tenant_id uuid,p_activity_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog,zhiban_bridge,zhiban_identity,pg_temp AS $$
 SELECT coalesce(session_user='zhiban_bridge_runtime'
   AND p_tenant_id=zhiban_identity.current_tenant_id()
   AND zhiban_identity.is_uuid_v7(p_tenant_id) AND zhiban_identity.is_uuid_v7(p_activity_id)
   AND EXISTS(SELECT 1 FROM zhiban_content.resources r WHERE r.tenant_id=p_tenant_id AND r.id=p_activity_id
      AND r.kind='SLIDE_CONTENT' AND r.policy_version IN ('content-text-v1','content-png-v1')),false);
$$;
CREATE OR REPLACE FUNCTION zhiban_content.publication_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,zhiban_content,zhiban_identity,pg_temp AS $$
DECLARE r zhiban_content.resources%ROWTYPE;
BEGIN
 IF session_user<>'zhiban_bridge_runtime' OR NEW.tenant_id IS DISTINCT FROM zhiban_identity.current_tenant_id() THEN
   RAISE EXCEPTION 'Content publication context rejected' USING ERRCODE='42501';
 END IF;
 SELECT * INTO r FROM zhiban_content.resources WHERE tenant_id=NEW.tenant_id AND id=NEW.resource_id FOR UPDATE;
 IF NOT FOUND OR r.revision<>NEW.source_revision OR NEW.title<>r.title OR NEW.policy_version<>r.policy_version
    OR NEW.publication_no<>r.last_publication_no+1 OR NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(r.draft->'slides') s,
      LATERAL jsonb_array_elements(s.value->'elements') e WHERE btrim(e.value->>'text',E' \n\r\t')<>'' OR e.value ? 'assetId') THEN
   RAISE EXCEPTION 'Content publish source rejected' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
-- New PNG publications must include every source image exactly once, with the
-- exact parent preparation, successful child and correct scene ordinal.
CREATE FUNCTION zhiban_content.png_publish_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,zhiban_content,zhiban_bridge,pg_temp AS $$
DECLARE r zhiban_content.resources%ROWTYPE; expected_count integer; actual_count integer;
BEGIN
 IF NEW.policy_version<>'content-png-v1' THEN RETURN NEW; END IF;
 SELECT * INTO r FROM zhiban_content.resources WHERE tenant_id=NEW.tenant_id AND id=NEW.resource_id;
 SELECT count(*) INTO expected_count FROM jsonb_array_elements(r.draft->'slides') ds,LATERAL jsonb_array_elements(ds->'elements') e WHERE e ? 'assetId';
 SELECT count(*) INTO actual_count FROM zhiban_content.png_publication_refs f WHERE f.tenant_id=NEW.tenant_id AND f.generation_id=NEW.bridge_generation_id AND f.resource_id=NEW.resource_id;
 IF expected_count<>actual_count OR EXISTS(
  SELECT 1 FROM zhiban_content.png_publication_refs f
  JOIN zhiban_content.png_asset_operations child ON child.tenant_id=f.tenant_id AND child.operation_id=f.prepare_asset_operation_id
  JOIN zhiban_bridge.asset_bindings a ON a.tenant_id=f.tenant_id AND a.asset_binding_id=f.asset_binding_id
  JOIN zhiban_bridge.scene_bindings s ON s.tenant_id=a.tenant_id AND s.scene_binding_id=a.scene_binding_id
  WHERE f.tenant_id=NEW.tenant_id AND f.generation_id=NEW.bridge_generation_id AND
   (child.parent_operation_id<>NEW.prepare_operation_id OR child.element_id<>f.element_id OR child.upload_id<>f.upload_id
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.draft->'slides') WITH ORDINALITY ds(v,n),LATERAL jsonb_array_elements(ds.v->'elements') e
      WHERE ds.v->>'id'=f.slide_id::text AND ds.n-1=s.scene_ordinal AND e->>'id'=f.element_id::text AND e->>'assetId'=f.upload_id::text)))
  OR (SELECT count(*) FROM zhiban_bridge.asset_bindings WHERE tenant_id=NEW.tenant_id AND generation_id=NEW.bridge_generation_id)<>actual_count
 THEN RAISE EXCEPTION 'Incomplete PNG publication' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION zhiban_content.png_publish_guard() FROM PUBLIC;
CREATE TRIGGER content_png_publish_guard BEFORE INSERT ON zhiban_content.publications FOR EACH ROW EXECUTE FUNCTION zhiban_content.png_publish_guard();
