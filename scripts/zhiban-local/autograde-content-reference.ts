import { localPgMajor, readProfileReference } from './pg-version';
/** Combined expected profile: unchanged trusted Content/Identity/Bridge profile plus separately source-built grading DDL. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { autogradeMigrations } from './autograde';
import { referenceSourceEntries } from './reference-source';
export const autoContentReference =
  'docs/v2/evidence/zhiban-autograde-content-reference-local.json';
export const autoContentBase = 'docs/v2/evidence/p4-joint-classroom-profile-reference-local.json';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export async function expectedAutoContent() {
  if (localPgMajor === 18) return (await readProfileReference(autoContentReference)).fingerprint;
  const baseBytes = await readFile(autoContentBase),
    r = JSON.parse(await readFile(autoContentReference, 'utf8'));
  if (
    r.evidenceOrigin !== 'LOCAL' ||
    r.githubActions !== false ||
    r.scope !== 'SOURCE_BUILT_AUTOGRADE_OVER_FIXED_CONTENT_REFERENCE' ||
    r.baseReferenceSha256 !== hash(baseBytes)
  )
    throw Error('Combined grading content expected source rejected');
  for (const p of autogradeMigrations)
    if (r.migrationHashes[p] !== hash(await readFile(p)))
      throw Error('Combined grading content migration rejected');
  const base = JSON.parse(baseBytes.toString());
  for (const [p, h] of referenceSourceEntries(
    base.sourceHashes ?? {},
    'lib/zhiban/infrastructure/identity/postgres/bootstrap-roles.pg16.sql',
  ))
    if (hash(await readFile(p)) !== h) throw Error('Combined base construction source changed');
  const f = { ...base.enabledProfile.fingerprints };
  for (const s of ['zhiban_academic', 'zhiban_learning', 'zhiban_assessment'])
    f[s] = r.replacementFingerprints[s];
  const expected = hash(JSON.stringify({ fingerprints: f, extra: base.enabledProfile.extra }));
  if (r.fingerprint !== expected) throw Error('Combined expected profile closure rejected');
  return expected;
}
