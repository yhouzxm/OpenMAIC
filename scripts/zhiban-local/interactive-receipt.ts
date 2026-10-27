import { readProfileReference, referenceScope, versionedContentPath } from './pg-version';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { official } from '../../lib/zhiban/infrastructure/openmaic/catalog';
export const interactiveMigration = 'docs/v2/candidates/p4-interactive/0003-interactive.sql';
export const interactiveReference = 'docs/v2/evidence/p4-interactive-profile-reference-local.json';
export async function interactiveSources() {
  const sql = await readFile(versionedContentPath(interactiveMigration), 'utf8'),
    hash = createHash('sha256').update(sql).digest('hex');
  const reference = await readProfileReference(interactiveReference);
  if (
    reference.evidenceOrigin !== 'LOCAL' ||
    reference.scope !== referenceScope('ISOLATED_PG16_INTERACTIVE_REFERENCE') ||
    reference.interactiveMigrationSha256 !== hash ||
    Object.entries(official).some(([k, v]) => reference.provider[k] !== v)
  )
    throw Error('Interactive reference/source rejected');
  return { sql, hash, reference };
}
export async function checkInteractiveLedger(
  client: { query(sql: string): Promise<{ rows: Record<string, unknown>[] }> },
  hash: string,
) {
  const rows = (
    await client.query(
      'SELECT * FROM zhiban_content.interactive_schema_migrations ORDER BY version',
    )
  ).rows;
  if (rows.length !== 1 || rows[0].version !== '0003' || rows[0].checksum !== hash)
    throw Error('Interactive ledger rejected');
}
