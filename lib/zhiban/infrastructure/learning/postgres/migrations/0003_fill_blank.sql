-- New LOCAL candidate: preserve all existing snapshots and algorithm identities.
ALTER TABLE zhiban_learning.quiz_versions DROP CONSTRAINT quiz_versions_algorithm_check;
ALTER TABLE zhiban_learning.quiz_versions ADD CONSTRAINT quiz_versions_algorithm_check CHECK(algorithm IN('zhiban-quiz-1','zhiban-quiz-fill-1'));
ALTER TABLE zhiban_learning.quiz_evaluations DROP CONSTRAINT quiz_evaluations_algorithm_check;
ALTER TABLE zhiban_learning.quiz_evaluations ADD CONSTRAINT quiz_evaluations_algorithm_check CHECK(algorithm IN('zhiban-quiz-1','zhiban-quiz-fill-1'));
