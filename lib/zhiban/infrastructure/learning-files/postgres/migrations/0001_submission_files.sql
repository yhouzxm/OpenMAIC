-- Additive, independent submission attachments; no changes to applied Learning SQL.
CREATE SCHEMA zhiban_learning_files AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_learning_files FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_learning_files TO zhiban_academic_runtime;
CREATE TABLE zhiban_learning_files.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_learning_files.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_learning_files.files(
 tenant_id uuid NOT NULL,id uuid NOT NULL,submission_id uuid NOT NULL,attempt_id uuid NOT NULL,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120 AND name !~ '[[:cntrl:]/\\]'),
 mime text NOT NULL CHECK(mime IN('application/pdf','text/plain')),digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 size integer NOT NULL CHECK(size BETWEEN 1 AND 1048576),bytes bytea NOT NULL CHECK(octet_length(bytes)=size),created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,submission_id),
 FOREIGN KEY(tenant_id,submission_id,attempt_id) REFERENCES zhiban_learning.submissions(tenant_id,id,attempt_id)
);
ALTER TABLE zhiban_learning_files.files ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhiban_learning_files.files FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON zhiban_learning_files.files FOR ALL TO zhiban_academic_runtime
 USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id());
GRANT SELECT,INSERT ON zhiban_learning_files.files TO zhiban_academic_runtime;
