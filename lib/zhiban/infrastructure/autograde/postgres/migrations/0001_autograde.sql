-- Additive delegated formal grading. Service has no Identity role or human session.
CREATE SCHEMA zhiban_autograde AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_autograde FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_autograde TO zhiban_academic_runtime,zhiban_autograde_worker;
CREATE TABLE zhiban_autograde.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum~'^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_autograde.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_autograde.heads(tenant_id uuid NOT NULL,activity_id uuid NOT NULL,offering_id uuid NOT NULL,revision bigint NOT NULL DEFAULT 1,current_policy uuid,enabled boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,activity_id),FOREIGN KEY(tenant_id,activity_id) REFERENCES zhiban_learning.activities(tenant_id,id),FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id));
CREATE TABLE zhiban_autograde.policies(
 tenant_id uuid NOT NULL,id uuid NOT NULL,activity_id uuid NOT NULL,offering_id uuid NOT NULL,activity_version integer NOT NULL,rubric text NOT NULL CHECK(length(rubric) BETWEEN 1 AND 4000),max_points integer NOT NULL CHECK(max_points BETWEEN 1 AND 100000),provider text NOT NULL CHECK(length(provider) BETWEEN 1 AND 120),model text NOT NULL CHECK(length(model) BETWEEN 1 AND 200),
 teacher_id uuid NOT NULL,teacher_grant uuid NOT NULL,teacher_auth_version bigint NOT NULL,created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,activity_id,id),FOREIGN KEY(tenant_id,activity_id,activity_version) REFERENCES zhiban_learning.activity_versions(tenant_id,activity_id,version),FOREIGN KEY(tenant_id,teacher_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id),FOREIGN KEY(teacher_grant) REFERENCES zhiban_identity.role_grants(grant_id)
);
ALTER TABLE zhiban_autograde.heads ADD FOREIGN KEY(tenant_id,activity_id,current_policy) REFERENCES zhiban_autograde.policies(tenant_id,activity_id,id);
CREATE TABLE zhiban_autograde.jobs(
 tenant_id uuid NOT NULL,id uuid NOT NULL,offering_id uuid NOT NULL,submission_id uuid NOT NULL,policy_id uuid NOT NULL,secret_hash text NOT NULL CHECK(secret_hash~'^[a-f0-9]{64}$'),expires_at bigint NOT NULL,
 state text NOT NULL CHECK(state IN('RUNNING','APPLIED','FAILED','CANCELLED')),revision bigint NOT NULL DEFAULT 1,input jsonb NOT NULL,source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),result jsonb,publication_id uuid,failure text,created_at bigint NOT NULL,finished_at bigint,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,id,submission_id),FOREIGN KEY(tenant_id,submission_id) REFERENCES zhiban_learning.submissions(tenant_id,id),FOREIGN KEY(tenant_id,policy_id) REFERENCES zhiban_autograde.policies(tenant_id,id),
 CHECK((state='APPLIED')=(publication_id IS NOT NULL AND result IS NOT NULL))
);
CREATE UNIQUE INDEX autograde_one_active_submission ON zhiban_autograde.jobs(tenant_id,submission_id) WHERE state IN('RUNNING','APPLIED');
CREATE TABLE zhiban_autograde.requests(tenant_id uuid NOT NULL,submission_id uuid NOT NULL,offering_id uuid NOT NULL,policy_id uuid NOT NULL,state text NOT NULL CHECK(state IN('PENDING','RUNNING','DONE','FAILED')),created_at bigint NOT NULL,job_id uuid,
 PRIMARY KEY(tenant_id,submission_id),FOREIGN KEY(tenant_id,policy_id) REFERENCES zhiban_autograde.policies(tenant_id,id),FOREIGN KEY(tenant_id,submission_id) REFERENCES zhiban_learning.submissions(tenant_id,id),FOREIGN KEY(tenant_id,job_id,submission_id) REFERENCES zhiban_autograde.jobs(tenant_id,id,submission_id));
