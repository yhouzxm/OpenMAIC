import type { ZhibanMigration } from './001-initial-identity';

export const importOrganizationFromSourceMigration: ZhibanMigration = {
  version: '030',
  description: 'Resolve imported account organization and identity directly from spreadsheet data',
  checksum: 'zhiban-030-import-organization-from-source-v1',
  up: [
    `ALTER TABLE zhiban.identity_import_batches ALTER COLUMN default_organization_id DROP NOT NULL`,
  ],
  down: [
    `DELETE FROM zhiban.identity_import_batches WHERE default_organization_id IS NULL`,
    `ALTER TABLE zhiban.identity_import_batches ALTER COLUMN default_organization_id SET NOT NULL`,
  ],
};
