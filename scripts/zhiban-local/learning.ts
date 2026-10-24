import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { privateFile, digest } from './config';
import { learningPolicy } from '@/lib/zhiban/domain/learning/model';
export const learningMigration =
  'lib/zhiban/infrastructure/learning/postgres/migrations/0001_learning.sql';
export async function loadLearningReceipt(pool: Pool): Promise<boolean> {
  let raw: Buffer;
  try {
    raw = await privateFile('learning.json');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return false;
    throw error;
  }
  const config = JSON.parse(raw.toString());
  const receipt = JSON.parse((await privateFile('learning-receipt.json')).toString());
  const migration = await readFile(resolve(learningMigration), 'utf8');
  if (
    config.mode !== 'LOCAL_SYNTHETIC_M3' ||
    receipt.mode !== config.mode ||
    receipt.configHash !== digest(raw.toString()) ||
    config.migrationHash !== digest(migration) ||
    receipt.migrationHash !== config.migrationHash ||
    config.policyHash !== digest(JSON.stringify(learningPolicy)) ||
    receipt.policyHash !== config.policyHash
  )
    throw new Error('LOCAL M3 receipt/source/policy mismatch.');
  const requireQuizMigration = await readFile(
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
  const ledger = (
    await pool.query(
      'SELECT version,checksum FROM zhiban_learning.schema_migrations ORDER BY version',
    )
  ).rows;
  if (
    config.quizMigrationHash !== digest(requireQuizMigration) ||
    receipt.quizMigrationHash !== config.quizMigrationHash ||
    config.fillMigrationHash !== digest(fillMigration) ||
    receipt.fillMigrationHash !== config.fillMigrationHash ||
    config.matchingMigrationHash !== digest(matchingMigration) ||
    receipt.matchingMigrationHash !== config.matchingMigrationHash ||
    config.orderingMigrationHash !== digest(orderingMigration) ||
    receipt.orderingMigrationHash !== config.orderingMigrationHash ||
    ledger.length !== 5 ||
    !ledger.some((r) => r.version === '0005' && r.checksum === digest(orderingMigration)) ||
    !ledger.some((r) => r.version === '0004' && r.checksum === digest(matchingMigration)) ||
    !ledger.some((r) => r.version === '0003' && r.checksum === digest(fillMigration)) ||
    !ledger.some((r) => r.version === '0002' && r.checksum === digest(requireQuizMigration)) ||
    ledger[0].version !== '0001' ||
    ledger[0].checksum !== config.migrationHash
  )
    throw new Error('Learning ledger mismatch.');
  const names = [
    'activities',
    'activity_versions',
    'attempts',
    'submissions',
    'events',
    'quiz_definitions',
    'quiz_versions',
    'quiz_attempt_answers',
    'quiz_submission_answers',
    'quiz_evaluations',
  ];
  const tables = (
    await pool.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,r.rolname AS owner,
    has_table_privilege(c.oid,'SELECT') AS read,has_table_privilege(c.oid,'INSERT') AS insert,
    has_table_privilege(c.oid,'DELETE') OR has_table_privilege(c.oid,'TRUNCATE') OR has_table_privilege(c.oid,'REFERENCES') OR has_table_privilege(c.oid,'TRIGGER') AS extra,
    (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
    (SELECT pg_get_expr(p.polqual,p.polrelid) FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='tenant_scope') AS using,
    (SELECT pg_get_expr(p.polwithcheck,p.polrelid) FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='tenant_scope') AS check,
    (SELECT bool_and(p.polcmd='*' AND p.polpermissive AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='zhiban_academic_runtime')]) FROM pg_policy p WHERE p.polrelid=c.oid) AS policy_roles
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='zhiban_learning' AND c.relkind='r' AND c.relname<>'schema_migrations'`)
  ).rows;
  if (
    tables.length !== names.length ||
    tables.some(
      (t) =>
        !names.includes(t.relname) ||
        !t.relrowsecurity ||
        !t.relforcerowsecurity ||
        t.owner !== 'zhiban_identity_owner' ||
        !t.read ||
        !t.insert ||
        t.extra ||
        Number(t.policies) !== 1 ||
        !t.policy_roles ||
        t.using !== '(tenant_id = zhiban_identity.current_tenant_id())' ||
        t.check !== t.using,
    )
  )
    throw new Error('Learning live RLS/table ACL rejected.');
  const mutable: Record<string, string[]> = {
    activities: [
      'title',
      'prompt',
      'deadline_at',
      'allow_resubmit',
      'max_attempts',
      'status',
      'published_version',
      'revision',
      'updated_at',
    ],
    attempts: ['status', 'draft', 'revision', 'updated_at'],
    quiz_definitions: ['draft', 'draft_hash', 'review_closed_at', 'review_closed_by'],
    quiz_attempt_answers: ['answers', 'answers_hash'],
  };
  const columns = (
    await pool.query(
      "SELECT c.relname,a.attname,has_column_privilege(c.oid,a.attname,'UPDATE') AS update,has_column_privilege(c.oid,a.attname,'REFERENCES') AS references FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='zhiban_learning' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped",
    )
  ).rows;
  if (
    columns.some(
      (c) => c.references || c.update !== (mutable[c.relname]?.includes(c.attname) ?? false),
    )
  )
    throw new Error('Learning column ACL rejected.');
  if (
    (await pool.query("SELECT has_schema_privilege('zhiban_learning','CREATE') AS extra")).rows[0]
      .extra
  )
    throw new Error('Learning runtime DDL rejected.');
  return true;
}
