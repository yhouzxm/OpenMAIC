#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Isolated logical transfer supervisor. */
'use strict';
const fs = require('node:fs'),
  path = require('node:path'),
  cp = require('node:child_process');
const { privatePath, ancestors, validateSnapshot } = require('../zhiban-portable.cjs');
const transfer = require('./pg-transfer.cjs');
const check = (v, m) => {
  if (!v) throw Error(m);
};
function rehearse(snapshot, pin, output) {
  check(
    path.isAbsolute(output) && path.normalize(output) === output,
    'Absolute private output required',
  );
  ancestors(output);
  privatePath(path.dirname(output), true);
  check(!fs.existsSync(output), 'New output required; failed imports cannot be retried in place');
  const manifest = validateSnapshot(snapshot, pin);
  check(
    manifest.applicationVersion === '1.3.0' &&
      manifest.metadata?.contentInstallation?.provider?.storage === '0.38.1',
    'Upgrade a stopped source copy to v1.3.0 first',
  );
  for (const p of [snapshot, manifest.originalRoot])
    check(
      output !== p && !output.startsWith(p + '/') && !p.startsWith(output + '/'),
      'Disjoint source/output required',
    );
  fs.mkdirSync(output, { mode: 0o700 });
  const put = (n, v) =>
    fs.writeFileSync(path.join(output, n), JSON.stringify(v, null, 2) + '\n', {
      mode: 0o600,
      flag: 'wx',
    });
  put('INCOMPLETE.json', { operation: 'PG16_TO_PG18_IMPORT', sourcePin: pin });
  const source = path.join(output, 'source'),
    target = path.join(output, 'target'),
    pack = path.join(output, 'logical');
  const bin18 = process.env.ZHIBAN_PG18_BIN || '/usr/lib/postgresql/18/bin';
  let sourceStarted = false,
    targetStarted = false;
  try {
    transfer.create(source, '/usr/lib/postgresql/16/bin', 16, 56545, snapshot, pin);
    transfer.start(source, true);
    sourceStarted = true;
    const bundle = transfer.exportBundle(source, bin18, pack, path.join(snapshot, 'root'));
    transfer.stop(source);
    sourceStarted = false;
    transfer.create(target, bin18, 18, 56546);
    transfer.start(target, false);
    targetStarted = true;
    transfer.restore(target, pack, bundle.pin);
    const env = {
      ...process.env,
      ZHIBAN_LOCAL_PG_PROFILE: 'PG18_V1',
      ZHIBAN_PG18_LINEAGE: 'PG16_IMPORTED_V1',
      ZHIBAN_DEPLOY_PRIVATE_DIAGNOSTIC: path.join(output, 'private-diagnostic.txt'),
    };
    for (const key of Object.keys(env))
      if (
        /^(DATABASE_URL|PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGPASSFILE|PGSERVICE|PGOPTIONS)$/.test(
          key,
        )
      )
        delete env[key];
    const log = fs.openSync(path.join(output, 'application.log'), 'wx', 0o600);
    let r;
    const tools = fs.mkdtempSync(path.join(process.cwd(), '.zhiban-import-tools-'));
    try {
      const entry = path.join(tools, 'verify.mjs');
      require('esbuild').buildSync({
        entryPoints: ['scripts/zhiban-deploy/verify-pg18.ts'],
        outfile: entry,
        bundle: true,
        platform: 'node',
        format: 'esm',
        packages: 'external',
        logLevel: 'silent',
        banner: {
          js: 'import {createRequire as externalCreateRequire} from "node:module"; const require=externalCreateRequire(import.meta.url);',
        },
      });
      r = cp.spawnSync(
        process.execPath,
        [entry, target, pack, bundle.pin, path.join(output, 'application.json')],
        { env, stdio: ['ignore', log, log], timeout: 180000 },
      );
    } finally {
      fs.closeSync(log);
      fs.rmSync(tools, { recursive: true, force: true });
    }
    check(r.status === 0, 'Imported application validation failed; private state retained');
    transfer.stop(target);
    targetStarted = false;
    validateSnapshot(snapshot, pin);
    const comparison = JSON.parse(fs.readFileSync(path.join(target, 'RESTORE-COMPARISON.json')));
    check(comparison.differences.length === 0, 'Imported data differs');
    const application = JSON.parse(fs.readFileSync(path.join(output, 'application.json')));
    const report = {
      kind: 'ZHIBAN_130_PG16_TO_PG18_IMPORT_V1',
      status: 'PASS',
      evidenceOrigin: application.evidenceOrigin,
      githubActions: application.githubActions,
      ...(application.run ? { run: application.run } : {}),
      sourceSnapshotPin: pin,
      logicalBundlePin: bundle.pin,
      referenceSha256: application.referenceSha256,
      databases: 3,
      dataAclRoleDifferences: 0,
      identityRoles: application.checks.map((x) => x.role),
      providerActivated: false,
      sourceMutated: false,
      scope: 'LOGICAL_IMPORT_AND_IDENTITY_IN_QUARANTINE',
      excluded: [
        'FORMAL_RUNTIME_ACTIVATION',
        'ALIBABA_RDS',
        'EXTERNAL_PROVIDERS',
        'OLD_NATIVE_MAINTENANCE',
      ],
    };
    put('RESULT.json', report);
    fs.unlinkSync(path.join(output, 'INCOMPLETE.json'));
    return report;
  } catch (e) {
    put('FAILED.json', { phase: 'IMPORT_OR_VALIDATION', providerActivated: false });
    throw e;
  } finally {
    if (sourceStarted) transfer.stop(source);
    if (targetStarted) transfer.stop(target);
  }
}
module.exports = { rehearse };
if (require.main === module) {
  try {
    const a = process.argv.slice(2);
    check(a.length === 3, 'Use SNAPSHOT MANIFEST_SHA256 NEW_PRIVATE_OUTPUT');
    console.log(JSON.stringify(rehearse(...a)));
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
