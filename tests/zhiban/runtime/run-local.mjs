// Explicit Ubuntu LOCAL continuation. Evidence and credentials never enter the repository.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

// Ubuntu measurements put CLI/KDF/SQL test bodies near the default 5000ms limit.
// This budget belongs only to this LOCAL real-PG runner, never hermetic/CI tests.
export const LOCAL_PG16_TEST_TIMEOUT_MS = 15000;
export function localPg16Passes(phase) {
  if (phase === 'pg-second') return [2];
  if (phase === 'pg' || phase === 'all') return [1, 2];
  if (phase === 'nonpg') return [];
  throw Error('Unknown LOCAL phase');
}
export function localVitestArguments(files, report, realPg = false) {
  return [
    'exec',
    'vitest',
    'run',
    ...files,
    '--maxWorkers=1',
    '--no-file-parallelism',
    ...(realPg ? [`--testTimeout=${LOCAL_PG16_TEST_TIMEOUT_MS}`] : []),
    '--reporter=verbose',
    '--reporter=json',
    '--outputFile.json=' + report,
  ];
}

// Every requested file must appear exactly once and contain only passed cases.
export function validateSuiteReport(files, result) {
  const expected = new Set(files.map((file) => resolve(file)));
  if (
    expected.size === 0 ||
    expected.size !== files.length ||
    result.success !== true ||
    !Array.isArray(result.testResults) ||
    result.testResults.length !== expected.size
  )
    throw Error('LOCAL required test file collection rejected');
  let passed = 0;
  const collected = new Set();
  for (const suite of result.testResults) {
    if (typeof suite.name !== 'string') throw Error('LOCAL test file name missing');
    const file = resolve(suite.name);
    if (!expected.has(file) || collected.has(file))
      throw Error('LOCAL missing/unexpected/duplicate test file');
    collected.add(file);
    if (
      suite.status !== 'passed' ||
      !Array.isArray(suite.assertionResults) ||
      suite.assertionResults.length === 0 ||
      suite.assertionResults.some((assertion) => assertion.status !== 'passed')
    )
      throw Error('LOCAL required test file has missing/skipped/failed cases');
    passed += suite.assertionResults.length;
  }
  return passed;
}

