-- LOCAL additive course attainment and controlled equivalence credits. No external qualification claim.
CREATE SCHEMA zhiban_attainment AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_attainment FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_attainment TO zhiban_academic_runtime;
CREATE TABLE zhiban_attainment.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum~'^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_attainment.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_attainment.cert_rules(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,revision bigint NOT NULL CHECK(revision>0),title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),threshold integer NOT NULL CHECK(threshold BETWEEN 0 AND 10000),enabled boolean NOT NULL,updated_by uuid NOT NULL,updated_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,offering_id),FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id),FOREIGN KEY(tenant_id,updated_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_attainment.certificates(
 tenant_id uuid NOT NULL,id uuid NOT NULL,offering_id uuid NOT NULL,membership_id uuid NOT NULL,course_id uuid NOT NULL,total_id uuid NOT NULL,rule_revision bigint NOT NULL,
 snapshot jsonb NOT NULL,source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),state text NOT NULL CHECK(state IN('ACTIVE','REVOKED')),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),issued_by uuid NOT NULL,issued_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,offering_id,membership_id,total_id) REFERENCES zhiban_finalgrade.publications(tenant_id,offering_id,membership_id,id),FOREIGN KEY(tenant_id,issued_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE UNIQUE INDEX one_active_course_certificate ON zhiban_attainment.certificates(tenant_id,membership_id,course_id) WHERE state='ACTIVE';
CREATE TABLE zhiban_attainment.credit_rules(
 tenant_id uuid NOT NULL,id uuid NOT NULL,revision bigint NOT NULL CHECK(revision>0),source_course uuid NOT NULL,target_course uuid NOT NULL,title text NOT NULL CHECK(length(title) BETWEEN 1 AND 120),credits_tenths integer NOT NULL CHECK(credits_tenths BETWEEN 1 AND 300),threshold integer NOT NULL CHECK(threshold BETWEEN 0 AND 10000),enabled boolean NOT NULL,updated_by uuid NOT NULL,updated_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,source_course) REFERENCES zhiban_academic.courses(tenant_id,id),FOREIGN KEY(tenant_id,target_course) REFERENCES zhiban_academic.courses(tenant_id,id),FOREIGN KEY(tenant_id,updated_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_attainment.credits(
 tenant_id uuid NOT NULL,id uuid NOT NULL,membership_id uuid NOT NULL,source_offering uuid NOT NULL,source_course uuid NOT NULL,target_course uuid NOT NULL,rule_id uuid NOT NULL,rule_revision bigint NOT NULL,total_id uuid NOT NULL,
 credits_tenths integer NOT NULL CHECK(credits_tenths BETWEEN 1 AND 300),source_digest text NOT NULL CHECK(source_digest~'^[a-f0-9]{64}$'),snapshot jsonb NOT NULL,state text NOT NULL CHECK(state IN('ACTIVE','REVOKED')),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),issued_by uuid NOT NULL,issued_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,rule_id) REFERENCES zhiban_attainment.credit_rules(tenant_id,id),FOREIGN KEY(tenant_id,source_offering,membership_id,total_id) REFERENCES zhiban_finalgrade.publications(tenant_id,offering_id,membership_id,id),FOREIGN KEY(tenant_id,issued_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE UNIQUE INDEX one_active_credit_per_course ON zhiban_attainment.credits(tenant_id,membership_id,target_course) WHERE state='ACTIVE';
CREATE TABLE zhiban_attainment.events(
 tenant_id uuid NOT NULL,id uuid NOT NULL,actor_id uuid NOT NULL,action text NOT NULL,target_id uuid NOT NULL,revision bigint NOT NULL,reason text NOT NULL,snapshot jsonb NOT NULL,created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_attainment.commands(
 tenant_id uuid NOT NULL,command_key text NOT NULL,actor_id uuid NOT NULL,payload_digest text NOT NULL CHECK(payload_digest~'^[a-f0-9]{64}$'),result jsonb NOT NULL,created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,command_key),FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
DO $$ DECLARE n text; BEGIN FOREACH n IN ARRAY ARRAY['cert_rules','certificates','credit_rules','credits','events','commands'] LOOP
 EXECUTE format('ALTER TABLE zhiban_attainment.%I ENABLE ROW LEVEL SECURITY',n);EXECUTE format('ALTER TABLE zhiban_attainment.%I FORCE ROW LEVEL SECURITY',n);
 EXECUTE format('CREATE POLICY tenant_scope ON zhiban_attainment.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',n);
 EXECUTE format('REVOKE ALL ON zhiban_attainment.%I FROM PUBLIC',n);EXECUTE format('GRANT SELECT,INSERT ON zhiban_attainment.%I TO zhiban_academic_runtime',n);
 END LOOP; END $$;
GRANT UPDATE(revision,title,threshold,enabled,updated_by,updated_at) ON zhiban_attainment.cert_rules TO zhiban_academic_runtime;
GRANT UPDATE(revision,title,credits_tenths,threshold,enabled,updated_by,updated_at) ON zhiban_attainment.credit_rules TO zhiban_academic_runtime;
GRANT UPDATE(state,revision) ON zhiban_attainment.certificates,zhiban_attainment.credits TO zhiban_academic_runtime;
CREATE INDEX attainment_certificate_page ON zhiban_attainment.certificates(tenant_id,membership_id,id DESC);
CREATE INDEX attainment_credit_page ON zhiban_attainment.credits(tenant_id,membership_id,id DESC);
