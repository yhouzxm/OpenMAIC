-- Additive course-owned group collaboration over immutable native PBL v2 designs.
CREATE SCHEMA zhiban_pbl AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_pbl FROM PUBLIC;
CREATE TABLE zhiban_pbl.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum~'^[a-f0-9]{64}$'));
CREATE TABLE zhiban_pbl.projects(
 tenant_id uuid NOT NULL,id uuid NOT NULL,offering_id uuid NOT NULL,revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),state text NOT NULL CHECK(state IN('DRAFT','OPEN','CLOSED')),design jsonb NOT NULL,deadline_at bigint,allow_resubmit boolean NOT NULL,published_version bigint,
 author_id uuid NOT NULL,updated_at bigint NOT NULL,PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,id,offering_id),FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id),FOREIGN KEY(tenant_id,author_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_pbl.versions(
 tenant_id uuid NOT NULL,project_id uuid NOT NULL,version bigint NOT NULL CHECK(version>0),design jsonb NOT NULL,deadline_at bigint,allow_resubmit boolean NOT NULL,source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),published_by uuid NOT NULL,published_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,project_id,version),FOREIGN KEY(tenant_id,project_id) REFERENCES zhiban_pbl.projects(tenant_id,id),FOREIGN KEY(tenant_id,published_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
ALTER TABLE zhiban_pbl.projects ADD FOREIGN KEY(tenant_id,id,published_version) REFERENCES zhiban_pbl.versions(tenant_id,project_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE zhiban_pbl.groups(
 tenant_id uuid NOT NULL,id uuid NOT NULL,project_id uuid NOT NULL,offering_id uuid NOT NULL,project_version bigint NOT NULL,name text NOT NULL CHECK(length(name) BETWEEN 1 AND 80),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),work_revision bigint NOT NULL DEFAULT 1 CHECK(work_revision>0),membership_revision bigint NOT NULL DEFAULT 1 CHECK(membership_revision>0),work jsonb NOT NULL,submitted_work_revision bigint,latest_submission_id uuid,updated_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,id,project_id),UNIQUE(tenant_id,id,project_id,project_version),UNIQUE(tenant_id,id,offering_id),FOREIGN KEY(tenant_id,project_id,offering_id) REFERENCES zhiban_pbl.projects(tenant_id,id,offering_id),FOREIGN KEY(tenant_id,project_id,project_version) REFERENCES zhiban_pbl.versions(tenant_id,project_id,version)
);
CREATE TABLE zhiban_pbl.members(
 tenant_id uuid NOT NULL,group_id uuid NOT NULL,project_id uuid NOT NULL,membership_id uuid NOT NULL,offering_id uuid NOT NULL,enrollment_id uuid NOT NULL,active boolean NOT NULL,joined_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,group_id,membership_id),FOREIGN KEY(tenant_id,group_id,project_id) REFERENCES zhiban_pbl.groups(tenant_id,id,project_id),FOREIGN KEY(tenant_id,group_id,offering_id) REFERENCES zhiban_pbl.groups(tenant_id,id,offering_id),FOREIGN KEY(tenant_id,enrollment_id,offering_id,membership_id) REFERENCES zhiban_academic.enrollments(tenant_id,id,offering_id,membership_id)
);
CREATE UNIQUE INDEX one_pbl_group_per_project ON zhiban_pbl.members(tenant_id,project_id,membership_id) WHERE active;
CREATE TABLE zhiban_pbl.revisions(
 tenant_id uuid NOT NULL,group_id uuid NOT NULL,work_revision bigint NOT NULL CHECK(work_revision>0),membership_revision bigint NOT NULL,work jsonb NOT NULL,source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),author_id uuid NOT NULL,created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,group_id,work_revision),FOREIGN KEY(tenant_id,group_id) REFERENCES zhiban_pbl.groups(tenant_id,id),FOREIGN KEY(tenant_id,author_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_pbl.confirmations(
 tenant_id uuid NOT NULL,group_id uuid NOT NULL,membership_id uuid NOT NULL,enrollment_id uuid NOT NULL,work_revision bigint NOT NULL,membership_revision bigint NOT NULL,confirmed boolean NOT NULL,confirmed_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,group_id,membership_id),FOREIGN KEY(tenant_id,group_id,membership_id) REFERENCES zhiban_pbl.members(tenant_id,group_id,membership_id)
);
CREATE TABLE zhiban_pbl.submissions(
 tenant_id uuid NOT NULL,id uuid NOT NULL,group_id uuid NOT NULL,offering_id uuid NOT NULL,project_id uuid NOT NULL,project_version bigint NOT NULL,version bigint NOT NULL CHECK(version>0),work_revision bigint NOT NULL,membership_revision bigint NOT NULL,work jsonb NOT NULL,members jsonb NOT NULL CHECK(jsonb_array_length(members) BETWEEN 1 AND 10),source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),submitted_by uuid NOT NULL,submitted_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,group_id,version),UNIQUE(tenant_id,group_id,id),FOREIGN KEY(tenant_id,group_id,offering_id) REFERENCES zhiban_pbl.groups(tenant_id,id,offering_id),FOREIGN KEY(tenant_id,project_id,project_version) REFERENCES zhiban_pbl.versions(tenant_id,project_id,version),FOREIGN KEY(tenant_id,group_id,project_id,project_version) REFERENCES zhiban_pbl.groups(tenant_id,id,project_id,project_version),FOREIGN KEY(tenant_id,group_id,work_revision) REFERENCES zhiban_pbl.revisions(tenant_id,group_id,work_revision),FOREIGN KEY(tenant_id,submitted_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
ALTER TABLE zhiban_pbl.groups ADD FOREIGN KEY(tenant_id,id,latest_submission_id) REFERENCES zhiban_pbl.submissions(tenant_id,group_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE zhiban_pbl.evaluations(
 tenant_id uuid NOT NULL,submission_id uuid NOT NULL,version bigint NOT NULL CHECK(version>0),score integer NOT NULL CHECK(score BETWEEN 0 AND 100),feedback text NOT NULL CHECK(length(feedback) BETWEEN 1 AND 4000),reason text NOT NULL CHECK(version=1 OR length(reason)>0),published_by uuid NOT NULL,published_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,submission_id,version),FOREIGN KEY(tenant_id,submission_id) REFERENCES zhiban_pbl.submissions(tenant_id,id),FOREIGN KEY(tenant_id,published_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_pbl.events(
 tenant_id uuid NOT NULL,id uuid NOT NULL,offering_id uuid NOT NULL,project_id uuid NOT NULL,group_id uuid,actor_id uuid NOT NULL,action text NOT NULL,facts jsonb NOT NULL,created_at bigint NOT NULL,PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,project_id,offering_id) REFERENCES zhiban_pbl.projects(tenant_id,id,offering_id),FOREIGN KEY(tenant_id,group_id) REFERENCES zhiban_pbl.groups(tenant_id,id),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_pbl.commands(
 tenant_id uuid NOT NULL,command_key text NOT NULL CHECK(command_key~'^[A-Za-z0-9_-]{16,80}$'),offering_id uuid NOT NULL,actor_id uuid NOT NULL,payload_digest text NOT NULL CHECK(payload_digest~'^[a-f0-9]{64}$'),result jsonb NOT NULL,created_at bigint NOT NULL,PRIMARY KEY(tenant_id,command_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA zhiban_pbl FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_pbl TO zhiban_academic_runtime;
GRANT SELECT ON zhiban_pbl.schema_migrations TO zhiban_academic_runtime;
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['projects','versions','groups','members','revisions','confirmations','submissions','evaluations','events','commands'] LOOP
 EXECUTE format('ALTER TABLE zhiban_pbl.%I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('ALTER TABLE zhiban_pbl.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY tenant_scope ON zhiban_pbl.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',n);
 EXECUTE format('GRANT SELECT,INSERT ON zhiban_pbl.%I TO zhiban_academic_runtime',n);
 END LOOP;
END $$;
GRANT UPDATE(revision,state,design,deadline_at,allow_resubmit,published_version,updated_at) ON zhiban_pbl.projects TO zhiban_academic_runtime;
GRANT UPDATE(name,revision,work_revision,membership_revision,work,submitted_work_revision,latest_submission_id,updated_at) ON zhiban_pbl.groups TO zhiban_academic_runtime;
GRANT UPDATE(enrollment_id,active,joined_at) ON zhiban_pbl.members TO zhiban_academic_runtime;
GRANT UPDATE(enrollment_id,work_revision,membership_revision,confirmed,confirmed_at) ON zhiban_pbl.confirmations TO zhiban_academic_runtime;
CREATE INDEX pbl_projects_page ON zhiban_pbl.projects(tenant_id,offering_id,id DESC);
CREATE INDEX pbl_groups_page ON zhiban_pbl.groups(tenant_id,project_id,id DESC);
CREATE INDEX pbl_submissions_page ON zhiban_pbl.submissions(tenant_id,group_id,id DESC);
CREATE INDEX pbl_revisions_page ON zhiban_pbl.revisions(tenant_id,group_id,work_revision DESC);
-- PBL multi-party lock preflight only: no state projection, mutation, session or grant issuance.
-- The unchanged Bridge context is subsequently called in batches of at most two related members,
-- on this same transaction, with the actual authenticated actor on every call.
CREATE FUNCTION zhiban_pbl.lock_participants(p_tenant uuid,p_members uuid[]) RETURNS void
LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER
SET search_path=pg_catalog,zhiban_identity,pg_temp SET row_security=on AS $$
DECLARE ids uuid[]; users uuid[]; n integer;
BEGIN
 IF session_user<>'zhiban_bridge_runtime' OR p_tenant IS DISTINCT FROM zhiban_identity.current_tenant_id()
 OR zhiban_identity.is_uuid_v7(p_tenant) IS DISTINCT FROM TRUE OR p_members IS NULL
 OR cardinality(p_members) NOT BETWEEN 1 AND 21
 OR EXISTS(SELECT 1 FROM unnest(p_members) x WHERE zhiban_identity.is_uuid_v7(x) IS DISTINCT FROM TRUE)
 OR cardinality(p_members)<>(SELECT count(DISTINCT x) FROM unnest(p_members) x) THEN
  RAISE EXCEPTION 'PBL lock target rejected' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM zhiban_identity.tenants WHERE tenant_id=p_tenant AND status='ACTIVE' FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'PBL lock target rejected' USING ERRCODE='42501'; END IF;
 SELECT array_agg(m.membership_id ORDER BY m.membership_id),array_agg(DISTINCT m.user_id ORDER BY m.user_id),count(*) INTO ids,users,n FROM zhiban_identity.memberships m WHERE m.tenant_id=p_tenant AND m.membership_id=ANY(p_members);
 IF n<>cardinality(p_members) THEN RAISE EXCEPTION 'PBL lock target rejected' USING ERRCODE='42501'; END IF;
 PERFORM u.user_id FROM zhiban_identity.users u WHERE u.user_id=ANY(users) ORDER BY u.user_id FOR SHARE;
 PERFORM m.membership_id FROM zhiban_identity.memberships m WHERE m.tenant_id=p_tenant AND m.membership_id=ANY(ids) ORDER BY m.membership_id FOR SHARE;
END;
$$;
REVOKE ALL ON FUNCTION zhiban_pbl.lock_participants(uuid,uuid[]) FROM PUBLIC,zhiban_academic_runtime,zhiban_runtime,zhiban_auth_runtime,zhiban_control_runtime;
GRANT USAGE ON SCHEMA zhiban_pbl TO zhiban_bridge_runtime;
GRANT EXECUTE ON FUNCTION zhiban_pbl.lock_participants(uuid,uuid[]) TO zhiban_bridge_runtime;
