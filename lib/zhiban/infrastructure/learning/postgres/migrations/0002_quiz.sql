-- LOCAL candidate: application is restricted to owned disposable fixtures.
ALTER TABLE zhiban_learning.activities DROP CONSTRAINT activities_activity_type_check;
ALTER TABLE zhiban_learning.activities ADD CONSTRAINT activities_activity_type_check CHECK(activity_type IN('TEXT_RESPONSE','QUIZ'));
CREATE TABLE zhiban_learning.quiz_definitions(
 tenant_id uuid NOT NULL,activity_id uuid NOT NULL,mode text NOT NULL CHECK(mode IN('PRACTICE','ASSESSED')),
 draft jsonb NOT NULL,draft_hash text NOT NULL CHECK(draft_hash~'^[a-f0-9]{64}$'),review_closed_at bigint,review_closed_by uuid,
 PRIMARY KEY(tenant_id,activity_id),FOREIGN KEY(tenant_id,activity_id) REFERENCES zhiban_learning.activities(tenant_id,id),
 CHECK((review_closed_at IS NULL)=(review_closed_by IS NULL))
);
CREATE TABLE zhiban_learning.quiz_versions(
 tenant_id uuid NOT NULL,activity_id uuid NOT NULL,version integer NOT NULL,content jsonb NOT NULL,public_questions jsonb NOT NULL,
 content_hash text NOT NULL CHECK(content_hash~'^[a-f0-9]{64}$'),public_hash text NOT NULL CHECK(public_hash~'^[a-f0-9]{64}$'),
 max_points integer NOT NULL CHECK(max_points>0 AND max_points<=100000),algorithm text NOT NULL CHECK(algorithm='zhiban-quiz-1'),source_pin text NOT NULL CHECK(source_pin='a9da60b3b4adb429369c0da13d5637a904ead2b0'),
 PRIMARY KEY(tenant_id,activity_id,version),FOREIGN KEY(tenant_id,activity_id,version) REFERENCES zhiban_learning.activity_versions(tenant_id,activity_id,version),FOREIGN KEY(tenant_id,activity_id) REFERENCES zhiban_learning.quiz_definitions(tenant_id,activity_id)
);
CREATE TABLE zhiban_learning.quiz_attempt_answers(
 tenant_id uuid NOT NULL,attempt_id uuid NOT NULL,answers jsonb NOT NULL,answers_hash text NOT NULL CHECK(answers_hash~'^[a-f0-9]{64}$'),
 PRIMARY KEY(tenant_id,attempt_id),FOREIGN KEY(tenant_id,attempt_id) REFERENCES zhiban_learning.attempts(tenant_id,id)
);
CREATE TABLE zhiban_learning.quiz_submission_answers(
 tenant_id uuid NOT NULL,submission_id uuid NOT NULL,attempt_id uuid NOT NULL,answers jsonb NOT NULL,answers_hash text NOT NULL CHECK(answers_hash~'^[a-f0-9]{64}$'),
 activity_id uuid NOT NULL,activity_version integer NOT NULL,quiz_hash text NOT NULL CHECK(quiz_hash~'^[a-f0-9]{64}$'),
 PRIMARY KEY(tenant_id,submission_id),FOREIGN KEY(tenant_id,submission_id,attempt_id) REFERENCES zhiban_learning.submissions(tenant_id,id,attempt_id),
 FOREIGN KEY(tenant_id,activity_id,activity_version) REFERENCES zhiban_learning.quiz_versions(tenant_id,activity_id,version)
);
CREATE TABLE zhiban_learning.quiz_evaluations(
 tenant_id uuid NOT NULL,submission_id uuid NOT NULL,results jsonb NOT NULL,objective_points integer NOT NULL CHECK(objective_points>=0),manual_pending boolean NOT NULL,
 algorithm text NOT NULL CHECK(algorithm='zhiban-quiz-1'),answers_hash text NOT NULL,quiz_hash text NOT NULL,
 PRIMARY KEY(tenant_id,submission_id),FOREIGN KEY(tenant_id,submission_id) REFERENCES zhiban_learning.quiz_submission_answers(tenant_id,submission_id)
);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['quiz_definitions','quiz_versions','quiz_attempt_answers','quiz_submission_answers','quiz_evaluations'] LOOP
 EXECUTE format('ALTER TABLE zhiban_learning.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE zhiban_learning.%I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY tenant_scope ON zhiban_learning.%I FOR ALL TO zhiban_academic_runtime USING(tenant_id=zhiban_identity.current_tenant_id()) WITH CHECK(tenant_id=zhiban_identity.current_tenant_id())',t);
 EXECUTE format('GRANT SELECT,INSERT ON zhiban_learning.%I TO zhiban_academic_runtime',t);
 END LOOP;
END $$;
GRANT UPDATE(draft,draft_hash,review_closed_at,review_closed_by) ON zhiban_learning.quiz_definitions TO zhiban_academic_runtime;
GRANT UPDATE(answers,answers_hash) ON zhiban_learning.quiz_attempt_answers TO zhiban_academic_runtime;

CREATE UNIQUE INDEX quiz_attempt_version_anchor ON zhiban_learning.attempts(tenant_id,id,activity_id,activity_version);
ALTER TABLE zhiban_learning.quiz_submission_answers ADD CONSTRAINT quiz_submission_attempt_version_fkey FOREIGN KEY(tenant_id,attempt_id,activity_id,activity_version) REFERENCES zhiban_learning.attempts(tenant_id,id,activity_id,activity_version);
CREATE FUNCTION zhiban_learning.quiz_definition_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
 IF NEW.mode<>OLD.mode OR (OLD.review_closed_at IS NOT NULL AND (NEW.review_closed_at IS DISTINCT FROM OLD.review_closed_at OR NEW.review_closed_by IS DISTINCT FROM OLD.review_closed_by OR NEW.draft IS DISTINCT FROM OLD.draft)) THEN RAISE EXCEPTION 'quiz definition immutable'; END IF; RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION zhiban_learning.quiz_definition_guard() FROM PUBLIC;
CREATE TRIGGER quiz_definition_guard BEFORE UPDATE ON zhiban_learning.quiz_definitions FOR EACH ROW EXECUTE FUNCTION zhiban_learning.quiz_definition_guard();

CREATE UNIQUE INDEX quiz_submission_hash_anchor ON zhiban_learning.quiz_submission_answers(tenant_id,submission_id,answers_hash,quiz_hash);
ALTER TABLE zhiban_learning.quiz_evaluations ADD CONSTRAINT quiz_evaluation_hash_fkey FOREIGN KEY(tenant_id,submission_id,answers_hash,quiz_hash) REFERENCES zhiban_learning.quiz_submission_answers(tenant_id,submission_id,answers_hash,quiz_hash);
