import {
  localPgMajor,
  pg18Lineage,
  localPgBin,
  pg18Origin,
  pg18Reference,
  executionEvidence,
  validInstallationEvidence,
  versionedContentPath,
} from './pg-version';
import { businessPg18Catalog } from '../zhiban-deploy/pg18-catalog';
import { expectedAutoContent, autoContentReference } from './autograde-content-reference';
import { jointSources, jointClassroomProfile } from './joint-classroom-receipt';
import { attemptRuntimeSources } from './attempt-runtime-receipt';
import { interactiveSources } from './interactive-receipt';
/** Fixed LOCAL disposable composition. Does not read content.json or maintenance inputs. */
import { readFile, writeFile, lstat, readdir } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Pool } from 'pg';
import type { IdentityAuthentication } from '../../lib/zhiban/infrastructure/identity/composition/authentication';
import { provisionNative } from '../../lib/zhiban/infrastructure/openmaic/provision';
import { official } from '../../lib/zhiban/infrastructure/openmaic/catalog';
import { ContentService } from '../../lib/zhiban/infrastructure/content/service';
import { contentHttp } from '../../lib/zhiban/infrastructure/content/http';
import {
  candidateSources,
  checkLedgers,
  validateContentDatabaseState,
  validateContentDatabaseStatePg18,
} from './content-receipt';
import { pngSources } from './png-receipt';
import { contentProfile } from './content-profile';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const classroomEdit = process.argv.includes('--classroom-edit');
const sharedClassroom = classroomEdit || process.argv.includes('--shared-classroom');
const database = classroomEdit
    ? 'zhiban_classroom_edit_disposable'
    : sharedClassroom
      ? 'zhiban_shared_classroom_disposable'
      : 'zhiban_trial_content_disposable',
  nativeDatabase = classroomEdit
    ? 'zhiban_classroom_edit_native'
    : sharedClassroom
      ? 'zhiban_shared_classroom_native'
      : 'zhiban_trial_content_native';
const origin =
    localPgMajor === 18
      ? pg18Origin
      : process.argv.includes('--authoring-focus') ||
          process.argv.includes('--classroom-ai-focus') ||
          process.argv.includes('--resources-focus') ||
          process.argv.includes('--pbl-focus') ||
          process.argv.includes('--ema-focus') ||
          process.argv.includes('--attainment-focus')
        ? 'https://127.0.0.1:3468'
        : classroomEdit
          ? 'https://127.0.0.1:3463'
          : sharedClassroom
            ? 'https://127.0.0.1:3462'
            : 'https://127.0.0.1:3461',
  port = classroomEdit ? 56519 : sharedClassroom ? 56518 : 56517;
