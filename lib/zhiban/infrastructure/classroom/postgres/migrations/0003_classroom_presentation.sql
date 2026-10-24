-- Teacher-controlled presentation position only. No Runtime/completion/grade facts.
ALTER TABLE zhiban_classroom.dispatches
 ADD COLUMN current_page integer NOT NULL DEFAULT 1 CHECK(current_page BETWEEN 1 AND 32),
 ADD COLUMN presentation_revision bigint NOT NULL DEFAULT 1 CHECK(presentation_revision>0),
 ADD COLUMN presentation_updated_at bigint CHECK(presentation_updated_at BETWEEN 0 AND 8640000000000000),
 ADD CONSTRAINT activity_has_no_presentation CHECK(kind='LECTURE' OR (current_page=1 AND presentation_revision=1 AND presentation_updated_at IS NULL));
GRANT UPDATE(current_page,presentation_revision,presentation_updated_at) ON zhiban_classroom.dispatches TO zhiban_academic_runtime;
