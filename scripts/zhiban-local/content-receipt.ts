import { checkJointLedger, jointClassroomProfile } from './joint-classroom-receipt';
import { pg18Reference } from './pg-version';
import { checkAttemptRuntimeLedger } from './attempt-runtime-receipt';
import { checkInteractiveLedger } from './interactive-receipt';
import { verifyNativeSchemaState } from '../../lib/zhiban/infrastructure/openmaic/schema-state';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Pool } from 'pg';
import { digest, directory, database, pgPort, privateFile } from './config';
import { contentProfile } from './content-profile';
import { pngMode, pngSources, checkPngLedger, pngReferencePath } from './png-receipt';
import { catalogFingerprint, official } from '@/lib/zhiban/infrastructure/openmaic/catalog';
export const nativeDatabase = 'zhiban_m5_native';
export const candidateDirectory = resolve('docs/v2/candidates/m5-content');
export async function candidateSources() {
  const inv = JSON.parse(await readFile(join(candidateDirectory, 'inventory.json'), 'utf8'));
  for (const [name, expected] of Object.entries(inv.filesSha256))
    if (digest(await readFile(join(candidateDirectory, name), 'utf8')) !== expected)
      throw new Error('Candidate source drift');
  const sql = await Promise.all(
    inv.migration.orderedComponents.map((name: string) =>
      readFile(join(candidateDirectory, name), 'utf8'),
    ),
  );
  if (digest(sql.join('')) !== inv.migration.aggregateSha256)
    throw new Error('Candidate aggregate drift');
  return { inv, sql, hash: inv.migration.aggregateSha256 };
}
export async function implementationBindings() {
  const result: Record<string, string> = {};
  async function walk(path: string) {
    for (const e of await readdir(path, { withFileTypes: true })) {
      const f = join(path, e.name);
      if (e.isDirectory()) await walk(f);
      else if (/\.(ts|mts|tsx|js|html|css|json|sql)$/.test(e.name))
        result[f] = digest(await readFile(f, 'utf8'));
    }
  }
  for (const dir of [
    'lib/zhiban',
    'app/zhiban/local',
    'packages/@openmaic/storage/src',
    'packages/@openmaic/storage/dist',
    'packages/@openmaic/dsl/src',
    'packages/@openmaic/dsl/dist',
    'packages/@openmaic/editor/src',
    'packages/@openmaic/editor/dist',
    'packages/@openmaic/renderer/src',
    'packages/@openmaic/renderer/dist',
  ])
    await walk(dir);
  for (const f of [
    'scripts/zhiban-local/content-profile.ts',
    'scripts/zhiban-local/png-receipt.ts',
    'docs/v2/candidates/m5-png/0002-png.sql',
    'docs/v2/candidates/m5-png/inventory.json',
    pngReferencePath,
    'docs/v2/evidence/m5-png-csp-profile.json',
    'scripts/zhiban-local/content-receipt.ts',
    'scripts/zhiban-local/content.ts',
    'scripts/zhiban-local/server.ts',
    'scripts/zhiban-local/academic.ts',
    'scripts/zhiban-local/config.ts',
    'scripts/zhiban-local/launch.ts',
    'docs/v2/candidates/m5-terminal/maintenance-lock.cjs',
    'scripts/zhiban-local/install-m5.ts',
    'scripts/zhiban-local/inspect-m5.ts',
    'scripts/zhiban-local/inspection-budget.ts',
    'scripts/zhiban-local/run-m5-inspection.ts',
    'scripts/zhiban-local/learning.ts',
    'scripts/zhiban-local/assessment.ts',
    'package.json',
    'tsconfig.json',
    'docs/v2/evidence/m5-profile-reference-openmaic-120.json',
    'docs/v2/evidence/m5-csp-local.json',
    'docs/v2/evidence/m5-content-csp-profile.json',
    'scripts/zhiban-local/build-m5.ts',
    'scripts/zhiban-local/setup-m5.ts',
    'pnpm-lock.yaml',
    'packages/@openmaic/storage/package.json',
    'packages/@openmaic/dsl/package.json',
    'packages/@openmaic/editor/package.json',
    'packages/@openmaic/renderer/package.json',
  ])
    result[f] = digest(await readFile(f, 'utf8'));
  for (const name of [
    'localhost.crt',
    'localhost.key',
    'development-ca.crt',
    'm5-server.mjs',
    'm5-installer.mjs',
    'm5-inspector.mjs',
  ])
    result['private/' + name] = digest((await privateFile(name)).toString());
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
export async function checkLedgers(client: any) {
  for (const context of ['identity', 'academic', 'learning', 'assessment']) {
    const dir = resolve(`lib/zhiban/infrastructure/${context}/postgres/migrations`);
    const names = (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort();
    const rows = (
      await client.query(
        `SELECT version,checksum FROM zhiban_${context}.schema_migrations ORDER BY version`,
      )
    ).rows;
    if (rows.length !== names.length) throw new Error('Prerequisite ledger count drift');
    for (let i = 0; i < names.length; i++)
      if (
        rows[i].version !== names[i].slice(0, 4) ||
        rows[i].checksum !== digest(await readFile(join(dir, names[i]), 'utf8'))
      )
        throw new Error('Prerequisite ledger source drift');
  }
}
export async function validateContentInstallation(
  bridge: Pool,
  native: Pool,
  receipt: any,
  config: any,
) {
  validateContentEndpoints(config);
  const source = await candidateSources();
  const png = config.mode === pngMode ? await pngSources() : null;
  const reference =
    png?.reference ??
    JSON.parse(await readFile('docs/v2/evidence/m5-profile-reference-openmaic-120.json', 'utf8'));
  if (
    receipt.formatVersion !== 1 ||
    receipt.approvalRef !== (png ? 'LOCAL_USER_M5_C_20261014' : 'LOCAL_USER_M5_BUILD_20261009') ||
    typeof receipt.issuedAt !== 'string' ||
    !Number.isFinite(Date.parse(receipt.issuedAt)) ||
    receipt.target?.database !== database ||
    receipt.target?.pgPort !== pgPort ||
    receipt.target?.nativeDatabase !== nativeDatabase ||
    receipt.target?.dataDirectory !== join(directory, 'pgdata') ||
    receipt.evidenceOrigin !== 'LOCAL' ||
    receipt.githubActions !== false ||
    receipt.status !== 'VERIFIED' ||
    receipt.kind !== (png ? 'LOCAL_M5_PNG_INSTALLATION' : 'LOCAL_M5_INSTALLATION') ||
    (png && receipt.pngMigrationSha256 !== png.hash) ||
    receipt.candidateMigrationSha256 !== source.hash ||
    receipt.candidateInventorySha256 !==
      digest(await readFile(join(candidateDirectory, 'inventory.json'), 'utf8')) ||
    reference.candidateMigrationSha256 !== source.hash ||
    receipt.configHash !== digest(JSON.stringify(config)) ||
    receipt.bindingHash !== digest(JSON.stringify(await implementationBindings())) ||
    receipt.profile !== reference.enabledProfile.fingerprint
  )
    throw new Error('Content installation receipt/source binding rejected');
  await validateContentDatabaseState(bridge, native, {
    database,
    nativeDatabase,
    deploymentId: config.deploymentId,
    profile: reference.enabledProfile.fingerprint,
    contentHash: source.hash,
    pngHash: png?.hash,
    nativeFingerprint: receipt.nativeFingerprint,
  });
}
// Database-only checks shared with the fixed, owner-bound disposable host.
// This function neither accepts connection strings nor issues installation receipts.
export async function validateContentDatabaseState(
  bridge: Pool,
  native: Pool,
  expected: {
    database: string;
    nativeDatabase: string;
    deploymentId: string;
    profile: string;
    contentHash: string;
    pngHash?: string;
    interactiveHash?: string;
    attemptRuntimeHash?: string;
    jointHash?: string;
    jointClassroomFingerprint?: string;
    nativeFingerprint: string;
  },
) {
  return validateContentStateVersion(bridge, native, expected, 16);
}
export async function validateContentDatabaseStatePg18(
  bridge: Pool,
  native: Pool,
  expected: Parameters<typeof validateContentDatabaseState>[2],
) {
  const reference = await pg18Reference();
  if (
    expected.profile !== reference.contentFingerprint ||
    expected.nativeFingerprint !== reference.nativeFingerprint
  )
    throw Error('PG18 approved expected profile mismatch');
  return validateContentStateVersion(bridge, native, expected, 18);
}
async function validateContentStateVersion(
  bridge: Pool,
  native: Pool,
  expected: Parameters<typeof validateContentDatabaseState>[2],
  major: 16 | 18,
) {
  const { database, nativeDatabase } = expected;
  const client = await bridge.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const identity = (
      await client.query(
        `SELECT session_user,current_database() AS db,current_setting('server_version_num')::integer AS pg,has_database_privilege(current_user,current_database(),'CREATE') OR has_database_privilege(current_user,current_database(),'TEMP') AS extra`,
      )
    ).rows[0];
    if (
      identity.session_user !== 'zhiban_bridge_runtime' ||
      identity.db !== database ||
      identity.pg < major * 10000 ||
      identity.pg >= (major + 1) * 10000 ||
      identity.extra
    )
      throw new Error('Bridge endpoint rejected');
    if ((await contentProfile(client)).fingerprint !== expected.profile)
      throw new Error('Content live profile drift');
    const ledger = (
      await client.query('SELECT version,checksum FROM zhiban_content.schema_migrations')
    ).rows;
    if (
      ledger.length !== 1 ||
      ledger[0].version !== '0001' ||
      ledger[0].checksum !== expected.contentHash
    )
      throw new Error('Content ledger drift');
    if (expected.pngHash) await checkPngLedger(client, expected.pngHash);
    if (expected.jointHash) {
      await checkJointLedger(client, expected.jointHash);
      if ((await jointClassroomProfile(client)) !== expected.jointClassroomFingerprint)
        throw Error('Joint classroom live profile rejected');
    }
    if (expected.attemptRuntimeHash)
      await checkAttemptRuntimeLedger(client, expected.attemptRuntimeHash);
    if (expected.interactiveHash) await checkInteractiveLedger(client, expected.interactiveHash);
    const deployment = (
      await client.query('SELECT * FROM zhiban_bridge.deployment_registry WHERE deployment_id=$1', [
        expected.deploymentId,
      ])
    ).rows[0];
    if (
      !deployment ||
      deployment.state !== 'VERIFIED' ||
      deployment.provisioning_digest !== expected.nativeFingerprint ||
      deployment.official_sha !== official.sha ||
      deployment.storage_version !== official.storage ||
      deployment.dsl_version !== official.dsl ||
      deployment.renderer_version !== official.renderer
    )
      throw new Error('Native deployment binding rejected');
    await client.query('COMMIT');
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
  const n = await native.connect();
  try {
    await n.query('BEGIN READ ONLY');
    if (major === 18) {
      const v = Number((await n.query('SHOW server_version_num')).rows[0].server_version_num);
      if (v < 180000 || v >= 190000) throw Error('PG18 Native endpoint rejected');
    }
    const row = (
      await n.query(
        `SELECT session_user,current_database() AS db,r.rolsuper OR r.rolinherit OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication OR has_schema_privilege(current_user,'public','CREATE') OR has_database_privilege(current_user,current_database(),'CREATE') OR has_database_privilege(current_user,current_database(),'TEMP') OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) OR EXISTS(SELECT 1 FROM pg_class WHERE relowner=r.oid) AS extra FROM pg_roles r WHERE rolname=session_user`,
      )
    ).rows[0];
    if (row.session_user !== 'zhiban_openmaic_runtime' || row.db !== nativeDatabase || row.extra)
      throw new Error('Native runtime privilege drift');
    const roles = (
      await n.query(
        "SELECT rolname,rolcanlogin,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles WHERE rolname IN ('zhiban_openmaic_owner','zhiban_openmaic_migrator','zhiban_openmaic_runtime') ORDER BY rolname",
      )
    ).rows;
    if (
      roles.length !== 3 ||
      roles.some(
        (r: any) =>
          r.rolcanlogin !== (r.rolname !== 'zhiban_openmaic_owner') ||
          r.rolsuper ||
          r.rolinherit ||
          r.rolcreaterole ||
          r.rolcreatedb ||
          r.rolreplication ||
          r.rolbypassrls,
      )
    )
      throw new Error('Native role graph rejected');
    const edges = (
      await n.query(
        "SELECT a.rolname AS granted,b.rolname AS member,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles a ON a.oid=m.roleid JOIN pg_roles b ON b.oid=m.member WHERE a.rolname LIKE 'zhiban_openmaic_%' OR b.rolname LIKE 'zhiban_openmaic_%'",
      )
    ).rows;
    if (
      edges.length !== 1 ||
      edges[0].granted !== 'zhiban_openmaic_owner' ||
      edges[0].member !== 'zhiban_openmaic_migrator' ||
      edges[0].admin_option ||
      edges[0].inherit_option ||
      !edges[0].set_option
    )
      throw new Error('Native PG16 role edge rejected');
    const schema = (
      await n.query(
        "SELECT pg_get_userbyid(nspowner) AS owner, EXISTS(SELECT 1 FROM aclexplode(coalesce(nspacl,acldefault('n',nspowner))) a WHERE a.grantee NOT IN (nspowner,(SELECT oid FROM pg_roles WHERE rolname='zhiban_openmaic_runtime')) OR a.is_grantable OR (a.grantee=(SELECT oid FROM pg_roles WHERE rolname='zhiban_openmaic_runtime') AND a.privilege_type<>'USAGE')) AS extra FROM pg_namespace WHERE nspname='public'",
      )
    ).rows[0];
    if (schema.owner !== 'zhiban_openmaic_owner' || schema.extra)
      throw new Error('Native schema ACL rejected');
    const isolation = (
      await n.query(
        "SELECT has_database_privilege('zhiban_bridge_runtime',current_database(),'CONNECT') OR has_database_privilege('zhiban_academic_runtime',current_database(),'CONNECT') OR EXISTS(SELECT 1 FROM pg_default_acl WHERE defaclrole=(SELECT oid FROM pg_roles WHERE rolname='zhiban_openmaic_owner')) AS extra",
      )
    ).rows[0];
    if (isolation.extra) throw new Error('Native database/default ACL isolation rejected');
    await n.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
    await verifyNativeSchemaState(n);
    if ((await catalogFingerprint(n as any, 'public')) !== expected.nativeFingerprint)
      throw new Error('Native catalog drift');
    await n.query('COMMIT');
  } finally {
    await n.query('ROLLBACK').catch(() => {});
    n.release();
  }
}
export function validateContentEndpoints(config: any) {
  if (
    ![pngMode, 'LOCAL_M5_CONTENT_TEXT_V1'].includes(config.mode) ||
    typeof config.deploymentId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      config.deploymentId,
    )
  )
    throw new Error('Fixed content configuration required');
  for (const [name, role, db] of [
    ['bridge', 'zhiban_bridge_runtime', database],
    ['native', 'zhiban_openmaic_runtime', nativeDatabase],
    ['nativeMigrator', 'zhiban_openmaic_migrator', nativeDatabase],
  ]) {
    const u = new URL(config[name]);
    if (
      u.protocol !== 'postgresql:' ||
      u.hostname !== '127.0.0.1' ||
      Number(u.port) !== pgPort ||
      u.pathname !== `/${db}` ||
      u.username !== role ||
      u.search ||
      u.hash
    )
      throw new Error('Fixed content endpoint required');
  }
}
export async function readContentConfiguration() {
  const config = JSON.parse((await privateFile('content.json')).toString());
  const receipt = JSON.parse((await privateFile('content-installation-receipt.json')).toString());
  validateContentEndpoints(config);
  return { config, receipt };
}
