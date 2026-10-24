import { randomBytes } from 'node:crypto';
import { fstatSync, lstatSync } from 'node:fs';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Pool } from 'pg';
import { v7 } from 'uuid';
import {
  directory,
  database,
  pgPort,
  pgBin,
  digest,
  loadRuntime,
  privateFile,
  requirePrivateClusterDirectories,
} from './config';
import {
  candidateSources,
  candidateDirectory,
  nativeDatabase,
  implementationBindings,
  checkLedgers,
  validateContentInstallation,
  validateContentEndpoints,
} from './content-receipt';
import { contentProfile } from './content-profile';
import { pngSources, pngMode, checkPngLedger } from './png-receipt';
import {
  provisionNative,
  verifyNativeProvisioning,
} from '@/lib/zhiban/infrastructure/openmaic/provision';
import { official } from '@/lib/zhiban/infrastructure/openmaic/catalog';
async function main() {
  await loadRuntime();
  await requirePrivateClusterDirectories();
  const source = await candidateSources();
  const png = process.argv.includes('--png') ? await pngSources() : null;
  if (png) {
    const held = fstatSync(3),
      expected = lstatSync(join(directory, 'maintenance.lock'));
    const flag = JSON.parse((await privateFile('maintenance.json')).toString());
    if (
      !held.isFile() ||
      held.ino !== expected.ino ||
      held.dev !== expected.dev ||
      held.uid !== process.getuid?.() ||
      (held.mode & 0o077) !== 0 ||
      flag.status !== 'BLOCKED_UNTIL_CLOSED'
    )
      throw new Error('PNG installer requires inherited exclusive maintenance custody');
    execFileSync('/usr/bin/flock', ['-n', '-x', '3'], { stdio: ['ignore', 'ignore', 'ignore', 3] });
  }
  const build = JSON.parse((await privateFile('m5-build-manifest.json')).toString());
  if (
    build.evidenceOrigin !== 'LOCAL' ||
    build.bindingHash !== digest(JSON.stringify(await implementationBindings()))
  )
    throw new Error('Fresh source/artifact build bindings required');
  const reference = JSON.parse(
    await readFile('docs/v2/evidence/m5-profile-reference-openmaic-120.json', 'utf8'),
  );
  if (reference.candidateMigrationSha256 !== source.hash)
    throw new Error('Fresh isolated reference profile required');
  for (const p of source.inv.prerequisiteMigrationSources)
    if (digest(await readFile(p.path, 'utf8')) !== p.sha256)
      throw new Error('Prerequisite source drift');
  const academic = JSON.parse((await privateFile('academic.json')).toString());
  const adminPool = new Pool({
    host: join(directory, 'socket'),
    port: pgPort,
    database,
    user: 'postgres',
    max: 1,
  });
  const admin = await adminPool.connect();
  const pools: Pool[] = [];
  try {
    // Hold a session lock across both databases and receipt issuance.
    await admin.query("SELECT pg_advisory_lock(hashtextextended('LOCAL_M5_INSTALL',0))");
    const c = admin;
    let installed = false;
    let pngInstalled = false;
    try {
      await c.query('BEGIN');
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('LOCAL_M5_INSTALL',0))");
      const id = (
        await c.query(
          "SELECT current_database() AS db,current_setting('data_directory') AS dir,current_setting('server_version_num')::integer AS pg,current_setting('port') AS port",
        )
      ).rows[0];
      if (
        id.db !== database ||
        id.dir !== join(directory, 'pgdata') ||
        id.port !== String(pgPort) ||
        id.pg < 160000 ||
        id.pg > 169999
      )
        throw new Error('Exact owned local PG16 required');
      await checkLedgers(c);
      installed = !!(await c.query("SELECT to_regnamespace('zhiban_content') AS s")).rows[0].s;
      pngInstalled = !!(
        await c.query("SELECT to_regclass('zhiban_content.png_schema_migrations') AS s")
      ).rows[0].s;
      if (pngInstalled && !png)
        throw new Error('PNG installed: explicit --png required; no downgrade');
      const profile = await contentProfile(c, installed);
      if (
        profile.fingerprint !==
        (pngInstalled
          ? png!.reference.enabledProfile
          : installed
            ? reference.enabledProfile
            : reference.baselineProfile
        ).fingerprint
      )
        throw new Error('Expected vs live prerequisite profile mismatch');
      if (!installed) {
        await c.query(await readFile(join(candidateDirectory, '00-preflight.sql'), 'utf8'));
        await c.query('SET LOCAL ROLE zhiban_identity_owner');
        for (const sql of source.sql) await c.query(sql);
        await c.query(
          'INSERT INTO zhiban_content.schema_migrations(version,checksum) VALUES($1,$2)',
          ['0001', source.hash],
        );
        if ((await contentProfile(c)).fingerprint !== reference.enabledProfile.fingerprint)
          throw new Error('Expected installed profile mismatch');
      } else {
        const rows = (
          await c.query('SELECT version,checksum FROM zhiban_content.schema_migrations')
        ).rows;
        if (rows.length !== 1 || rows[0].version !== '0001' || rows[0].checksum !== source.hash)
          throw new Error('Existing content ledger rejected; no reapply');
      }
      if (png) {
        if (!pngInstalled) {
          await c.query('SET LOCAL ROLE zhiban_identity_owner');
          await c.query(png.sql);
          await c.query('INSERT INTO zhiban_content.png_schema_migrations VALUES($1,$2)', [
            '0002',
            png.hash,
          ]);
        }
        await checkPngLedger(c, png.hash);
        if ((await contentProfile(c)).fingerprint !== png.reference.enabledProfile.fingerprint)
          throw new Error('PNG expected/live profile mismatch');
      }
      await c.query('COMMIT');
    } finally {
      await c.query('ROLLBACK').catch(() => {});
    }
    let config: any, provision: any;
    try {
      config = JSON.parse((await privateFile('content.json')).toString());
      provision = JSON.parse((await privateFile('content-native-receipt.json')).toString());
    } catch (e) {
      if ((e as any).code !== 'ENOENT') throw e;
    }
    if (!config) {
      if (
        (await admin.query('SELECT 1 FROM pg_database WHERE datname=$1', [nativeDatabase])).rowCount
      )
        throw new Error('Unknown existing Native database; refuse reset');
      await admin.query(`CREATE DATABASE ${nativeDatabase} TEMPLATE template0 ENCODING 'UTF8'`);
      execFileSync(
        join(pgBin, 'psql'),
        [
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-h',
          join(directory, 'socket'),
          '-p',
          String(pgPort),
          '-U',
          'postgres',
          '-d',
          nativeDatabase,
          '-f',
          resolve('lib/zhiban/infrastructure/openmaic/bootstrap-native-roles.pg16.sql'),
        ],
        { stdio: 'pipe' },
      );
      const migratorPassword = randomBytes(32).toString('base64url'),
        runtimePassword = randomBytes(32).toString('base64url');
      await admin.query(`ALTER ROLE zhiban_openmaic_migrator PASSWORD '${migratorPassword}'`);
      await admin.query(`ALTER ROLE zhiban_openmaic_runtime PASSWORD '${runtimePassword}'`);
      const nativeUrl = (role: string, pw: string) =>
        `postgresql://${role}:${pw}@127.0.0.1:${pgPort}/${nativeDatabase}`;
      config = {
        mode: 'LOCAL_M5_CONTENT_TEXT_V1',
        bridge: academic.bridge,
        native: nativeUrl('zhiban_openmaic_runtime', runtimePassword),
        nativeMigrator: nativeUrl('zhiban_openmaic_migrator', migratorPassword),
        deploymentId: v7(),
      };
      validateContentEndpoints(config);
      const maintainer = new Pool({ connectionString: config.nativeMigrator, max: 1 });
      pools.push(maintainer);
      provision = await provisionNative(maintainer, nativeDatabase, 'LOCAL_USER_M5_BUILD_20261009');
      await writeFile(
        join(directory, 'content-native-receipt.json'),
        JSON.stringify(provision, null, 2) + '\n',
        { mode: 0o600, flag: 'wx' },
      );
      await writeFile(join(directory, 'content.json'), JSON.stringify(config, null, 2) + '\n', {
        mode: 0o600,
        flag: 'wx',
      });
      const t = Date.now();
      await admin.query(
        'INSERT INTO zhiban_bridge.deployment_registry VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9)',
        [
          config.deploymentId,
          'LOCAL_M5_TEXT',
          official.sha,
          official.storage,
          official.dsl,
          official.renderer,
          provision.fingerprint,
          'VERIFIED',
          t,
        ],
      );
    } else {
      validateContentEndpoints(config);
      const maintainer = new Pool({ connectionString: config.nativeMigrator, max: 1 });
      pools.push(maintainer);
      await verifyNativeProvisioning(maintainer, provision);
    }
    if (png) config = { ...config, mode: pngMode };
    const bindingHash = digest(JSON.stringify(await implementationBindings()));
    if (bindingHash !== build.bindingHash)
      throw new Error('Source/artifact changed during installation');
    const receipt = {
      formatVersion: 1,
      kind: png ? 'LOCAL_M5_PNG_INSTALLATION' : 'LOCAL_M5_INSTALLATION',
      status: 'VERIFIED',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      approvalRef: png ? 'LOCAL_USER_M5_C_20261014' : 'LOCAL_USER_M5_BUILD_20261009',
      issuedAt: new Date().toISOString(),
      target: { database, pgPort, nativeDatabase, dataDirectory: join(directory, 'pgdata') },
      candidateMigrationSha256: source.hash,
      candidateInventorySha256: digest(
        await readFile(join(candidateDirectory, 'inventory.json'), 'utf8'),
      ),
      profile: (png?.reference ?? reference).enabledProfile.fingerprint,
      ...(png ? { pngMigrationSha256: png.hash } : {}),
      nativeFingerprint: provision.fingerprint,
      configHash: digest(JSON.stringify(config)),
      bindingHash,
      scope:
        'Exact LOCAL installation/source/catalog/ledger/Native/TLS bindings; product acceptance tracked in separate evidence, not a production signoff',
    };
    const bridge = new Pool({ connectionString: config.bridge, max: 1 }),
      native = new Pool({ connectionString: config.native, max: 1 });
    pools.push(bridge, native);
    await validateContentInstallation(bridge, native, receipt, config);
    if (png) {
      const staged = join(directory, `content-png.${randomBytes(12).toString('hex')}.tmp`);
      await writeFile(staged, JSON.stringify(config, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      await rename(staged, join(directory, 'content.json'));
    }
    const temporaryReceipt = join(
      directory,
      `content-installation-receipt.${randomBytes(12).toString('hex')}.tmp`,
    );
    try {
      await writeFile(temporaryReceipt, JSON.stringify(receipt, null, 2) + '\n', {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporaryReceipt, join(directory, 'content-installation-receipt.json'));
    } finally {
      await unlink(temporaryReceipt).catch((e) => {
        if (e.code !== 'ENOENT') throw e;
      });
    }
    console.log(
      `LOCAL M5 installation ${installed ? 'verified without reapplying' : 'applied and verified'}; private receipt issued.`,
    );
  } finally {
    await admin
      .query("SELECT pg_advisory_unlock(hashtextextended('LOCAL_M5_INSTALL',0))")
      .catch(() => {});
    admin.release();
    await Promise.allSettled([adminPool.end(), ...pools.map((p) => p.end())]);
  }
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'M5 installation rejected');
  process.exitCode = 1;
});
