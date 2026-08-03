import { Pool } from 'pg';

import {
  getZhibanMigrationStatus,
  migrateZhibanDatabase,
  rollbackLatestZhibanMigration,
} from '../lib/zhiban/db/index';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

const command = process.argv[2] ?? 'status';
const pool = new Pool({ connectionString, max: 2 });

try {
  if (command === 'migrate') {
    const versions = await migrateZhibanDatabase(pool);
    console.log(
      versions.length ? `Applied Zhiban migrations: ${versions.join(', ')}` : 'Up to date',
    );
  } else if (command === 'rollback') {
    if (process.env.ZHIBAN_ALLOW_ROLLBACK !== 'true') {
      throw new Error('Set ZHIBAN_ALLOW_ROLLBACK=true to confirm destructive rollback');
    }
    const version = await rollbackLatestZhibanMigration(pool);
    console.log(version ? `Rolled back Zhiban migration ${version}` : 'Nothing to roll back');
  } else if (command === 'status') {
    console.table(await getZhibanMigrationStatus(pool));
  } else {
    throw new Error(`Unknown command: ${command}. Use migrate, rollback, or status.`);
  }
} finally {
  await pool.end();
}