type PoolFactory = (user?: string, database?: string) => Pool;
type Target = { owned: string; socket: string; certificateHash: string };
async function target(t: Target) {
  if (
    dirname(t.owned) !== tmpdir() ||
    !t.owned.startsWith(
      join(
        tmpdir(),
        classroomEdit
          ? 'zhiban-classroom-edit-'
          : sharedClassroom
            ? 'zhiban-shared-classroom-'
            : 'zhiban-trial-content-',
      ),
    ) ||
    t.socket !== join(t.owned, 'socket')
  )
    throw Error('Disposable content target rejected');
  for (const p of [t.owned, t.socket]) {
    const s = await lstat(p);
    if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== process.getuid?.() || s.mode & 0o077)
      throw Error('Disposable path rejected');
  }
  if ((await readFile(join(t.owned, 'data/PG_VERSION'), 'utf8')).trim() !== String(localPgMajor))
    throw Error('Selected PG' + localPgMajor + ' required');
}
async function bindings() {
  const result: Record<string, string> = {};
  async function walk(p: string) {
    for (const e of await readdir(p, { withFileTypes: true })) {
      const f = join(p, e.name);
      if (e.isDirectory()) await walk(f);
      else result[resolve(f)] = hash(await readFile(f));
    }
  }
  for (const p of ['dsl', 'storage', 'editor', 'renderer', 'generation']) {
    await walk(`packages/@openmaic/${p}/src`);
    await walk(`packages/@openmaic/${p}/dist`);
    result[resolve(`packages/@openmaic/${p}/package.json`)] = hash(
      await readFile(`packages/@openmaic/${p}/package.json`),
    );
  }
  for (const p of [
    'pnpm-lock.yaml',
    'lib/agent/runtime/run-native-child.ts',
    'lib/agent/runtime/build-agent.ts',
    'lib/agent/runtime/stream-fn.ts',
    'lib/agent/runtime/allowlist.ts',
    'lib/agent/runtime/quota.ts',
    'lib/agent/runtime/tool-timeout.ts',
    'lib/agent/runtime/provider-metadata.ts',
    'lib/ai/llm.ts',
    'lib/server/resolve-model.ts',
    'app/zhiban/local/content-client.tsx',
    'app/zhiban/local/published-player.tsx',
    'app/zhiban/local/classroom-player.ts',
    'scripts/zhiban-local/verify-native-classroom.ts',
    'scripts/zhiban-local/verify-simulation.ts',
    'scripts/zhiban-local/seed-simulation-demo.ts',
    'scripts/zhiban-local/flow.ts',
    'docs/v2/evidence/zhiban-flow-simulation-profile-reference-local.json',
    'app/zhiban/local/interactive-client.tsx',
    'app/zhiban/local/attempt-runtime-client.tsx',
    'app/zhiban/local/joint-attempt-client.tsx',
    'scripts/zhiban-local/joint-classroom-receipt.ts',
    'scripts/zhiban-local/verify-joint-classroom.ts',
    'scripts/zhiban-local/verify-classroom-results.ts',
    'docs/v2/candidates/p4-joint-classroom/0005-joint-classroom.sql',
    autoContentReference,
    'docs/v2/evidence/zhiban-autograde-profile-reference-local.json',
    'docs/v2/evidence/zhiban-attainment-profile-reference-local.json',
    'docs/v2/evidence/p4-joint-classroom-profile-reference-local.json',
    'app/zhiban/local/attempt-runtime-page.tsx',
    'app/zhiban/local/attempt-runtime-page.js',
    'scripts/zhiban-local/attempt-runtime-receipt.ts',
    'scripts/zhiban-local/verify-attempt-runtime.ts',
    'docs/v2/candidates/p4-attempt-runtime/0004-attempt-runtime.sql',
    'docs/v2/evidence/p4-attempt-runtime-profile-reference-local.json',
    'scripts/zhiban-local/interactive-receipt.ts',
    'docs/v2/candidates/p4-interactive/0003-interactive.sql',
    'docs/v2/evidence/p4-interactive-profile-reference-local.json',
    'app/zhiban/local/published-player.js',
    'app/zhiban/local/published-player.css',
    'app/zhiban/local/published-player-link.ts',
    'app/zhiban/local/quiz-client.tsx',
    'app/zhiban/local/quiz-client.js',
    'app/zhiban/local/quiz.css',
    'app/zhiban/local/quiz.base.css',
    'scripts/zhiban-local/quiz-css.ts',
    'docs/v2/evidence/zhiban-quiz-extension-source-local.json',
    'app/zhiban/local/learning-center-client.tsx',
    'app/zhiban/local/learning.js',
    'app/zhiban/local/assessment.js',
    'app/zhiban/local/analytics.js',
    'app/zhiban/local/analytics.css',
    'app/zhiban/local/grading.js',
    'scripts/zhiban-local/verify-followups.ts',
    'scripts/zhiban-local/verify-followup-cases.ts',
    'app/zhiban/local/learning-profile.js',
    'app/zhiban/local/learning-profile.css',
    'app/zhiban/local/learning-profile.html',
    'scripts/zhiban-local/verify-learner.ts',
    'scripts/zhiban-local/learner.ts',
    'app/zhiban/local/tutor.html',
    'app/zhiban/local/tutor.js',
    'app/zhiban/local/tutor.css',
    'scripts/zhiban-local/tutor.ts',
    'app/zhiban/local/imports.html',
    'app/zhiban/local/imports.js',
    'scripts/zhiban-local/imports.ts',
    'scripts/zhiban-local/build-imports-reference.ts',
    'scripts/zhiban-local/verify-imports.ts',
    'docs/v2/evidence/zhiban-imports-profile-reference-local.json',
    'app/zhiban/local/onboarding.html',
    'app/zhiban/local/onboarding.js',
    'app/zhiban/local/onboarding.css',
    'app/zhiban/local/account-setup.html',
    'app/zhiban/local/account-setup.js',
    'scripts/zhiban-local/onboarding.ts',
    'scripts/zhiban-local/account-authority.ts',
    'scripts/zhiban-local/login-identifiers.ts',
    'scripts/zhiban-local/build-login-identifiers-reference.ts',
    'scripts/zhiban-local/login-identifier-authority.ts',
    'scripts/zhiban-local/control-login-identifier.ts',
    'scripts/zhiban-local/verify-login-identifiers.ts',
    'docs/v2/evidence/zhiban-login-identifiers-profile-reference-local.json',
    'app/zhiban/local/login-identifiers.html',
    'app/zhiban/local/login-identifiers.js',
    'scripts/zhiban-local/account-status.ts',
    'scripts/zhiban-local/control-account-status.ts',
    'scripts/zhiban-local/verify-account-status.ts',
    'lib/zhiban/infrastructure/profile/global-status.ts',
    'scripts/zhiban-local/account-control.ts',
    'scripts/zhiban-local/approve-account-request.ts',
    'scripts/zhiban-local/build-onboarding-reference.ts',
    'scripts/zhiban-local/verify-onboarding.ts',
    'docs/v2/evidence/zhiban-onboarding-profile-reference-local.json',
    'scripts/zhiban-local/verify-tutor.ts',
    'scripts/zhiban-local/build-tutor-reference.ts',
    'docs/v2/evidence/zhiban-tutor-profile-reference-local.json',
    'scripts/zhiban-local/build-learner-reference.ts',
    'docs/v2/evidence/zhiban-learner-profile-reference-local.json',
    'app/zhiban/local/concepts.js',
    'app/zhiban/local/concepts.css',
    'app/zhiban/local/concepts.html',
    'scripts/zhiban-local/verify-concept.ts',
    'scripts/zhiban-local/concept.ts',
    'scripts/zhiban-local/build-concept-reference.ts',
    'docs/v2/evidence/zhiban-concept-profile-reference-local.json',
    'app/zhiban/local/risk.js',
    'app/zhiban/local/risk.css',
    'app/zhiban/local/risk.html',
    'scripts/zhiban-local/verify-risk.ts',
    'scripts/zhiban-local/risk.ts',
    'scripts/zhiban-local/build-risk-reference.ts',
    'docs/v2/evidence/zhiban-risk-profile-reference-local.json',
    'app/zhiban/local/remediation.js',
    'app/zhiban/local/remediation.css',
    'app/zhiban/local/remediation.html',
    'scripts/zhiban-local/verify-remediation.ts',
    'scripts/zhiban-local/remediation.ts',
    'scripts/zhiban-local/build-remediation-reference.ts',
    'docs/v2/evidence/zhiban-remediation-profile-reference-local.json',
    'app/zhiban/local/reminders.js',
    'app/zhiban/local/reminders.css',
    'app/zhiban/local/reminders.html',
    'scripts/zhiban-local/verify-reminders.ts',
    'scripts/zhiban-local/reminder.ts',
    'scripts/zhiban-local/build-reminder-reference.ts',
    'docs/v2/evidence/zhiban-reminder-profile-reference-local.json',
    'scripts/zhiban-local/followup.ts',
    'scripts/zhiban-local/build-followup-reference.ts',
    'docs/v2/evidence/zhiban-followup-profile-reference-local.json',
    'app/zhiban/local/discussion.js',
    'app/zhiban/local/material-client.tsx',
    'app/zhiban/local/published-export.tsx',
    'scripts/zhiban-local/run-m6-catalog.ts',
    'scripts/zhiban-local/verify-exports.ts',
    'scripts/zhiban-local/verify-unified-trial.ts',
    'scripts/build-standalone-player.mjs',
    'types/export-vendors.d.ts',
    'scripts/zhiban-local/material.ts',
    'scripts/zhiban-local/material-parser-child.ts',
    'scripts/zhiban-local/verify-materials.ts',
    'lib/workbench/material-upload-policy.ts',
    'docs/v2/evidence/zhiban-material-reference-local.json',
    'app/zhiban/local/profile.js',
    'app/zhiban/local/membership.js',
    'app/zhiban/local/membership.html',
    'scripts/zhiban-local/member-authority.ts',
    'scripts/zhiban-local/prepare-member-admission.ts',
    'scripts/zhiban-local/verify-members.ts',
    'app/zhiban/local/profile.html',
    'app/zhiban/local/client.js',
    'app/zhiban/local/admin-shell.js',
    'scripts/zhiban-local/profile.ts',
    'scripts/zhiban-local/verify-profile.ts',
    'docs/v2/evidence/zhiban-profile-directory-reference-local.json',
    'docs/v2/evidence/m5-png-profile-reference-teacher-local.json',
    'scripts/zhiban-local/teaching.ts',
    'scripts/zhiban-local/prepare-trial.ts',
    'scripts/zhiban-local/png-receipt.ts',
    'scripts/zhiban-local/trial-control.ts',
    'scripts/zhiban-local/verify-teacher-scope.ts',
    'app/zhiban/local/workspace.js',
    'app/zhiban/local/index.html',
    'scripts/zhiban-local/discussion.ts',
    'scripts/zhiban-local/verify-discussion.ts',
    'docs/v2/evidence/zhiban-discussion-profile-reference-local.json',
    'app/zhiban/local/lesson.js',
    'app/zhiban/local/lesson.css',
    'scripts/zhiban-local/lesson.ts',
    'scripts/zhiban-local/verify-lesson.ts',
    'scripts/zhiban-local/verify-presentation.ts',
    'scripts/zhiban-local/verify-native-player.ts',
    'scripts/zhiban-local/verify-interactive.ts',
    'app/zhiban/local/content.html',
    'app/zhiban/local/content.css',
    'app/zhiban/local/course-page.js',
    'app/zhiban/local/workspace.css',
    'app/zhiban/local/style.css',
    'scripts/zhiban-local/request-target.ts',
    'scripts/zhiban-local/trial-content.ts',
    'scripts/zhiban-local/content-receipt.ts',
    'scripts/zhiban-local/content-profile.ts',
    'scripts/zhiban-local/verify-m6-catalog.mts',
    'docs/v2/evidence/m5-png-profile-reference-quiz-local.json',
    'docs/v2/evidence/m5-png-csp-profile.json',
  ])
    result[resolve(p)] = hash(await readFile(p));
  for (const p of [
    'lib',
    'packages/@openmaic/generation/src',
    'packages/@openmaic/generation/templates',
    'packages/@openmaic/generation/snippets',
    'packages/@openmaic/generation/prompts-pbl',
  ])
    await walk(p);
  const { build } = createRequire(require.resolve('tsx'))('esbuild');
  for (const dir of ['lib/export', 'lib/standalone-player', 'public/vendor/standalone-player'])
    await walk(dir);
  const exportClosure = await build({
    entryPoints: ['app/zhiban/local/published-export.tsx'],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'browser',
    packages: 'external',
    logLevel: 'silent',
  });
  for (const path of Object.keys(exportClosure.metafile.inputs))
    result[resolve(path)] = hash(await readFile(path));
  const extraction = await build({
    entryPoints: ['scripts/zhiban-local/material-parser-child.ts'],
    bundle: true,
    write: false,
    metafile: true,
    platform: 'node',
    packages: 'external',
    format: 'cjs',
    logLevel: 'silent',
  });
  for (const path of Object.keys(extraction.metafile.inputs))
    result[resolve(path)] = hash(await readFile(path));
  const tsxLoader = createRequire(resolve('package.json')).resolve('tsx');
  result[tsxLoader] = hash(await readFile(tsxLoader));

  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
async function gradingProfile(pool: Pool, prior: string) {
  const exists = (await pool.query("SELECT to_regclass('zhiban_autograde.schema_migrations') AS r"))
    .rows[0].r;
  return exists ? await expectedAutoContent() : prior;
}
export async function installTrialContent(
  input: Target & {
    admin: Pool;
    master: Pool;
    pool: PoolFactory;
    sourceHashes: Record<string, string>;
    record: (s: string) => void;
  },
) {
  await target(input);
  if (localPgMajor === 18 && pg18Lineage !== 'PG18_FRESH_V1')
    throw Error('Imported lineage cannot execute fresh DDL');
  const source = await candidateSources(),
    png = await pngSources(process.argv.includes('--unified-trial')),
    interactive = process.argv.includes('--unified-trial') ? await interactiveSources() : null,
    attemptRuntime = process.argv.includes('--unified-trial')
      ? await attemptRuntimeSources()
      : null,
    joint = process.argv.includes('--unified-trial') ? await jointSources() : null;
  await input.admin.query('BEGIN');
  try {
    await input.admin.query('SET LOCAL ROLE zhiban_identity_owner');
    for (const sql of source.sql) await input.admin.query(sql);
    await input.admin.query('INSERT INTO zhiban_content.schema_migrations VALUES($1,$2)', [
      '0001',
      source.hash,
    ]);
    await input.admin.query(png.sql);
    await input.admin.query('INSERT INTO zhiban_content.png_schema_migrations VALUES($1,$2)', [
      '0002',
      png.hash,
    ]);
    if (interactive) {
      await input.admin.query(interactive.sql);
      await input.admin.query(
        'INSERT INTO zhiban_content.interactive_schema_migrations VALUES($1,$2)',
        ['0003', interactive.hash],
      );
    }
    if (attemptRuntime) {
      await input.admin.query(attemptRuntime.sql);
      await input.admin.query(
        'INSERT INTO zhiban_content.attempt_runtime_schema_migrations VALUES($1,$2)',
        ['0004', attemptRuntime.hash],
      );
    }
    if (joint) {
      await input.admin.query(joint.sql);
      await input.admin.query('INSERT INTO zhiban_content.joint_schema_migrations VALUES($1,$2)', [
        '0005',
        joint.hash,
      ]);
    }
    await input.admin.query('COMMIT');
  } catch (e) {
    await input.admin.query('ROLLBACK');
    throw e;
  }
  await checkLedgers(input.admin);
  if (
    joint &&
    (await jointClassroomProfile(input.admin)) !== joint.reference.jointClassroomFingerprint
  )
    throw Error('Joint classroom fixed profile mismatch');
  if (
    (await contentProfile(input.admin)).fingerprint !==
    (await gradingProfile(
      input.admin,
      joint?.reference.enabledProfile.fingerprint ??
        attemptRuntime?.reference.enabledProfile.fingerprint ??
        interactive?.reference.enabledProfile.fingerprint ??
        png.reference.enabledProfile.fingerprint,
    ))
  )
    throw Error('Unified profile differs from fixed PNG reference');
  await input.master.query(`CREATE DATABASE ${nativeDatabase}`);
  const boot = resolve(
    localPgMajor === 18
      ? 'docs/v2/candidates/pg18-provider-v1/bootstrap-native-roles.pg18.sql'
      : 'lib/zhiban/infrastructure/openmaic/bootstrap-native-roles.pg16.sql',
  );
  execFileSync(
    join(localPgBin, 'psql'),
    [
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-h',
      input.socket,
      '-p',
      String(port),
      '-U',
      'postgres',
      '-d',
      nativeDatabase,
      '-f',
      boot,
    ],
    { stdio: 'pipe' },
  );
  const provision = await provisionNative(
    input.pool('zhiban_openmaic_migrator', nativeDatabase),
    nativeDatabase,
    'LOCAL_UNIFIED_TRIAL_CONTENT',
  );
  if (provision.fingerprint !== png.reference.nativeFingerprint)
    throw Error('Native reference fingerprint mismatch');
  // UUID v7 remains the frozen registry locator format.
  const { v7 } = await import('uuid');
  const deploymentId = v7(),
    now = Date.now();
  await input.admin.query(
    'INSERT INTO zhiban_bridge.deployment_registry VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9)',
    [
      deploymentId,
      'LOCAL_UNIFIED_TRIAL_CONTENT',
      official.sha,
      official.storage,
      official.dsl,
      official.renderer,
      provision.fingerprint,
      'VERIFIED',
      now,
    ],
  );
  const bundlePath = join(input.owned, 'content-client.js');
  const { build } = createRequire(require.resolve('tsx'))('esbuild');
  await build({
    entryPoints: ['app/zhiban/local/content-client.tsx'],
    outfile: bundlePath,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  const csp = JSON.parse(await readFile('docs/v2/evidence/m5-png-csp-profile.json', 'utf8'))
    .policy as string;
  if (!csp || csp.includes('unsafe-inline')) throw Error('CSP rejected');
  for (const name of source.inv.migration.orderedComponents) {
    const path = resolve('docs/v2/candidates/m5-content', name);
    input.sourceHashes[path] = hash(await readFile(path));
  }
  input.sourceHashes[resolve(versionedContentPath('docs/v2/candidates/m5-png/0002-png.sql'))] =
    png.hash;
  const bound = await bindings();
  Object.assign(input.sourceHashes, bound);
  const receipt = {
    kind:
      localPgMajor === 18 ? 'LOCAL_UNIFIED_CONTENT_PG18_V1' : 'LOCAL_UNIFIED_CONTENT_INSTALLATION',
    ...(localPgMajor === 18
      ? { postgresMajor: 18, profileManifestSha256: (await pg18Reference()).manifestSha256 }
      : {}),
    ...executionEvidence(),
    status: 'VERIFIED',
    issuedAt: new Date().toISOString(),
    origin,
    port,
    database,
    nativeDatabase,
    dataDirectory: join(input.owned, 'data'),
    socket: input.socket,
    deploymentId,
    contentHash: source.hash,
    pngHash: png.hash,
    profile: await gradingProfile(
      input.admin,
      joint?.reference.enabledProfile.fingerprint ??
        attemptRuntime?.reference.enabledProfile.fingerprint ??
        interactive?.reference.enabledProfile.fingerprint ??
        png.reference.enabledProfile.fingerprint,
    ),
    interactiveHash: interactive?.hash,
    attemptRuntimeHash: attemptRuntime?.hash,
    jointHash: joint?.hash,
    jointClassroomFingerprint: joint?.reference.jointClassroomFingerprint,
    nativeFingerprint: provision.fingerprint,
    provider: official,
    bindingsHash: hash(JSON.stringify(bound)),
    certificateHash: input.certificateHash,
    bundlePath,
    bundleHash: hash(await readFile(bundlePath)),
    csp,
    cspHash: hash(csp),
  };
  await writeFile(
    join(input.owned, 'content-installation.json'),
    JSON.stringify(receipt, null, 2) + '\n',
    { mode: 0o600, flag: 'wx' },
  );
  input.sourceHashes[bundlePath] = receipt.bundleHash;
  input.sourceHashes[boot] = hash(await readFile(boot));
  input.record(
    `Content/Native fixed profile verified in owned PG${localPgMajor} dual databases; independent Classroom migrations are validated separately`,
  );
  return receipt;
}
export async function loadTrialContent(
  receipt: Awaited<ReturnType<typeof installTrialContent>>,
  input: Target & { pool: PoolFactory; security: IdentityAuthentication },
) {
  await target(input);
  const privateReceipt = join(input.owned, 'content-installation.json'),
    stat = await lstat(privateReceipt);
  if (stat.isSymbolicLink() || stat.uid !== process.getuid?.() || stat.mode & 0o077)
    throw Error('Private receipt rejected');
  const disk = JSON.parse(await readFile(privateReceipt, 'utf8'));
  if (JSON.stringify(disk) !== JSON.stringify(receipt)) throw Error('Receipt mutation rejected');
  const source = await candidateSources(),
    png = await pngSources(process.argv.includes('--unified-trial')),
    interactive = process.argv.includes('--unified-trial') ? await interactiveSources() : null,
    attemptRuntime = process.argv.includes('--unified-trial')
      ? await attemptRuntimeSources()
      : null,
    joint = process.argv.includes('--unified-trial') ? await jointSources() : null;
  if (
    receipt.kind !==
      (localPgMajor === 18
        ? 'LOCAL_UNIFIED_CONTENT_PG18_V1'
        : 'LOCAL_UNIFIED_CONTENT_INSTALLATION') ||
    !validInstallationEvidence(receipt) ||
    receipt.status !== 'VERIFIED' ||
    receipt.origin !== origin ||
    receipt.port !== port ||
    receipt.database !== database ||
    receipt.nativeDatabase !== nativeDatabase ||
    receipt.socket !== input.socket ||
    receipt.dataDirectory !== join(input.owned, 'data') ||
    receipt.certificateHash !== input.certificateHash ||
    receipt.contentHash !== source.hash ||
    receipt.pngHash !== png.hash ||
    receipt.interactiveHash !== interactive?.hash ||
    receipt.attemptRuntimeHash !== attemptRuntime?.hash ||
    receipt.jointHash !== joint?.hash ||
    receipt.jointClassroomFingerprint !== joint?.reference.jointClassroomFingerprint ||
    receipt.profile !==
      (await gradingProfile(
        input.pool(),
        joint?.reference.enabledProfile.fingerprint ??
          attemptRuntime?.reference.enabledProfile.fingerprint ??
          interactive?.reference.enabledProfile.fingerprint ??
          png.reference.enabledProfile.fingerprint,
      )) ||
    receipt.nativeFingerprint !== png.reference.nativeFingerprint ||
    receipt.bindingsHash !== hash(JSON.stringify(await bindings())) ||
    receipt.bundlePath !== join(input.owned, 'content-client.js') ||
    receipt.bundleHash !== hash(await readFile(receipt.bundlePath)) ||
    receipt.cspHash !== hash(receipt.csp)
  )
    throw Error('Disposable content receipt/source mismatch');
  const bridge = input.pool('zhiban_bridge_runtime'),
    native = input.pool('zhiban_openmaic_runtime', nativeDatabase);
  if (localPgMajor === 18) {
    const expected = await pg18Reference();
    if (
      receipt.postgresMajor !== 18 ||
      receipt.sourceLineage !== pg18Lineage ||
      receipt.profileManifestSha256 !== expected.manifestSha256
    )
      throw Error('PG18 receipt dialect/profile binding rejected');
    const c = await input.pool().connect();
    try {
      if ((await businessPg18Catalog(c)).fingerprint !== expected.businessFingerprint)
        throw Error('PG18 complete business catalog/ACL drift');
    } finally {
      c.release();
    }
  }
  await (localPgMajor === 18 ? validateContentDatabaseStatePg18 : validateContentDatabaseState)(
    bridge,
    native,
    receipt,
  );
  const service = new ContentService(
    bridge,
    native,
    input.security,
    receipt.deploymentId,
    () => {},
    true,
    !!interactive,
    !!attemptRuntime,
    !!joint,
  );
  return {
    service,
    http: contentHttp(service, input.security, origin),
    bundlePath: receipt.bundlePath,
    csp: receipt.csp,
  };
}

/** Explicit LOCAL snapshot upgrade; validates the restored DB contract before re-binding current host sources. */
export async function upgradeRestoredContent(input: Target & { pool: PoolFactory }) {
  await target(input);
  const path = join(input.owned, 'content-installation.json');
  const previousBytes = await readFile(path);
  const previous = JSON.parse(previousBytes.toString());
  if (
    previous.kind !==
      (localPgMajor === 18
        ? 'LOCAL_UNIFIED_CONTENT_PG18_V1'
        : 'LOCAL_UNIFIED_CONTENT_INSTALLATION') ||
    !validInstallationEvidence(previous) ||
    previous.origin !== origin ||
    previous.socket !== input.socket ||
    previous.dataDirectory !== join(input.owned, 'data') ||
    previous.database !== database ||
    previous.nativeDatabase !== nativeDatabase ||
    previous.port !== port ||
    previous.certificateHash !== input.certificateHash ||
    previous.bundlePath !== join(input.owned, 'content-client.js') ||
    previous.bundleHash !== hash(await readFile(previous.bundlePath))
  )
    throw Error('Restored receipt target rejected');
  const expectedProfile = await gradingProfile(
    input.pool(),
    (await jointSources()).reference.enabledProfile.fingerprint,
  );
  if (
    previous.profile !== expectedProfile &&
    previous.profile !== (await jointSources()).reference.enabledProfile.fingerprint
  )
    throw Error('Restored prior profile rejected');
  await (localPgMajor === 18 ? validateContentDatabaseStatePg18 : validateContentDatabaseState)(
    input.pool('zhiban_bridge_runtime'),
    input.pool('zhiban_openmaic_runtime', nativeDatabase),
    { ...previous, profile: expectedProfile },
  );
  // No migration/helper/ACL receipt is relaxed. The normal loader checks all current source/profile pins again.
  const { build } = createRequire(require.resolve('tsx'))('esbuild');
  await build({
    entryPoints: ['app/zhiban/local/content-client.tsx'],
    outfile: previous.bundlePath,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  await writeFile(
    join(input.owned, `content-installation.before-upgrade-${Date.now()}.json`),
    previousBytes,
    {
      mode: 0o600,
      flag: 'wx',
    },
  );
  const current = {
    ...previous,
    profile: expectedProfile,
    issuedAt: new Date().toISOString(),
    bindingsHash: hash(JSON.stringify(await bindings())),
    bundleHash: hash(await readFile(previous.bundlePath)),
  };
  await writeFile(path, JSON.stringify(current, null, 2) + '\n', { mode: 0o600 });
}
