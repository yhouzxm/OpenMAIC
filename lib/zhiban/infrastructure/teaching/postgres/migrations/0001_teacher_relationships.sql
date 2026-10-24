-- Additive teacher resource loader. No applied Identity or Academic migration is edited.
CREATE SCHEMA zhiban_teaching AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_teaching FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_teaching TO zhiban_runtime;
CREATE TABLE zhiban_teaching.schema_migrations(version text PRIMARY KEY, checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
-- Owner remains NOLOGIN/NOBYPASSRLS. Policies permit locks/read only for the Identity runtime's scoped helper.
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['courses','offerings','assignments'] LOOP
  EXECUTE format('CREATE POLICY teacher_relationship_owner_read ON zhiban_academic.%I FOR SELECT TO zhiban_identity_owner USING(session_user=''zhiban_runtime'' AND tenant_id=zhiban_identity.current_tenant_id())',n);
  EXECUTE format('CREATE POLICY teacher_relationship_owner_lock ON zhiban_academic.%I FOR UPDATE TO zhiban_identity_owner USING(session_user=''zhiban_runtime'' AND tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(false)',n);
 END LOOP;
END $$;
CREATE FUNCTION zhiban_teaching.identity_teacher_relationship(p_tenant uuid,p_member uuid,p_kind text,p_scope uuid)
RETURNS TABLE(tenant_id uuid,membership_id uuid,scope_kind text,scope_id uuid,course_id uuid,offering_id uuid,assignment_id uuid,course_revision bigint,offering_revision bigint,assignment_revision bigint)
LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
SET search_path=pg_catalog
SET row_security=on
AS $$
DECLARE c uuid; o uuid; a uuid; cr bigint; orv bigint; ar bigint; at_ms bigint;
BEGIN
 IF session_user<>'zhiban_runtime' OR p_tenant IS NULL OR p_tenant IS DISTINCT FROM zhiban_identity.current_tenant_id()
    OR p_member IS NULL OR p_scope IS NULL OR p_kind IS NULL OR p_kind NOT IN('CLASS','COURSE') THEN
  RAISE EXCEPTION 'Teacher relationship rejected' USING ERRCODE='42501';
 END IF;
 at_ms:=floor(extract(epoch FROM clock_timestamp())*1000)::bigint;
 -- Hints plan a canonical course -> offering -> assignment lock order. No authority from hints.
 SELECT x.course_id,x.id,y.id INTO c,o,a FROM zhiban_academic.offerings x
 JOIN zhiban_academic.assignments y ON y.tenant_id=x.tenant_id AND y.offering_id=x.id
 WHERE x.tenant_id=p_tenant AND x.status='OPEN' AND y.membership_id=p_member AND y.status='ACTIVE' AND y.valid_from<=at_ms AND y.valid_until IS NULL
 AND ((p_kind='COURSE' AND x.course_id=p_scope) OR (p_kind='CLASS' AND x.id=p_scope))
 ORDER BY x.id,y.id LIMIT 1;
 IF c IS NULL THEN RETURN; END IF;
 SELECT x.revision INTO cr FROM zhiban_academic.courses x WHERE x.tenant_id=p_tenant AND x.id=c AND x.status<>'ARCHIVED' AND x.published_version>0 FOR SHARE;
 IF cr IS NULL THEN RETURN; END IF;
 SELECT x.revision INTO orv FROM zhiban_academic.offerings x WHERE x.tenant_id=p_tenant AND x.id=o AND x.course_id=c AND x.status='OPEN'
 AND ((p_kind='COURSE' AND x.course_id=p_scope) OR (p_kind='CLASS' AND x.id=p_scope)) FOR SHARE;
 IF orv IS NULL THEN RETURN; END IF;
 SELECT x.revision INTO ar FROM zhiban_academic.assignments x WHERE x.tenant_id=p_tenant AND x.id=a AND x.offering_id=o
 AND x.membership_id=p_member AND x.status='ACTIVE' AND x.valid_from<=at_ms AND x.valid_until IS NULL FOR SHARE;
 IF ar IS NULL THEN RETURN; END IF;
 RETURN QUERY SELECT p_tenant,p_member,p_kind,p_scope,c,o,a,cr,orv,ar;
END $$;
REVOKE ALL ON FUNCTION zhiban_teaching.identity_teacher_relationship(uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION zhiban_teaching.identity_teacher_relationship(uuid,uuid,text,uuid) TO zhiban_runtime;
