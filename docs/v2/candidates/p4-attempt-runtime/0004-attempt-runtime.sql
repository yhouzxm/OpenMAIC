-- LOCAL additive candidate only. Server provenance, not Native chat Runtime enablement.
DO $$ BEGIN IF current_user<>'zhiban_identity_owner' OR current_setting('server_version_num')::int NOT BETWEEN 160000 AND 169999 THEN RAISE EXCEPTION 'PG16 owner required'; END IF; END $$;
CREATE TABLE zhiban_content.attempt_runtime_schema_migrations(version text PRIMARY KEY CHECK(version='0004'),checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
REVOKE ALL ON zhiban_content.attempt_runtime_schema_migrations FROM PUBLIC;
GRANT SELECT ON zhiban_content.attempt_runtime_schema_migrations TO zhiban_bridge_runtime;
CREATE UNIQUE INDEX attempt_runtime_anchor ON zhiban_learning.attempts(tenant_id,id,offering_id,membership_id,enrollment_id);
CREATE UNIQUE INDEX publication_runtime_anchor ON zhiban_content.publications(tenant_id,id,resource_id,offering_id,bridge_slot_id,bridge_generation_id);
CREATE TABLE zhiban_content.attempt_runtime_bindings(
 tenant_id uuid NOT NULL,id uuid NOT NULL CHECK(zhiban_identity.is_uuid_v7(id)),
 resource_id uuid NOT NULL,offering_id uuid NOT NULL,publication_id uuid NOT NULL,
 bridge_slot_id uuid NOT NULL,bridge_generation_id uuid NOT NULL,
 attempt_id uuid NOT NULL,learner_membership_id uuid NOT NULL,enrollment_id uuid NOT NULL,
 bound_at bigint NOT NULL CHECK(bound_at>0),source_version text NOT NULL CHECK(source_version='attempt-runtime-server-v1'),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,attempt_id,resource_id),
 FOREIGN KEY(tenant_id,attempt_id,offering_id,learner_membership_id,enrollment_id)
 REFERENCES zhiban_learning.attempts(tenant_id,id,offering_id,membership_id,enrollment_id),
 FOREIGN KEY(tenant_id,publication_id,resource_id,offering_id,bridge_slot_id,bridge_generation_id)
 REFERENCES zhiban_content.publications(tenant_id,id,resource_id,offering_id,bridge_slot_id,bridge_generation_id)
);
REVOKE ALL ON zhiban_content.attempt_runtime_bindings FROM PUBLIC;
ALTER TABLE zhiban_content.attempt_runtime_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhiban_content.attempt_runtime_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_read ON zhiban_content.attempt_runtime_bindings FOR SELECT TO zhiban_identity_owner,zhiban_bridge_runtime
 USING(session_user='zhiban_bridge_runtime' AND tenant_id=zhiban_identity.current_tenant_id());
CREATE POLICY runtime_bind ON zhiban_content.attempt_runtime_bindings FOR INSERT TO zhiban_identity_owner
 WITH CHECK(session_user='zhiban_bridge_runtime' AND tenant_id=zhiban_identity.current_tenant_id());
GRANT SELECT ON zhiban_content.attempt_runtime_bindings TO zhiban_bridge_runtime;
-- No raw learning grants or binding DML for the Bridge login. The helper's owner
-- policies permit scoped reads/locks only. No change to existing learning writers.
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['activities','activity_versions','attempts','submissions','events'] LOOP
  EXECUTE format('CREATE POLICY runtime_owner_read ON zhiban_learning.%I FOR SELECT TO zhiban_identity_owner USING(session_user=''zhiban_bridge_runtime'' AND tenant_id=zhiban_identity.current_tenant_id())',n);
 END LOOP;
 FOREACH n IN ARRAY ARRAY['activities','attempts'] LOOP
  EXECUTE format('CREATE POLICY runtime_owner_lock ON zhiban_learning.%I FOR UPDATE TO zhiban_identity_owner USING(session_user=''zhiban_bridge_runtime'' AND tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(false)',n);
 END LOOP;
END $$;
CREATE FUNCTION zhiban_content.attempt_runtime(
 p_tenant uuid,p_resource uuid,p_offering uuid,p_actor uuid,p_attempt uuid,
 p_teacher boolean,p_publication uuid,p_binding uuid
) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE a zhiban_learning.attempts%ROWTYPE; act zhiban_learning.activities%ROWTYPE;
 v zhiban_learning.activity_versions%ROWTYPE; b zhiban_content.attempt_runtime_bindings%ROWTYPE;
 p zhiban_content.publications%ROWTYPE; r zhiban_content.resources%ROWTYPE;
 ev jsonb; t bigint; mode text;
