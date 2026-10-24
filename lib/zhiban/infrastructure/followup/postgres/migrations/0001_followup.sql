-- Additive P5 manual followup context. No existing migration or Identity privileges changed.
CREATE SCHEMA zhiban_followup AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_followup FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_followup TO zhiban_academic_runtime;
CREATE TABLE zhiban_followup.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_followup.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_followup.cases(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,id uuid NOT NULL,
 enrollment_id uuid NOT NULL,membership_id uuid NOT NULL,activity_id uuid NOT NULL,activity_version integer NOT NULL,
 activity_title text NOT NULL CHECK(length(activity_title) BETWEEN 1 AND 120),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
 state text NOT NULL CHECK(state IN('OPEN','CLOSED')),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 created_by uuid NOT NULL,updated_by uuid NOT NULL,created_at bigint NOT NULL CHECK(created_at>0),updated_at bigint NOT NULL CHECK(updated_at>=created_at),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,offering_id,id),UNIQUE(tenant_id,enrollment_id,activity_id,activity_version),
 FOREIGN KEY(tenant_id,enrollment_id,offering_id,membership_id) REFERENCES zhiban_academic.enrollments(tenant_id,id,offering_id,membership_id),
 FOREIGN KEY(tenant_id,activity_id,activity_version,offering_id) REFERENCES zhiban_learning.activity_versions(tenant_id,activity_id,version,offering_id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id),
 FOREIGN KEY(tenant_id,updated_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_followup.events(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,case_id uuid NOT NULL,id uuid NOT NULL,
 actor_id uuid NOT NULL,action text NOT NULL CHECK(action IN('CREATE_CASE','ADD_NOTE','CLOSE_CASE','REOPEN_CASE')),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),revision bigint NOT NULL CHECK(revision>0),
 from_state text,to_state text NOT NULL,created_at bigint NOT NULL CHECK(created_at>0),
 CHECK((action='CREATE_CASE' AND from_state IS NULL AND to_state='OPEN' AND revision=1)
 OR (action='ADD_NOTE' AND from_state='OPEN' AND to_state='OPEN' AND revision>1)
 OR (action='CLOSE_CASE' AND from_state='OPEN' AND to_state='CLOSED' AND revision>1)
 OR (action='REOPEN_CASE' AND from_state='CLOSED' AND to_state='OPEN' AND revision>1)),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,case_id,revision),
 FOREIGN KEY(tenant_id,offering_id,case_id) REFERENCES zhiban_followup.cases(tenant_id,offering_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_followup.commands(
 tenant_id uuid NOT NULL,command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9_-]{16,80}$'),
 actor_id uuid NOT NULL,offering_id uuid NOT NULL,case_id uuid NOT NULL,payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),created_at bigint NOT NULL CHECK(created_at>0),
 PRIMARY KEY(tenant_id,command_key),
 FOREIGN KEY(tenant_id,offering_id,case_id) REFERENCES zhiban_followup.cases(tenant_id,offering_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE INDEX followup_cases_page ON zhiban_followup.cases(tenant_id,offering_id,id DESC);
CREATE INDEX followup_events_page ON zhiban_followup.events(tenant_id,offering_id,case_id,id DESC);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['cases','events','commands'] LOOP
  EXECUTE format('ALTER TABLE zhiban_followup.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE zhiban_followup.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY tenant_scope ON zhiban_followup.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',n);
  EXECUTE format('REVOKE ALL ON zhiban_followup.%I FROM PUBLIC',n);
  EXECUTE format('GRANT SELECT,INSERT ON zhiban_followup.%I TO zhiban_academic_runtime',n);
 END LOOP;
END $$;
GRANT UPDATE(state,revision,updated_by,updated_at) ON zhiban_followup.cases TO zhiban_academic_runtime;
-- Notes, receipts and anchors have no UPDATE/DELETE grants. Closing does not alter learning facts.
