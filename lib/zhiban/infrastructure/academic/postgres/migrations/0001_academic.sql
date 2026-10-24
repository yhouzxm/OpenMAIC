-- New academic bounded context. Existing Identity/Bridge migrations are unchanged.
CREATE SCHEMA zhiban_academic AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_academic FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_academic TO zhiban_academic_runtime;
GRANT USAGE ON SCHEMA zhiban_identity TO zhiban_academic_runtime;
GRANT EXECUTE ON FUNCTION zhiban_identity.current_tenant_id() TO zhiban_academic_runtime;
CREATE TABLE zhiban_academic.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_academic.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_academic.courses(
 tenant_id uuid NOT NULL REFERENCES zhiban_identity.tenants(tenant_id), id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120), description text NOT NULL CHECK(length(description)<=2000),
 owner_membership_id uuid, status text NOT NULL CHECK(status IN('DRAFT','PUBLISHED','ARCHIVED')), published_version integer NOT NULL DEFAULT 0 CHECK(published_version>=0),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0), created_at bigint NOT NULL, updated_at bigint NOT NULL CHECK(updated_at>=created_at),
 PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,code), FOREIGN KEY(tenant_id,owner_membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_academic.course_versions(
 tenant_id uuid NOT NULL,id uuid NOT NULL,version integer NOT NULL CHECK(version>0),name text NOT NULL,description text NOT NULL,owner_membership_id uuid,published_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id,version),FOREIGN KEY(tenant_id,id) REFERENCES zhiban_academic.courses(tenant_id,id), FOREIGN KEY(tenant_id,owner_membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_academic.terms(
 tenant_id uuid NOT NULL REFERENCES zhiban_identity.tenants(tenant_id),id uuid NOT NULL,code text NOT NULL CHECK(code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),starts_on date NOT NULL,ends_on date NOT NULL CHECK(ends_on>=starts_on),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,code)
);
CREATE TABLE zhiban_academic.classes(
 tenant_id uuid NOT NULL REFERENCES zhiban_identity.tenants(tenant_id),id uuid NOT NULL,code text NOT NULL CHECK(code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),head_teacher_id uuid,revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,code),FOREIGN KEY(tenant_id,head_teacher_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_academic.class_members(
 tenant_id uuid NOT NULL,id uuid NOT NULL,class_id uuid NOT NULL,membership_id uuid NOT NULL,active boolean NOT NULL,revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,class_id,membership_id),FOREIGN KEY(tenant_id,class_id) REFERENCES zhiban_academic.classes(tenant_id,id),FOREIGN KEY(tenant_id,membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE UNIQUE INDEX class_members_one_active ON zhiban_academic.class_members(tenant_id,membership_id) WHERE active;
CREATE TABLE zhiban_academic.offerings(
 tenant_id uuid NOT NULL,id uuid NOT NULL,course_id uuid NOT NULL,course_version integer NOT NULL,term_id uuid NOT NULL,class_id uuid,
 code text NOT NULL CHECK(code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 1000),status text NOT NULL CHECK(status IN('OPEN','CLOSED')),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,term_id,code),FOREIGN KEY(tenant_id,course_id,course_version) REFERENCES zhiban_academic.course_versions(tenant_id,id,version),FOREIGN KEY(tenant_id,term_id) REFERENCES zhiban_academic.terms(tenant_id,id),FOREIGN KEY(tenant_id,class_id) REFERENCES zhiban_academic.classes(tenant_id,id)
);
CREATE TABLE zhiban_academic.assignments(
 tenant_id uuid NOT NULL,id uuid NOT NULL,offering_id uuid NOT NULL,membership_id uuid NOT NULL,status text NOT NULL CHECK(status IN('ACTIVE','ENDED')),valid_from bigint NOT NULL,valid_until bigint CHECK(valid_until>=valid_from),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 CHECK((status='ACTIVE' AND valid_until IS NULL) OR (status='ENDED' AND valid_until IS NOT NULL)), PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,offering_id,membership_id),FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id),FOREIGN KEY(tenant_id,membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_academic.enrollments(
 tenant_id uuid NOT NULL,id uuid NOT NULL,offering_id uuid NOT NULL,membership_id uuid NOT NULL,status text NOT NULL CHECK(status IN('ACTIVE','WITHDRAWN')),valid_from bigint NOT NULL,valid_until bigint CHECK(valid_until>=valid_from),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 CHECK((status='ACTIVE' AND valid_until IS NULL) OR (status='WITHDRAWN' AND valid_until IS NOT NULL)),PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,offering_id,membership_id),FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id),FOREIGN KEY(tenant_id,membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_academic.people(
 tenant_id uuid NOT NULL,membership_id uuid NOT NULL,display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),PRIMARY KEY(tenant_id,membership_id),FOREIGN KEY(tenant_id,membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_academic.commands(
 tenant_id uuid NOT NULL,command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9_-]{16,80}$'),actor_id uuid NOT NULL,payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),completed_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,command_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_academic.audit_events(
 tenant_id uuid NOT NULL,id uuid NOT NULL,actor_id uuid NOT NULL,command_key text NOT NULL,event_type text NOT NULL,occurred_at bigint NOT NULL,facts jsonb NOT NULL,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id),FOREIGN KEY(tenant_id,command_key) REFERENCES zhiban_academic.commands(tenant_id,command_key) DEFERRABLE INITIALLY DEFERRED
);
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['courses','course_versions','terms','classes','class_members','offerings','assignments','enrollments','people','commands','audit_events'] LOOP
  EXECUTE format('ALTER TABLE zhiban_academic.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE zhiban_academic.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY tenant_scope ON zhiban_academic.%I FOR ALL TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',table_name);
  EXECUTE format('GRANT SELECT,INSERT ON zhiban_academic.%I TO zhiban_academic_runtime',table_name);
 END LOOP;
END $$;
GRANT UPDATE(name,description,owner_membership_id,status,published_version,revision,updated_at) ON zhiban_academic.courses TO zhiban_academic_runtime;
GRANT UPDATE(head_teacher_id,revision) ON zhiban_academic.classes TO zhiban_academic_runtime;
GRANT UPDATE(active,revision) ON zhiban_academic.class_members TO zhiban_academic_runtime;
GRANT UPDATE(name,capacity,status,revision) ON zhiban_academic.offerings TO zhiban_academic_runtime;
GRANT UPDATE(status,valid_from,valid_until,revision) ON zhiban_academic.assignments,zhiban_academic.enrollments TO zhiban_academic_runtime;
-- Immutable versions, command receipts and audit: SELECT/INSERT only, no DELETE anywhere.
