import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Pool } from 'pg';
import {
  directory,
  database,
  pgPort,
  digest,
  loadRuntime,
  privateFile,
  requirePrivateClusterDirectories,
} from './config';
import { learningMigration, loadLearningReceipt } from './learning';
import { learningPolicy } from '@/lib/zhiban/domain/learning/model';
async function main() {
  await loadRuntime();
  await requirePrivateClusterDirectories();
  const config = JSON.parse((await privateFile('academic.json')).toString());
  const academicReceipt = JSON.parse((await privateFile('academic-receipt.json')).toString());
  const original = await readFile(
    resolve('lib/zhiban/infrastructure/academic/postgres/migrations/0001_academic.sql'),
    'utf8',
  );
  if (
    config.mode !== 'LOCAL_SYNTHETIC_M2' ||
    config.migrationHash !== digest(original) ||
    academicReceipt.configHash !== digest((await privateFile('academic.json')).toString())
  )
    throw new Error('M2 receipt rejected.');
  const endpoint = new URL(config.academic);
  if (
    endpoint.protocol !== 'postgresql:' ||
    endpoint.hostname !== '127.0.0.1' ||
    Number(endpoint.port) !== pgPort ||
    endpoint.pathname !== `/${database}` ||
    endpoint.username !== 'zhiban_academic_runtime' ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error('Fixed local Learning endpoint required.');
  const pool = new Pool({
    host: join(directory, 'socket'),
    port: pgPort,
    database,
    user: 'postgres',
    max: 1,
  });
  const runtime = new Pool({ connectionString: config.academic, max: 1 });
  try {
    const row = (
      await pool.query(
        "SELECT current_database() AS database,current_setting('data_directory') AS directory,current_setting('server_version_num')::integer AS version",
      )
    ).rows[0];
    if (
      row.database !== database ||
      row.directory !== join(directory, 'pgdata') ||
      row.version < 160000 ||
      row.version > 169999
    )
      throw new Error('Owned local PG16 required.');
    const originalLedger = (
      await pool.query('SELECT version,checksum FROM zhiban_academic.schema_migrations')
    ).rows;
    if (
      originalLedger.length !== 1 ||
      originalLedger[0].version !== '0001' ||
      originalLedger[0].checksum !== config.migrationHash
    )
      throw new Error('Original ledger rejected.');
    if (await loadLearningReceipt(runtime)) {
      console.log('LOCAL M3 already prepared; immutable ledger and ACL verified.');
      return;
    }
    const migration = await readFile(resolve(learningMigration), 'utf8');
    const successor = await readFile(
      resolve('lib/zhiban/infrastructure/learning/postgres/migrations/0002_quiz.sql'),
      'utf8',
    );
    const fillMigration = await readFile(
      resolve('lib/zhiban/infrastructure/learning/postgres/migrations/0003_fill_blank.sql'),
      'utf8',
    );
    const matchingMigration = await readFile(
      resolve('lib/zhiban/infrastructure/learning/postgres/migrations/0004_matching.sql'),
      'utf8',
    );
    const orderingMigration = await readFile(
      resolve('lib/zhiban/infrastructure/learning/postgres/migrations/0005_ordering.sql'),
      'utf8',
    );
    await pool.query('BEGIN');
    await pool.query("SELECT pg_advisory_xact_lock(hashtextextended('LOCAL_M3_SCHEMA',0))");
    if ((await pool.query("SELECT to_regnamespace('zhiban_learning') AS schema")).rows[0].schema) {
      const ledger = (
        await pool.query(
          'SELECT version,checksum FROM zhiban_learning.schema_migrations ORDER BY version',
        )
      ).rows;
      if (
        ledger.length !== 5 ||
        !ledger.some((r) => r.version === '0005' && r.checksum === digest(orderingMigration)) ||
        !ledger.some((r) => r.version === '0004' && r.checksum === digest(matchingMigration)) ||
        !ledger.some((r) => r.version === '0003' && r.checksum === digest(fillMigration)) ||
        !ledger.some((r) => r.version === '0002' && r.checksum === digest(successor)) ||
        ledger[0].version !== '0001' ||
        ledger[0].checksum !== digest(migration)
      )
        throw new Error('Unknown learning schema; no reset.');
    } else {
      await pool.query('SET LOCAL ROLE zhiban_identity_owner');
      await pool.query(migration);
      await pool.query(
        'INSERT INTO zhiban_learning.schema_migrations(version,checksum) VALUES($1,$2)',
        ['0001', digest(migration)],
      );
    }
    if (
      !(await pool.query("SELECT 1 FROM zhiban_learning.schema_migrations WHERE version='0002'"))
        .rowCount
    ) {
      await pool.query(successor);
      await pool.query('INSERT INTO zhiban_learning.schema_migrations VALUES($1,$2)', [
        '0002',
        digest(successor),
      ]);
    }
    if (
      !(await pool.query("SELECT 1 FROM zhiban_learning.schema_migrations WHERE version='0003'"))
        .rowCount
    ) {
      await pool.query(fillMigration);
      await pool.query('INSERT INTO zhiban_learning.schema_migrations VALUES($1,$2)', [
        '0003',
        digest(fillMigration),
      ]);
    }
    if (
      !(await pool.query("SELECT 1 FROM zhiban_learning.schema_migrations WHERE version='0004'"))
        .rowCount
    ) {
      await pool.query(matchingMigration);
      await pool.query('INSERT INTO zhiban_learning.schema_migrations VALUES($1,$2)', [
        '0004',
        digest(matchingMigration),
      ]);
    }
    if (
      !(await pool.query("SELECT 1 FROM zhiban_learning.schema_migrations WHERE version='0005'"))
        .rowCount
    ) {
      await pool.query(orderingMigration);
      await pool.query('INSERT INTO zhiban_learning.schema_migrations VALUES($1,$2)', [
        '0005',
        digest(orderingMigration),
      ]);
    }
    await pool.query('COMMIT');
    const raw =
      JSON.stringify(
        {
          mode: 'LOCAL_SYNTHETIC_M3',
          migrationHash: digest(migration),
          quizMigrationHash: digest(successor),
          fillMigrationHash: digest(fillMigration),
          matchingMigrationHash: digest(matchingMigration),
          orderingMigrationHash: digest(orderingMigration),
          policyHash: digest(JSON.stringify(learningPolicy)),
        },
        null,
        2,
      ) + '\n';
    await writeFile(join(directory, 'learning.json'), raw, { mode: 0o600, flag: 'wx' });
    await writeFile(
      join(directory, 'learning-receipt.json'),
      JSON.stringify(
        {
          mode: 'LOCAL_SYNTHETIC_M3',
          createdAt: new Date().toISOString(),
          configHash: digest(raw),
          migrationHash: digest(migration),
          quizMigrationHash: digest(successor),
          fillMigrationHash: digest(fillMigration),
          matchingMigrationHash: digest(matchingMigration),
          orderingMigrationHash: digest(orderingMigration),
          policyHash: digest(JSON.stringify(learningPolicy)),
          scope: 'LOCAL synthetic Learning schema only; no production, V1 migration or CI signoff',
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    await loadLearningReceipt(runtime);
    console.log('LOCAL M3 prepared. No courses, activities or learner work fabricated.');
  } finally {
    await pool.query('ROLLBACK').catch(() => {});
    await Promise.all([pool.end(), runtime.end()]);
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'M3 setup rejected');
  process.exitCode = 1;
});
