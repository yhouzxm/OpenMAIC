import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Pool } from 'pg';
import { privateFile, digest } from './config';
import { assessmentPolicy } from '@/lib/zhiban/domain/assessment/model';
export const assessmentMigration =
  'lib/zhiban/infrastructure/assessment/postgres/migrations/0001_assessment.sql';
export async function loadAssessmentReceipt(pool: Pool): Promise<boolean> {
  let raw: Buffer;
  try {
    raw = await privateFile('assessment.json');
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') return false;
    throw error;
  }
  const config = JSON.parse(raw.toString());
  const receipt = JSON.parse((await privateFile('assessment-receipt.json')).toString());
  const migration = await readFile(resolve(assessmentMigration), 'utf8');
  if (
    config.mode !== 'LOCAL_SYNTHETIC_M4' ||
    receipt.mode !== config.mode ||
    receipt.configHash !== digest(raw.toString()) ||
    config.migrationHash !== digest(migration) ||
    receipt.migrationHash !== config.migrationHash ||
    config.policyHash !== digest(JSON.stringify(assessmentPolicy)) ||
    receipt.policyHash !== config.policyHash
  )
    throw new Error('LOCAL M4 receipt/source/policy mismatch.');
  const requireQuizMigration = await readFile(
    resolve('lib/zhiban/infrastructure/assessment/postgres/migrations/0002_quiz_details.sql'),
    'utf8',
  );
  const ledger = (
    await pool.query(
      'SELECT version,checksum FROM zhiban_assessment.schema_migrations ORDER BY version',
    )
  ).rows;
  if (
    config.quizMigrationHash !== digest(requireQuizMigration) ||
    receipt.quizMigrationHash !== config.quizMigrationHash ||
    ledger.length !== 2 ||
    !ledger.some((r) => r.version === '0002' && r.checksum === digest(requireQuizMigration)) ||
    ledger[0].version !== '0001' ||
    ledger[0].checksum !== config.migrationHash
  )
    throw new Error('Assessment ledger mismatch.');
  const names = ['grades', 'publications', 'quiz_grade_details', 'quiz_publication_details'];
  const tables = (
    await pool.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,r.rolname AS owner,
    has_table_privilege(c.oid,'SELECT') AS read,has_table_privilege(c.oid,'INSERT') AS insert,
    has_table_privilege(c.oid,'DELETE') OR has_table_privilege(c.oid,'TRUNCATE') OR has_table_privilege(c.oid,'REFERENCES') OR has_table_privilege(c.oid,'TRIGGER') AS extra,
    (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
    (SELECT pg_get_expr(p.polqual,p.polrelid) FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='tenant_scope') AS using,
    (SELECT pg_get_expr(p.polwithcheck,p.polrelid) FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='tenant_scope') AS check,
    (SELECT bool_and(p.polcmd='*' AND p.polpermissive AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='zhiban_academic_runtime')]) FROM pg_policy p WHERE p.polrelid=c.oid) AS policy_roles
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='zhiban_assessment' AND c.relkind='r' AND c.relname<>'schema_migrations'`)
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
    throw new Error('Assessment live RLS/table ACL rejected.');
  const mutable: Record<string, string[]> = {
    grades: [
      'score_points',
      'max_points',
      'feedback',
      'published_version',
      'revision',
      'updated_by',
      'updated_at',
    ],
  };
  const columns = (
    await pool.query(
      "SELECT c.relname,a.attname,has_column_privilege(c.oid,a.attname,'UPDATE') AS update,has_column_privilege(c.oid,a.attname,'REFERENCES') AS references FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='zhiban_assessment' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped",
    )
  ).rows;
  if (
    columns.some(
      (c) => c.references || c.update !== (mutable[c.relname]?.includes(c.attname) ?? false),
    )
  )
    throw new Error('Assessment column ACL rejected.');
  if (
    (await pool.query("SELECT has_schema_privilege('zhiban_assessment','CREATE') AS extra")).rows[0]
      .extra
  )
    throw new Error('Assessment runtime DDL rejected.');
  return true;
}
