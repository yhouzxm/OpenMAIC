-- Additive course-offering outline; no changes to applied migrations or content authority.
CREATE SCHEMA zhiban_curriculum AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_curriculum FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_curriculum TO zhiban_academic_runtime;
CREATE TABLE zhiban_curriculum.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_curriculum.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_curriculum.outlines(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 draft jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(draft)='array' AND jsonb_array_length(draft)<=50),
 published jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(published)='array' AND jsonb_array_length(published)<=50),
 publication_no integer NOT NULL DEFAULT 0 CHECK(publication_no>=0),updated_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,offering_id),FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id)
);
ALTER TABLE zhiban_curriculum.outlines ENABLE ROW LEVEL SECURITY;
ALTER TABLE zhiban_curriculum.outlines FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON zhiban_curriculum.outlines FOR ALL TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id());
GRANT SELECT,INSERT ON zhiban_curriculum.outlines TO zhiban_academic_runtime;
GRANT UPDATE(revision,draft,published,publication_no,updated_at) ON zhiban_curriculum.outlines TO zhiban_academic_runtime;
