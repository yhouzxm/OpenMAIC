/** Trusted CLI host selection only. The default PG16 contract and references remain unchanged. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';
export const localPgMajor =
  process.env.ZHIBAN_LOCAL_PG_PROFILE === undefined
    ? 16
    : process.env.ZHIBAN_LOCAL_PG_PROFILE === 'PG18_V1'
      ? 18
      : (() => {
          throw Error('Unsupported PostgreSQL profile');
        })();
export const pg18Lineage = process.env.ZHIBAN_PG18_LINEAGE ?? 'PG18_FRESH_V1';
if (!['PG18_FRESH_V1', 'PG16_IMPORTED_V1'].includes(pg18Lineage))
  throw Error('Unsupported PG18 source lineage');
export const localPgBin =
  localPgMajor === 16
    ? '/usr/lib/postgresql/16/bin'
    : process.env.ZHIBAN_PG18_BIN || '/usr/lib/postgresql/18/bin';
if (!isAbsolute(localPgBin) || normalize(localPgBin) !== localPgBin)
  throw Error('Absolute versioned PG binary directory required');
export const pg18Origin = 'https://127.0.0.1:3478';
export const pg18ReferencePath = 'docs/v2/candidates/pg18-provider-v1/reference.json';
export const pg18PinPath = 'docs/v2/candidates/pg18-provider-v1/pin.json';
export const hashPgInput = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
export function referenceScope(pg16: string) {
  return localPgMajor === 18 ? pg16.replaceAll('PG16', 'PG18') : pg16;
}
export async function pg18Reference() {
  const bytes = await readFile(pg18ReferencePath),
    pin = JSON.parse(await readFile(pg18PinPath, 'utf8'));
  if (
    pin.kind !== 'PG18_REFERENCE_PIN_V1' ||
    !/^[a-f0-9]{64}$/.test(pin.sha256) ||
    hashPgInput(bytes) !== pin.sha256
  )
    throw Error('PG18 reference pin rejected');
  const r = JSON.parse(bytes.toString());
  if (
    r.kind !== 'PG18_SOURCE_BUILT_REFERENCE_V1' ||
    r.major !== 18 ||
    r.evidenceOrigin !== 'LOCAL' ||
    r.githubActions !== false ||
    r.constructionOnly !== true ||
    !r.profiles ||
    !r.sourceHashes
  )
    throw Error('PG18 reference origin/version rejected');
  for (const [p, h] of Object.entries(r.sourceHashes)) {
    if (
      isAbsolute(p) ||
      normalize(p) !== p ||
      p.startsWith('../') ||
      !/^[a-f0-9]{64}$/.test(String(h)) ||
      hashPgInput(await readFile(p)) !== h
    )
      throw Error('PG18 reference source closure rejected: ' + p);
  }
  const selected = pg18Lineage === 'PG16_IMPORTED_V1' ? r.importedPg16 : r;
  if (!selected || selected.major !== 18) throw Error('PG18 lineage reference missing');
  return {
    ...selected,
    sourceHashes: r.sourceHashes,
    sourceLineage: pg18Lineage,
    manifestSha256: pin.sha256,
  };
}
export async function readProfileReference(path: string): Promise<ReturnType<typeof JSON.parse>> {
  if (localPgMajor === 16) return JSON.parse(await readFile(path, 'utf8'));
  const r = await pg18Reference();
  if (!Object.hasOwn(r.profiles, path))
    throw Error('PG18 reference does not contain requested profile: ' + path);
  return structuredClone(r.profiles[path]);
}
export function executionEvidence() {
  if (localPgMajor === 18 && process.env.GITHUB_ACTIONS === 'true') {
    if (
      !/^\d+$/.test(process.env.GITHUB_RUN_ID || '') ||
      !/^\d+$/.test(process.env.GITHUB_RUN_ATTEMPT || '') ||
      !/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || '')
    )
      throw Error('GitHub evidence identity required');
    return {
      postgresMajor: 18,
      profileFormat: 'PG18_V1',
      sourceLineage: pg18Lineage,
      evidenceOrigin: 'GITHUB_ACTIONS',
      githubActions: true,
      run: {
        id: process.env.GITHUB_RUN_ID,
        attempt: process.env.GITHUB_RUN_ATTEMPT,
        sha: process.env.GITHUB_SHA,
      },
    };
  }
  return {
    ...(localPgMajor === 18
      ? { postgresMajor: 18, profileFormat: 'PG18_V1', sourceLineage: pg18Lineage }
      : {}),
    evidenceOrigin: 'LOCAL',
    githubActions: false,
  };
}
export function validInstallationEvidence(r: Record<string, unknown>) {
  const run = r.run as { id?: string; attempt?: string; sha?: string } | undefined;
  return (
    (r.evidenceOrigin === 'LOCAL' && r.githubActions === false) ||
    (localPgMajor === 18 &&
      r.evidenceOrigin === 'GITHUB_ACTIONS' &&
      r.githubActions === true &&
      /^\d+$/.test(run?.id ?? '') &&
      /^\d+$/.test(run?.attempt ?? '') &&
      /^[a-f0-9]{40}$/.test(run?.sha ?? ''))
  );
}

export function versionedContentPath(path: string) {
  return localPgMajor === 18 &&
    pg18Lineage === 'PG18_FRESH_V1' &&
    /^docs\/v2\/candidates\/(?:m5-png|p4-interactive|p4-attempt-runtime|p4-joint-classroom)\/[^/]+\.sql$/.test(
      path,
    )
    ? 'docs/v2/candidates/pg18-provider-v1/' + path.split('/').at(-1)!.replace('.sql', '.pg18.sql')
    : path;
}
