import type { ZhibanMigration } from './001-initial-identity';

export const administrativeClassImportMigration: ZhibanMigration = {
  version: '031',
  description: 'Administrative class source fields and reversible Excel import support',
  checksum: 'zhiban-031-administrative-class-import-v1',
  up: [
    `ALTER TABLE zhiban.academic_import_batches DROP CONSTRAINT academic_import_batches_import_type_check`,
    `ALTER TABLE zhiban.academic_import_batches ADD CONSTRAINT academic_import_batches_import_type_check CHECK(import_type IN ('course_registration','administrative_class'))`,
    `ALTER TABLE zhiban.classes
      ADD COLUMN class_kind VARCHAR(32) NOT NULL DEFAULT 'administrative',
      ADD COLUMN expected_size INTEGER CHECK(expected_size IS NULL OR expected_size>=0),
      ADD COLUMN student_category_code VARCHAR(32),
      ADD COLUMN student_category_name VARCHAR(100),
      ADD COLUMN program_level_code VARCHAR(32),
      ADD COLUMN program_level_name VARCHAR(100),
      ADD COLUMN branch_code VARCHAR(32),
      ADD COLUMN branch_name VARCHAR(160),
      ADD COLUMN study_center_code VARCHAR(32),
      ADD COLUMN study_center_name VARCHAR(160),
      ADD COLUMN major_code VARCHAR(64),
      ADD COLUMN major_name VARCHAR(240),
      ADD COLUMN training_plan_no VARCHAR(64),
      ADD COLUMN head_teacher_source_name VARCHAR(120)`,
    `CREATE INDEX classes_admin_lookup_idx ON zhiban.classes(tenant_id,admission_term_code,study_center_code,major_code) WHERE class_kind='administrative'`,
  ],
  down: [
    `DROP INDEX IF EXISTS zhiban.classes_admin_lookup_idx`,
    `ALTER TABLE zhiban.classes DROP COLUMN head_teacher_source_name,DROP COLUMN training_plan_no,DROP COLUMN major_name,DROP COLUMN major_code,DROP COLUMN study_center_name,DROP COLUMN study_center_code,DROP COLUMN branch_name,DROP COLUMN branch_code,DROP COLUMN program_level_name,DROP COLUMN program_level_code,DROP COLUMN student_category_name,DROP COLUMN student_category_code,DROP COLUMN expected_size,DROP COLUMN class_kind`,
    `ALTER TABLE zhiban.academic_import_batches DROP CONSTRAINT academic_import_batches_import_type_check`,
    `ALTER TABLE zhiban.academic_import_batches ADD CONSTRAINT academic_import_batches_import_type_check CHECK(import_type IN ('course_registration'))`,
  ],
};
