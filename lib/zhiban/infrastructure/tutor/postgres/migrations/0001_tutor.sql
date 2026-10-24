-- New isolated course Tutor context. No changes to Identity, Native, Bridge or grading.
CREATE SCHEMA zhiban_tutor AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_tutor FROM PUBLIC;
CREATE TABLE zhiban_tutor.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL);
CREATE TABLE zhiban_tutor.policies(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,revision bigint NOT NULL CHECK(revision>0),enabled boolean NOT NULL,guidance text NOT NULL CHECK(length(guidance)<=2000),updated_by uuid NOT NULL,updated_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,offering_id),FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id),FOREIGN KEY(tenant_id,updated_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_tutor.sessions(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,id uuid NOT NULL,membership_id uuid NOT NULL,mode text NOT NULL CHECK(mode IN('TEACHER','STUDENT')),enrollment_id uuid,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),source jsonb CHECK(source IS NULL OR jsonb_typeof(source)='object'),state text NOT NULL CHECK(state IN('OPEN','CLOSED')),revision bigint NOT NULL CHECK(revision>0),created_at bigint NOT NULL,updated_at bigint NOT NULL,
 CHECK((mode='STUDENT')=(enrollment_id IS NOT NULL)),PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,offering_id,id,membership_id),FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id),FOREIGN KEY(tenant_id,membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id),FOREIGN KEY(tenant_id,enrollment_id,offering_id,membership_id) REFERENCES zhiban_academic.enrollments(tenant_id,id,offering_id,membership_id)
);
CREATE TABLE zhiban_tutor.turns(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,session_id uuid NOT NULL,membership_id uuid NOT NULL,id uuid NOT NULL,position integer NOT NULL CHECK(position BETWEEN 1 AND 30),policy_revision bigint NOT NULL,question text NOT NULL CHECK(length(question) BETWEEN 1 AND 2000),answer text CHECK(length(answer) BETWEEN 1 AND 16000),state text NOT NULL CHECK(state IN('RUNNING','COMPLETED','FAILED','CANCELLED','BLOCKED','EXPIRED')),model jsonb,error_code text,created_at bigint NOT NULL,expires_at bigint NOT NULL,finished_at bigint,
 CHECK((state='COMPLETED')=(answer IS NOT NULL)),CHECK((state='RUNNING')=(finished_at IS NULL)),CHECK(expires_at>created_at),PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,session_id,position),FOREIGN KEY(tenant_id,offering_id,session_id,membership_id) REFERENCES zhiban_tutor.sessions(tenant_id,offering_id,id,membership_id)
);
CREATE UNIQUE INDEX one_tutor_running_per_member ON zhiban_tutor.turns(tenant_id,offering_id,membership_id) WHERE state='RUNNING';
CREATE TABLE zhiban_tutor.events(
 tenant_id uuid NOT NULL,id uuid NOT NULL,offering_id uuid NOT NULL,actor_id uuid NOT NULL,action text NOT NULL,facts jsonb NOT NULL,created_at bigint NOT NULL,PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_tutor.commands(
 tenant_id uuid NOT NULL,command_key text NOT NULL CHECK(command_key~'^[A-Za-z0-9_-]{16,80}$'),offering_id uuid NOT NULL,actor_id uuid NOT NULL,payload_digest text NOT NULL CHECK(payload_digest~'^[a-f0-9]{64}$'),result jsonb NOT NULL,created_at bigint NOT NULL,PRIMARY KEY(tenant_id,command_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA zhiban_tutor FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_tutor TO zhiban_academic_runtime;
GRANT SELECT ON zhiban_tutor.schema_migrations TO zhiban_academic_runtime;
DO $$ DECLARE n text;BEGIN
 FOREACH n IN ARRAY ARRAY['policies','sessions','turns','events','commands'] LOOP
 EXECUTE format('ALTER TABLE zhiban_tutor.%I ENABLE ROW LEVEL SECURITY',n);
 EXECUTE format('ALTER TABLE zhiban_tutor.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY tenant_isolation ON zhiban_tutor.%I USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',n);
 EXECUTE format('GRANT SELECT,INSERT ON zhiban_tutor.%I TO zhiban_academic_runtime',n);
 END LOOP;
END $$;
GRANT UPDATE(revision,enabled,guidance,updated_by,updated_at) ON zhiban_tutor.policies TO zhiban_academic_runtime;
GRANT UPDATE(state,revision,updated_at) ON zhiban_tutor.sessions TO zhiban_academic_runtime;
GRANT UPDATE(answer,state,model,error_code,finished_at) ON zhiban_tutor.turns TO zhiban_academic_runtime;
