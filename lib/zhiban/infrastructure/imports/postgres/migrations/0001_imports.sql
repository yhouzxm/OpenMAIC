-- New durable import receipts. No changes to existing Identity or academic tables/ACL.
CREATE SCHEMA zhiban_imports AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_imports FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_imports TO zhiban_academic_runtime;
CREATE TABLE zhiban_imports.schema_migrations(version text PRIMARY KEY, checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_imports.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_imports.batches(
 tenant_id uuid NOT NULL REFERENCES zhiban_identity.tenants(tenant_id), id uuid NOT NULL,
 actor_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN('TERMS','COURSES','CLASSES','OFFERINGS','DIRECTORY','CLASS_MEMBERS','ENROLLMENTS')),
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 created_at bigint NOT NULL, expires_at bigint NOT NULL CHECK(expires_at>created_at),
 PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE INDEX import_batches_actor ON zhiban_imports.batches(tenant_id,actor_id,id DESC);
CREATE TABLE zhiban_imports.rows(
 tenant_id uuid NOT NULL, batch_id uuid NOT NULL, line integer NOT NULL CHECK(line BETWEEN 2 AND 51),
 label text NOT NULL CHECK(length(label)<=120), command jsonb, expected text,
 state text NOT NULL CHECK(state IN('READY','SKIP','BLOCKED','IMPORTED','SKIPPED','FAILED')),
 code text, command_key text NOT NULL CHECK(command_key ~ '^import_[a-f0-9]{32}_[0-9]{1,2}$'),
 PRIMARY KEY(tenant_id,batch_id,line), UNIQUE(tenant_id,command_key),
 FOREIGN KEY(tenant_id,batch_id) REFERENCES zhiban_imports.batches(tenant_id,id),
 CHECK((state='BLOCKED') OR (command IS NOT NULL AND expected ~ '^[a-f0-9]{64}$'))
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['batches','rows'] LOOP
  EXECUTE format('ALTER TABLE zhiban_imports.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE zhiban_imports.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_scope ON zhiban_imports.%I FOR ALL TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',t);
  EXECUTE format('GRANT SELECT,INSERT ON zhiban_imports.%I TO zhiban_academic_runtime',t);
 END LOOP;
END $$;
GRANT UPDATE(state,code) ON zhiban_imports.rows TO zhiban_academic_runtime;
-- No DELETE, command/input rewrites, SECURITY DEFINER or cross-tenant lookup.
