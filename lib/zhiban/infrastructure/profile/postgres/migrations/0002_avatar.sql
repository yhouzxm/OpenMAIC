-- Additive tenant-scoped avatar storage and idempotent audit. No Identity writes.
CREATE TABLE zhiban_profile.avatars(
 tenant_id uuid NOT NULL,membership_id uuid NOT NULL,
 png text CHECK(png IS NULL OR (length(png)<=16384 AND png ~ '^[A-Za-z0-9+/]+={0,2}$')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),updated_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,membership_id),FOREIGN KEY(tenant_id,membership_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_profile.avatar_commands(
 tenant_id uuid NOT NULL,command_key text NOT NULL,actor_id uuid NOT NULL,
 payload_digest text NOT NULL,result jsonb NOT NULL,created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,command_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['avatars','avatar_commands'] LOOP
  EXECUTE format('ALTER TABLE zhiban_profile.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE zhiban_profile.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY tenant_scope ON zhiban_profile.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',n);
  EXECUTE format('REVOKE ALL ON zhiban_profile.%I FROM PUBLIC',n);
  EXECUTE format('GRANT SELECT,INSERT ON zhiban_profile.%I TO zhiban_academic_runtime',n);
 END LOOP;
END $$;
GRANT UPDATE(png,revision,updated_at) ON zhiban_profile.avatars TO zhiban_academic_runtime;