function runLocal() {
  const [phase, expectedHead] = process.argv.slice(2);
  if (
    !['pg', 'pg-second', 'nonpg', 'all'].includes(phase) ||
    !/^[0-9a-f]{40}$/.test(expectedHead ?? '')
  )
    throw Error(
      'Usage: node tests/zhiban/runtime/run-local.mjs pg|pg-second|nonpg|all EXPECTED_HEAD',
    );
  if (
    !process.version.startsWith('v22.') ||
    process.platform !== 'linux' ||
    process.arch !== 'x64' ||
    process.env.GITHUB_ACTIONS !== undefined ||
    process.env.GITHUB_SHA !== undefined
  )
    throw Error('LOCAL requires Node22/linux/x64 and no GitHub origin variables');
  if (
    execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== expectedHead ||
    execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim() !==
      'refactor/zhiban-v2'
  )
    throw Error('LOCAL baseline rejected');
  const lock = join(tmpdir(), 'zhiban-pg16-55432.lock');
  mkdirSync(lock, { mode: 0o700 }); // Exclusive run; a stale lock needs inspection, never automatic removal.
  const evidence = mkdtempSync(join(tmpdir(), 'zhiban-local-'));
  const summary = {
    executionMode: 'LOCAL',
    head: expectedHead,
    node: process.version,
    phase,
    pgTestTimeoutMs: LOCAL_PG16_TEST_TIMEOUT_MS,
    pgPasses: localPg16Passes(phase),
    evidence,
    results: [],
  };
  console.log(`LOCAL evidence: ${evidence}`);
  const env = {
    ...process.env,
    ZB_PG16_EXECUTION_MODE: 'LOCAL',
    ZB_PG16_EXPECTED_HEAD: expectedHead,
    ZB_PG16_DISPOSABLE: '1',
    ZB_PG16_REQUIRED: '1',
    ZB_PG16_ADMIN_URL:
      process.env.ZB_PG16_ADMIN_URL ?? 'postgresql://postgres@127.0.0.1:55432/zhiban_pg16_test',
    ZB_PG16_ROLE_PASSWORD: randomBytes(24).toString('hex'),
  };
  function run(name, program, args, environment = env) {
    const result = spawnSync(program, args, {
      env: environment,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    writeFileSync(join(evidence, name + '.log'), (result.stdout ?? '') + (result.stderr ?? ''), {
      mode: 0o600,
    });
    if (result.status !== 0) throw Error(`LOCAL ${name} failed; inspect its evidence log`);
  }
  function suite(name, files, environment = env, realPg = false) {
    const report = join(evidence, name + '.json');
    run(name, 'pnpm', localVitestArguments(files, report, realPg), environment);
    const result = JSON.parse(readFileSync(report, 'utf8'));
    const passed = validateSuiteReport(files, result);
    summary.results.push({ name, passed, skipped: 0 });
    console.log(`LOCAL ${name}: ${passed} PASS, 0 skipped`);
  }
  try {
    run('pnpm-version', 'pnpm', ['--version']);
    if (readFileSync(join(evidence, 'pnpm-version.log'), 'utf8').trim() !== '10.28.0')
      throw Error('pnpm version rejected');
    run('dsl-build', 'pnpm', ['--filter', '@openmaic/dsl', 'build']);
    run('storage-build', 'pnpm', ['--filter', '@openmaic/storage', 'build']);
    if (phase !== 'nonpg') {
      run('preflight', 'pnpm', [
        'exec',
        'tsx',
        '-e',
        "import {verifyPg16} from './tests/zhiban/identity/postgres/pg16-harness'; verifyPg16().then(v=>console.log('LOCAL PostgreSQL '+v)).catch(()=>{console.error('LOCAL connection/isolation rejected');process.exitCode=1})",
      ]);
      const suites = [
        'role-bootstrap',
        'migration-runner',
        'schema-security',
        'rls',
        'transactions',
        'repository-signoff',
        'credentials',
        'sessions',
        'authorization',
        'identity-composition',
        'membership-composition',
        'identity-http',
        'manual-recovery',
        'bridge',
        'runtime-foundation',
      ];
      for (const pass of localPg16Passes(phase)) {
        // Build and receipt are fresh for each complete pass; pass-one data are never reused.
        run(`pass${pass}-dsl-build`, 'pnpm', ['--filter', '@openmaic/dsl', 'build']);
        run(`pass${pass}-storage-build`, 'pnpm', ['--filter', '@openmaic/storage', 'build']);
        env.C9_PROVIDER_RECEIPT = join(evidence, `pass${pass}-provider.json`);
        run(`pass${pass}-receipt`, process.execPath, [
          'tests/zhiban/runtime/prepare-provider.mjs',
          '--receipt',
          env.C9_PROVIDER_RECEIPT,
        ]);
        for (const name of suites)
          suite(
            `pass${pass}-${name}`,
            [`tests/zhiban/identity/postgres/pg16-${name}.test.ts`],
            { ...env, C9_PG16_REQUIRED: name === 'runtime-foundation' ? '1' : undefined },
            true,
          );
      }
      run('cleanup-proof', 'pnpm', [
        'exec',
        'tsx',
        '-e',
        "import {adminClient,verifyPg16} from './tests/zhiban/identity/postgres/pg16-harness'; (async()=>{await verifyPg16();const c=adminClient();await c.connect();try{const r=await c.query(\"SELECT (SELECT count(*) FROM pg_namespace WHERE nspname IN ('zhiban_identity','zhiban_bridge','zhiban_runtime_contract_test'))+(SELECT count(*) FROM pg_roles WHERE rolname LIKE 'zhiban_%') AS n\");if(r.rows[0].n!=='0')throw Error();console.log('LOCAL cleanup verified')}finally{await c.end()}})().catch(()=>{console.error('LOCAL cleanup rejected');process.exitCode=1})",
      ]);
    }
    if (!['pg', 'pg-second'].includes(phase)) {
      const hermetic = { ...env };
      for (const key of [
        'ZB_PG16_ADMIN_URL',
        'ZB_PG16_REQUIRED',
        'ZB_PG16_ROLE_PASSWORD',
        'C9_PG16_REQUIRED',
        'C9_PROVIDER_RECEIPT',
      ])
        delete hermetic[key];
      const identity = readdirSync('tests/zhiban/identity', { recursive: true })
        .filter((p) => p.endsWith('.test.ts') && !p.split('/').at(-1).startsWith('pg16-'))
        .map((p) => 'tests/zhiban/identity/' + p);
      suite('identity-nonpg', identity, hermetic);
      const bridge = readdirSync('tests/zhiban/bridge')
        .filter(
          (p) => p.endsWith('.test.ts') && !['native-pg.test.ts', 'browser.test.ts'].includes(p),
        )
        .map((p) => 'tests/zhiban/bridge/' + p);
      suite('bridge-nonpg', bridge, hermetic);
      suite(
        'runtime-nonpg',
        [
          'contracts',
          'records',
          'protocol',
          'native-provider',
          'admission',
          'ai',
          'schema-acl',
        ].map((p) => `tests/zhiban/runtime/${p}.test.ts`),
        hermetic,
      );
      run('lint', 'pnpm', ['lint'], hermetic);
      run('typecheck', 'pnpm', ['exec', 'tsc', '--noEmit'], {
        ...hermetic,
        NODE_OPTIONS: '--max-old-space-size=8192',
      });
      run('format-check', 'pnpm', ['check'], hermetic);
    }
    run('diff-check', 'git', ['diff', '--check']);
    summary.status = 'PASS';
  } catch (error) {
    summary.status = 'FAIL';
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    writeFileSync(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2), {
      mode: 0o600,
    });
    rmSync(lock, { recursive: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runLocal();
