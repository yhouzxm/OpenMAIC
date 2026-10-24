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
import { assessmentMigration, loadAssessmentReceipt } from './assessment';
import { loadLearningReceipt } from './learning';
import { assessmentPolicy } from '@/lib/zhiban/domain/assessment/model';
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
    throw new Error('Fixed local Assessment endpoint required.');
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
    if (!(await loadLearningReceipt(runtime))) throw new Error('Verified M3 required.');
    if (await loadAssessmentReceipt(runtime)) {
      console.log('LOCAL M4 already prepared; immutable ledger and ACL verified.');
      return;
    }
    const migration = await readFile(resolve(assessmentMigration), 'utf8');
    const successor = await readFile(
      resolve('lib/zhiban/infrastructure/assessment/postgres/migrations/0002_quiz_details.sql'),
      'utf8',
    );
    await pool.query('BEGIN');
    await pool.query("SELECT pg_advisory_xact_lock(hashtextextended('LOCAL_M4_SCHEMA',0))");
    if (
      (await pool.query("SELECT to_regnamespace('zhiban_assessment') AS schema")).rows[0].schema
    ) {
      const ledger = (
        await pool.query(
          'SELECT version,checksum FROM zhiban_assessment.schema_migrations ORDER BY version',
        )
      ).rows;
      if (
        ledger.length !== 2 ||
        !ledger.some((r) => r.version === '0002' && r.checksum === digest(successor)) ||
        ledger[0].version !== '0001' ||
        ledger[0].checksum !== digest(migration)
      )
        throw new Error('Unknown assessment schema; no reset.');
    } else {
      await pool.query('SET LOCAL ROLE zhiban_identity_owner');
      await pool.query(migration);
      await pool.query(
        'INSERT INTO zhiban_assessment.schema_migrations(version,checksum) VALUES($1,$2)',
        ['0001', digest(migration)],
      );
    }
    if (
      !(await pool.query("SELECT 1 FROM zhiban_assessment.schema_migrations WHERE version='0002'"))
        .rowCount
    ) {
      await pool.query(successor);
      await pool.query('INSERT INTO zhiban_assessment.schema_migrations VALUES($1,$2)', [
        '0002',
        digest(successor),
      ]);
    }
    await pool.query('COMMIT');
    const raw =
      JSON.stringify(
        {
          mode: 'LOCAL_SYNTHETIC_M4',
          migrationHash: digest(migration),
          quizMigrationHash: digest(successor),
          policyHash: digest(JSON.stringify(assessmentPolicy)),
        },
        null,
        2,
      ) + '\n';
    await writeFile(join(directory, 'assessment.json'), raw, { mode: 0o600, flag: 'wx' });
    await writeFile(
      join(directory, 'assessment-receipt.json'),
      JSON.stringify(
        {
          mode: 'LOCAL_SYNTHETIC_M4',
          createdAt: new Date().toISOString(),
          configHash: digest(raw),
          migrationHash: digest(migration),
          quizMigrationHash: digest(successor),
          policyHash: digest(JSON.stringify(assessmentPolicy)),
          scope:
            'LOCAL synthetic Assessment schema only; no production, V1 migration or CI signoff',
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    await loadAssessmentReceipt(runtime);
    console.log('LOCAL M4 prepared. No courses, activities or learner work fabricated.');
  } finally {
    await pool.query('ROLLBACK').catch(() => {});
    await Promise.all([pool.end(), runtime.end()]);
  }
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'M4 setup rejected');
  process.exitCode = 1;
});
