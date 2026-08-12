import type { ZhibanMigration } from './001-initial-identity';

export const separateIdentityImportsMigration: ZhibanMigration = {
  version: '029',
  description: 'Support separately uploaded user and student identity datasets',
  checksum: 'zhiban-029-separate-identity-imports-v1',
  up: [
    `ALTER TABLE zhiban.identity_import_batches DROP CONSTRAINT identity_import_batches_unmatched_account_policy_check`,
    `ALTER TABLE zhiban.identity_import_batches ADD CONSTRAINT identity_import_batches_unmatched_account_policy_check
       CHECK (unmatched_account_policy IN ('reject','student','teacher','administrator'))`,
  ],
  down: [
    `UPDATE zhiban.identity_import_batches SET unmatched_account_policy='reject' WHERE unmatched_account_policy='student'`,
    `ALTER TABLE zhiban.identity_import_batches DROP CONSTRAINT identity_import_batches_unmatched_account_policy_check`,
    `ALTER TABLE zhiban.identity_import_batches ADD CONSTRAINT identity_import_batches_unmatched_account_policy_check
       CHECK (unmatched_account_policy IN ('reject','teacher','administrator'))`,
  ],
};
