import { jointSources, jointClassroomProfile, checkJointLedger } from './joint-classroom-receipt';
/** Read-only readiness: web startup never installs the additive classroom migration. */
import type { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export async function loadClassroom(pool: Pool, jointEnabled = false): Promise<boolean> {
  if (
    !(await pool.query("SELECT to_regclass('zhiban_classroom.schema_migrations') AS name")).rows[0]
      .name
  )
    return false;
  const ledger = (
    await pool.query('SELECT * FROM zhiban_classroom.schema_migrations ORDER BY version')
  ).rows;
  if (ledger.length !== 3) throw Error('LOCAL classroom ledger/source mismatch');
  for (const [i, name] of [
    '0001_classroom.sql',
    '0002_classroom_edit.sql',
    '0003_classroom_presentation.sql',
  ].entries()) {
    const sql = await readFile('lib/zhiban/infrastructure/classroom/postgres/migrations/' + name);
    if (
      ledger[i].version !== name.slice(0, 4) ||
      ledger[i].checksum !== createHash('sha256').update(sql).digest('hex')
    )
      throw Error('LOCAL classroom ledger/source mismatch');
  }
  if (jointEnabled) {
    const source = await jointSources();
    await checkJointLedger(pool, source.hash);
    if ((await jointClassroomProfile(pool)) !== source.reference.jointClassroomFingerprint)
      throw Error('Joint classroom ACL/RLS mismatch');
    return true;
  }
  const mutable: Record<string, string[]> = {
    sessions: ['state', 'revision', 'title', 'description', 'opens_at', 'closes_at'],
    dispatches: ['state', 'current_page', 'presentation_revision', 'presentation_updated_at'],
    entries: [],
  };
  const rows = (
    await pool.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,r.rolname AS owner,
 has_table_privilege(c.oid,'SELECT') AS read,has_table_privilege(c.oid,'INSERT') AS insert,
 has_table_privilege(c.oid,'UPDATE') OR has_table_privilege(c.oid,'DELETE') OR has_table_privilege(c.oid,'TRUNCATE') OR has_table_privilege(c.oid,'REFERENCES') OR has_table_privilege(c.oid,'TRIGGER') AS extra,
 (SELECT count(*) FROM pg_policy p WHERE p.polrelid=c.oid) AS policies,
 (SELECT pg_get_expr(p.polqual,p.polrelid) FROM pg_policy p WHERE p.polrelid=c.oid) AS using,
 (SELECT pg_get_expr(p.polwithcheck,p.polrelid) FROM pg_policy p WHERE p.polrelid=c.oid) AS check,
 (SELECT bool_and(p.polcmd='*' AND p.polpermissive AND p.polroles=ARRAY[(SELECT oid FROM pg_roles WHERE rolname='zhiban_academic_runtime')]) FROM pg_policy p WHERE p.polrelid=c.oid) AS roles
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner WHERE n.nspname='zhiban_classroom' AND c.relkind='r' AND c.relname<>'schema_migrations'`)
  ).rows;
  if (
    rows.length !== 3 ||
    rows.some(
      (r) =>
        !mutable[r.relname] ||
        !r.relrowsecurity ||
        !r.relforcerowsecurity ||
        r.owner !== 'zhiban_identity_owner' ||
        !r.read ||
        !r.insert ||
        r.extra ||
        Number(r.policies) !== 1 ||
        !r.roles ||
        r.using !== '(tenant_id = zhiban_identity.current_tenant_id())' ||
        r.check !== r.using,
    )
  )
    throw Error('LOCAL classroom ACL/RLS mismatch');
  const cols = (
    await pool.query(
      "SELECT c.relname,a.attname,has_column_privilege(c.oid,a.attname,'UPDATE') AS update FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname='zhiban_classroom' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped",
    )
  ).rows;
  if (
    cols.some((c) => c.update !== (mutable[c.relname]?.includes(c.attname) ?? false)) ||
    (await pool.query("SELECT has_schema_privilege('zhiban_classroom','CREATE') AS extra")).rows[0]
      .extra
  )
    throw Error('LOCAL classroom column ACL mismatch');
  return true;
}
