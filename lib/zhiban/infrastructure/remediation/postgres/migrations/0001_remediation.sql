-- Additive P5 plan/task/effect context. No Learning/Identity semantics changed.
CREATE SCHEMA zhiban_remediation AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_remediation FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_remediation TO zhiban_academic_runtime;
CREATE TABLE zhiban_remediation.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_remediation.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_remediation.plans(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,id uuid NOT NULL,case_id uuid NOT NULL,
 enrollment_id uuid NOT NULL,membership_id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),goal text NOT NULL CHECK(length(goal) BETWEEN 1 AND 2000),
 due_at bigint CHECK(due_at BETWEEN 1 AND 8640000000000000),state text NOT NULL CHECK(state IN('ACTIVE','CLOSED','CANCELLED')),
 revision bigint NOT NULL CHECK(revision>0),created_by uuid NOT NULL,created_at bigint NOT NULL CHECK(created_at>0),updated_at bigint NOT NULL CHECK(updated_at>=created_at),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,offering_id,id),
 FOREIGN KEY(tenant_id,offering_id,case_id) REFERENCES zhiban_followup.cases(tenant_id,offering_id,id),
 FOREIGN KEY(tenant_id,enrollment_id,offering_id,membership_id) REFERENCES zhiban_academic.enrollments(tenant_id,id,offering_id,membership_id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE UNIQUE INDEX one_active_remediation ON zhiban_remediation.plans(tenant_id,case_id) WHERE state='ACTIVE';
CREATE TABLE zhiban_remediation.tasks(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,plan_id uuid NOT NULL,id uuid NOT NULL,position integer NOT NULL CHECK(position BETWEEN 1 AND 5),
 activity_id uuid NOT NULL,activity_version integer NOT NULL,activity_title text NOT NULL,
 baseline jsonb NOT NULL CHECK(jsonb_typeof(baseline)='object'),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,plan_id,id),UNIQUE(tenant_id,plan_id,position),UNIQUE(tenant_id,plan_id,activity_id),
 FOREIGN KEY(tenant_id,offering_id,plan_id) REFERENCES zhiban_remediation.plans(tenant_id,offering_id,id),
 FOREIGN KEY(tenant_id,activity_id,activity_version,offering_id) REFERENCES zhiban_learning.activity_versions(tenant_id,activity_id,version,offering_id)
);
CREATE TABLE zhiban_remediation.events(
 tenant_id uuid NOT NULL,plan_id uuid NOT NULL,id uuid NOT NULL,task_id uuid,
 action text NOT NULL CHECK(action IN('ASSIGN_PLAN','REPORT_TASK','REVIEW_PLAN','CANCEL_PLAN')),
 value text,body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='array'),
 revision bigint NOT NULL CHECK(revision>0),actor_id uuid NOT NULL,created_at bigint NOT NULL CHECK(created_at>0),
 CHECK((action='ASSIGN_PLAN' AND task_id IS NULL AND value IS NULL AND revision=1)
 OR(action='REPORT_TASK' AND task_id IS NOT NULL AND value IN('READY_FOR_REVIEW','NEEDS_HELP') AND revision>1)
 OR(action='REVIEW_PLAN' AND task_id IS NULL AND value IN('ACHIEVED','NEEDS_MORE') AND revision>1)
 OR(action='CANCEL_PLAN' AND task_id IS NULL AND value IS NULL AND revision>1)),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,plan_id,revision),
 FOREIGN KEY(tenant_id,plan_id) REFERENCES zhiban_remediation.plans(tenant_id,id),
 FOREIGN KEY(tenant_id,plan_id,task_id) REFERENCES zhiban_remediation.tasks(tenant_id,plan_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_remediation.commands(
 tenant_id uuid NOT NULL,command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9_-]{16,80}$'),actor_id uuid NOT NULL,
 offering_id uuid NOT NULL,payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,command_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE INDEX remediation_plan_page ON zhiban_remediation.plans(tenant_id,offering_id,id DESC);
CREATE INDEX remediation_event_page ON zhiban_remediation.events(tenant_id,plan_id,id DESC);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['plans','tasks','events','commands'] LOOP
  EXECUTE format('ALTER TABLE zhiban_remediation.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE zhiban_remediation.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY tenant_scope ON zhiban_remediation.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',n);
  EXECUTE format('REVOKE ALL ON zhiban_remediation.%I FROM PUBLIC',n);
  EXECUTE format('GRANT SELECT,INSERT ON zhiban_remediation.%I TO zhiban_academic_runtime',n);
 END LOOP;
END $$;
GRANT UPDATE(state,revision,updated_at) ON zhiban_remediation.plans TO zhiban_academic_runtime;
-- Public goal, anchors, task baselines, feedback/review snapshots and receipts cannot be rewritten.
