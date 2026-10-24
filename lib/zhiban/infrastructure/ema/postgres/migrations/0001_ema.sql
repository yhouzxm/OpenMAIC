-- Additive LOCAL teaching evidence classification and teacher-requested EMA jobs.
CREATE SCHEMA zhiban_ema AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_ema FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_ema TO zhiban_academic_runtime;
CREATE TABLE zhiban_ema.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum~'^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_ema.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_ema.tags(
 tenant_id uuid NOT NULL,note_id uuid NOT NULL,dimension text NOT NULL CHECK(dimension IN('KNOWLEDGE','APPLICATION','PROBLEM_SOLVING','SELF_REGULATION','COLLABORATION','REFLECTION')),
 created_by uuid NOT NULL,created_at bigint NOT NULL CHECK(created_at>0),PRIMARY KEY(tenant_id,note_id),
 FOREIGN KEY(tenant_id,note_id) REFERENCES zhiban_learner.observations(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_ema.jobs(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,id uuid NOT NULL,enrollment_id uuid NOT NULL,membership_id uuid NOT NULL,
 purpose text NOT NULL CHECK(length(purpose) BETWEEN 1 AND 1000),due_at bigint NOT NULL CHECK(due_at>0),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='array' AND jsonb_array_length(evidence) BETWEEN 1 AND 5),
 source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),prompt_version text NOT NULL CHECK(prompt_version='ema-six-v1'),
 state text NOT NULL CHECK(state IN('QUEUED','RUNNING','READY','FAILED','STALE','CANCELLED')),
 revision bigint NOT NULL CHECK(revision>0),lease uuid,started_at bigint,finished_at bigint,result jsonb,model jsonb,failure text CHECK(failure IN('MODEL_FAILED','EXPIRED','SOURCE_CHANGED')),
 created_by uuid NOT NULL,created_at bigint NOT NULL,updated_at bigint NOT NULL,
 CHECK((state='RUNNING')=(lease IS NOT NULL)),CHECK((state IN('READY','STALE'))=(result IS NOT NULL)),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,offering_id,id),
 FOREIGN KEY(tenant_id,enrollment_id,offering_id,membership_id) REFERENCES zhiban_academic.enrollments(tenant_id,id,offering_id,membership_id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_ema.reviews(
 tenant_id uuid NOT NULL,job_id uuid NOT NULL,dimension text NOT NULL CHECK(dimension IN('KNOWLEDGE','APPLICATION','PROBLEM_SOLVING','SELF_REGULATION','COLLABORATION','REFLECTION')),
 decision text NOT NULL CHECK(decision IN('ADOPT','REJECT')),reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),note_id uuid,
 actor_id uuid NOT NULL,created_at bigint NOT NULL,CHECK((decision='ADOPT')=(note_id IS NOT NULL)),
 PRIMARY KEY(tenant_id,job_id,dimension),FOREIGN KEY(tenant_id,job_id) REFERENCES zhiban_ema.jobs(tenant_id,id),
 FOREIGN KEY(tenant_id,note_id) REFERENCES zhiban_ema.tags(tenant_id,note_id),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_ema.events(
 tenant_id uuid NOT NULL,id uuid NOT NULL,job_id uuid NOT NULL,revision bigint NOT NULL,action text NOT NULL,
 detail jsonb NOT NULL CHECK(jsonb_typeof(detail)='object'),actor_id uuid NOT NULL,created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,job_id,revision),FOREIGN KEY(tenant_id,job_id) REFERENCES zhiban_ema.jobs(tenant_id,id),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_ema.commands(
 tenant_id uuid NOT NULL,command_key text NOT NULL CHECK(command_key~'^[A-Za-z0-9_-]{16,80}$'),offering_id uuid NOT NULL,actor_id uuid NOT NULL,payload_digest text NOT NULL CHECK(payload_digest~'^[a-f0-9]{64}$'),result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,command_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE INDEX ema_job_page ON zhiban_ema.jobs(tenant_id,offering_id,enrollment_id,id DESC);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['tags','jobs','reviews','events','commands'] LOOP
 EXECUTE format('ALTER TABLE zhiban_ema.%I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('ALTER TABLE zhiban_ema.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY tenant_scope ON zhiban_ema.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',n);
 EXECUTE format('REVOKE ALL ON zhiban_ema.%I FROM PUBLIC',n);EXECUTE format('GRANT SELECT,INSERT ON zhiban_ema.%I TO zhiban_academic_runtime',n);
 END LOOP;
END $$;
GRANT UPDATE(state,revision,lease,started_at,finished_at,result,model,failure,updated_at) ON zhiban_ema.jobs TO zhiban_academic_runtime;
