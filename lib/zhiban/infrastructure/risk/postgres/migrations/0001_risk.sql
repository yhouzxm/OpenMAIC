-- Teacher-only explainable signals and immutable human review. No automatic student risk labels.
CREATE SCHEMA zhiban_risk AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_risk FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_risk TO zhiban_academic_runtime;
CREATE TABLE zhiban_risk.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_risk.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_risk.rules(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,rule_code text NOT NULL CHECK(rule_code IN('OVERDUE','LOW_SCORE','PLAN_OVERDUE')),
 enabled boolean NOT NULL,threshold integer NOT NULL,revision bigint NOT NULL CHECK(revision>0),
 CHECK(threshold>=CASE WHEN rule_code='LOW_SCORE' THEN 1 ELSE 0 END AND threshold<=CASE WHEN rule_code='LOW_SCORE' THEN 100 ELSE 720 END),
 PRIMARY KEY(tenant_id,offering_id,rule_code),FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id)
);
CREATE TABLE zhiban_risk.rule_versions(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,rule_code text NOT NULL,revision bigint NOT NULL CHECK(revision>0),enabled boolean NOT NULL,threshold integer NOT NULL,actor_id uuid NOT NULL,created_at bigint NOT NULL,
 CHECK(threshold>=CASE WHEN rule_code='LOW_SCORE' THEN 1 ELSE 0 END AND threshold<=CASE WHEN rule_code='LOW_SCORE' THEN 100 ELSE 720 END),
 PRIMARY KEY(tenant_id,offering_id,rule_code,revision),FOREIGN KEY(tenant_id,offering_id,rule_code) REFERENCES zhiban_risk.rules(tenant_id,offering_id,rule_code),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_risk.reviews(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,id uuid NOT NULL,rule_code text NOT NULL,rule_revision bigint NOT NULL,
 enrollment_id uuid NOT NULL,membership_id uuid NOT NULL,activity_id uuid,activity_version integer,plan_id uuid,
 anchor_id uuid GENERATED ALWAYS AS(coalesce(activity_id,plan_id)) STORED,anchor_version integer GENERATED ALWAYS AS(coalesce(activity_version,0)) STORED,
 source_key text NOT NULL,evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
 decision text NOT NULL CHECK(decision IN('SUPPORT','NO_ACTION','RESOLVED')),revision bigint NOT NULL CHECK(revision>0),case_id uuid,created_by uuid NOT NULL,created_at bigint NOT NULL,updated_at bigint NOT NULL CHECK(updated_at>=created_at),
 CHECK((rule_code='PLAN_OVERDUE' AND plan_id IS NOT NULL AND activity_id IS NULL AND activity_version IS NULL) OR(rule_code IN('OVERDUE','LOW_SCORE') AND plan_id IS NULL AND activity_id IS NOT NULL AND activity_version IS NOT NULL AND activity_version>0)),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,offering_id,id),UNIQUE(tenant_id,offering_id,rule_code,rule_revision,enrollment_id,anchor_id,anchor_version,source_key),
 FOREIGN KEY(tenant_id,offering_id,rule_code,rule_revision) REFERENCES zhiban_risk.rule_versions(tenant_id,offering_id,rule_code,revision),
 FOREIGN KEY(tenant_id,enrollment_id,offering_id,membership_id) REFERENCES zhiban_academic.enrollments(tenant_id,id,offering_id,membership_id),
 FOREIGN KEY(tenant_id,activity_id,activity_version,offering_id) REFERENCES zhiban_learning.activity_versions(tenant_id,activity_id,version,offering_id),
 FOREIGN KEY(tenant_id,offering_id,plan_id) REFERENCES zhiban_remediation.plans(tenant_id,offering_id,id),
 FOREIGN KEY(tenant_id,offering_id,case_id) REFERENCES zhiban_followup.cases(tenant_id,offering_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_risk.events(
 tenant_id uuid NOT NULL,review_id uuid NOT NULL,id uuid NOT NULL,action text NOT NULL CHECK(action IN('REVIEW_SIGNAL','AMEND_REVIEW','LINK_FOLLOWUP')),
 decision text NOT NULL CHECK(decision IN('SUPPORT','NO_ACTION','RESOLVED')),revision bigint NOT NULL CHECK(revision>0),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),actor_id uuid NOT NULL,created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,review_id,revision),FOREIGN KEY(tenant_id,review_id) REFERENCES zhiban_risk.reviews(tenant_id,id),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_risk.commands(
 tenant_id uuid NOT NULL,command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9_-]{16,80}$'),actor_id uuid NOT NULL,offering_id uuid NOT NULL,payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,command_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE INDEX risk_review_page ON zhiban_risk.reviews(tenant_id,offering_id,id DESC);
CREATE INDEX risk_event_page ON zhiban_risk.events(tenant_id,review_id,id DESC);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['rules','rule_versions','reviews','events','commands'] LOOP
  EXECUTE format('ALTER TABLE zhiban_risk.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE zhiban_risk.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY tenant_scope ON zhiban_risk.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',n);
  EXECUTE format('REVOKE ALL ON zhiban_risk.%I FROM PUBLIC',n);
  EXECUTE format('GRANT SELECT,INSERT ON zhiban_risk.%I TO zhiban_academic_runtime',n);
 END LOOP;
END $$;
GRANT UPDATE(enabled,threshold,revision) ON zhiban_risk.rules TO zhiban_academic_runtime;
GRANT UPDATE(decision,revision,case_id,updated_at) ON zhiban_risk.reviews TO zhiban_academic_runtime;
-- Rules history, evidence, private reviews/events and receipts have no UPDATE/DELETE grant.
