import type { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export async function loadCurriculum(pool: Pool): Promise<boolean> {
  if (
    !(await pool.query("SELECT to_regclass('zhiban_curriculum.schema_migrations') AS name")).rows[0]
      .name
  )
    return false;
  const sql = await readFile(
    'lib/zhiban/infrastructure/curriculum/postgres/migrations/0001_curriculum.sql',
  );
  const rows = (
    await pool.query('SELECT version,checksum FROM zhiban_curriculum.schema_migrations')
  ).rows;
  if (
    rows.length !== 1 ||
    rows[0].version !== '0001' ||
    rows[0].checksum !== createHash('sha256').update(sql).digest('hex')
  )
    throw Error('LOCAL curriculum source/ledger mismatch');
  const facts = (
    await pool.query(`SELECT c.relrowsecurity,c.relforcerowsecurity,r.rolname,
    has_table_privilege(c.oid,'SELECT') AS read,has_table_privilege(c.oid,'INSERT') AS insert,
    has_table_privilege(c.oid,'DELETE') OR has_table_privilege(c.oid,'TRUNCATE') OR has_table_privilege(c.oid,'UPDATE') OR has_schema_privilege('zhiban_curriculum','CREATE') AS extra,
    (SELECT count(*) FROM pg_policy WHERE polrelid=c.oid) AS policies,
    (SELECT pg_get_expr(polqual,polrelid) FROM pg_policy WHERE polrelid=c.oid) AS using,
    (SELECT pg_get_expr(polwithcheck,polrelid) FROM pg_policy WHERE polrelid=c.oid) AS check
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='zhiban_curriculum' AND c.relname='outlines'`)
  ).rows[0];
  if (
    !facts ||
    !facts.relrowsecurity ||
    !facts.relforcerowsecurity ||
    facts.rolname !== 'zhiban_identity_owner' ||
    !facts.read ||
    !facts.insert ||
    facts.extra ||
    Number(facts.policies) !== 1 ||
    facts.using !== '(tenant_id = zhiban_identity.current_tenant_id())' ||
    facts.check !== facts.using
  )
    throw Error('LOCAL curriculum live ACL/RLS mismatch');
  const mutable = ['revision', 'draft', 'published', 'publication_no', 'updated_at'];
  const columns = (
    await pool.query(
      "SELECT a.attname,has_column_privilege(a.attrelid,a.attname,'UPDATE') AS update FROM pg_attribute a WHERE a.attrelid='zhiban_curriculum.outlines'::regclass AND a.attnum>0 AND NOT a.attisdropped",
    )
  ).rows;
  if (columns.some((c) => c.update !== mutable.includes(c.attname)))
    throw Error('LOCAL curriculum column ACL mismatch');
  return true;
}
