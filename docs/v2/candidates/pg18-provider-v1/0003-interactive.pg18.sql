-- Additive LOCAL candidate: self-contained interactive document policy; no Runtime or Identity changes.
DO $$ BEGIN IF current_user<>'zhiban_identity_owner' OR current_setting('server_version_num')::int NOT BETWEEN 180000 AND 189999 THEN RAISE EXCEPTION 'PG18 owner required'; END IF; END $$;
CREATE TABLE zhiban_content.interactive_schema_migrations(version text PRIMARY KEY CHECK(version='0003'),checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
REVOKE ALL ON zhiban_content.interactive_schema_migrations FROM PUBLIC;
GRANT SELECT ON zhiban_content.interactive_schema_migrations TO zhiban_bridge_runtime;
CREATE FUNCTION zhiban_content.valid_interactive_draft(d jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path=pg_catalog,zhiban_content,pg_temp AS $$
BEGIN
 RETURN jsonb_typeof(d->'html')='string' AND octet_length(d->>'html') BETWEEN 1 AND 65536 AND btrim(d->>'html')<>''
 AND zhiban_content.valid_text_draft(d-'html') AND jsonb_array_length(d->'slides')=1 AND jsonb_array_length(d#>'{slides,0,elements}')=0;
EXCEPTION WHEN OTHERS THEN RETURN false; END $$;
REVOKE ALL ON FUNCTION zhiban_content.valid_interactive_draft(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zhiban_content.valid_interactive_draft(jsonb) TO zhiban_bridge_runtime;
ALTER TABLE zhiban_content.resources DROP CONSTRAINT resources_policy_version_check;
ALTER TABLE zhiban_content.publications DROP CONSTRAINT publications_policy_version_check;
ALTER TABLE zhiban_content.resources DROP CONSTRAINT resources_draft_check;
ALTER TABLE zhiban_content.resources ADD CONSTRAINT resources_policy_version_check CHECK(policy_version IN ('content-text-v1','content-png-v1','content-interactive-offline-v1'));
ALTER TABLE zhiban_content.publications ADD CONSTRAINT publications_policy_version_check CHECK(policy_version IN ('content-text-v1','content-png-v1','content-interactive-offline-v1'));
ALTER TABLE zhiban_content.resources ADD CONSTRAINT resources_draft_check CHECK(
 CASE policy_version WHEN 'content-interactive-offline-v1' THEN zhiban_content.valid_interactive_draft(draft)
 WHEN 'content-png-v1' THEN zhiban_content.valid_draft(draft) ELSE zhiban_content.valid_text_draft(draft) END);
-- Original inline validator CHECK also covers new drafts through a closed dispatch.
ALTER FUNCTION zhiban_content.valid_draft(jsonb) RENAME TO valid_png_draft;
CREATE FUNCTION zhiban_content.valid_draft(d jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path=pg_catalog,zhiban_content,pg_temp AS $$ SELECT CASE WHEN d ? 'html' THEN zhiban_content.valid_interactive_draft(d) ELSE zhiban_content.valid_png_draft(d) END $$;
REVOKE ALL ON FUNCTION zhiban_content.valid_draft(jsonb) FROM PUBLIC;
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
       AND r.kind='SLIDE_CONTENT' AND r.policy_version IN ('content-text-v1','content-png-v1','content-interactive-offline-v1')) THEN
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
      AND r.kind='SLIDE_CONTENT' AND r.policy_version IN ('content-text-v1','content-png-v1','content-interactive-offline-v1')),false);
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
    OR NEW.publication_no<>r.last_publication_no+1 OR NOT (NEW.policy_version='content-interactive-offline-v1' AND zhiban_content.valid_interactive_draft(r.draft)) AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(r.draft->'slides') s,
      LATERAL jsonb_array_elements(s.value->'elements') e WHERE btrim(e.value->>'text',E' \n\r\t')<>'' OR e.value ? 'assetId') THEN
   RAISE EXCEPTION 'Content publish source rejected' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
