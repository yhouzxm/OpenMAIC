import type { ZhibanMigration } from './001-initial-identity';

export const oucImportAccessFixesMigration: ZhibanMigration = {
  version: '027',
  description: 'Allow organization-scoped role assignments used by OUC identity imports',
  checksum: 'zhiban-027-ouc-import-access-fixes-v1',
  up: [
    `DO $$
     DECLARE constraint_name text;
     BEGIN
       SELECT conname INTO constraint_name
         FROM pg_constraint
        WHERE conrelid='zhiban.role_assignments'::regclass
          AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%scope_id%project_group%';
       IF constraint_name IS NOT NULL THEN
         EXECUTE format('ALTER TABLE zhiban.role_assignments DROP CONSTRAINT %I', constraint_name);
       END IF;
     END $$`,
    `ALTER TABLE zhiban.role_assignments ADD CONSTRAINT role_assignments_scope_id_check
       CHECK ((scope_type IN ('organization','project_group','class','course') AND scope_id IS NOT NULL)
         OR (scope_type IN ('self','tenant','system') AND scope_id IS NULL))`,
  ],
  down: [
    `ALTER TABLE zhiban.role_assignments DROP CONSTRAINT IF EXISTS role_assignments_scope_id_check`,
    `ALTER TABLE zhiban.role_assignments ADD CONSTRAINT role_assignments_scope_id_check
       CHECK ((scope_type IN ('project_group','class','course') AND scope_id IS NOT NULL)
         OR (scope_type IN ('self','tenant','system') AND scope_id IS NULL))`,
  ],
};
