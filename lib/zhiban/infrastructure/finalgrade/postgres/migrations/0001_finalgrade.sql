-- Additive P3 explicit weighted totals and appeals. Immutable original grading contracts stay intact.
CREATE SCHEMA zhiban_finalgrade AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_finalgrade FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_finalgrade TO zhiban_academic_runtime;
CREATE TABLE zhiban_finalgrade.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_finalgrade.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_finalgrade.configs(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 draft jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(draft)='array'),published_version integer NOT NULL DEFAULT 0 CHECK(published_version>=0),
 PRIMARY KEY(tenant_id,offering_id), FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id)
);
CREATE TABLE zhiban_finalgrade.rules(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),items jsonb NOT NULL CHECK(jsonb_typeof(items)='array'),
 actor_id uuid NOT NULL,created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,offering_id,version),FOREIGN KEY(tenant_id,offering_id) REFERENCES zhiban_academic.offerings(tenant_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_finalgrade.publications(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,id uuid NOT NULL,membership_id uuid NOT NULL,enrollment_id uuid NOT NULL,enrollment_from bigint NOT NULL,
 version integer NOT NULL CHECK(version>0),rule_version integer NOT NULL,score_points integer NOT NULL CHECK(score_points BETWEEN 0 AND 10000),
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),components jsonb NOT NULL CHECK(jsonb_typeof(components)='array'),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 1000),published_by uuid NOT NULL,published_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,membership_id,id),UNIQUE(tenant_id,offering_id,membership_id,version),UNIQUE(tenant_id,offering_id,membership_id,id),
 FOREIGN KEY(tenant_id,offering_id,rule_version) REFERENCES zhiban_finalgrade.rules(tenant_id,offering_id,version),
 FOREIGN KEY(tenant_id,enrollment_id,offering_id,membership_id) REFERENCES zhiban_academic.enrollments(tenant_id,id,offering_id,membership_id),
 FOREIGN KEY(tenant_id,published_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_finalgrade.appeals(
 tenant_id uuid NOT NULL,offering_id uuid NOT NULL,id uuid NOT NULL,membership_id uuid NOT NULL,publication_id uuid NOT NULL,
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),state text NOT NULL DEFAULT 'OPEN' CHECK(state IN('OPEN','RESOLVED')),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,publication_id),UNIQUE(tenant_id,id,membership_id),
 FOREIGN KEY(tenant_id,offering_id,membership_id,publication_id) REFERENCES zhiban_finalgrade.publications(tenant_id,offering_id,membership_id,id)
);
CREATE TABLE zhiban_finalgrade.responses(
 tenant_id uuid NOT NULL,appeal_id uuid NOT NULL,membership_id uuid NOT NULL,actor_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN('EXPLAINED','REPLACED')),body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),replacement_id uuid,created_at bigint NOT NULL,
 PRIMARY KEY(tenant_id,appeal_id),FOREIGN KEY(tenant_id,appeal_id,membership_id) REFERENCES zhiban_finalgrade.appeals(tenant_id,id,membership_id),
 FOREIGN KEY(tenant_id,membership_id,replacement_id) REFERENCES zhiban_finalgrade.publications(tenant_id,membership_id,id),
 FOREIGN KEY(tenant_id,actor_id) REFERENCES zhiban_identity.memberships(tenant_id,membership_id),
 CHECK((decision='EXPLAINED' AND replacement_id IS NULL) OR(decision='REPLACED' AND replacement_id IS NOT NULL))
);
CREATE INDEX finalgrade_member_page ON zhiban_finalgrade.publications(tenant_id,offering_id,membership_id,id DESC);
CREATE INDEX finalgrade_appeal_page ON zhiban_finalgrade.appeals(tenant_id,offering_id,membership_id,id DESC);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['configs','rules','publications','appeals','responses'] LOOP
  EXECUTE format('ALTER TABLE zhiban_finalgrade.%I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE zhiban_finalgrade.%I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY tenant_scope ON zhiban_finalgrade.%I TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',n);
  EXECUTE format('REVOKE ALL ON zhiban_finalgrade.%I FROM PUBLIC',n);
  EXECUTE format('GRANT SELECT,INSERT ON zhiban_finalgrade.%I TO zhiban_academic_runtime',n);
 END LOOP;
END $$;
GRANT UPDATE(draft,revision,published_version) ON zhiban_finalgrade.configs TO zhiban_academic_runtime;
GRANT UPDATE(state,revision) ON zhiban_finalgrade.appeals TO zhiban_academic_runtime;
-- No UPDATE/DELETE/TRUNCATE on rule versions, total publications or appeal responses.
