-- Additive business profile/directory. Identity state and credential ACLs remain unchanged.
CREATE SCHEMA zhiban_profile AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_profile FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_profile TO zhiban_academic_runtime;
CREATE TABLE zhiban_profile.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_profile.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_profile.profiles(
 tenant_id uuid NOT NULL,membership_id uuid NOT NULL,
 display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 120),email text NOT NULL CHECK(length(email)<=254),qq text NOT NULL CHECK(length(qq)<=32),wechat text NOT NULL CHECK(length(wechat)<=100),bio text NOT NULL CHECK(length(bio)<=2000),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),updated_at bigint NOT NULL CHECK(updated_at>0),
 PRIMARY KEY(tenant_id,membership_id),FOREIGN KEY(tenant_id,membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_profile.directory_records(
 tenant_id uuid NOT NULL,membership_id uuid NOT NULL,
 formal_name text NOT NULL CHECK(length(formal_name) BETWEEN 1 AND 120),student_no text NOT NULL CHECK(student_no='' OR student_no ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),employee_no text NOT NULL CHECK(employee_no='' OR employee_no ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),updated_at bigint NOT NULL CHECK(updated_at>0),
 PRIMARY KEY(tenant_id,membership_id),FOREIGN KEY(tenant_id,membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE UNIQUE INDEX directory_student_no_unique ON zhiban_profile.directory_records(tenant_id,lower(student_no)) WHERE student_no<>'';
CREATE UNIQUE INDEX directory_employee_no_unique ON zhiban_profile.directory_records(tenant_id,lower(employee_no)) WHERE employee_no<>'';
CREATE TABLE zhiban_profile.commands(
 tenant_id uuid NOT NULL,command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9_-]{16,80}$'),actor_id uuid NOT NULL,target_id uuid NOT NULL,
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),action text NOT NULL CHECK(action IN('SAVE_PROFILE','SAVE_DIRECTORY')),result jsonb NOT NULL,created_at bigint NOT NULL CHECK(created_at>0),
 PRIMARY KEY(tenant_id,command_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id),FOREIGN KEY(tenant_id,target_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['profiles','directory_records','commands'] LOOP
  EXECUTE format('ALTER TABLE zhiban_profile.%I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE zhiban_profile.%I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY tenant_scope ON zhiban_profile.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',name);
  EXECUTE format('REVOKE ALL ON zhiban_profile.%I FROM PUBLIC',name);
  EXECUTE format('GRANT SELECT,INSERT ON zhiban_profile.%I TO zhiban_academic_runtime',name);
 END LOOP;
END $$;
GRANT UPDATE(display_name,email,qq,wechat,bio,revision,updated_at) ON zhiban_profile.profiles TO zhiban_academic_runtime;
GRANT UPDATE(formal_name,student_no,employee_no,revision,updated_at) ON zhiban_profile.directory_records TO zhiban_academic_runtime;
-- Explicit successor ACL for atomic public display-name synchronization; no role/credential mutation.
GRANT UPDATE(display_name) ON zhiban_academic.people TO zhiban_academic_runtime;
