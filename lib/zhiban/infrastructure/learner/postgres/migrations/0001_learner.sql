-- Independent P5 evidence-backed observations. LOCAL owned disposable installation only.
CREATE SCHEMA zhiban_learner AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_learner FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_learner TO zhiban_academic_runtime;
CREATE TABLE zhiban_learner.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum~'^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_learner.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_learner.observations(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,id uuid NOT NULL,enrollment_id uuid NOT NULL,membership_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN('DRAFT','PUBLISHED','WITHDRAWN')),revision bigint NOT NULL CHECK(revision>0),content_revision bigint NOT NULL CHECK(content_revision>0 AND content_revision<=revision),published_revision bigint CHECK(published_revision>0 AND published_revision<=revision),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),confidence text NOT NULL CHECK(confidence IN('LIMITED','SUPPORTED')),
 created_by uuid NOT NULL,created_at bigint NOT NULL CHECK(created_at>0),updated_at bigint NOT NULL CHECK(updated_at>=created_at),
 CHECK((state='DRAFT')=(published_revision IS NULL)),PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,offering_id,id),UNIQUE(tenant_id,offering_id,id,enrollment_id,membership_id),
 FOREIGN KEY(tenant_id,enrollment_id,offering_id,membership_id) REFERENCES zhiban_academic.enrollments(tenant_id,id,offering_id,membership_id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_learner.events(
 tenant_id uuid NOT NULL,note_id uuid NOT NULL,id uuid NOT NULL,revision bigint NOT NULL CHECK(revision>0),action text NOT NULL CHECK(action IN('CREATE_OBSERVATION','EDIT_DRAFT','PUBLISH_OBSERVATION','REVISE_PUBLIC','WITHDRAW_OBSERVATION','DISPUTE_REVISE','DISPUTE_WITHDRAW')),
 state text NOT NULL CHECK(state IN('DRAFT','PUBLISHED','WITHDRAWN')),body text NOT NULL CHECK(length(body)<=2000),snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),actor_id uuid NOT NULL,created_at bigint NOT NULL CHECK(created_at>0),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,note_id,revision),FOREIGN KEY(tenant_id,note_id) REFERENCES zhiban_learner.observations(tenant_id,id),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_learner.citations(
 tenant_id uuid NOT NULL,note_id uuid NOT NULL,revision bigint NOT NULL,position integer NOT NULL CHECK(position BETWEEN 1 AND 5),kind text NOT NULL CHECK(kind IN('GRADE','CONCEPT','REMEDIATION')),
 publication_id uuid,concept_id uuid,plan_id uuid,source_id uuid GENERATED ALWAYS AS(coalesce(publication_id,concept_id,plan_id)) STORED,
 digest text NOT NULL CHECK(digest~'^[a-f0-9]{64}$'),snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 CHECK((kind='GRADE' AND publication_id IS NOT NULL AND concept_id IS NULL AND plan_id IS NULL) OR(kind='CONCEPT' AND concept_id IS NOT NULL AND publication_id IS NULL AND plan_id IS NULL) OR(kind='REMEDIATION' AND plan_id IS NOT NULL AND publication_id IS NULL AND concept_id IS NULL)),
 PRIMARY KEY(tenant_id,note_id,revision,position),UNIQUE(tenant_id,note_id,revision,kind,source_id),
 FOREIGN KEY(tenant_id,note_id,revision) REFERENCES zhiban_learner.events(tenant_id,note_id,revision) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(tenant_id,publication_id) REFERENCES zhiban_assessment.publications(tenant_id,id),FOREIGN KEY(tenant_id,concept_id) REFERENCES zhiban_concept.corrections(tenant_id,id),FOREIGN KEY(tenant_id,plan_id) REFERENCES zhiban_remediation.plans(tenant_id,id)
);
CREATE TABLE zhiban_learner.disputes(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,id uuid NOT NULL,note_id uuid NOT NULL,enrollment_id uuid NOT NULL,membership_id uuid NOT NULL,target_revision bigint NOT NULL CHECK(target_revision>0),original_snapshot jsonb NOT NULL CHECK(jsonb_typeof(original_snapshot)='object'),state text NOT NULL CHECK(state IN('OPEN','RESOLVED')),revision bigint NOT NULL CHECK(revision>0),created_at bigint NOT NULL CHECK(created_at>0),updated_at bigint NOT NULL CHECK(updated_at>=created_at),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,offering_id,id),FOREIGN KEY(tenant_id,offering_id,note_id,enrollment_id,membership_id) REFERENCES zhiban_learner.observations(tenant_id,offering_id,id,enrollment_id,membership_id)
);
CREATE UNIQUE INDEX one_open_learner_dispute ON zhiban_learner.disputes(tenant_id,note_id) WHERE state='OPEN';
CREATE TABLE zhiban_learner.dispute_events(
 tenant_id uuid NOT NULL,dispute_id uuid NOT NULL,id uuid NOT NULL,revision bigint NOT NULL CHECK(revision>0),action text NOT NULL CHECK(action IN('OPEN_DISPUTE','APPEND_DISPUTE','RESOLVE_DISPUTE')),outcome text CHECK(outcome IN('KEEP','REVISE','WITHDRAW')),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),desired text CHECK(length(desired) BETWEEN 1 AND 2000),note_snapshot jsonb NOT NULL CHECK(jsonb_typeof(note_snapshot)='object'),actor_id uuid NOT NULL,created_at bigint NOT NULL CHECK(created_at>0),
 CHECK((action='RESOLVE_DISPUTE' AND outcome IS NOT NULL AND desired IS NULL) OR(action<>'RESOLVE_DISPUTE' AND outcome IS NULL AND desired IS NOT NULL)),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,dispute_id,revision),FOREIGN KEY(tenant_id,dispute_id) REFERENCES zhiban_learner.disputes(tenant_id,id),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_learner.commands(
 tenant_id uuid NOT NULL,command_key text NOT NULL CHECK(command_key~'^[A-Za-z0-9_-]{16,80}$'),offering_id uuid NOT NULL,actor_id uuid NOT NULL,payload_digest text NOT NULL CHECK(payload_digest~'^[a-f0-9]{64}$'),result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,command_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE INDEX learner_note_page ON zhiban_learner.observations(tenant_id,offering_id,enrollment_id,id DESC);
CREATE INDEX learner_dispute_page ON zhiban_learner.disputes(tenant_id,offering_id,enrollment_id,id DESC);
CREATE INDEX learner_event_page ON zhiban_learner.events(tenant_id,note_id,id DESC);
CREATE INDEX learner_dispute_event_page ON zhiban_learner.dispute_events(tenant_id,dispute_id,id DESC);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['observations','events','citations','disputes','dispute_events','commands'] LOOP
 EXECUTE format('ALTER TABLE zhiban_learner.%I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('ALTER TABLE zhiban_learner.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY tenant_scope ON zhiban_learner.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',n);
 EXECUTE format('REVOKE ALL ON zhiban_learner.%I FROM PUBLIC',n);EXECUTE format('GRANT SELECT,INSERT ON zhiban_learner.%I TO zhiban_academic_runtime',n);
 END LOOP;
END $$;
GRANT UPDATE(state,revision,content_revision,published_revision,title,body,confidence,updated_at) ON zhiban_learner.observations TO zhiban_academic_runtime;
GRANT UPDATE(state,revision,updated_at) ON zhiban_learner.disputes TO zhiban_academic_runtime;
