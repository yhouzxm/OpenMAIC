import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
export const submissionFilesMigration =
  'lib/zhiban/infrastructure/learning-files/postgres/migrations/0001_submission_files.sql';
export async function loadSubmissionFiles(pool: Pick<Pool, 'query'>): Promise<boolean> {
  if (
    !(await pool.query("SELECT to_regclass('zhiban_learning_files.schema_migrations') AS name"))
      .rows[0].name
  )
    return false;
  const files = [
    submissionFilesMigration,
    submissionFilesMigration.replace('0001_submission_files.sql', '0002_file_clearance.sql'),
    submissionFilesMigration.replace('0001_submission_files.sql', '0003_trusted_scanner.sql'),
    submissionFilesMigration.replace('0001_submission_files.sql', '0004_attachment_formats.sql'),
  ];
  const ledger = (
    await pool.query(
      'SELECT version,checksum FROM zhiban_learning_files.schema_migrations ORDER BY version',
    )
  ).rows;
  if (ledger.length !== files.length) throw Error('Submission files ledger mismatch');
  for (const [i, file] of files.entries()) {
    const hash = createHash('sha256')
      .update(await readFile(file))
      .digest('hex');
    if (ledger[i].version !== String(i + 1).padStart(4, '0') || ledger[i].checksum !== hash)
      throw Error('Submission files ledger mismatch');
  }
  const schemaTables = (
    await pool.query(
      "SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='zhiban_learning_files' AND c.relkind='r' ORDER BY relname",
    )
  ).rows;
  if (
    schemaTables.map((t) => t.relname).join(',') !== 'files,schema_migrations' ||
    (
      await pool.query(
        "SELECT has_table_privilege('zhiban_learning_files.schema_migrations','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS extra",
      )
    ).rows[0].extra
  )
    throw Error('Submission files schema ACL rejected');
  const rows = (
    await pool.query(`SELECT c.relrowsecurity,c.relforcerowsecurity,r.rolname,
 has_table_privilege(c.oid,'SELECT') AS read,has_table_privilege(c.oid,'INSERT') AS insert,
 has_table_privilege(c.oid,'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS extra,
 (SELECT count(*) FROM pg_policy WHERE polrelid=c.oid) AS policies,
 (SELECT pg_get_expr(polqual,polrelid) FROM pg_policy WHERE polrelid=c.oid) AS using,
 (SELECT pg_get_expr(polwithcheck,polrelid) FROM pg_policy WHERE polrelid=c.oid) AS check,
 (SELECT bool_and(polcmd='*' AND polpermissive AND polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='zhiban_academic_runtime')]) FROM pg_policy WHERE polrelid=c.oid) AS roles
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='zhiban_learning_files' AND c.relname='files' AND c.relkind='r'`)
  ).rows;
  const row = rows[0];
  const columns = (
    await pool.query(
      `SELECT has_column_privilege(c.oid,a.attname,'UPDATE,REFERENCES') AS extra FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='zhiban_learning_files' AND c.relname='files' AND a.attnum>0 AND NOT a.attisdropped`,
    )
  ).rows;
  if (
    rows.length !== 1 ||
    !row.relrowsecurity ||
    !row.relforcerowsecurity ||
    row.rolname !== 'zhiban_identity_owner' ||
    !row.read ||
    !row.insert ||
    row.extra ||
    Number(row.policies) !== 1 ||
    !row.roles ||
    row.using !== '(tenant_id = zhiban_identity.current_tenant_id())' ||
    row.check !== row.using ||
    columns.some((c) => c.extra) ||
    (await pool.query("SELECT has_schema_privilege('zhiban_learning_files','CREATE') AS extra"))
      .rows[0].extra
  )
    throw Error('Submission files ACL/RLS rejected');
  return true;
}
