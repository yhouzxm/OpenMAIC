import type { ZhibanMigration } from './001-initial-identity';

const tenantSetting = `NULLIF(current_setting('zhiban.tenant_id',true),'')::uuid`;
export const courseClassGroupingMigration: ZhibanMigration = {
  version: '032',
  description: 'Named course classes grouping multiple administrative classes',
  checksum: 'zhiban-032-course-class-grouping-v1',
  up: [
    `ALTER TABLE zhiban.course_offerings ADD COLUMN name VARCHAR(200)`,
    `CREATE TABLE zhiban.course_offering_classes (
      tenant_id UUID NOT NULL REFERENCES zhiban.tenants(id) ON DELETE CASCADE,
      offering_id UUID NOT NULL,class_id UUID NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY(offering_id,class_id),
      FOREIGN KEY(offering_id,tenant_id) REFERENCES zhiban.course_offerings(id,tenant_id) ON DELETE CASCADE,
      FOREIGN KEY(class_id,tenant_id) REFERENCES zhiban.classes(id,tenant_id) ON DELETE RESTRICT
    )`,
    `ALTER TABLE zhiban.course_offering_classes ENABLE ROW LEVEL SECURITY`,
    `ALTER TABLE zhiban.course_offering_classes FORCE ROW LEVEL SECURITY`,
    `CREATE POLICY tenant_isolation ON zhiban.course_offering_classes USING(tenant_id=${tenantSetting}) WITH CHECK(tenant_id=${tenantSetting})`,
    `CREATE INDEX course_offering_classes_class_idx ON zhiban.course_offering_classes(tenant_id,class_id)`,
  ],
  down: [
    `DROP TABLE IF EXISTS zhiban.course_offering_classes`,
    `ALTER TABLE zhiban.course_offerings DROP COLUMN name`,
  ],
};
