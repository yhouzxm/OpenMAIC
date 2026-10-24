ALTER TABLE zhiban_assessment.publications ADD CONSTRAINT quiz_publication_submission_anchor UNIQUE(tenant_id,id,submission_id);
CREATE TABLE zhiban_assessment.quiz_grade_details(
 tenant_id uuid NOT NULL,grade_id uuid NOT NULL,revision bigint NOT NULL,submission_id uuid NOT NULL,marks jsonb NOT NULL,overrides jsonb NOT NULL,
 PRIMARY KEY(tenant_id,grade_id,revision),FOREIGN KEY(tenant_id,grade_id,submission_id) REFERENCES zhiban_assessment.grades(tenant_id,id,submission_id),FOREIGN KEY(tenant_id,submission_id) REFERENCES zhiban_learning.quiz_submission_answers(tenant_id,submission_id)
);
CREATE TABLE zhiban_assessment.quiz_publication_details(
 tenant_id uuid NOT NULL,publication_id uuid NOT NULL,submission_id uuid NOT NULL,marks jsonb NOT NULL,overrides jsonb NOT NULL,
 PRIMARY KEY(tenant_id,publication_id),FOREIGN KEY(tenant_id,publication_id,submission_id) REFERENCES zhiban_assessment.publications(tenant_id,id,submission_id),FOREIGN KEY(tenant_id,submission_id) REFERENCES zhiban_learning.quiz_submission_answers(tenant_id,submission_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['quiz_grade_details','quiz_publication_details'] LOOP
 EXECUTE format('ALTER TABLE zhiban_assessment.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE zhiban_assessment.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON zhiban_assessment.%I FOR ALL TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',t);
 EXECUTE format('GRANT SELECT,INSERT ON zhiban_assessment.%I TO zhiban_academic_runtime',t);
 END LOOP;
END $$;
