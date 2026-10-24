-- LOCAL additive candidate, new owned PG16 only. Existing migrations stay immutable.
DO $$ BEGIN IF current_user<>'zhiban_identity_owner' OR current_setting('server_version_num')::int NOT BETWEEN 160000 AND 169999 THEN RAISE EXCEPTION 'PG16 owner required'; END IF; END $$;
CREATE TABLE zhiban_content.joint_schema_migrations(version text PRIMARY KEY CHECK(version='0005'),checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
REVOKE ALL ON zhiban_content.joint_schema_migrations FROM PUBLIC;
GRANT SELECT ON zhiban_content.joint_schema_migrations TO zhiban_bridge_runtime,zhiban_academic_runtime;
GRANT USAGE ON SCHEMA zhiban_content TO zhiban_academic_runtime;
CREATE UNIQUE INDEX joint_dispatch_anchor ON zhiban_classroom.dispatches(tenant_id,id,offering_id,kind,target_id,target_version);
CREATE UNIQUE INDEX joint_publication_anchor ON zhiban_content.publications(tenant_id,id,resource_id,offering_id);
CREATE TABLE zhiban_classroom.joint_tasks(
 tenant_id uuid NOT NULL,dispatch_id uuid NOT NULL,resource_id uuid NOT NULL,publication_id uuid NOT NULL,
 offering_id uuid NOT NULL,activity_id uuid NOT NULL,activity_version integer NOT NULL,
 target_version text GENERATED ALWAYS AS (activity_version::text) STORED,
 kind text NOT NULL DEFAULT 'ACTIVITY' CHECK(kind='ACTIVITY'),
 PRIMARY KEY(tenant_id,dispatch_id),UNIQUE(tenant_id,dispatch_id,resource_id,publication_id),
 FOREIGN KEY(tenant_id,dispatch_id,offering_id,kind,activity_id,target_version) REFERENCES zhiban_classroom.dispatches(tenant_id,id,offering_id,kind,target_id,target_version),
 FOREIGN KEY(tenant_id,activity_id,activity_version,offering_id) REFERENCES zhiban_learning.activity_versions(tenant_id,activity_id,version,offering_id),
 FOREIGN KEY(tenant_id,publication_id,resource_id,offering_id) REFERENCES zhiban_content.publications(tenant_id,id,resource_id,offering_id)
);
CREATE UNIQUE INDEX joint_binding_anchor ON zhiban_content.attempt_runtime_bindings(tenant_id,id,attempt_id,learner_membership_id,resource_id,publication_id);
CREATE TABLE zhiban_classroom.joint_entries(
 tenant_id uuid NOT NULL,dispatch_id uuid NOT NULL,membership_id uuid NOT NULL,
 attempt_id uuid NOT NULL,runtime_binding_id uuid NOT NULL,resource_id uuid NOT NULL,publication_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,dispatch_id,membership_id),
 FOREIGN KEY(tenant_id,dispatch_id,membership_id) REFERENCES zhiban_classroom.entries(tenant_id,dispatch_id,membership_id),
 FOREIGN KEY(tenant_id,dispatch_id,resource_id,publication_id) REFERENCES zhiban_classroom.joint_tasks(tenant_id,dispatch_id,resource_id,publication_id),
 FOREIGN KEY(tenant_id,runtime_binding_id,attempt_id,membership_id,resource_id,publication_id)
 REFERENCES zhiban_content.attempt_runtime_bindings(tenant_id,id,attempt_id,learner_membership_id,resource_id,publication_id)
);
REVOKE ALL ON zhiban_classroom.joint_tasks,zhiban_classroom.joint_entries FROM PUBLIC;
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['joint_tasks','joint_entries'] LOOP
  EXECUTE format('ALTER TABLE zhiban_classroom.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE zhiban_classroom.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY tenant_scope ON zhiban_classroom.%I FOR ALL TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',n);
  EXECUTE format('GRANT SELECT,INSERT ON zhiban_classroom.%I TO zhiban_academic_runtime',n);
 END LOOP;
 FOREACH n IN ARRAY ARRAY['sessions','dispatches','entries','joint_tasks','joint_entries'] LOOP
  EXECUTE format('CREATE POLICY joint_owner_read ON zhiban_classroom.%I FOR SELECT TO zhiban_identity_owner USING(session_user IN (''zhiban_academic_runtime'',''zhiban_bridge_runtime'') AND tenant_id=zhiban_identity.current_tenant_id())',n);
 END LOOP;
 FOREACH n IN ARRAY ARRAY['resources','publications','attempt_runtime_bindings'] LOOP
  EXECUTE format('CREATE POLICY joint_owner_read ON zhiban_content.%I FOR SELECT TO zhiban_identity_owner USING(session_user=''zhiban_academic_runtime'' AND tenant_id=zhiban_identity.current_tenant_id())',n);
 END LOOP;
 FOREACH n IN ARRAY ARRAY['resource_slots','resource_generations'] LOOP
  EXECUTE format('CREATE POLICY joint_owner_read ON zhiban_bridge.%I FOR SELECT TO zhiban_identity_owner USING(session_user=''zhiban_academic_runtime'' AND tenant_id=zhiban_identity.current_tenant_id())',n);
 END LOOP;
 FOREACH n IN ARRAY ARRAY['attempts','activities','activity_versions'] LOOP
  EXECUTE format('CREATE POLICY joint_owner_read ON zhiban_learning.%I FOR SELECT TO zhiban_identity_owner USING(session_user=''zhiban_academic_runtime'' AND tenant_id=zhiban_identity.current_tenant_id())',n);
 END LOOP;
