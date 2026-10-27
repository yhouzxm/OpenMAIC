-- Additive private native host storage. Formal submissions stay in the original Learning transaction.
CREATE TABLE zhiban_course_result_tasks (
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,activity_id uuid NOT NULL,activity_version integer NOT NULL,
 revision bigint NOT NULL CHECK(revision>0),enabled boolean NOT NULL,spec jsonb NOT NULL,updated_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,activity_id,activity_version)
);
CREATE TABLE zhiban_course_result_anchors (
 attempt_id uuid PRIMARY KEY,tenant_id uuid NOT NULL,offering_id uuid NOT NULL,member_id uuid NOT NULL,enrollment_id uuid NOT NULL,
 activity_id uuid NOT NULL,activity_version integer NOT NULL,task_revision bigint NOT NULL,spec jsonb NOT NULL,baseline jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(attempt_id,tenant_id,offering_id,member_id)
);
CREATE TABLE zhiban_course_result_proofs (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,offering_id uuid NOT NULL,member_id uuid NOT NULL,attempt_id uuid NOT NULL,
 command_id text NOT NULL,intent_digest text NOT NULL,digest text NOT NULL,payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,member_id,command_id),
 FOREIGN KEY(attempt_id,tenant_id,offering_id,member_id) REFERENCES zhiban_course_result_anchors(attempt_id,tenant_id,offering_id,member_id)
);
CREATE TABLE zhiban_course_shared_results (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,offering_id uuid NOT NULL,resource_id uuid NOT NULL,publication_id uuid NOT NULL,
 actor_id uuid NOT NULL,command_id text NOT NULL,intent_digest text NOT NULL,source_digest text NOT NULL,title text NOT NULL,
 summary text NOT NULL,whiteboard jsonb,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,actor_id,command_id)
);
CREATE TABLE zhiban_course_result_events (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,offering_id uuid NOT NULL,actor_id uuid NOT NULL,event_kind text NOT NULL,
 command_id text NOT NULL,intent_digest text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,actor_id,command_id)
);
CREATE FUNCTION zhiban_course_result_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Course result provenance is immutable'; END $$;
CREATE TRIGGER course_result_proofs_immutable BEFORE UPDATE OR DELETE ON zhiban_course_result_proofs FOR EACH ROW EXECUTE FUNCTION zhiban_course_result_immutable();
CREATE TRIGGER course_result_anchors_immutable BEFORE UPDATE OR DELETE ON zhiban_course_result_anchors FOR EACH ROW EXECUTE FUNCTION zhiban_course_result_immutable();
CREATE TRIGGER course_result_events_immutable BEFORE UPDATE OR DELETE ON zhiban_course_result_events FOR EACH ROW EXECUTE FUNCTION zhiban_course_result_immutable();
CREATE TRIGGER course_shared_results_immutable BEFORE UPDATE OR DELETE ON zhiban_course_shared_results FOR EACH ROW EXECUTE FUNCTION zhiban_course_result_immutable();
REVOKE ALL ON zhiban_course_result_tasks,zhiban_course_result_anchors,zhiban_course_result_proofs,zhiban_course_shared_results,zhiban_course_result_events FROM PUBLIC;
REVOKE ALL ON FUNCTION zhiban_course_result_immutable() FROM PUBLIC;
