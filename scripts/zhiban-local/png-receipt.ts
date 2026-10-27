import {
  readProfileReference,
  referenceScope,
  versionedContentPath,
  localPgMajor,
} from './pg-version';
import { official } from '../../lib/zhiban/infrastructure/openmaic/catalog';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const pngMigrationPath = 'docs/v2/candidates/m5-png/0002-png.sql';
export const pngReferencePath = 'docs/v2/evidence/m5-png-profile-reference-quiz-local.json';
export const pngMode = 'LOCAL_M5_CONTENT_PNG_V1';
export async function pngSources(profile = false) {
  const sql = await readFile(versionedContentPath(pngMigrationPath), 'utf8'),
    hash = createHash('sha256').update(sql).digest('hex');
  const inventory = JSON.parse(await readFile('docs/v2/candidates/m5-png/inventory.json', 'utf8'));
  const reference = await readProfileReference(
    profile ? 'docs/v2/evidence/m5-png-profile-reference-teacher-local.json' : pngReferencePath,
  );
  if (
    inventory.migrationSha256 !==
      (localPgMajor === 18
        ? createHash('sha256')
            .update(await readFile(pngMigrationPath))
            .digest('hex')
        : hash) ||
    reference.migrationSha256 !== hash ||
    reference.evidenceOrigin !== 'LOCAL' ||
    reference.scope !==
      referenceScope(
        profile ? 'ISOLATED_PG16_PNG_TEACHER_REFERENCE' : 'ISOLATED_PG16_PNG_QUIZ_REFERENCE',
      ) ||
    Object.entries(official).some(([key, value]) => reference.provider?.[key] !== value)
  )
    throw new Error('PNG source/reference binding rejected');
  return { sql, hash, reference };
}
export async function checkPngLedger(
  client: { query(sql: string): Promise<{ rows: Record<string, unknown>[] }> },
  expected: string,
) {
  const rows = (
    await client.query(
      'SELECT version,checksum FROM zhiban_content.png_schema_migrations ORDER BY version',
    )
  ).rows;
  if (rows.length !== 1 || rows[0].version !== '0002' || rows[0].checksum !== expected)
    throw new Error('PNG ledger rejected');
}
