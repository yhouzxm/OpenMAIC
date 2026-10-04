// CI entry only. Provision exactly one NEW job database; never reset an existing database.
import pg from 'pg';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const name = 'zhiban_0b_capability_test';
const configurationError = () => {
  throw new Error('DIAGNOSTIC_CI_CONFIGURATION');
};
if (
  process.env.CI !== 'true' ||
  process.platform !== 'linux' ||
  process.versions.node.split('.')[0] !== '22'
)
  configurationError();
const provenance = JSON.parse(
  await readFile('tests/zhiban/openmaic/artifact-provenance.json', 'utf8'),
);
if (
  !provenance.freshBuild ||
  provenance.node !== process.version ||
  provenance.platform !== 'linux'
)
  configurationError();
let baseline;
try {
  baseline = new URL(process.env.PG_CONTRACT_URL || 'invalid');
} catch {
  configurationError();
}
if (
  baseline.protocol !== 'postgresql:' ||
  !['localhost', '127.0.0.1'].includes(baseline.hostname) ||
  baseline.pathname !== '/openmaic' ||
  baseline.search ||
  baseline.hash
)
  configurationError();
baseline.hostname = '127.0.0.1';
const diagnostic = new URL(baseline);
diagnostic.pathname = `/${name}`;
const pool = new pg.Pool({
  connectionString: baseline.href,
  max: 1,
  connectionTimeoutMillis: 5000,
  query_timeout: 5000,
});
let created = false;
let failed = false;
const deadline = Date.now() + 600_000;
async function run(args) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('DIAGNOSTIC_BUDGET_EXCEEDED');
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn('pnpm', args, {
      stdio: 'inherit',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CI: 'true',
        B0_PG16_URL: diagnostic.href,
        B0_PG16_REQUIRED: '1',
        B0_DISPOSABLE: '1',
        B0_FRESH_REQUIRED: '1',
      },
      detached: true,
    });
    // Kill the exact child process group on aggregate timeout (Linux CI only).
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* Already exited. */
      }
    }, remaining);
    child.once('error', () => {
      clearTimeout(timer);
      rejectRun(new Error('DIAGNOSTIC_CHILD_FAILED'));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolveRun();
      else rejectRun(new Error('DIAGNOSTIC_CHILD_FAILED'));
    });
  });
}
try {
  const version = (await pool.query("SELECT current_setting('server_version') AS version")).rows[0]
    .version;
  if (!version.startsWith('16.')) configurationError();
  if ((await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount !== 0)
    configurationError();
  await pool.query('CREATE DATABASE zhiban_0b_capability_test');
  created = true;
  process.stdout.write(
    `B0 ENVIRONMENT: PostgreSQL ${version}; ${process.version} linux/${process.arch}\n`,
  );
  for (const pass of [1, 2]) {
    process.stdout.write(`B0 DIAGNOSTIC RUN ${pass}\n`);
    await run([
      'exec',
      'vitest',
      'run',
      '--config',
      'tests/zhiban/openmaic/vitest.config.ts',
      '--reporter=default',
      '--reporter=json',
      `--outputFile.json=${resolve(`b0-run-${pass}.json`)}`,
    ]);
    const result = JSON.parse(await readFile(`b0-run-${pass}.json`, 'utf8'));
    // Explicit collection assertions prevent green jobs with missing/skipped diagnostic suites.
    const suites = [
      'boundary.test.ts',
      'host.test.ts',
      'egress.test.ts',
      'artifacts.test.ts',
      'pg16-diagnostic.test.ts',
    ];
    if (
      !result.success ||
      result.numPendingTests ||
      result.numFailedTests ||
      suites.some(
        (file) =>
          !result.testResults.some(
            (suite) =>
              suite.name.endsWith(file) &&
              suite.assertionResults.length &&
              suite.assertionResults.every((test) => test.status === 'passed'),
          ),
      )
    )
      throw new Error('DIAGNOSTIC_COLLECTION_FAILED');
    await run([
      'exec',
      'playwright',
      'test',
      '--config',
      'tests/zhiban/openmaic/playwright.config.ts',
    ]);
    const budgetPool = new pg.Pool({
      connectionString: diagnostic.href,
      max: 1,
      query_timeout: 5000,
    });
    try {
      const bytes = (
        await budgetPool.query(`SELECT
        COALESCE(SUM(octet_length(bytes)), 0)::text AS total,
        COALESCE(MAX(octet_length(bytes)), 0)::text AS largest FROM asset_blobs`)
      ).rows[0];
      if (BigInt(bytes.total) > 32n * 1024n * 1024n || BigInt(bytes.largest) > 4n * 1024n * 1024n) {
        throw new Error('DIAGNOSTIC_BYTES_BUDGET_EXCEEDED');
      }
    } finally {
      await budgetPool.end();
    }
    process.stdout.write(
      `B0 DIAGNOSTIC RUN ${pass} PASS: ${result.numPassedTests} unit/PG + 1 browser\n`,
    );
  }
} catch {
  failed = true;
  process.stderr.write('DIAGNOSTIC_CI_FAILED (no automatic rerun)\n');
} finally {
  try {
    // Only a database created by THIS invocation is disposable. No existing DB cleanup capability.
    if (created) await pool.query('DROP DATABASE zhiban_0b_capability_test WITH (FORCE)');
  } catch {
    failed = true;
    process.stderr.write('DIAGNOSTIC_DATABASE_CLEANUP_FAILED\n');
  }
  await pool.end();
}
if (failed) process.exitCode = 1;
