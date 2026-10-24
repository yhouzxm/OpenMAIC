-- Additive Assessment context; never edit applied Learning/Academic/Identity migrations.
CREATE SCHEMA zhiban_assessment AUTHORIZATION zhiban_identity_owner;
REVOKE ALL ON SCHEMA zhiban_assessment FROM PUBLIC;
GRANT USAGE ON SCHEMA zhiban_assessment TO zhiban_academic_runtime;
CREATE TABLE zhiban_assessment.schema_migrations(version text PRIMARY KEY,checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'));
GRANT SELECT ON zhiban_assessment.schema_migrations TO zhiban_academic_runtime;
CREATE TABLE zhiban_assessment.grades(
 tenant_id uuid NOT NULL,id uuid NOT NULL,submission_id uuid NOT NULL,
 score_points integer NOT NULL CHECK(score_points>=0),max_points integer NOT NULL CHECK(max_points BETWEEN 1 AND 100000 AND score_points<=max_points),feedback text NOT NULL CHECK(length(feedback)<=2000),
 published_version integer NOT NULL DEFAULT 0 CHECK(published_version>=0),revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),updated_by uuid NOT NULL,created_at bigint NOT NULL,updated_at bigint NOT NULL CHECK(updated_at>=created_at),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,submission_id),UNIQUE(tenant_id,id,submission_id),
 FOREIGN KEY(tenant_id,submission_id) REFERENCES zhiban_learning.submissions(tenant_id,id),FOREIGN KEY(tenant_id,updated_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
CREATE TABLE zhiban_assessment.publications(
 tenant_id uuid NOT NULL,id uuid NOT NULL,grade_id uuid NOT NULL,submission_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),
 score_points integer NOT NULL CHECK(score_points>=0),max_points integer NOT NULL CHECK(max_points BETWEEN 1 AND 100000 AND score_points<=max_points),feedback text NOT NULL CHECK(length(feedback)<=2000),
 reason text CHECK(length(reason) BETWEEN 1 AND 1000),published_by uuid NOT NULL,published_at bigint NOT NULL,
 CHECK((version=1 AND reason IS NULL) OR(version>1 AND reason IS NOT NULL)),
 PRIMARY KEY(tenant_id,id),UNIQUE(tenant_id,grade_id,version),FOREIGN KEY(tenant_id,grade_id,submission_id) REFERENCES zhiban_assessment.grades(tenant_id,id,submission_id),FOREIGN KEY(tenant_id,published_by) REFERENCES zhiban_identity.memberships(tenant_id,membership_id)
);
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['grades','publications'] LOOP
  EXECUTE format('ALTER TABLE zhiban_assessment.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('ALTER TABLE zhiban_assessment.%I FORCE ROW LEVEL SECURITY',table_name);
  EXECUTE format('CREATE POLICY tenant_scope ON zhiban_assessment.%I FOR ALL TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',table_name);
  EXECUTE format('GRANT SELECT,INSERT ON zhiban_assessment.%I TO zhiban_academic_runtime',table_name);
 END LOOP;
END $$;
GRANT UPDATE(score_points,max_points,feedback,published_version,revision,updated_by,updated_at) ON zhiban_assessment.grades TO zhiban_academic_runtime;
-- Published snapshots are immutable; no UPDATE/DELETE, no new Identity privileges.
