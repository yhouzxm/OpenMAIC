-- Additive single-recipient in-app delivery. Private followup notes never copied.
CREATE SCHEMA zhiban_reminder AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_reminder FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_reminder TO zhiban_academic_runtime;
CREATE TABLE zhiban_reminder.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_reminder.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_reminder.deliveries(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,id uuid NOT NULL,case_id uuid NOT NULL,
 enrollment_id uuid NOT NULL,membership_id uuid NOT NULL,sequence bigint NOT NULL CHECK(sequence>0),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 sent_by uuid NOT NULL,sent_at bigint NOT NULL CHECK(sent_at>0),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,case_id,sequence),
 UNIQUE(tenant_id,id,membership_id),
 FOREIGN KEY(tenant_id,offering_id,case_id) REFERENCES zhiban_followup.cases(tenant_id,offering_id,id),
 FOREIGN KEY(tenant_id,enrollment_id,offering_id,membership_id) REFERENCES zhiban_academic.enrollments(tenant_id,id,offering_id,membership_id),
 FOREIGN KEY(tenant_id,sent_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_reminder.confirmations(
 tenant_id uuid NOT NULL,delivery_id uuid NOT NULL,membership_id uuid NOT NULL,confirmed_at bigint NOT NULL CHECK(confirmed_at>0),
 PRIMARY KEY(tenant_id,delivery_id),
 FOREIGN KEY(tenant_id,delivery_id,membership_id) REFERENCES zhiban_reminder.deliveries(tenant_id,id,membership_id)
);
CREATE TABLE zhiban_reminder.commands(
 tenant_id uuid NOT NULL,command_key text NOT NULL CHECK(command_key ~ '^[A-Za-z0-9_-]{16,80}$'),actor_id uuid NOT NULL,
 offering_id uuid NOT NULL,payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,command_key),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE INDEX reminder_inbox ON zhiban_reminder.deliveries(tenant_id,offering_id,membership_id,id DESC);
CREATE INDEX reminder_case ON zhiban_reminder.deliveries(tenant_id,offering_id,case_id,id DESC);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['deliveries','confirmations','commands'] LOOP
  EXECUTE format('ALTER TABLE zhiban_reminder.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE zhiban_reminder.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY tenant_scope ON zhiban_reminder.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',n);
  EXECUTE format('REVOKE ALL ON zhiban_reminder.%I FROM PUBLIC',n);
  EXECUTE format('GRANT SELECT,INSERT ON zhiban_reminder.%I TO zhiban_academic_runtime',n);
 END LOOP;
END $$;
-- All deliveries, explicit confirmations and command receipts immutable; no UPDATE/DELETE grants.
