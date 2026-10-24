import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { official } from '../../lib/zhiban/infrastructure/openmaic/catalog';
export const attemptRuntimeMigration =
  'docs/v2/candidates/p4-attempt-runtime/0004-attempt-runtime.sql';
export const attemptRuntimeReference =
  'docs/v2/evidence/p4-attempt-runtime-profile-reference-local.json';
export async function attemptRuntimeSources() {
  const sql = await readFile(attemptRuntimeMigration, 'utf8'),
    hash = createHash('sha256').update(sql).digest('hex');
  const reference = JSON.parse(await readFile(attemptRuntimeReference, 'utf8'));
  if (
    reference.evidenceOrigin !== 'LOCAL' ||
    reference.githubActions !== false ||
    reference.interactiveMigrationSha256 !==
      createHash('sha256')
        .update(await readFile('docs/v2/candidates/p4-interactive/0003-interactive.sql'))
        .digest('hex') ||
    reference.scope !== 'ISOLATED_PG16_ATTEMPT_RUNTIME_REFERENCE' ||
    reference.attemptRuntimeMigrationSha256 !== hash ||
    Object.entries(official).some(([k, v]) => reference.provider[k] !== v)
  )
    throw Error('Attempt Runtime reference/source rejected');
  return { sql, hash, reference };
}
export async function checkAttemptRuntimeLedger(
  client: { query(sql: string): Promise<{ rows: Record<string, unknown>[] }> },
  hash: string,
) {
  const rows = (
    await client.query(
      'SELECT * FROM zhiban_content.attempt_runtime_schema_migrations ORDER BY version',
    )
  ).rows;
  if (rows.length !== 1 || rows[0].version !== '0004' || rows[0].checksum !== hash)
    throw Error('Attempt Runtime ledger rejected');
}
