-- Additive host extension. No formal Attempt, grade or frozen provider changes.
CREATE TABLE zhiban_live_classroom (
 tenant_id uuid NOT NULL, offering_id uuid NOT NULL, resource_id uuid NOT NULL, publication_id uuid NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), actor_id uuid NOT NULL, controller_id uuid NOT NULL,
 enabled boolean NOT NULL, state jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,offering_id,resource_id,publication_id)
);
CREATE TABLE zhiban_live_events (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, offering_id uuid NOT NULL, resource_id uuid NOT NULL, publication_id uuid NOT NULL,
 revision bigint NOT NULL, actor_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('START','UPDATE','STOP')),
 state_digest text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,offering_id,resource_id,publication_id,revision)
);
CREATE TABLE zhiban_course_video_jobs (
 id uuid PRIMARY KEY, owner_id text NOT NULL, command_id uuid NOT NULL, intent_digest text NOT NULL,
 tenant_id uuid NOT NULL, offering_id uuid NOT NULL, actor_id uuid NOT NULL,
 source jsonb NOT NULL, project_digest text NOT NULL, upstream_id text,
 status text NOT NULL CHECK(status IN ('SUBMITTING','SUBMITTED','FAILED','EXPIRED')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,command_id)
);
REVOKE ALL ON zhiban_live_classroom,zhiban_live_events,zhiban_course_video_jobs FROM PUBLIC;
CREATE FUNCTION zhiban_live_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Classroom live audit is append only'; END $$;
CREATE TRIGGER zhiban_live_audit BEFORE UPDATE OR DELETE ON zhiban_live_events FOR EACH ROW EXECUTE FUNCTION zhiban_live_audit_immutable();
REVOKE ALL ON FUNCTION zhiban_live_audit_immutable() FROM PUBLIC;
