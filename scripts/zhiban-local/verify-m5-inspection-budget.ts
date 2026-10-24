import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { readFile, readdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { InspectionBudget } from './inspection-budget';
import {
  directory,
  database,
  pgPort,
  privateFile,
  digest,
  requirePrivateClusterDirectories,
} from './config';
import {
  readContentConfiguration,
  validateContentInstallation,
  implementationBindings,
} from './content-receipt';
const run = promisify(execFile);
const checks: string[] = [];
function pass(name: string) {
  checks.push(name);
  console.log('PASS ' + name);
}
async function synthetic() {
  const destroyed: boolean[] = [];
  let rawQueries = 0;
  const fake = {
    connect: async () => ({
      query: async () => {
        rawQueries++;
        return new Promise(() => {});
      },
      release: (discard: boolean) => destroyed.push(discard),
    }),
  } as unknown as Pool;
  const budget = new InspectionBudget(60),
    p = budget.pool(fake),
    c = await p.connect();
  await assert.rejects(() => c.query('SELECT 1'));
  assert.deepEqual(destroyed, [true]);
  await assert.rejects(() => c.query('SELECT 2'));
  c.release();
  assert.equal(rawQueries, 1);
  assert.equal(destroyed.length, 1);
  pass('Stalled query expires, destroys active connection once and blocks all later queries');
  let releaseLate!: (c: any) => void;
  const lateReleased: boolean[] = [];
  const lateBudget = new InspectionBudget(40);
  const connecting = lateBudget
    .pool({
      connect: () =>
        new Promise((resolve) => {
          releaseLate = resolve;
        }),
    } as unknown as Pool)
    .connect();
  await assert.rejects(() => connecting);
  releaseLate({ release: (discard: boolean) => lateReleased.push(discard) });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(lateReleased, [true]);
  pass('Late connection is discarded after acquisition budget expires');
  const releases: boolean[] = [];
  const okBudget = new InspectionBudget();
  const ok = await okBudget
    .pool({
      connect: async () => ({
        query: async () => ({ rows: [] }),
        release: (discard: boolean) => releases.push(discard),
      }),
    } as unknown as Pool)
    .connect();
  await ok.query('BEGIN READ ONLY');
  await ok.query('COMMIT');
  ok.release();
  okBudget.abort();
  assert.deepEqual(releases, [false]);
  pass('Successful connection is released normally without later double release');
  const aborted: boolean[] = [];
  const shared = new InspectionBudget();
  const fakeError = (fail: boolean) =>
    shared.pool({
      connect: async () => ({
        query: async () => {
          if (fail) throw new Error('Synthetic driver timeout');
          return { rows: [] };
        },
        release: (discard: boolean) => aborted.push(discard),
      }),
    } as unknown as Pool);
  const first = await fakeError(true).connect(),
    second = await fakeError(false).connect();
  await assert.rejects(() => first.query('SELECT 1'));
  await assert.rejects(() => second.query('SELECT 2'));
  assert.deepEqual(aborted, [true, true]);
  pass('Driver error closes all acquired peers and prevents post-error continuation');
}
async function main() {
  await synthetic();
  await requirePrivateClusterDirectories();
  const { config, receipt } = await readContentConfiguration();
  const rawBridge = new Pool({
    connectionString: config.bridge,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    lock_timeout: 1000,
    idle_in_transaction_session_timeout: 10000,
    query_timeout: 5500,
  });
  const rawNative = new Pool({
    connectionString: config.native,
    max: 1,
    connectionTimeoutMillis: 3000,
    statement_timeout: 5000,
    lock_timeout: 1000,
    idle_in_transaction_session_timeout: 10000,
    query_timeout: 5500,
  });
  const admin = new Pool({
    host: join(directory, 'socket'),
    port: pgPort,
    database,
    user: 'postgres',
    max: 2,
  });
  const peers = [rawBridge, rawNative, admin];
  try {
    const ep = (
      await admin.query(
        "SELECT current_setting('data_directory') AS dir,current_setting('server_version_num')::int AS pg,current_database() AS db",
      )
    ).rows[0];
    assert.equal(ep.dir, join(directory, 'pgdata'));
    assert.equal(ep.db, database);
    assert.ok(ep.pg >= 160000 && ep.pg < 170000);
    const state = async () => {
      const rows: Record<string, unknown> = {};
      for (const table of [
        'zhiban_content.resources',
        'zhiban_content.operations',
        'zhiban_content.publications',
        'zhiban_content.audit_events',
        'zhiban_bridge.resource_slots',
        'zhiban_bridge.resource_generations',
        'zhiban_bridge.operations',
        'zhiban_bridge.audit_events',
      ])
        rows[table] = (
          await admin.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)
        ).rows;
      return digest(JSON.stringify(rows));
    };
    const before = await state();
    const budget = new InspectionBudget(),
      bridge = budget.pool(rawBridge),
      native = budget.pool(rawNative);
    await budget.wait(() => validateContentInstallation(bridge, native, receipt, config));
    const defaults = (
      await rawBridge.query(
        "SELECT current_setting('statement_timeout') AS statement,current_setting('lock_timeout') AS lock,current_setting('idle_in_transaction_session_timeout') AS idle",
      )
    ).rows[0];
    assert.deepEqual(defaults, { statement: '5s', lock: '1s', idle: '10s' });
    pass(
      'PG16 startup statement/lock/idle timeouts apply before loader BEGIN; live receipt validates',
    );
    const fixture = JSON.parse((await privateFile('m5-last-fixture.json')).toString());
    const reports = async () =>
      (await readdir(directory))
        .filter((n) => n.startsWith('m5-inspection-') && n.endsWith('.json'))
        .sort();
    const args = [
      'list',
      '--tenant',
      fixture.tenant,
      '--offering',
      fixture.offering,
      '--limit',
      '1',
    ];
    const prior = await reports();
    const holder = await admin.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('LOCK TABLE zhiban_content.schema_migrations IN ACCESS EXCLUSIVE MODE');
      const started = performance.now();
      const result = await run(process.execPath, [join(directory, 'm5-inspector.mjs'), ...args], {
        timeout: 12000,
      }).then(
        () => null,
        (error) => error,
      );
      assert.ok(result);
      assert.equal(result.code, 1);
      assert.equal(result.stdout, '');
      assert.ok(performance.now() - started < 10000);
      assert.deepEqual(await reports(), prior);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
    pass(
      'Compiled CLI pre-validation real ledger lock times out and exits without issuing a report',
    );
    const postBudget = new InspectionBudget(),
      postBridge = postBudget.pool(rawBridge),
      postNative = postBudget.pool(rawNative);
    await postBudget.wait(() =>
      validateContentInstallation(postBridge, postNative, receipt, config),
    );
    const locked = await admin.connect();
    let issued = false;
    try {
      // Match CLI staging: initial validation, readonly data, final validation, then output.
      const c = await postBridge.connect();
      try {
        await c.query('BEGIN READ ONLY');
        await c.query('SELECT count(*) FROM zhiban_content.operations');
        await c.query('COMMIT');
      } finally {
        c.release();
      }
      await locked.query('BEGIN');
      await locked.query('LOCK TABLE zhiban_content.schema_migrations IN ACCESS EXCLUSIVE MODE');
      await assert.rejects(async () => {
        await postBudget.wait(() =>
          validateContentInstallation(postBridge, postNative, receipt, config),
        );
        issued = true;
      });
      assert.equal(issued, false);
      assert.equal(rawBridge.totalCount, 0);
      await assert.rejects(() => postBridge.connect());
    } finally {
      await locked.query('ROLLBACK');
      locked.release();
    }
    pass(
      'Final-validation real ledger lock destroys connection and prevents report phase or reacquisition',
    );
    const result = JSON.parse(
      (
        await run(process.execPath, [join(directory, 'm5-inspector.mjs'), ...args], {
          timeout: 15000,
        })
      ).stdout,
    );
    const envelope = JSON.parse(await readFile(result.output, 'utf8'));
    assert.equal(envelope.report.fenceAction, 'KEEP');
    assert.equal(envelope.report.settlementAllowed, false);
    assert.equal((await stat(result.output)).mode & 0o777, 0o600);
    pass('Compiled CLI succeeds after lock release with private KEEP-only report');
    assert.equal(await state(), before);
    pass(
      'All pre-existing content/Bridge resource, operation, publication and audit rows unchanged',
    );
    assert.equal(digest(JSON.stringify(await implementationBindings())), receipt.bindingHash);
    await writeFile(
      'docs/v2/evidence/m5-inspection-budget-fix-local.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          date: '2026-10-12',
          kind: 'M5_R1_R2_FIX_VERIFICATION',
          implementationBindingHash: receipt.bindingHash,
          candidateMigrationSha256: receipt.candidateMigrationSha256,
          verifierSha256: digest(
            await readFile('scripts/zhiban-local/verify-m5-inspection-budget.ts', 'utf8'),
          ),
          passed: checks.length,
          cases: checks,
          protectedStateSha256: before,
          newBusinessFixtures: 0,
          fenceAction: 'KEEP',
          terminalSettlementImplemented: false,
          scope: [
            'Synthetic lifecycle deadline/driver-error tests',
            'Actual PG16 ledger locks in pre-validation compiled CLI and post-validation staging',
            'Existing scoped list success; no historical 20-case/host rerun',
          ],
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`LOCAL R1/R2: ${checks.length}/${checks.length} PASS`);
  } finally {
    await Promise.allSettled(peers.map((p) => p.end()));
  }
}
void main().catch((error) => {
  console.error(
    'LOCAL budget verification failed:',
    error instanceof assert.AssertionError ? error.message : (error?.code ?? error?.name),
  );
  process.exitCode = 1;
});
