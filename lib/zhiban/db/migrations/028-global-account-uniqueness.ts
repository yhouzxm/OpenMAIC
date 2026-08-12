import type { ZhibanMigration } from './001-initial-identity';

export const globalAccountUniquenessMigration: ZhibanMigration = {
  version: '028',
  description: 'Enforce globally unique login accounts without organization-based login routing',
  checksum: 'zhiban-028-global-account-uniqueness-v1',
  up: [
    `DO $$
     DECLARE duplicates text;
     BEGIN
       SELECT string_agg(login_name, ', ' ORDER BY login_name) INTO duplicates
         FROM (
           SELECT lower(login_name) AS login_name
             FROM zhiban.accounts
            WHERE deleted_at IS NULL
            GROUP BY lower(login_name)
           HAVING count(*) > 1
         ) duplicate_accounts;
       IF duplicates IS NOT NULL THEN
         RAISE EXCEPTION 'Global account uniqueness migration blocked by duplicate login names: %', duplicates;
       END IF;
     END $$`,
    `CREATE UNIQUE INDEX accounts_global_login_name_uq
       ON zhiban.accounts(lower(login_name)) WHERE deleted_at IS NULL`,
  ],
  down: [`DROP INDEX IF EXISTS zhiban.accounts_global_login_name_uq`],
};
