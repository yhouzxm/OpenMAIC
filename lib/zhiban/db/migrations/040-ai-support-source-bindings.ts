import type { ZhibanMigration } from './001-initial-identity';

export const aiSupportSourceBindingsMigration: ZhibanMigration = {
  version: '040',
  description: 'AI support activity multi-source knowledge bindings',
  checksum: 'zhiban-040-ai-support-source-bindings-v1',
  up: [
    `ALTER TABLE zhiban.course_tutor_documents DROP CONSTRAINT course_tutor_documents_source_type_check`,
    `ALTER TABLE zhiban.course_tutor_documents ADD CONSTRAINT course_tutor_documents_source_type_check
      CHECK(source_type IN('activity_content','course_resource','assignment','manual','pbl','classroom','discussion'))`,
  ],
  down: [
    `UPDATE zhiban.course_tutor_documents SET status='archived' WHERE source_type IN('pbl','classroom','discussion')`,
    `DELETE FROM zhiban.course_tutor_documents WHERE source_type IN('pbl','classroom','discussion')`,
    `ALTER TABLE zhiban.course_tutor_documents DROP CONSTRAINT course_tutor_documents_source_type_check`,
    `ALTER TABLE zhiban.course_tutor_documents ADD CONSTRAINT course_tutor_documents_source_type_check
      CHECK(source_type IN('activity_content','course_resource','assignment','manual'))`,
  ],
};
