import { buildNativeAuthoring } from './build-native-authoring';
import { createStartupDiagnostics } from '../zhiban-ci/startup-diagnostics.cjs';
import { parseEnv } from 'node:util';
import { privateEntry } from './persistent-snapshot';
import { buildQuizCss } from './quiz-css';
import { verifyUpstreamPackage } from './upstream-source';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { mkdtemp, rm, lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
const startup = createStartupDiagnostics('CATALOG');
async function main() {
  if (
    process.argv.includes('--authoring-focus') ||
    process.argv.includes('--ema-focus') ||
    process.argv.includes('--attainment-focus')
  ) {
    const envFile = '.env.local';
    if (await lstat(envFile).catch(() => null)) {
      await privateEntry(envFile);
      const config = parseEnv(await readFile(envFile, 'utf8'));
      for (const key of ['GLM_API_KEY', 'GLM_BASE_URL', 'GLM_MODELS', 'DEFAULT_MODEL'])
        if (!process.env[key] && config[key]) process.env[key] = config[key];
    }
  }
  if (process.argv.includes('--unified-trial')) {
    startup.enter('PLAYER_BUILD');
    execFileSync(process.execPath, ['scripts/build-standalone-player.mjs'], { stdio: 'pipe' });
  }

  if (
    (process.argv.includes('--trusted-files') || process.argv.includes('--unified-trial')) &&
    !process.env.ZHIBAN_LOCAL_STATE &&
    !process.env.ZHIBAN_SCANNER_PROFILE &&
    !process.env.ZHIBAN_SCANNER_PROFILE_SHA256
  ) {
    const selection = join(homedir(), '.local/share/zhiban-scanner/active.json');
    const stat = await lstat(selection).catch((error) => {
      if (
        error.code === 'ENOENT' &&
        process.argv.includes('--unified-trial') &&
        process.argv.includes('--serve')
      )
        return null;
      throw error;
    });
    if (stat !== null) {
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.uid !== process.getuid?.() ||
        stat.mode & 0o077
      )
        throw Error('Private scanner selection required');
      const selected = JSON.parse(await readFile(selection, 'utf8'));
      if (selected.evidenceOrigin !== 'LOCAL') throw Error('Local scanner selection rejected');
      process.env.ZHIBAN_SCANNER_PROFILE = selected.profile;
      process.env.ZHIBAN_SCANNER_PROFILE_SHA256 = selected.sha256;
    }
  }
  if (
    process.argv.includes('--unified-trial') ||
    process.argv.includes('--trial-content') ||
    process.argv.includes('--shared-classroom') ||
    process.argv.includes('--classroom-edit')
  ) {
    for (const pkg of ['dsl', 'storage', 'editor', 'renderer', 'generation']) {
      startup.enter('SDK_VERIFY', pkg);
      await verifyUpstreamPackage(pkg);
      let reuse = false;
      for (const cachePath of [
        'docs/v2/evidence/zhiban-local-sdk-build-cache.json',
        'docs/v2/evidence/zhiban-quiz-sdk-build-local.json',
        'docs/v2/evidence/m5-c-png-openmaic-120-local.json',
        'docs/v2/evidence/zhiban-trial-content-demo-close-local.json',
      ]) {
        try {
          const receipt = JSON.parse(await readFile(cachePath, 'utf8'));
          if (cachePath.includes('quiz-sdk') && receipt.status !== 'PASS') continue;
          if (cachePath.includes('openmaic-120') && receipt.status !== 'PASS') continue;
          receipt.sourceHashes = Object.fromEntries(
            Object.entries(receipt.sourceHashes).map(([path, digest]) => [resolve(path), digest]),
          );
          const base = resolve(`packages/@openmaic/${pkg}`);
          const paths = execFileSync(
            'rg',
            [
              '--files',
              '--hidden',
              '--no-ignore',
              `${base}/src`,
              `${base}/dist`,
              `${base}/package.json`,
            ],
            { encoding: 'utf8' },
          )
            .trim()
            .split('\n')
            .sort();
          const prior = Object.keys(receipt.sourceHashes)
            .filter(
              (f) =>
                f.startsWith(base + '/src/') ||
                f.startsWith(base + '/dist/') ||
                f === base + '/package.json',
            )
            .sort();
          reuse =
            receipt.evidenceOrigin === 'LOCAL' &&
            receipt.githubActions === false &&
            receipt.node === process.version &&
            receipt.sourceHashes[resolve('pnpm-lock.yaml')] ===
              createHash('sha256')
                .update(await readFile('pnpm-lock.yaml'))
                .digest('hex') &&
            paths.some((f) =>
              f.endsWith(pkg === 'editor' ? '/dist/core/index.js' : '/dist/index.js'),
            ) &&
            JSON.stringify(paths) === JSON.stringify(prior);
          for (const path of paths)
            if (
              reuse &&
              createHash('sha256')
                .update(await readFile(path))
                .digest('hex') !== receipt.sourceHashes[path]
            )
              reuse = false;
          if (reuse) break;
        } catch {
          reuse = false;
        }
      }
      if (reuse) console.log(`Reused @openmaic/${pkg}: matching LOCAL source/build hashes`);
      else {
        startup.enter('SDK_BUILD', pkg);
        execFileSync('pnpm', ['--filter', `@openmaic/${pkg}`, 'build'], { stdio: 'pipe' });
      }
    }
  }
  if (process.argv.includes('--unified-trial')) {
    startup.enter('SDK_CACHE_WRITE');
    const paths = execFileSync(
      'rg',
      [
        '--files',
        '--hidden',
        '--no-ignore',
        ...['dsl', 'storage', 'editor', 'renderer', 'generation'].flatMap((p) => [
          `packages/@openmaic/${p}/src`,
          `packages/@openmaic/${p}/dist`,
          `packages/@openmaic/${p}/package.json`,
        ]),
      ],
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n');
    const sourceHashes: Record<string, string> = {};
    for (const p of [...paths, 'pnpm-lock.yaml'])
      sourceHashes[resolve(p)] = createHash('sha256')
        .update(await readFile(p))
        .digest('hex');
    await writeFile(
      'docs/v2/evidence/zhiban-local-sdk-build-cache.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          scope: 'BUILD_CACHE_ONLY_NOT_PRODUCT_EVIDENCE',
          node: process.version,
          sourceHashes,
        },
        null,
        2,
      ) + '\n',
    );
  }
  if (process.argv.includes('--unified-trial')) await buildNativeAuthoring();
  const { build } = createRequire(require.resolve('tsx'))('esbuild');
  startup.enter('QUIZ_CSS');
  await buildQuizCss();
  startup.enter('QUIZ_BUNDLE');
  await build({
    entryPoints: ['app/zhiban/local/quiz-client.tsx'],
    outfile: 'app/zhiban/local/quiz-client.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  startup.enter('PUBLISHED_PLAYER_BUNDLE');
  await build({
    entryPoints: ['app/zhiban/local/published-player.tsx'],
    outfile: 'app/zhiban/local/published-player.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  startup.enter('ATTEMPT_RUNTIME_BUNDLE');
  await build({
    entryPoints: ['app/zhiban/local/attempt-runtime-page.tsx'],
    outfile: 'app/zhiban/local/attempt-runtime-page.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'silent',
  });
  const root = await mkdtemp(resolve('.zhiban-catalog-run-'));
  try {
    const path = join(root, 'verify.mjs');
    startup.enter('HOST_BUNDLE');
    await build({
      entryPoints: ['scripts/zhiban-local/verify-m6-catalog.mts'],
      outfile: path,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      alias: {
        'next/server': 'next/server.js',
        'next/headers': 'next/headers.js',
        '@openmaic/dsl/schema/scene.schema.json': resolve(
          'packages/@openmaic/dsl/dist/schema/scene.schema.json',
        ),
      },
      banner: {
        js: 'import { createRequire as externalCreateRequire } from "node:module"; const require = externalCreateRequire(import.meta.url);',
      },
      logLevel: 'silent',
    });
    startup.enter('HOST_LAUNCH');
    const child = spawn(
      process.execPath,
      [
        path,
        ...process.argv
          .slice(2)
          .filter((v) =>
            [
              '--persistent',
              '--resume',
              '--upgrade-resources',
              '--upgrade-local',
              '--flow-focus',
              '--simulation-focus',
              '--pbl-focus',
              '--ema-focus',
              '--attainment-focus',
              '--resources-focus',
              '--resources-browser-continuation',
              '--submission-files',
              '--trusted-files',
              '--unified-trial',
              '--member-focus',
              '--teacher-scope',
              '--lesson-focus',
              '--lesson-product-focus',
              '--authoring-focus',
              '--native-player-focus',
              '--native-classroom-focus',
              '--interactive-focus',
              '--attempt-runtime-focus',
              '--joint-classroom-focus',
              '--classroom-results-focus',
              '--followups-focus',
              '--followup-cases-focus',
              '--reminders-focus',
              '--remediation-focus',
              '--risk-focus',
              '--concept-focus',
              '--learner-focus',
              '--tutor-focus',
              '--onboarding-focus',
              '--account-status-focus',
              '--login-identifiers-focus',
              '--avatar-focus',
              '--imports-focus',
              '--gradebook-export-focus',
              '--gradebook-csv',
              '--gradebook',
              '--classroom-edit',
              '--shared-classroom',
              '--serve',
              '--admin-workspace',
              '--course-owner',
              '--history',
              '--trial',
              '--uat-fixes',
              '--uat-round2',
              '--roster-trial',
              '--classroom-fixes',
              '--trial-content',
            ].includes(v),
          ),
      ],
      { stdio: 'inherit' },
    );
    const signal = () => child.kill('SIGTERM');
    process.once('SIGINT', signal);
    process.once('SIGTERM', signal);
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (c) => resolve(c ?? 1));
    });
    process.removeListener('SIGINT', signal);
    process.removeListener('SIGTERM', signal);
    if (code !== 0) process.exitCode = code;
  } finally {
    await rm(root, { recursive: true });
  }
}
void main().catch((e) => {
  startup.fail(e);
  console.error(e);
  process.exitCode = 1;
});
