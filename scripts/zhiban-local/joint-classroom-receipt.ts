import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { catalogFingerprint, official } from '../../lib/zhiban/infrastructure/openmaic/catalog';
export const jointMigration = 'docs/v2/candidates/p4-joint-classroom/0005-joint-classroom.sql';
export const jointReference = 'docs/v2/evidence/p4-joint-classroom-profile-reference-local.json';
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export async function jointClassroomProfile(
  client: Pick<Parameters<typeof catalogFingerprint>[0], 'query'>,
) {
  const catalog = await catalogFingerprint(
    client as Parameters<typeof catalogFingerprint>[0],
    'zhiban_classroom' as 'zhiban_bridge',
  );
  const extra = (
    await client.query(
      `SELECT jsonb_build_object('schema',(SELECT jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',nspacl::text) FROM pg_namespace WHERE nspname='zhiban_classroom'), 'functionOwners',(SELECT coalesce(jsonb_agg(jsonb_build_object('name',p.proname,'owner',pg_get_userbyid(p.proowner)) ORDER BY p.proname),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='zhiban_classroom')) AS facts`,
    )
  ).rows[0].facts;
  return hash(JSON.stringify({ catalog, extra }));
}
export async function jointSources() {
  const sql = await readFile(jointMigration, 'utf8'),
    digest = hash(sql),
    reference = JSON.parse(await readFile(jointReference, 'utf8'));
  if (
    reference.evidenceOrigin !== 'LOCAL' ||
    reference.githubActions !== false ||
    reference.scope !== 'ISOLATED_PG16_JOINT_CLASSROOM_REFERENCE' ||
    reference.jointMigrationSha256 !== digest ||
    reference.attemptRuntimeMigrationSha256 !==
      hash(await readFile('docs/v2/candidates/p4-attempt-runtime/0004-attempt-runtime.sql')) ||
    Object.entries(official).some(([k, v]) => reference.provider[k] !== v)
  )
    throw Error('Joint classroom reference/source rejected');
  return { sql, hash: digest, reference };
}
export async function checkJointLedger(
  client: { query(sql: string): Promise<{ rows: Record<string, unknown>[] }> },
  expected: string,
) {
  const rows = (
    await client.query('SELECT * FROM zhiban_content.joint_schema_migrations ORDER BY version')
  ).rows;
  if (rows.length !== 1 || rows[0].version !== '0005' || rows[0].checksum !== expected)
    throw Error('Joint classroom ledger rejected');
}