BEGIN
 IF session_user<>'zhiban_bridge_runtime' OR p_tenant IS DISTINCT FROM zhiban_identity.current_tenant_id()
 OR p_teacher IS NULL OR p_attempt IS NULL OR (p_publication IS NULL)<>(p_binding IS NULL) THEN
  RAISE EXCEPTION 'Runtime context rejected' USING ERRCODE='42501'; END IF;
 -- The caller MUST first hold the existing private Identity guard and check the
 -- current role/scope on this SAME transaction. This helper checks business facts.
 mode:=CASE WHEN p_teacher THEN 'TEACHER_READ' ELSE 'STUDENT_READ' END;
 PERFORM * FROM zhiban_content.lock_business_context(p_tenant,p_resource,p_offering,p_actor,mode);
 SELECT * INTO r FROM zhiban_content.resources WHERE tenant_id=p_tenant AND id=p_resource AND offering_id=p_offering;
 IF NOT FOUND OR r.policy_version<>'content-interactive-offline-v1' THEN RAISE EXCEPTION 'Runtime resource rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM zhiban_learning.attempts WHERE tenant_id=p_tenant AND id=p_attempt AND offering_id=p_offering;
 IF NOT FOUND OR (NOT p_teacher AND a.membership_id<>p_actor) THEN RAISE EXCEPTION 'Runtime attempt rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO act FROM zhiban_learning.activities WHERE tenant_id=p_tenant AND id=a.activity_id FOR SHARE;
 SELECT * INTO a FROM zhiban_learning.attempts WHERE tenant_id=p_tenant AND id=p_attempt FOR SHARE;
 SELECT * INTO v FROM zhiban_learning.activity_versions WHERE tenant_id=p_tenant AND activity_id=a.activity_id AND version=a.activity_version;
 SELECT * INTO b FROM zhiban_content.attempt_runtime_bindings WHERE tenant_id=p_tenant AND attempt_id=p_attempt AND resource_id=p_resource;
 IF p_publication IS NOT NULL THEN
  IF p_teacher OR r.state<>'PUBLISHED' OR r.active_publication_id<>p_publication THEN RAISE EXCEPTION 'Runtime version rejected' USING ERRCODE='23514'; END IF;
  SELECT * INTO p FROM zhiban_content.publications WHERE tenant_id=p_tenant AND id=p_publication AND resource_id=p_resource;
  IF NOT FOUND THEN RAISE EXCEPTION 'Runtime publication rejected' USING ERRCODE='23514'; END IF;
  IF b.id IS NULL THEN
   t:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
   IF act.status<>'PUBLISHED' OR a.status<>'IN_PROGRESS' OR (v.deadline_at IS NOT NULL AND t>=v.deadline_at)
    OR EXISTS(SELECT 1 FROM zhiban_learning.attempts n WHERE n.tenant_id=p_tenant AND n.activity_id=a.activity_id AND n.membership_id=a.membership_id AND n.attempt_no>a.attempt_no)
    OR NOT EXISTS(SELECT 1 FROM zhiban_academic.enrollments e WHERE e.tenant_id=p_tenant AND e.id=a.enrollment_id AND e.membership_id=p_actor AND e.status='ACTIVE' AND e.valid_from<=t AND e.valid_until IS NULL)
    OR NOT EXISTS(SELECT 1 FROM zhiban_academic.offerings o WHERE o.tenant_id=p_tenant AND o.id=p_offering AND o.status='OPEN') THEN
    RAISE EXCEPTION 'Runtime attempt not writable' USING ERRCODE='23514'; END IF;
   INSERT INTO zhiban_content.attempt_runtime_bindings VALUES(p_tenant,p_binding,p_resource,p_offering,p.id,p.bridge_slot_id,p.bridge_generation_id,p_attempt,p_actor,a.enrollment_id,t,'attempt-runtime-server-v1')
    ON CONFLICT(tenant_id,attempt_id,resource_id) DO NOTHING;
   SELECT * INTO b FROM zhiban_content.attempt_runtime_bindings WHERE tenant_id=p_tenant AND attempt_id=p_attempt AND resource_id=p_resource;
  END IF;
  IF b.publication_id<>p_publication THEN RAISE EXCEPTION 'Runtime binding immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF b.id IS NULL THEN RETURN jsonb_build_object('binding',NULL,'events','[]'::jsonb); END IF;
 SELECT * INTO p FROM zhiban_content.publications WHERE tenant_id=p_tenant AND id=b.publication_id;
 SELECT coalesce(jsonb_agg(x ORDER BY x->>'at',x->>'id'),'[]'::jsonb) INTO ev FROM (
  SELECT jsonb_build_object('id',e.id,'type',e.event_type,'source',e.source_version,'at',e.received_at,
    'submissionId',e.submission_id,'submissionVersion',s.version) AS x
  FROM zhiban_learning.events e LEFT JOIN zhiban_learning.submissions s ON s.tenant_id=e.tenant_id AND s.id=e.submission_id AND s.attempt_id=e.attempt_id
  WHERE e.tenant_id=p_tenant AND e.attempt_id=p_attempt ORDER BY e.received_at DESC,e.id DESC LIMIT 51
 ) selected;
 RETURN jsonb_build_object(
  'binding',jsonb_build_object('id',b.id,'attemptId',a.id,'activityId',a.activity_id,'activityVersion',a.activity_version,'attemptNumber',a.attempt_no,
    'title',v.title,'publicationId',b.publication_id,'publicationNo',p.publication_no,'boundAt',b.bound_at,'source',b.source_version),
  'attemptStatus',a.status,'events',CASE WHEN jsonb_array_length(ev)>50 THEN ev-0 ELSE ev END,
  'moreEvents',jsonb_array_length(ev)>50,
  'currentPublication',r.state='PUBLISHED' AND r.active_publication_id=b.publication_id,
  'completion',NULL,'score',NULL);
END $$;
REVOKE ALL ON FUNCTION zhiban_content.attempt_runtime(uuid,uuid,uuid,uuid,uuid,boolean,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zhiban_content.attempt_runtime(uuid,uuid,uuid,uuid,uuid,boolean,uuid,uuid) TO zhiban_bridge_runtime;