CREATE TABLE zhiban_autograde.events(
 tenant_id uuid NOT NULL,id uuid NOT NULL,job_id uuid,activity_id uuid NOT NULL,action text NOT NULL,actor_kind text NOT NULL CHECK(actor_kind IN('USER','SERVICE')),actor_id uuid,service_code text,detail jsonb NOT NULL,created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,job_id) REFERENCES zhiban_autograde.jobs(tenant_id,id),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id),CHECK((actor_kind='USER' AND actor_id IS NOT NULL AND service_code IS NULL) OR(actor_kind='SERVICE' AND actor_id IS NULL AND service_code='formal_ai_grader'))
);
CREATE TABLE zhiban_autograde.appeals(tenant_id uuid NOT NULL,id uuid NOT NULL,publication_id uuid NOT NULL,membership_id uuid NOT NULL,offering_id uuid NOT NULL,body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),state text NOT NULL CHECK(state IN('OPEN','RESOLVED')),revision bigint NOT NULL DEFAULT 1,response text,replacement_id uuid,created_at bigint NOT NULL,resolved_at bigint,resolved_by uuid,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,publication_id),FOREIGN KEY(tenant_id,publication_id) REFERENCES zhiban_assessment.publications(tenant_id,id),FOREIGN KEY(tenant_id,membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id),FOREIGN KEY(tenant_id,replacement_id) REFERENCES zhiban_assessment.publications(tenant_id,id),FOREIGN KEY(tenant_id,resolved_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_autograde.commands(tenant_id uuid NOT NULL,command_key text NOT NULL,actor_id uuid NOT NULL,payload_digest text NOT NULL,result jsonb NOT NULL,created_at bigint NOT NULL,PRIMARY KEY(tenant_id,command_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id));
-- The original human columns retain their meaning. A service publication has no fictitious human publisher.
ALTER TABLE zhiban_assessment.grades ADD COLUMN service_job_id uuid,ALTER COLUMN updated_by DROP NOT NULL;
ALTER TABLE zhiban_assessment.grades ADD CONSTRAINT grade_actor_exactly_one CHECK((updated_by IS NULL)<>(service_job_id IS NULL)),ADD FOREIGN KEY(tenant_id,service_job_id,submission_id) REFERENCES zhiban_autograde.jobs(tenant_id,id,submission_id);
ALTER TABLE zhiban_assessment.publications ADD COLUMN service_job_id uuid,ALTER COLUMN published_by DROP NOT NULL;
ALTER TABLE zhiban_assessment.publications ADD CONSTRAINT publication_actor_exactly_one CHECK((published_by IS NULL)<>(service_job_id IS NULL)),ADD FOREIGN KEY(tenant_id,service_job_id,submission_id) REFERENCES zhiban_autograde.jobs(tenant_id,id,submission_id);
CREATE UNIQUE INDEX service_job_single_publication ON zhiban_assessment.publications(tenant_id,service_job_id) WHERE service_job_id IS NOT NULL;
ALTER TABLE zhiban_autograde.jobs ADD FOREIGN KEY(tenant_id,publication_id,submission_id) REFERENCES zhiban_assessment.publications(tenant_id,id,submission_id) DEFERRABLE INITIALLY DEFERRED;
GRANT UPDATE(service_job_id) ON zhiban_assessment.grades TO zhiban_academic_runtime;
DO $$ DECLARE n text; BEGIN FOREACH n IN ARRAY ARRAY['heads','policies','jobs','requests','events','appeals','commands'] LOOP
 EXECUTE format('ALTER TABLE zhiban_autograde.%I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('ALTER TABLE zhiban_autograde.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY tenant_scope ON zhiban_autograde.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',n);
 EXECUTE format('CREATE POLICY service_owner ON zhiban_autograde.%I TO zhiban_identity_owner USING(tenant_id=zhiban_identity.current_tenant_id() AND session_user=''zhiban_autograde_worker'') WITH CHECK(tenant_id=zhiban_identity.current_tenant_id() AND session_user=''zhiban_autograde_worker'')',n);
 EXECUTE format('REVOKE ALL ON zhiban_autograde.%I FROM PUBLIC,zhiban_autograde_worker',n);EXECUTE format('GRANT SELECT ON zhiban_autograde.%I TO zhiban_academic_runtime',n);
 END LOOP; END $$;
GRANT INSERT ON zhiban_autograde.requests,zhiban_autograde.heads,zhiban_autograde.policies,zhiban_autograde.events,zhiban_autograde.appeals,zhiban_autograde.commands TO zhiban_academic_runtime;
GRANT UPDATE(revision,current_policy,enabled) ON zhiban_autograde.heads TO zhiban_academic_runtime;
GRANT UPDATE(state,revision,finished_at,failure) ON zhiban_autograde.jobs TO zhiban_academic_runtime;
GRANT UPDATE(state,revision,response,replacement_id,resolved_at,resolved_by) ON zhiban_autograde.appeals TO zhiban_academic_runtime;
-- Existing Identity owner read policies are reused unchanged. No Identity DML, role, catalog or RLS widening.
-- Business table access is confined to a new service-login-specific owner policy and closed functions below.
DO $$ DECLARE s text;t text; BEGIN
 FOR s,t IN SELECT * FROM (VALUES
 ('zhiban_academic','offerings'),('zhiban_academic','courses'),('zhiban_academic','assignments'),('zhiban_academic','enrollments'),
 ('zhiban_learning','activities'),('zhiban_learning','activity_versions'),('zhiban_learning','attempts'),('zhiban_learning','submissions'),('zhiban_learning','quiz_definitions'),('zhiban_learning','quiz_versions'),('zhiban_learning','quiz_submission_answers'),('zhiban_learning','quiz_evaluations'),
 ('zhiban_assessment','grades'),('zhiban_assessment','publications'),('zhiban_assessment','quiz_grade_details'),('zhiban_assessment','quiz_publication_details'))x(s,t) LOOP
 EXECUTE format('CREATE POLICY auto_grade_owner ON %I.%I TO zhiban_identity_owner USING(tenant_id=zhiban_identity.current_tenant_id() AND session_user=''zhiban_autograde_worker'') WITH CHECK(tenant_id=zhiban_identity.current_tenant_id() AND session_user=''zhiban_autograde_worker'')',s,t);
 END LOOP;
END $$;
CREATE INDEX autograde_job_page ON zhiban_autograde.jobs(tenant_id,offering_id,id DESC);
CREATE INDEX autograde_appeal_page ON zhiban_autograde.appeals(tenant_id,offering_id,id DESC);

GRANT UPDATE(state,policy_id) ON zhiban_autograde.requests TO zhiban_academic_runtime;
CREATE FUNCTION zhiban_autograde.submission_outbox() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$ BEGIN
 INSERT INTO zhiban_autograde.requests(tenant_id,submission_id,offering_id,policy_id,state,created_at)
 SELECT NEW.tenant_id,NEW.id,t.offering_id,p.id,'PENDING',NEW.submitted_at FROM zhiban_learning.attempts t JOIN zhiban_autograde.heads h ON h.tenant_id=t.tenant_id AND h.activity_id=t.activity_id JOIN zhiban_autograde.policies p ON p.tenant_id=h.tenant_id AND p.id=h.current_policy AND p.activity_version=t.activity_version WHERE t.tenant_id=NEW.tenant_id AND t.id=NEW.attempt_id AND h.enabled ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION zhiban_autograde.submission_outbox() FROM PUBLIC;
CREATE TRIGGER auto_grade_submission_outbox AFTER INSERT ON zhiban_learning.submissions FOR EACH ROW EXECUTE FUNCTION zhiban_autograde.submission_outbox();
-- Business connections may publish human grades, but cannot forge service attribution or service audit.
CREATE FUNCTION zhiban_autograde.guard_service_actor() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF TG_TABLE_SCHEMA='zhiban_autograde' THEN
  IF NEW.actor_kind='SERVICE' AND (session_user<>'zhiban_autograde_worker' OR current_user<>'zhiban_identity_owner') THEN RAISE EXCEPTION 'Service actor rejected' USING ERRCODE='42501'; END IF;
 ELSE
  IF NEW.service_job_id IS NOT NULL AND (session_user<>'zhiban_autograde_worker' OR current_user<>'zhiban_identity_owner') THEN RAISE EXCEPTION 'Service attribution rejected' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION zhiban_autograde.guard_service_actor() FROM PUBLIC;
CREATE TRIGGER service_grade_actor BEFORE INSERT OR UPDATE ON zhiban_assessment.grades FOR EACH ROW EXECUTE FUNCTION zhiban_autograde.guard_service_actor();
CREATE TRIGGER service_publication_actor BEFORE INSERT ON zhiban_assessment.publications FOR EACH ROW EXECUTE FUNCTION zhiban_autograde.guard_service_actor();
CREATE TRIGGER service_audit_actor BEFORE INSERT ON zhiban_autograde.events FOR EACH ROW EXECUTE FUNCTION zhiban_autograde.guard_service_actor();
