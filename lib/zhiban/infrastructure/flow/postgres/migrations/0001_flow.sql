-- Additive orchestration and learner-reported experiments. Existing Identity/Bridge/Classroom contracts unchanged.
CREATE SCHEMA zhiban_flow AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_flow FROM PUBLIC;
CREATE TABLE zhiban_flow.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum~'^[a-f0-9]{64}$'));
CREATE TABLE zhiban_flow.plans(
 tenant_id uuid NOT NULL,classroom_id uuid NOT NULL,offering_id uuid NOT NULL,revision bigint NOT NULL CHECK(revision>0),draft jsonb NOT NULL CHECK(jsonb_typeof(draft)='array' AND jsonb_array_length(draft) BETWEEN 1 AND 32),published_version bigint,
 updated_by uuid NOT NULL,updated_at bigint NOT NULL,PRIMARY KEY(tenant_id,classroom_id),UNIQUE(tenant_id,classroom_id,offering_id),
 FOREIGN KEY(tenant_id,classroom_id,offering_id) REFERENCES zhiban_classroom.sessions(tenant_id,id,offering_id),FOREIGN KEY(tenant_id,updated_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_flow.versions(
 tenant_id uuid NOT NULL,classroom_id uuid NOT NULL,version bigint NOT NULL CHECK(version>0),steps jsonb NOT NULL CHECK(jsonb_typeof(steps)='array' AND jsonb_array_length(steps) BETWEEN 1 AND 32),source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),published_by uuid NOT NULL,published_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,classroom_id,version),FOREIGN KEY(tenant_id,classroom_id) REFERENCES zhiban_flow.plans(tenant_id,classroom_id),FOREIGN KEY(tenant_id,published_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
ALTER TABLE zhiban_flow.plans ADD FOREIGN KEY(tenant_id,classroom_id,published_version) REFERENCES zhiban_flow.versions(tenant_id,classroom_id,version) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE zhiban_flow.runs(
 tenant_id uuid NOT NULL,classroom_id uuid NOT NULL,offering_id uuid NOT NULL,plan_version bigint NOT NULL,state text NOT NULL CHECK(state IN('RUNNING','PAUSED','FINISHED','CANCELLED')),step_index integer NOT NULL CHECK(step_index BETWEEN 0 AND 31),revision bigint NOT NULL CHECK(revision>0),updated_by uuid NOT NULL,updated_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,classroom_id),UNIQUE(tenant_id,classroom_id,plan_version),FOREIGN KEY(tenant_id,classroom_id,offering_id) REFERENCES zhiban_flow.plans(tenant_id,classroom_id,offering_id),FOREIGN KEY(tenant_id,classroom_id,plan_version) REFERENCES zhiban_flow.versions(tenant_id,classroom_id,version),FOREIGN KEY(tenant_id,updated_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_flow.dispatches(
 tenant_id uuid NOT NULL,classroom_id uuid NOT NULL,plan_version bigint NOT NULL,position integer NOT NULL CHECK(position BETWEEN 0 AND 31),dispatch_id uuid NOT NULL,
 PRIMARY KEY(tenant_id,classroom_id,position),UNIQUE(tenant_id,dispatch_id),UNIQUE(tenant_id,classroom_id,plan_version,position,dispatch_id),FOREIGN KEY(tenant_id,classroom_id,plan_version) REFERENCES zhiban_flow.runs(tenant_id,classroom_id,plan_version),FOREIGN KEY(tenant_id,dispatch_id,classroom_id) REFERENCES zhiban_classroom.dispatches(tenant_id,id,session_id)
);
CREATE TABLE zhiban_flow.notebooks(
 tenant_id uuid NOT NULL,id uuid NOT NULL,offering_id uuid NOT NULL,classroom_id uuid NOT NULL,plan_version bigint NOT NULL,position integer NOT NULL,dispatch_id uuid NOT NULL,attempt_id uuid NOT NULL,membership_id uuid NOT NULL,enrollment_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),parameters jsonb NOT NULL CHECK(jsonb_typeof(parameters)='object'),measurements jsonb NOT NULL CHECK(jsonb_typeof(measurements)='array' AND jsonb_array_length(measurements)<=50),conclusion text NOT NULL CHECK(length(conclusion)<=4000),submission_id uuid,submitted_revision bigint,CHECK((submission_id IS NULL)=(submitted_revision IS NULL)),updated_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,attempt_id),FOREIGN KEY(tenant_id,classroom_id,plan_version,position,dispatch_id) REFERENCES zhiban_flow.dispatches(tenant_id,classroom_id,plan_version,position,dispatch_id),FOREIGN KEY(tenant_id,attempt_id) REFERENCES zhiban_learning.attempts(tenant_id,id),FOREIGN KEY(tenant_id,enrollment_id,offering_id,membership_id) REFERENCES zhiban_academic.enrollments(tenant_id,id,offering_id,membership_id),FOREIGN KEY(tenant_id,submission_id,attempt_id) REFERENCES zhiban_learning.submissions(tenant_id,id,attempt_id),FOREIGN KEY(tenant_id,dispatch_id,membership_id) REFERENCES zhiban_classroom.entries(tenant_id,dispatch_id,membership_id)
);
CREATE TABLE zhiban_flow.reports(
 tenant_id uuid NOT NULL,notebook_id uuid NOT NULL,notebook_revision bigint NOT NULL CHECK(notebook_revision>0),submission_id uuid NOT NULL,attempt_id uuid NOT NULL,parameters jsonb NOT NULL CHECK(jsonb_typeof(parameters)='object'),measurements jsonb NOT NULL CHECK(jsonb_typeof(measurements)='array'),conclusion text NOT NULL CHECK(length(conclusion) BETWEEN 1 AND 3000),source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,notebook_id,notebook_revision),UNIQUE(tenant_id,notebook_id,notebook_revision,submission_id),UNIQUE(tenant_id,submission_id),FOREIGN KEY(tenant_id,notebook_id) REFERENCES zhiban_flow.notebooks(tenant_id,id),FOREIGN KEY(tenant_id,submission_id,attempt_id) REFERENCES zhiban_learning.submissions(tenant_id,id,attempt_id)
);
ALTER TABLE zhiban_flow.notebooks ADD FOREIGN KEY(tenant_id,id,submitted_revision,submission_id) REFERENCES zhiban_flow.reports(tenant_id,notebook_id,notebook_revision,submission_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE zhiban_flow.events(
 tenant_id uuid NOT NULL,id uuid NOT NULL,offering_id uuid NOT NULL,classroom_id uuid NOT NULL,actor_id uuid NOT NULL,action text NOT NULL,facts jsonb NOT NULL,created_at bigint NOT NULL,PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,classroom_id,offering_id) REFERENCES zhiban_classroom.sessions(tenant_id,id,offering_id),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_flow.commands(
 tenant_id uuid NOT NULL,command_key text NOT NULL CHECK(command_key~'^[A-Za-z0-9_-]{16,80}$'),offering_id uuid NOT NULL,actor_id uuid NOT NULL,payload_digest text NOT NULL CHECK(payload_digest~'^[a-f0-9]{64}$'),result jsonb NOT NULL,created_at bigint NOT NULL,PRIMARY KEY(tenant_id,command_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA zhiban_flow FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_flow TO zhiban_academic_runtime;
GRANT SELECT ON zhiban_flow.schema_migrations TO zhiban_academic_runtime;
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['plans','versions','runs','dispatches','notebooks','reports','events','commands'] LOOP
 EXECUTE format('ALTER TABLE zhiban_flow.%I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('ALTER TABLE zhiban_flow.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY tenant_scope ON zhiban_flow.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',n);
 EXECUTE format('GRANT SELECT,INSERT ON zhiban_flow.%I TO zhiban_academic_runtime',n);
 END LOOP;
END $$;
GRANT UPDATE(revision,draft,published_version,updated_by,updated_at) ON zhiban_flow.plans TO zhiban_academic_runtime;
GRANT UPDATE(state,step_index,revision,updated_by,updated_at) ON zhiban_flow.runs TO zhiban_academic_runtime;
GRANT UPDATE(revision,parameters,measurements,conclusion,submission_id,submitted_revision,updated_at) ON zhiban_flow.notebooks TO zhiban_academic_runtime;
CREATE INDEX flow_notebook_history ON zhiban_flow.notebooks(tenant_id,offering_id,membership_id,id DESC);
CREATE INDEX flow_event_history ON zhiban_flow.events(tenant_id,classroom_id,id DESC);