END $$;
CREATE POLICY joint_owner_lock ON zhiban_content.resources FOR UPDATE TO zhiban_identity_owner
 USING(session_user='zhiban_academic_runtime' AND tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(false);
CREATE POLICY joint_owner_lock ON zhiban_bridge.resource_slots FOR UPDATE TO zhiban_identity_owner
 USING(session_user='zhiban_academic_runtime' AND tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(false);
CREATE POLICY joint_bind ON zhiban_content.attempt_runtime_bindings FOR INSERT TO zhiban_identity_owner
 WITH CHECK(session_user='zhiban_academic_runtime' AND tenant_id=zhiban_identity.current_tenant_id());
CREATE POLICY joint_owner_read ON zhiban_academic.enrollments FOR SELECT TO zhiban_identity_owner
 USING(session_user='zhiban_academic_runtime' AND tenant_id=zhiban_identity.current_tenant_id());

-- Callers hold current private Identity + business guards. Joint writes ALSO
-- hold the ContentService public-provider read lease (owner Identity, resource
-- SHARE and slot SHARE) around the entire guarded Academic transaction.
CREATE FUNCTION zhiban_content.lock_joint_publication(p_tenant uuid,p_resource uuid,p_offering uuid,p_publication uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE r zhiban_content.resources%ROWTYPE;p zhiban_content.publications%ROWTYPE;s zhiban_bridge.resource_slots%ROWTYPE;g zhiban_bridge.resource_generations%ROWTYPE;
BEGIN
 IF session_user<>'zhiban_academic_runtime' OR p_tenant IS DISTINCT FROM zhiban_identity.current_tenant_id() THEN RAISE EXCEPTION 'Joint context rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM zhiban_content.resources WHERE tenant_id=p_tenant AND id=p_resource AND offering_id=p_offering FOR SHARE;
 IF NOT FOUND OR r.state<>'PUBLISHED' OR r.policy_version<>'content-interactive-offline-v1' OR r.active_publication_id<>p_publication THEN RAISE EXCEPTION 'Joint publication rejected' USING ERRCODE='23514'; END IF;
 SELECT * INTO p FROM zhiban_content.publications WHERE tenant_id=p_tenant AND id=p_publication AND resource_id=p_resource AND offering_id=p_offering;
 IF NOT FOUND THEN RAISE EXCEPTION 'Joint publication rejected' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM zhiban_bridge.resource_slots WHERE tenant_id=p_tenant AND slot_id=p.bridge_slot_id FOR SHARE;
 SELECT * INTO g FROM zhiban_bridge.resource_generations WHERE tenant_id=p_tenant AND generation_id=p.bridge_generation_id AND slot_id=p.bridge_slot_id;
 IF s.state IS DISTINCT FROM 'ENABLED' OR s.active_generation_id IS DISTINCT FROM p.bridge_generation_id OR g.state IS DISTINCT FROM 'ACTIVE' THEN RAISE EXCEPTION 'Joint generation rejected' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('title',p.title,'publicationNo',p.publication_no,'slot',p.bridge_slot_id,'generation',p.bridge_generation_id);
END $$;

CREATE FUNCTION zhiban_content.bind_joint_attempt(p_tenant uuid,p_dispatch uuid,p_member uuid,p_attempt uuid,p_binding uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE j zhiban_classroom.joint_tasks%ROWTYPE;d zhiban_classroom.dispatches%ROWTYPE;s zhiban_classroom.sessions%ROWTYPE;
 a zhiban_learning.attempts%ROWTYPE;b zhiban_content.attempt_runtime_bindings%ROWTYPE;v zhiban_learning.activity_versions%ROWTYPE;m jsonb;t bigint;
BEGIN
 IF session_user<>'zhiban_academic_runtime' OR p_tenant IS DISTINCT FROM zhiban_identity.current_tenant_id() THEN RAISE EXCEPTION 'Joint context rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO j FROM zhiban_classroom.joint_tasks WHERE tenant_id=p_tenant AND dispatch_id=p_dispatch;
 SELECT * INTO d FROM zhiban_classroom.dispatches WHERE tenant_id=p_tenant AND id=p_dispatch;
 SELECT * INTO s FROM zhiban_classroom.sessions WHERE tenant_id=p_tenant AND id=d.session_id;
 t:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 IF j.dispatch_id IS NULL OR d.kind IS DISTINCT FROM 'ACTIVITY' OR d.state IS DISTINCT FROM 'ACTIVE' OR s.state IS DISTINCT FROM 'PUBLISHED'
 OR (s.opens_at IS NOT NULL AND t<s.opens_at) OR (s.closes_at IS NOT NULL AND t>=s.closes_at)
 OR NOT EXISTS(SELECT 1 FROM zhiban_classroom.entries e WHERE e.tenant_id=p_tenant AND e.dispatch_id=p_dispatch AND e.membership_id=p_member) THEN RAISE EXCEPTION 'Joint entry rejected' USING ERRCODE='23514'; END IF;
 m:=zhiban_content.lock_joint_publication(p_tenant,j.resource_id,d.offering_id,j.publication_id);
 SELECT * INTO a FROM zhiban_learning.attempts WHERE tenant_id=p_tenant AND id=p_attempt AND membership_id=p_member AND offering_id=d.offering_id AND activity_id=d.target_id AND activity_version::text=d.target_version;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM zhiban_academic.enrollments e WHERE e.tenant_id=p_tenant AND e.id=a.enrollment_id AND e.membership_id=p_member AND e.offering_id=d.offering_id AND e.status='ACTIVE' AND e.valid_from<=t AND e.valid_until IS NULL) THEN RAISE EXCEPTION 'Joint attempt rejected' USING ERRCODE='42501'; END IF;
 SELECT * INTO b FROM zhiban_content.attempt_runtime_bindings WHERE tenant_id=p_tenant AND attempt_id=p_attempt AND resource_id=j.resource_id;
 IF b.id IS NULL THEN
  SELECT * INTO v FROM zhiban_learning.activity_versions WHERE tenant_id=p_tenant AND activity_id=a.activity_id AND version=a.activity_version;
  IF a.status<>'IN_PROGRESS' OR (v.deadline_at IS NOT NULL AND t>=v.deadline_at) THEN RAISE EXCEPTION 'Joint attempt closed' USING ERRCODE='23514'; END IF;
  INSERT INTO zhiban_content.attempt_runtime_bindings VALUES(p_tenant,p_binding,j.resource_id,d.offering_id,j.publication_id,(m->>'slot')::uuid,(m->>'generation')::uuid,p_attempt,p_member,a.enrollment_id,t,'attempt-runtime-server-v1') ON CONFLICT(tenant_id,attempt_id,resource_id) DO NOTHING;
  SELECT * INTO b FROM zhiban_content.attempt_runtime_bindings WHERE tenant_id=p_tenant AND attempt_id=p_attempt AND resource_id=j.resource_id;
 END IF;
 IF b.publication_id IS DISTINCT FROM j.publication_id THEN RAISE EXCEPTION 'Joint binding immutable' USING ERRCODE='23514'; END IF;
 RETURN b.id;
END $$;

CREATE FUNCTION zhiban_content.read_joint_entry(p_tenant uuid,p_resource uuid,p_offering uuid,p_publication uuid,p_dispatch uuid,p_member uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET row_security=on AS $$
DECLARE j record;
BEGIN
 IF session_user<>'zhiban_bridge_runtime' OR p_tenant IS DISTINCT FROM zhiban_identity.current_tenant_id() THEN RAISE EXCEPTION 'Joint context rejected' USING ERRCODE='42501'; END IF;
 SELECT e.attempt_id,e.runtime_binding_id,d.session_id,d.target_id,d.target_version INTO j FROM zhiban_classroom.joint_entries e
 JOIN zhiban_classroom.dispatches d ON d.tenant_id=e.tenant_id AND d.id=e.dispatch_id
 WHERE e.tenant_id=p_tenant AND e.resource_id=p_resource AND e.publication_id=p_publication AND e.dispatch_id=p_dispatch AND e.membership_id=p_member AND d.offering_id=p_offering;
 IF NOT FOUND THEN RAISE EXCEPTION 'Joint entry rejected' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('attemptId',j.attempt_id,'activityId',j.target_id,'activityVersion',j.target_version,'sessionId',j.session_id,'dispatchId',p_dispatch,'bindingId',j.runtime_binding_id);
END $$;
REVOKE ALL ON FUNCTION zhiban_content.lock_joint_publication(uuid,uuid,uuid,uuid),zhiban_content.bind_joint_attempt(uuid,uuid,uuid,uuid,uuid),zhiban_content.read_joint_entry(uuid,uuid,uuid,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zhiban_content.lock_joint_publication(uuid,uuid,uuid,uuid),zhiban_content.bind_joint_attempt(uuid,uuid,uuid,uuid,uuid) TO zhiban_academic_runtime;
GRANT EXECUTE ON FUNCTION zhiban_content.read_joint_entry(uuid,uuid,uuid,uuid,uuid,uuid) TO zhiban_bridge_runtime;
