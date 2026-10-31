/** Installation-only SQL, source checksums preserved. Never invoked by application startup. */
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export const businessContexts = [
  'identity',
  'academic',
  'learning',
  'assessment',
  'curriculum',
  'classroom',
  'learning-files',
  'discussion',
  'profile',
  'material',
  'teaching',
  'followup',
  'reminder',
  'remediation',
  'risk',
  'concept',
  'learner',
  'tutor',
  'onboarding',
  'login-identifiers',
  'imports',
  'finalgrade',
  'flow',
  'pbl',
  'ema',
  'attainment',
  'autograde',
] as const;
export async function installFreshBusinessSchema(pool: Pool) {
  const c = await pool.connect();
  try {
    const found = await c.query("SELECT 1 FROM pg_namespace WHERE nspname LIKE 'zhiban_%' LIMIT 1");
    if (found.rowCount)
      throw Error('Fresh business installation requires empty schemas; partial target retained');
    for (const context of businessContexts) {
      const directory = `lib/zhiban/infrastructure/${context}/postgres/migrations`;
      for (const file of (await readdir(directory)).filter((n) => n.endsWith('.sql')).sort()) {
        const sql = await readFile(directory + '/' + file, 'utf8');
        await c.query('BEGIN');
        try {
          await c.query('SET LOCAL ROLE zhiban_identity_owner');
          await c.query(sql);
          await c.query(
            `INSERT INTO zhiban_${context.replaceAll('-', '_')}.schema_migrations(version,checksum) VALUES($1,$2)`,
            [file.slice(0, 4), digest(sql)],
          );
          await c.query('COMMIT');
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        }
      }
    }
    let content = '';
    for (const file of [
      'docs/v2/candidates/m5-content/01-schema.sql',
      'docs/v2/candidates/m5-content/02-helpers-and-guards.sql',
      'docs/v2/candidates/m5-content/03-acl.sql',
      'docs/v2/candidates/pg18-provider-v1/0002-png.pg18.sql',
      'docs/v2/candidates/pg18-provider-v1/0003-interactive.pg18.sql',
      'docs/v2/candidates/pg18-provider-v1/0004-attempt-runtime.pg18.sql',
      'docs/v2/candidates/pg18-provider-v1/0005-joint-classroom.pg18.sql',
    ]) {
      const sql = await readFile(file, 'utf8');
      await c.query('BEGIN');
      try {
        await c.query('SET LOCAL ROLE zhiban_identity_owner');
        await c.query(sql);
        if (file.includes('/m5-content/')) {
          content += sql;
          if (file.endsWith('03-acl.sql'))
            await c.query(
              "INSERT INTO zhiban_content.schema_migrations(version,checksum) VALUES('0001',$1)",
              [digest(content)],
            );
        } else {
          const name = file.includes('0002-')
            ? 'png'
            : file.includes('0003-')
              ? 'interactive'
              : file.includes('0004-')
                ? 'attempt_runtime'
                : 'joint';
          await c.query(
            `INSERT INTO zhiban_content.${name}_schema_migrations(version,checksum) VALUES($1,$2)`,
            [file.split('/').at(-1)!.slice(0, 4), digest(sql)],
          );
        }
        await c.query('COMMIT');
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    }
    // Separate installation overlay: read-only provenance, no access to Identity data.
    // Exact static UNION; no caller identifiers, dynamic SQL, or writable surface.
    const ledgers = [
      ...businessContexts.map((name) => [
        'zhiban_' + name.replaceAll('-', '_'),
        'schema_migrations',
      ]),
      ...[
        'schema_migrations',
        'png_schema_migrations',
        'interactive_schema_migrations',
        'attempt_runtime_schema_migrations',
        'joint_schema_migrations',
      ].map((name) => ['zhiban_content', name]),
    ];
    await c.query('BEGIN');
    try {
      await c.query('SET LOCAL ROLE zhiban_identity_owner');
      await c.query('CREATE SCHEMA zhiban_installation AUTHORIZATION zhiban_identity_owner');
      await c.query('REVOKE ALL ON SCHEMA zhiban_installation FROM PUBLIC');
      await c.query(`CREATE FUNCTION zhiban_installation.schema_ledger()
        RETURNS TABLE(schema_name text,ledger_name text,version text,checksum text)
        LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=pg_catalog AS $ledger$
        ${ledgers.map(([schema, table]) => `SELECT '${schema}'::text,'${table}'::text,version::text,checksum::text FROM ${schema}.${table}`).join(' UNION ALL ')}
        $ledger$`);
      await c.query('REVOKE ALL ON FUNCTION zhiban_installation.schema_ledger() FROM PUBLIC');
      await c.query('GRANT USAGE ON SCHEMA zhiban_installation TO zhiban_control_runtime');
      await c.query(
        'GRANT EXECUTE ON FUNCTION zhiban_installation.schema_ledger() TO zhiban_control_runtime',
      );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  } finally {
    c.release(true);
  }
}
