import { createRequire } from 'node:module';
import { Pool } from 'pg';

import {
  getZhibanMigrationStatus,
  migrateZhibanDatabase,
  rollbackLatestZhibanMigration,
} from '../lib/zhiban/db/index';

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('@next/env') as typeof import('@next/env');
loadEnvConfig(process.cwd());

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
  } else if (command === 'partitions') {
    const result = await pool.query<{ partition_name: string; bound: string }>(
      `SELECT child.relname partition_name,pg_get_expr(child.relpartbound,child.oid) bound
       FROM pg_inherits JOIN pg_class parent ON parent.oid=inhparent JOIN pg_class child ON child.oid=inhrelid
       JOIN pg_namespace n ON n.oid=parent.relnamespace WHERE n.nspname='zhiban' AND parent.relname='learning_events' ORDER BY child.relname`,
    );
    console.table(result.rows);
  } else {
    throw new Error(`Unknown command: ${command}. Use migrate, rollback, status, or partitions.`);
  }
} finally {
  await pool.end();
}
