-- Additive basic classroom only. No Runtime/Identity session or completion semantics.
CREATE SCHEMA zhiban_classroom AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_classroom FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_classroom TO zhiban_academic_runtime;
CREATE TABLE zhiban_classroom.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_classroom.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_classroom.sessions(
 tenant_id uuid NOT NULL,id uuid NOT NULL,offering_id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),description text NOT NULL CHECK(length(description)<=1000),
 state text NOT NULL CHECK(state IN ('DRAFT','PUBLISHED','ENDED')),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 opens_at bigint,closes_at bigint,created_at bigint NOT NULL,created_by uuid NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,id,offering_id),
 FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id),
 CHECK(opens_at IS NULL OR closes_at IS NULL OR opens_at<closes_at)
);
CREATE TABLE zhiban_classroom.dispatches(
 tenant_id uuid NOT NULL,id uuid NOT NULL,session_id uuid NOT NULL,offering_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('LECTURE','ACTIVITY')),target_id uuid NOT NULL,target_version text NOT NULL CHECK(target_version ~ '^[1-9][0-9]{0,14}$'),
 title text NOT NULL,state text NOT NULL CHECK(state IN ('ACTIVE','ENDED')),created_at bigint NOT NULL,created_by uuid NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,id,session_id),
 FOREIGN KEY(tenant_id,session_id,offering_id) REFERENCES zhiban_classroom.sessions(tenant_id,id,offering_id)
);
CREATE UNIQUE INDEX one_active_task ON zhiban_classroom.dispatches(tenant_id,session_id) WHERE state='ACTIVE';
CREATE TABLE zhiban_classroom.entries(
 tenant_id uuid NOT NULL,dispatch_id uuid NOT NULL,session_id uuid NOT NULL,membership_id uuid NOT NULL,entered_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,dispatch_id,membership_id),
 FOREIGN KEY(tenant_id,dispatch_id,session_id) REFERENCES zhiban_classroom.dispatches(tenant_id,id,session_id)
);
ALTER TABLE zhiban_classroom.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhiban_classroom.sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE zhiban_classroom.dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhiban_classroom.dispatches FORCE ROW LEVEL SECURITY;
ALTER TABLE zhiban_classroom.entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhiban_classroom.entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON zhiban_classroom.sessions FOR ALL TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id());
CREATE POLICY tenant_scope ON zhiban_classroom.dispatches FOR ALL TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id());
CREATE POLICY tenant_scope ON zhiban_classroom.entries FOR ALL TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id());
GRANT SELECT,INSERT ON zhiban_classroom.sessions,zhiban_classroom.dispatches,zhiban_classroom.entries TO zhiban_academic_runtime;
GRANT UPDATE(state,revision) ON zhiban_classroom.sessions TO zhiban_academic_runtime;
GRANT UPDATE(state) ON zhiban_classroom.dispatches TO zhiban_academic_runtime;
