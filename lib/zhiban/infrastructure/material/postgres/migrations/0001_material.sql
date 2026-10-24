-- Course materials are business resources, independent of owner materials/Native Runtime.
CREATE SCHEMA zhiban_material AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_material FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_material TO zhiban_academic_runtime;
CREATE TABLE zhiban_material.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_material.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_material.resources(
 tenant_id uuid NOT NULL,id uuid NOT NULL,offering_id uuid NOT NULL,created_by uuid NOT NULL,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),source_revision bigint NOT NULL CHECK(source_revision>0),
 published_revision bigint,publication_no integer NOT NULL DEFAULT 0 CHECK(publication_no>=0),archived boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,offering_id,id),
 FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_material.versions(
 tenant_id uuid NOT NULL,resource_id uuid NOT NULL,source_revision bigint NOT NULL CHECK(source_revision>0),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120),mime text NOT NULL CHECK(mime IN('text/plain','text/markdown','application/pdf')),
 bytes bytea NOT NULL CHECK(octet_length(bytes) BETWEEN 1 AND 1048576),digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),
 extracted_text text NOT NULL CHECK(length(extracted_text)<=100000),parser text NOT NULL,scanner_reference text NOT NULL,created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,resource_id,source_revision),FOREIGN KEY(tenant_id,resource_id) REFERENCES zhiban_material.resources(tenant_id,id)
);
CREATE TABLE zhiban_material.publications(
 tenant_id uuid NOT NULL,resource_id uuid NOT NULL,publication_no integer NOT NULL CHECK(publication_no>0),source_revision bigint NOT NULL,actor_id uuid NOT NULL,published_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,resource_id,publication_no),FOREIGN KEY(tenant_id,resource_id,source_revision) REFERENCES zhiban_material.versions(tenant_id,resource_id,source_revision),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
ALTER TABLE zhiban_material.resources ADD FOREIGN KEY(tenant_id,id,source_revision) REFERENCES zhiban_material.versions(tenant_id,resource_id,source_revision) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE zhiban_material.resources ADD FOREIGN KEY(tenant_id,id,published_revision) REFERENCES zhiban_material.versions(tenant_id,resource_id,source_revision);
CREATE TABLE zhiban_material.commands(
 tenant_id uuid NOT NULL,command_key text NOT NULL,actor_id uuid NOT NULL,offering_id uuid NOT NULL,resource_id uuid NOT NULL,payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),action text NOT NULL,result jsonb NOT NULL,created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,command_key),FOREIGN KEY(tenant_id,offering_id,resource_id) REFERENCES zhiban_material.resources(tenant_id,offering_id,id),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['resources','versions','publications','commands'] LOOP
 EXECUTE format('ALTER TABLE zhiban_material.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE zhiban_material.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON zhiban_material.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',t);
 EXECUTE format('REVOKE ALL ON zhiban_material.%I FROM PUBLIC',t);
 EXECUTE format('GRANT SELECT,INSERT ON zhiban_material.%I TO zhiban_academic_runtime',t);
END LOOP; END $$;
GRANT UPDATE(revision,source_revision,published_revision,publication_no,archived) ON zhiban_material.resources TO zhiban_academic_runtime;
