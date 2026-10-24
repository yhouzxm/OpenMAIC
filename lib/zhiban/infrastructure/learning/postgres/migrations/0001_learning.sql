-- Additive M3 schema. Existing Identity and Academic migration bytes are immutable.
CREATE SCHEMA zhiban_learning AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_learning FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_learning TO zhiban_academic_runtime;
CREATE TABLE zhiban_learning.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_learning.schema_migrations TO zhiban_academic_runtime;
-- A composite enrollment anchor prevents tenant/member/offering substitutions.
CREATE UNIQUE INDEX enrollment_learning_anchor ON zhiban_academic.enrollments(tenant_id,id,offering_id,membership_id);
CREATE TABLE zhiban_learning.activities(
 tenant_id uuid NOT NULL,id uuid NOT NULL,offering_id uuid NOT NULL,
 activity_type text NOT NULL DEFAULT 'TEXT_RESPONSE' CHECK(activity_type='TEXT_RESPONSE'),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),prompt text NOT NULL CHECK(length(prompt) BETWEEN 1 AND 2000),
 deadline_at bigint CHECK(deadline_at>0),allow_resubmit boolean NOT NULL,max_attempts integer CHECK(max_attempts BETWEEN 1 AND 1000),
 status text NOT NULL CHECK(status IN('DRAFT','PUBLISHED','WITHDRAWN')),published_version integer NOT NULL DEFAULT 0 CHECK(published_version>=0),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),created_at bigint NOT NULL,updated_at bigint NOT NULL CHECK(updated_at>=created_at),
 CHECK((status='DRAFT' AND published_version=0) OR(status IN('PUBLISHED','WITHDRAWN') AND published_version>0)),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,id,offering_id),FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id)
);
CREATE TABLE zhiban_learning.activity_versions(
 tenant_id uuid NOT NULL,activity_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),offering_id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),prompt text NOT NULL CHECK(length(prompt) BETWEEN 1 AND 2000),deadline_at bigint CHECK(deadline_at>0),allow_resubmit boolean NOT NULL,max_attempts integer CHECK(max_attempts BETWEEN 1 AND 1000),published_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,activity_id,version),UNIQUE(tenant_id,activity_id,version,offering_id),
 FOREIGN KEY(tenant_id,activity_id,offering_id) REFERENCES zhiban_learning.activities(tenant_id,id,offering_id)
);
CREATE TABLE zhiban_learning.attempts(
 tenant_id uuid NOT NULL,id uuid NOT NULL,offering_id uuid NOT NULL,activity_id uuid NOT NULL,activity_version integer NOT NULL,
 enrollment_id uuid NOT NULL,membership_id uuid NOT NULL,attempt_no integer NOT NULL CHECK(attempt_no>0),
 status text NOT NULL CHECK(status IN('IN_PROGRESS','SUBMITTED')),draft text NOT NULL DEFAULT '' CHECK(length(draft)<=4000),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),started_at bigint NOT NULL,updated_at bigint NOT NULL CHECK(updated_at>=started_at),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,activity_id,membership_id,attempt_no),
 FOREIGN KEY(tenant_id,activity_id,activity_version,offering_id) REFERENCES zhiban_learning.activity_versions(tenant_id,activity_id,version,offering_id),
 FOREIGN KEY(tenant_id,enrollment_id,offering_id,membership_id) REFERENCES zhiban_academic.enrollments(tenant_id,id,offering_id,membership_id)
);
CREATE UNIQUE INDEX attempt_one_in_progress ON zhiban_learning.attempts(tenant_id,activity_id,membership_id) WHERE status='IN_PROGRESS';
CREATE TABLE zhiban_learning.submissions(
 tenant_id uuid NOT NULL,id uuid NOT NULL,attempt_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),answer text NOT NULL CHECK(length(answer) BETWEEN 1 AND 4000),submitted_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,id,attempt_id),UNIQUE(tenant_id,attempt_id,version),FOREIGN KEY(tenant_id,attempt_id) REFERENCES zhiban_learning.attempts(tenant_id,id)
);
CREATE TABLE zhiban_learning.events(
 tenant_id uuid NOT NULL,id uuid NOT NULL,attempt_id uuid NOT NULL,submission_id uuid,event_type text NOT NULL CHECK(event_type IN('ATTEMPT_STARTED','SUBMISSION_RECORDED')),source_version text NOT NULL CHECK(source_version='learning-v1'),received_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,attempt_id) REFERENCES zhiban_learning.attempts(tenant_id,id),FOREIGN KEY(tenant_id,submission_id,attempt_id) REFERENCES zhiban_learning.submissions(tenant_id,id,attempt_id),
 CHECK((event_type='ATTEMPT_STARTED' AND submission_id IS NULL) OR(event_type='SUBMISSION_RECORDED' AND submission_id IS NOT NULL))
);
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['activities','activity_versions','attempts','submissions','events'] LOOP
  EXECUTE format('ALTER TABLE zhiban_learning.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE zhiban_learning.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY tenant_scope ON zhiban_learning.%I FOR ALL TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',table_name);
  EXECUTE format('GRANT SELECT,INSERT ON zhiban_learning.%I TO zhiban_academic_runtime',table_name);
 END LOOP;
END $$;
GRANT UPDATE(title,prompt,deadline_at,allow_resubmit,max_attempts,status,published_version,revision,updated_at) ON zhiban_learning.activities TO zhiban_academic_runtime;
GRANT UPDATE(status,draft,revision,updated_at) ON zhiban_learning.attempts TO zhiban_academic_runtime;
-- Versions, final submissions and provenance are append-only; no DELETE privilege.
