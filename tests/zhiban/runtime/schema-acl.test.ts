import { it, expect } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateSuiteReport, localVitestArguments, localPg16Passes } from './run-local.mjs';
const sql = readFileSync('tests/zhiban/runtime/schema.sql', 'utf8');
it('fixture inventory is outside 13 applied migrations; exact public and column capabilities', () => {
  expect(
    readdirSync('lib/zhiban/infrastructure/identity/postgres/migrations').filter((n) =>
      n.endsWith('.sql'),
    ),
  ).toHaveLength(13);
  expect(sql.match(/CREATE TABLE zhiban_runtime_contract_test\./g)).toHaveLength(6);
  expect(sql).toContain('FORCE ROW LEVEL SECURITY');
  expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
  expect(sql).toContain("WHERE state IN ('RESERVED','OUTCOME_UNKNOWN')");
  expect(sql).toContain(
    'runtime_parent_context(uuid,uuid,uuid,uuid,uuid) TO zhiban_bridge_runtime',
  );
  expect(sql).not.toMatch(/GRANT.*(?:UPDATE|INSERT).*resources.*TO zhiban_bridge_runtime/);
  const privileges = sql
    .split('\n')
    .filter((line) => line.startsWith('GRANT '))
    .map((line) => line.split(' ON ')[0]);
  expect(privileges.some((line) => /\b(ALL|DELETE|TRUNCATE)\b/.test(line))).toBe(false);
  expect(sql).not.toMatch(/FROM .*\bold\b|JOIN .*\bold\b/);
  expect(sql).not.toContain("'{}'::aclitem[]");
});
it('fixture SQL requires atomic audits and immutable operation history', () => {
  expect(sql).toContain("OLD.state='OUTCOME_UNKNOWN'");
  expect(sql).toContain('Runtime orphan binding rejected');
  expect(sql).toContain('Runtime audit rejected');
  expect(sql).toContain('Runtime audit immutable');
  expect(sql).toContain('9223372036854775805');
  expect(sql).toContain('event_type=(CASE WHEN');
  expect(sql).toContain('anchor.native_updated_at<>(CASE WHEN');
  expect(sql.match(/\) IS TRUE\)/g)).toHaveLength(3);
  expect(sql).toContain('result_last_seq IS NOT DISTINCT FROM (CASE WHEN');
  // A structural guard, not a PostgreSQL/PLpgSQL parser signoff.
  const structural = sql.replace(/'(?:''|[^'])*'/g, "''");
  let depth = 0;
  for (const ch of structural) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    expect(depth >= 0).toBe(true);
  }
  expect(depth).toBe(0);
});
it('workflow integration is additive, explicit and retains all signed-off loops/tooling', () => {
  const identity = readFileSync('.github/workflows/zhiban-identity-pg16-security.yml', 'utf8'),
    storage = readFileSync('.github/workflows/storage-pg-contract.yml', 'utf8');
  expect(
    identity.match(/C9_PG16_REQUIRED=1 C9_PROVIDER_RECEIPT=.*pg16-runtime-foundation\.test\.ts/g),
  ).toHaveLength(2);
  expect(
    storage.match(/C9_NATIVE_REQUIRED=1 pnpm exec vitest run.*native-pg\.test\.ts/g),
  ).toHaveLength(2);
  for (const suite of [
    'contracts',
    'records',
    'protocol',
    'native-provider',
    'admission',
    'ai',
    'schema-acl',
  ])
    expect(identity.includes(`tests/zhiban/runtime/${suite}.test.ts`)).toBe(true);
  for (const suite of ['pg16-bridge', 'pg16-sessions', 'pg16-credentials', 'pg16-manual-recovery'])
    expect(identity.includes(`${suite}.test.ts`)).toBe(true);
  for (const source of [identity, storage]) {
    expect(source.includes('for pass in 1 2')).toBe(true);
    expect(source.includes('postgres:16')).toBe(true);
    expect(source.includes('--frozen-lockfile')).toBe(true);
  }
});
it('provider receipt preserves provenance and hashes the ESM-resolved artifact', () => {
  const script = readFileSync('tests/zhiban/runtime/prepare-provider.mjs', 'utf8');
  expect(script).not.toMatch(/createRequire|require\.resolve/);
  for (const guard of [
    "executionMode === 'GITHUB_ACTIONS'",
    "process.env.GITHUB_ACTIONS === 'true'",
    'head === process.env.GITHUB_SHA',
    'head === process.env.ZB_PG16_EXPECTED_HEAD',
    'process.env.GITHUB_ACTIONS === undefined',
    'process.env.GITHUB_SHA === undefined',
    'candidatePatchDigest:',
    "!process.version.startsWith('v22.')",
    "process.platform !== 'linux'",
    "process.arch !== 'x64'",
    "RUNTIME_DSL_VERSION !== '0.1.0'",
    "typeof PgRuntimeStore !== 'function'",
    "['diff', '--exit-code', official, 'HEAD', '--', 'packages/@openmaic']",
    'sourceDigest: hash(source)',
    "lockDigest: hash(readFileSync('pnpm-lock.yaml'))",
    'artifactDigest: hash(readFileSync(artifact))',
  ])
    expect(script).toContain(guard);
});
it('real Node resolves the import-only provider and hashes the exact loaded artifact', () => {
  const script = readFileSync('tests/zhiban/runtime/prepare-provider.mjs', 'utf8'),
    declaration = script.match(/^const artifact = .*;$/m)?.[0];
  expect(declaration).toBeDefined();
  // Execute the receipt script's actual resolver, not Vitest's transformed import resolver.
  const result = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
${declaration}
const provider = await import(artifact.href);
let commonJsError;
try { createRequire(import.meta.url).resolve('@openmaic/storage/runtime/pg'); }
catch (error) { commonJsError = error.code; }
console.log(JSON.stringify({
  artifact: artifact.href,
  provider: typeof provider.PgRuntimeStore,
  digest: createHash('sha256').update(readFileSync(artifact)).digest('hex'),
  commonJsError,
}));`,
      ],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 10000 },
    ),
  );
  const expected = resolve('packages/@openmaic/storage/dist/runtime/pg.js');
  expect(result.artifact).toBe(pathToFileURL(expected).href);
  expect(result.provider).toBe('function');
  expect(result.digest).toBe(createHash('sha256').update(readFileSync(expected)).digest('hex'));
  expect(result.commonJsError).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
});
it('PG16 fixture uses ESM artifact resolution and retains its receipt hash comparison', () => {
  const fixture = readFileSync(
    'tests/zhiban/identity/postgres/pg16-runtime-foundation.test.ts',
    'utf8',
  );
  expect(fixture).not.toMatch(/createRequire|require\.resolve/);
  expect(fixture).toContain(
    "const artifact = new URL(import.meta.resolve('@openmaic/storage/runtime/pg'));",
  );
  expect(fixture).toContain('const bytes = await readFile(artifact);');
  expect(fixture).toContain(
    "expect(createHash('sha256').update(bytes).digest('hex')).toBe(proof.artifactDigest);",
  );
  // The PG16 hook runs under Vitest; verify that runner's import resolver too.
  const artifact = new URL(import.meta.resolve('@openmaic/storage/runtime/pg'));
  expect(artifact.href).toBe(
    pathToFileURL(resolve('packages/@openmaic/storage/dist/runtime/pg.js')).href,
  );
  expect(createHash('sha256').update(readFileSync(artifact)).digest('hex')).toBe(
    createHash('sha256')
      .update(readFileSync('packages/@openmaic/storage/dist/runtime/pg.js'))
      .digest('hex'),
  );
});

it('LOCAL receipts reject mixed origin and tampered evidence without GitHub impersonation', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'c9-local-receipt-'));
  const path = resolve(directory, 'receipt.json');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ZB_PG16_EXECUTION_MODE: 'LOCAL',
    ZB_PG16_EXPECTED_HEAD: head,
  };
  delete env.GITHUB_ACTIONS;
  delete env.GITHUB_SHA;
  const run = (mode: string, environment = env) =>
    execFileSync(process.execPath, ['tests/zhiban/runtime/prepare-provider.mjs', mode, path], {
      env: environment,
      stdio: 'pipe',
    });
  try {
    run('--receipt');
    const proof = JSON.parse(readFileSync(path, 'utf8'));
    expect(proof.executionMode).toBe('LOCAL');
    expect(proof.head).toBe(head);
    run('--verify');
    for (const field of [
      'executionMode',
      'head',
      'node',
      'sourceDigest',
      'lockDigest',
      'artifactDigest',
      'candidatePatchDigest',
    ]) {
      writeFileSync(path, JSON.stringify({ ...proof, [field]: 'tampered' }));
      expect(() => run('--verify')).toThrow();
    }
    writeFileSync(path, JSON.stringify(proof));
    expect(() => run('--receipt', { ...env, GITHUB_ACTIONS: 'true' })).toThrow();
    expect(() => run('--receipt', { ...env, GITHUB_SHA: head })).toThrow();
    expect(() => run('--receipt', { ...env, ZB_PG16_EXPECTED_HEAD: 'wrong' })).toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 15000);

const localRequiredFiles = [
  'tests/zhiban/runtime/contracts.test.ts',
  'tests/zhiban/runtime/records.test.ts',
];
it('LOCAL real-PG timing budget retains serial execution and never changes hermetic/hook/retry policy', () => {
  const real = localVitestArguments(localRequiredFiles, '/tmp/real-report.json', true);
  const hermetic = localVitestArguments(localRequiredFiles, '/tmp/hermetic-report.json');
  expect(real.filter((a) => a.startsWith('--testTimeout='))).toEqual(['--testTimeout=15000']);
  expect(hermetic.some((a) => a.startsWith('--testTimeout='))).toBe(false);
  for (const args of [real, hermetic]) {
    expect(args).toContain('--maxWorkers=1');
    expect(args).toContain('--no-file-parallelism');
    expect(args.some((a) => /hookTimeout|retry/.test(a))).toBe(false);
  }
});
it('LOCAL explicit second pass runs only pass 2 while ordinary PG/full retain both passes', () => {
  expect(localPg16Passes('pg-second')).toEqual([2]);
  expect(localPg16Passes('pg')).toEqual([1, 2]);
  expect(localPg16Passes('all')).toEqual([1, 2]);
  expect(localPg16Passes('nonpg')).toEqual([]);
  expect(() => localPg16Passes('unknown')).toThrow();
});
const localReport = () => ({
  success: true,
  testResults: localRequiredFiles.map((name) => ({
    name: resolve(name),
    status: 'passed',
    assertionResults: [{ status: 'passed' }],
  })),
});
it('LOCAL collection accepts every requested file exactly once regardless of report order', () => {
  const result = localReport();
  result.testResults.reverse();
  expect(validateSuiteReport(localRequiredFiles, result)).toBe(2);
  expect(() => validateSuiteReport([], { success: true, testResults: [] })).toThrow();
  expect(() =>
    validateSuiteReport([...localRequiredFiles, localRequiredFiles[0]], result),
  ).toThrow();
});
it.each([
  'missing',
  'unexpected',
  'duplicate',
  'empty',
  'skipped',
  'pending',
  'todo',
  'failed',
  'failed-suite',
  'unsuccessful',
])('LOCAL collection rejects %s evidence', (scenario) => {
  const result = localReport();
  const file = result.testResults[1];
  switch (scenario) {
    case 'missing':
      result.testResults.pop();
      break;
    case 'unexpected':
      file.name = resolve('tests/zhiban/runtime/unrequested.test.ts');
      break;
    case 'duplicate':
      file.name = result.testResults[0].name;
      break;
    case 'empty':
      file.assertionResults = [];
      break;
    case 'failed-suite':
      file.status = 'failed';
      break;
    case 'unsuccessful':
      result.success = false;
      break;
    default:
      file.assertionResults[0].status = scenario;
  }
  expect(() => validateSuiteReport(localRequiredFiles, result)).toThrow();
});
it('LOCAL collection rejects a genuinely omitted Vitest file even when Vitest exits successfully', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'c9-local-collection-'));
  const path = resolve(directory, 'report.json');
  const requested = [localRequiredFiles[0], resolve(directory, 'missing-required.test.ts')];
  try {
    execFileSync(
      process.execPath,
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        ...requested,
        '--maxWorkers=1',
        '--no-file-parallelism',
        '--reporter=json',
        '--outputFile=' + path,
      ],
      { stdio: 'pipe', timeout: 30000 },
    );
    const result = JSON.parse(readFileSync(path, 'utf8'));
    expect(result.success).toBe(true);
    expect(validateSuiteReport([requested[0]], result)).toBeGreaterThan(0);
    expect(() => validateSuiteReport(requested, result)).toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}, 35000);
