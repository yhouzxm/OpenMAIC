-- New P5 context. Install only into a new owned LOCAL disposable PG16.
CREATE SCHEMA zhiban_concept AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_concept FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_concept TO zhiban_academic_runtime;
CREATE TABLE zhiban_concept.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum~'^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_concept.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_concept.corrections(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,id uuid NOT NULL,
 enrollment_id uuid NOT NULL,membership_id uuid NOT NULL,activity_id uuid NOT NULL,activity_version integer NOT NULL,attempt_id uuid NOT NULL,submission_id uuid NOT NULL,publication_id uuid NOT NULL,
 question_id text NOT NULL CHECK(length(question_id)<=100),evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
 state text NOT NULL CHECK(state IN('DRAFT','OPEN','RESOLVED','RETRACTED')),revision bigint NOT NULL CHECK(revision>0),published_revision bigint CHECK(published_revision>0 AND published_revision<=revision),
 concept text NOT NULL CHECK(length(concept) BETWEEN 1 AND 120),explanation text NOT NULL CHECK(length(explanation) BETWEEN 1 AND 2000),guidance text NOT NULL CHECK(length(guidance) BETWEEN 1 AND 2000),
 created_by uuid NOT NULL,created_at bigint NOT NULL CHECK(created_at>0),updated_at bigint NOT NULL CHECK(updated_at>=created_at),
 CHECK((state='DRAFT')=(published_revision IS NULL)),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,offering_id,id),UNIQUE(tenant_id,publication_id,question_id),
 FOREIGN KEY(tenant_id,enrollment_id,offering_id,membership_id) REFERENCES zhiban_academic.enrollments(tenant_id,id,offering_id,membership_id),
 FOREIGN KEY(tenant_id,activity_id,activity_version,offering_id) REFERENCES zhiban_learning.activity_versions(tenant_id,activity_id,version,offering_id),
 FOREIGN KEY(tenant_id,attempt_id,activity_id,activity_version) REFERENCES zhiban_learning.attempts(tenant_id,id,activity_id,activity_version),
 FOREIGN KEY(tenant_id,submission_id,attempt_id) REFERENCES zhiban_learning.submissions(tenant_id,id,attempt_id),
 FOREIGN KEY(tenant_id,publication_id,submission_id) REFERENCES zhiban_assessment.publications(tenant_id,id,submission_id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_concept.events(
 tenant_id uuid NOT NULL,correction_id uuid NOT NULL,id uuid NOT NULL,revision bigint NOT NULL CHECK(revision>0),
 action text NOT NULL CHECK(action IN('CREATE_CORRECTION','EDIT_DRAFT','PUBLISH_CORRECTION','REVISE_FEEDBACK','RESPOND','ASSESS','RETRACT')),
 state text NOT NULL CHECK(state IN('DRAFT','OPEN','RESOLVED','RETRACTED')),body text NOT NULL CHECK(length(body)<=2000),
 public_text jsonb NOT NULL CHECK(jsonb_typeof(public_text)='object'),snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 private_note text CHECK(length(private_note) BETWEEN 1 AND 2000),actor_id uuid NOT NULL,created_at bigint NOT NULL CHECK(created_at>0),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,correction_id,revision),
 FOREIGN KEY(tenant_id,correction_id) REFERENCES zhiban_concept.corrections(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id),
 CHECK((action='RESPOND' AND private_note IS NULL) OR action<>'RESPOND')
);
CREATE TABLE zhiban_concept.commands(
 tenant_id uuid NOT NULL,command_key text NOT NULL CHECK(command_key~'^[A-Za-z0-9_-]{16,80}$'),actor_id uuid NOT NULL,offering_id uuid NOT NULL,payload_digest text NOT NULL CHECK(payload_digest~'^[a-f0-9]{64}$'),result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,command_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE INDEX concept_page ON zhiban_concept.corrections(tenant_id,offering_id,id DESC);
CREATE INDEX concept_event_page ON zhiban_concept.events(tenant_id,correction_id,id DESC);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['corrections','events','commands'] LOOP
 EXECUTE format('ALTER TABLE zhiban_concept.%I ENABLE ROW LEVEL SECURITY',n);
 EXECUTE format('ALTER TABLE zhiban_concept.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY tenant_scope ON zhiban_concept.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',n);
 EXECUTE format('REVOKE ALL ON zhiban_concept.%I FROM PUBLIC',n);
 EXECUTE format('GRANT SELECT,INSERT ON zhiban_concept.%I TO zhiban_academic_runtime',n);
 END LOOP;
END $$;
GRANT UPDATE(state,revision,published_revision,concept,explanation,guidance,updated_at) ON zhiban_concept.corrections TO zhiban_academic_runtime;
-- Original evidence, author, anchors, history and command receipts have no UPDATE/DELETE privileges.
