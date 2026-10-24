#!/usr/bin/env node
// LOCAL disposable PG16 only. No real configuration/credentials are read.
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path');
const crypto = require('node:crypto'),
  assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { bootstrap } = require('./verify-local-pg16.cjs');
const terminal = require('./terminal-installation.cjs');
const executor = require('./maintenance-executor.cjs');
const io = require('./maintenance-hba.cjs'),
  lock = require('./maintenance-lock.cjs');
const checks = [];
const id = (n) => `0199aabb-ccdd-7000-8000-${String(n).padStart(12, '0')}`;
const deployment = id(1),
  provenance = 'a'.repeat(64),
  bin = '/usr/lib/postgresql/16/bin';
async function test(name, f) {
  await f();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
}
async function main() {
  const s = { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-maintenance-')), port: 56493 };
  fs.chmodSync(s.dir, 0o700);
  let admin,
    current,
    ctx,
    expectedPath,
    counter = 0;
  const adminPassword = io.secret(),
    old = Object.fromEntries([...io.WRITERS, ...io.MAINTENANCE].map((r) => [r, io.secret()]));
  const pair = crypto.generateKeyPairSync('ed25519');
  const put = (n, v) => {
    const file = path.join(s.dir, n);
    lock.writeExclusive(file, typeof v === 'string' ? v : JSON.stringify(v));
    return file;
  };
  const trustPinPath = put('public.pem', pair.publicKey.export({ type: 'spki', format: 'pem' }));
  const key = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    pin = terminal.publicPin(trustPinPath);
  const endpoint = () => ({ host: s.socket, port: s.port });
  async function context(mode, window, oldWindow = null, request = null, overrides = {}) {
    const oldCredentialsPath = put(`old-${++counter}.json`, old);
    const target = {
      ...(await executor.facts(admin)),
      hbaSha256: terminal.sha(terminal.readPrivate(path.join(s.data, 'pg_hba.conf'))),
    };
    const p = {
      purpose: 'LOCAL_MAINTENANCE_CONTROL',
      formatVersion: 1,
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      authorityKeySha256: pin.digest,
      candidateInventorySha256: terminal.sources().inventorySha256,
      approvalRef: 'DISPOSABLE_FIXTURE_ONLY',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 290000,
      mode,
      deploymentId: deployment,
      serviceRef: 'fixture-service',
      windowId: window,
      oldWindowId: oldWindow,
      takeoverRequestId: request,
      target,
      installation: {
        migration_digest: terminal.sources().migrationSha256,
        implementation_digest: provenance,
        receipt_digest: provenance,
        acl_digest: provenance,
        storage_digest: provenance,
      },
      restoreLoginRoles: ['zhiban_runtime', 'zhiban_openmaic_runtime'],
      oldCredentialsSha256: terminal.sha(terminal.readPrivate(oldCredentialsPath)),
      expectedArtifactSha256: terminal.sha(terminal.readPrivate(expectedPath)),
      ...overrides,
    };
    return {
      admin,
      adminPassword,
      expectedPath,
      directory: s.dir,
      oldCredentialsPath,
      trustPinPath,
      approvalPath: put(`approval-${counter}.json`, terminal.signed(p, key, pin)),
      journalPath: path.join(s.dir, `journal-${counter}.jsonl`),
      credentialsPath: path.join(s.dir, `new-${counter}.json`),
    };
  }
  function fixtureHandoffReset() {
    assert(fs.existsSync(path.join(s.dir, 'maintenance.json')));
    const reset = lock.acquire(s.dir, 'maintenance', true);
    reset.clearAfterClosed();
    reset.release();
  }
  async function business() {
    // Tests explicitly open an administrator-only inspection channel after executor
    // finishes/blocks; not an executor continuation or production bypass.
    await io.replaceHba(admin, path.join(s.data, 'pg_hba.conf'), io.hba([], true));
    await admin.query(`ALTER DATABASE ${io.BUSINESS} ALLOW_CONNECTIONS true`);
    return io.connect(endpoint(), io.BUSINESS, 'postgres', adminPassword);
  }
  try {
    await bootstrap(s);
    admin = await io.connect(endpoint(), 'postgres', 'postgres', adminPassword);
    await admin.query(`ALTER ROLE postgres PASSWORD '${io.verifier(adminPassword)}'`);
    for (const r of [...io.WRITERS, ...io.MAINTENANCE])
      await admin.query(`ALTER ROLE ${r} PASSWORD '${io.verifier(old[r])}'`);
    for (const r of ['zhiban_runtime', 'zhiban_openmaic_runtime']) {
      await admin.query(`ALTER ROLE ${r} LOGIN`);
      await admin.query(`GRANT CONNECT ON DATABASE ${io.dbFor(r)} TO ${r}`);
    }
    const b = await io.connect(endpoint(), io.BUSINESS, 'postgres', adminPassword),
      facts = await executor.facts(admin);
    // Synthetic ready authorization fixture, never an actual enabled receipt.
    await b.query('BEGIN');
    await b.query("SET LOCAL session_replication_role='replica'");
    await b.query(
      `INSERT INTO zhiban_bridge.deployment_registry VALUES($1,'fixture',$2,'0.31.1','0.11.2','0.1.11',$3,'VERIFIED',1,0,0)`,
      [deployment, 'd'.repeat(40), provenance],
    );
    await b.query(
      `INSERT INTO zhiban_reconcile.installations VALUES($1,'terminal-reconciliation-local-v1',$2,$3,$4,$5,$6,$6,$6,$6,true)`,
      [
        deployment,
        facts.cluster,
        facts.businessOid,
        facts.nativeOid,
        terminal.sources().migrationSha256,
        provenance,
      ],
    );
    await b.query(
      `INSERT INTO zhiban_reconcile.services VALUES('fixture-service',$1,'RECONCILE',1,'ACTIVE','zhiban_reconcile_executor')`,
      [deployment],
    );
    await b.query(
      `INSERT INTO zhiban_reconcile.service_versions VALUES('fixture-service',1,'ACTIVE',$1,0)`,
      [provenance],
    );
    await b.query(`INSERT INTO zhiban_reconcile.epoch_counters VALUES($1,0)`, [deployment]);
    await b.query(
      `INSERT INTO zhiban_reconcile.window_database_claims VALUES($1,$2,NULL),($1,$3,NULL)`,
      [facts.cluster, facts.businessOid, facts.nativeOid],
    );
    await b.query('COMMIT');
    const n = await io.connect(endpoint(), io.NATIVE, 'postgres', adminPassword);
    const after = await terminal.collectAfter(b, n);
    expectedPath = put(
      'expected.json',
      terminal.signed(
        {
          purpose: 'REVIEWED_TERMINAL_EXPECTED_PROFILE',
          formatVersion: 1,
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          authorityKeySha256: pin.digest,
          profile: 'terminal-reconciliation-local-v1',
          candidateInventorySha256: terminal.sources().inventorySha256,
          candidateMigrationSha256: terminal.sources().migrationSha256,
          review: {
            approvalRef: 'DISPOSABLE_FIXTURE_ONLY_NOT_INDEPENDENT_SIGNOFF',
            sourceKind: 'INDEPENDENT_SHADOW_PG16',
            referenceEvidenceSha256: terminal.sha(terminal.canonical(after)),
          },
          before: s.before,
          after,
        },
        key,
        pin,
      ),
    );
    await n.end();
    await b.end();
    await test('shared launcher excludes exclusive maintenance and concurrent launch is allowed', async () => {
      const a = lock.acquire(s.dir, 'launcher'),
        b = lock.acquire(s.dir, 'launcher');
      assert.throws(() => lock.acquire(s.dir, 'maintenance'));
      a.release();
      b.release();
    });
    await test('exclusive lock excludes another process and flag survives owner exit', async () => {
      const a = lock.acquire(s.dir, 'maintenance');
      assert.throws(() =>
        execFileSync(
          process.execPath,
          [
            '-e',
            `require(${JSON.stringify(path.join(__dirname, 'maintenance-lock.cjs'))}).acquire(${JSON.stringify(s.dir)},'launcher')`,
          ],
          { stdio: 'ignore' },
        ),
      );
      a.release();
      assert.throws(() => lock.acquire(s.dir, 'launcher'));
      const recovery = lock.acquire(s.dir, 'maintenance', true);
      recovery.clearAfterClosed();
      recovery.release();
    });
    await test('host inherits shared lock after launcher parent releases its descriptor', async () => {
      const parent = lock.acquire(s.dir, 'launcher');
      const child = spawn(
        process.execPath,
        ['-e', 'console.log("READY");setInterval(()=>{},1000)'],
        { stdio: ['ignore', 'pipe', 'ignore', parent.fd] },
      );
      try {
        await new Promise((resolve, reject) => {
          child.stdout.once('data', resolve);
          child.once('error', reject);
        });
        parent.release();
        assert.throws(() => lock.acquire(s.dir, 'maintenance'));
      } finally {
        const ended = new Promise((r) => child.once('exit', r));
        child.kill('SIGKILL');
        await ended;
        parent.release();
      }
      const probe = lock.acquire(s.dir, 'launcher');
      probe.release();
    });
    await test('unsafe parameter logging rejects before maintenance flag or admission mutation', async () => {
      const c = await context('normal', id(2));
      await admin.query('SET log_parameter_max_length=-1');
      try {
        await assert.rejects(() => executor.start(c), /logging profile/);
      } finally {
        await admin.query('SET log_parameter_max_length=0');
      }
      assert.equal(fs.existsSync(path.join(s.dir, 'maintenance.json')), false);
    });
    await test('tampered signed approval rejects before admission/HBA changes', async () => {
      const c = await context('normal', id(2));
      const a = JSON.parse(terminal.readPrivate(c.approvalPath));
      a.payload.windowId = id(99);
      fs.writeFileSync(c.approvalPath, JSON.stringify(a));
      await assert.rejects(() => executor.start(c), /Signed authority rejected/);
      assert.equal(
        (
          await admin.query(
            "SELECT bool_and(datallowconn) ok FROM pg_database WHERE datname IN('zhiban_m1_dev','zhiban_m5_native')",
          )
        ).rows[0].ok,
        true,
      );
    });
    // Late idle transaction must actually disappear before DRAINED.
    const late = await io.connect(
      endpoint(),
      io.NATIVE,
      'zhiban_openmaic_runtime',
      old.zhiban_openmaic_runtime,
    );
    await late.query('BEGIN');
    late.on('error', () => {});
    await test('normal executor rotates credentials, drains idle Native backend, holds exact four sessions', async () => {
      ctx = await context('normal', id(2));
      current = await executor.start(ctx);
      assert.equal(current.status().status, 'DRAINED');
      assert.equal(
        (
          await admin.query('SELECT count(*)::int n FROM pg_stat_activity WHERE pid=$1', [
            late.processID,
          ])
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM pg_stat_activity WHERE datname IN('zhiban_m1_dev','zhiban_m5_native')",
          )
        ).rows[0].n,
        4,
      );
      assert.throws(() => lock.acquire(s.dir, 'launcher'));
    });
    await test('renew checks actual barrier with current physical sessions', async () => {
      await current.renew();
    });
    await test('normal resume commits RESUMING before opening, clears claims only at CLOSED', async () => {
      const result = await current.resume();
      assert.equal(result.status, 'CLOSED');
      current = null;
      const events = terminal
        .readPrivate(ctx.journalPath)
        .toString()
        .trim()
        .split('\n')
        .map(JSON.parse);
      const begin = events.findIndex(
        (e) => e.stage === 'begin-resume-commit' && e.status === 'CONFIRMED',
      );
      assert(
        begin >= 0 &&
          events.findIndex(
            (e, i) =>
              i > begin && e.stage === 'admission:zhiban_m1_dev:true' && e.status === 'INTENT',
          ) > begin,
      );
      assert.equal(fs.existsSync(path.join(s.dir, 'maintenance.json')), true);
      assert.equal(result.credentialDeliveryReady, false);
      assert.throws(() => lock.acquire(s.dir, 'launcher'));
      fixtureHandoffReset();
      const c = await business();
      assert.equal(
        (await c.query('SELECT phase FROM zhiban_reconcile.windows WHERE window_id=$1', [id(2)]))
          .rows[0].phase,
        'CLOSED',
      );
      assert.equal(
        (
          await c.query(
            'SELECT count(*)::int n FROM zhiban_reconcile.window_database_claims WHERE current_window_id IS NOT NULL',
          )
        ).rows[0].n,
        0,
      );
      await c.end();
    });
    await test('normal window can restart with higher epoch and block without restoring admission', async () => {
      // Fresh authorization and fresh credential inventory are mandatory.
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('normal', id(3));
      current = await executor.start(ctx);
      await current.block();
      current = null;
      assert.equal(
        (
          await admin.query(
            "SELECT bool_or(datallowconn) ok FROM pg_database WHERE datname IN('zhiban_m1_dev','zhiban_m5_native')",
          )
        ).rows[0].ok,
        false,
      );
    });
    await test('takeover drains old maintenance and hands both claims to higher epoch; old credentials denied', async () => {
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('takeover', id(4), id(3), id(40));
      current = await executor.start(ctx);
      assert.equal(current.status().status, 'DRAINED');
      await current.resume();
      fixtureHandoffReset();
      current = null;
      const c = await business();
      const rows = (
        await c.query(
          'SELECT window_id,epoch::text,phase,successor_id FROM zhiban_reconcile.windows ORDER BY epoch',
        )
      ).rows;
      assert.equal(rows[1].phase, 'SUPERSEDED');
      assert.equal(rows[1].successor_id, id(4));
      assert.equal(rows[2].epoch, '3');
      assert.equal(rows[2].phase, 'CLOSED');
      await c.end();
    });
    await test('SIGKILL of real controller process leaves durable launcher block and closed databases', async () => {
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('normal', id(5));
      const { admin: ignored, ...serial } = ctx;
      const workerFile = put('worker.json', { ...serial, endpoint: endpoint() });
      const worker = spawn(process.execPath, [__filename, '--worker', workerFile], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(Error('Worker deadline')), 45000);
          worker.stdout.on('data', (chunk) => {
            if (chunk.toString().includes('DRAINED')) {
              clearTimeout(timeout);
              resolve();
            }
          });
          worker.once('exit', () => {
            clearTimeout(timeout);
            reject(Error('Worker exited early'));
          });
        });
        const ended = new Promise((resolve) => worker.once('exit', resolve));
        worker.kill('SIGKILL');
        await ended;
        assert.throws(() => lock.acquire(s.dir, 'launcher'));
        assert.equal(
          (
            await admin.query(
              "SELECT bool_or(datallowconn) ok FROM pg_database WHERE datname IN('zhiban_m1_dev','zhiban_m5_native')",
            )
          ).rows[0].ok,
          false,
        );
      } finally {
        worker.kill('SIGKILL');
      }
    });
    await test('takeover COMMIT acknowledgement loss preserves committed successor and blocks', async () => {
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('takeover', id(6), id(5), id(60));
      // Driver result-loss seam AFTER actual server COMMIT (not a network test).
      const { Client } = require('pg');
      const original = Client.prototype.query;
      let pending = false,
        injected = false;
      Client.prototype.query = async function (sql, args) {
        const r = await original.call(this, sql, args);
        if (
          typeof sql === 'string' &&
          sql.includes('SELECT zhiban_reconcile.takeover_blocked_window')
        )
          pending = true;
        else if (pending && sql === 'COMMIT') {
          pending = false;
          injected = true;
          throw Error('Fixture lost COMMIT reply');
        }
        return r;
      };
      try {
        await assert.rejects(() => executor.start(ctx), /BLOCKED/);
      } finally {
        Client.prototype.query = original;
      }
      assert(injected);
      assert(fs.existsSync(path.join(s.dir, 'maintenance.json')));
    });
    await test('same committed takeover pair is ACK-only and never creates another successor', async () => {
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('takeover', id(6), id(5), id(60));
      await assert.rejects(() => executor.start(ctx), /BLOCKED/);
      const log = terminal.readPrivate(ctx.journalPath).toString();
      assert(log.includes('COMMITTED'));
      assert(!log.includes('takeover-commit'));
    });
    await test('fresh request takes over lost successor at higher epoch and normal resume works', async () => {
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('takeover', id(7), id(6), id(70));
      current = await executor.start(ctx);
      await current.resume();
      fixtureHandoffReset();
      current = null;
    });
    await test('full catalog drift rejects normal resume and keeps both admissions closed', async () => {
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('normal', id(8));
      current = await executor.start(ctx);
      await admin.query('GRANT CONNECT ON DATABASE zhiban_m5_native TO zhiban_reconcile_executor');
      await assert.rejects(() => current.resume(), /BLOCKED/);
      current = null;
      assert.equal(
        (
          await admin.query(
            "SELECT bool_or(datallowconn) ok FROM pg_database WHERE datname IN('zhiban_m1_dev','zhiban_m5_native')",
          )
        ).rows[0].ok,
        false,
      );
      await admin.query(
        'REVOKE CONNECT ON DATABASE zhiban_m5_native FROM zhiban_reconcile_executor',
      );
    });
    await test('HBA tampering is detected on renewal and does not release startup flag', async () => {
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('takeover', id(9), id(8), id(90));
      current = await executor.start(ctx);
      fs.appendFileSync(path.join(s.data, 'pg_hba.conf'), '# drift\n');
      await assert.rejects(() => current.renew(), /BLOCKED/);
      current = null;
      assert.throws(() => lock.acquire(s.dir, 'launcher'));
    });
    await test('partial normal restore failure preserves RESUMING, closes gates and disables writers', async () => {
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('takeover', id(10), id(9), id(100));
      current = await executor.start(ctx);
      const original = admin.query.bind(admin);
      let injected = false;
      admin.query = async (sql, args) => {
        if (sql === 'ALTER DATABASE zhiban_m5_native ALLOW_CONNECTIONS true') {
          injected = true;
          throw Error('Fixture second admission failure');
        }
        return original(sql, args);
      };
      try {
        await assert.rejects(() => current.resume(), /BLOCKED/);
      } finally {
        admin.query = original;
        current = null;
      }
      assert(injected);
      assert.equal(
        (
          await admin.query(
            'SELECT count(*)::int n FROM pg_roles WHERE rolcanlogin AND rolname=ANY($1::text[])',
            [[...io.WRITERS, ...io.MAINTENANCE]],
          )
        ).rows[0].n,
        0,
      );
      const events = terminal
        .readPrivate(ctx.journalPath)
        .toString()
        .trim()
        .split('\n')
        .map(JSON.parse);
      assert(events.some((e) => e.stage === 'begin-resume-commit' && e.status === 'CONFIRMED'));
      assert(!events.some((e) => e.stage === 'complete-resume-commit'));
      assert(events.at(-1).admissions.every((d) => !d.datallowconn));
    });
    await test('credential staging failure occurs before any password ALTER', async () => {
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      const failed = await context('takeover', id(11), id(10), id(110));
      lock.writeExclusive(failed.credentialsPath, 'existing-output-must-not-be-overwritten');
      const before = (
        await admin.query(
          'SELECT rolname,rolpassword FROM pg_authid WHERE rolname=ANY($1::text[]) ORDER BY rolname',
          [[...io.WRITERS, ...io.MAINTENANCE]],
        )
      ).rows;
      await assert.rejects(() => executor.start(failed), /BLOCKED/);
      const after = (
        await admin.query(
          'SELECT rolname,rolpassword FROM pg_authid WHERE rolname=ANY($1::text[]) ORDER BY rolname',
          [[...io.WRITERS, ...io.MAINTENANCE]],
        )
      ).rows;
      assert.deepEqual(after, before);
    });
    await test('Business helper drift rejects before fresh controller authority is seeded', async () => {
      const c = await business();
      await c.query(
        "ALTER FUNCTION zhiban_reconcile.open_window(uuid,text,uuid,text,text) SET statement_timeout='4s'",
      );
      await c.end();
      ctx = await context('takeover', id(11), id(10), id(111));
      await assert.rejects(() => executor.start(ctx), /BLOCKED/);
      assert(!terminal.readPrivate(ctx.journalPath).toString().includes('bind-fresh-controller'));
      const b = await business();
      await b.query(
        'ALTER FUNCTION zhiban_reconcile.open_window(uuid,text,uuid,text,text) RESET statement_timeout',
      );
      await b.end();
    });
    await test('lost CLOSED COMMIT ACK keeps flag and isolation despite committed CLOSED', async () => {
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('takeover', id(11), id(10), id(112));
      current = await executor.start(ctx);
      const { Client } = require('pg');
      const original = Client.prototype.query;
      let pending = false,
        injected = false;
      Client.prototype.query = async function (sql, args) {
        const r = await original.call(this, sql, args);
        if (typeof sql === 'string' && sql.includes('SELECT zhiban_reconcile.complete_resume'))
          pending = true;
        else if (pending && sql === 'COMMIT') {
          pending = false;
          injected = true;
          throw Error('Fixture lost CLOSED COMMIT reply');
        }
        return r;
      };
      try {
        await assert.rejects(() => current.resume(), /BLOCKED/);
      } finally {
        Client.prototype.query = original;
        current = null;
      }
      assert(injected);
      assert.throws(() => lock.acquire(s.dir, 'launcher'));
    });
    let closedJournal, closedEpoch;
    await test('fresh closed-ack bootstrap observes exact CLOSED without replay or flag release', async () => {
      closedJournal = ctx.journalPath;
      const b = await business();
      closedEpoch = (
        await b.query('SELECT epoch::text FROM zhiban_reconcile.windows WHERE window_id=$1', [
          id(11),
        ])
      ).rows[0].epoch;
      await b.end();
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('closed-ack', id(11), null, null, {
        ackRequestId: id(201),
        expectedWindowEpoch: closedEpoch,
        resumeJournalSha256: terminal.sha(terminal.readPrivate(closedJournal)),
        restoreLoginRoles: [],
      });
      ctx.resumeJournalPath = closedJournal;
      const result = await executor.start(ctx);
      assert.equal(result.status, 'CLOSED_ACK_OBSERVED');
      assert.equal(result.ack.status, 'COMMITTED_CLOSED');
      assert.equal(result.ack.restoreAllowed, false);
      assert.equal(result.ack.clearMaintenanceFlagAllowed, false);
      assert.equal(result.ack.currentWindowId, null);
      assert.throws(() => lock.acquire(s.dir, 'launcher'));
      const journal = terminal.readPrivate(ctx.journalPath).toString();
      assert(!journal.includes('takeover-commit'));
      assert(!journal.includes('open-window'));
      assert(!journal.includes('complete-resume-commit'));
      assert.equal(
        (
          await admin.query(
            "SELECT bool_or(datallowconn) ok FROM pg_database WHERE datname IN('zhiban_m1_dev','zhiban_m5_native')",
          )
        ).rows[0].ok,
        false,
      );
    });
    await test('wrong CLOSED epoch rejects without granting restore authority', async () => {
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('closed-ack', id(11), null, null, {
        ackRequestId: id(202),
        expectedWindowEpoch: String(BigInt(closedEpoch) + 1n),
        resumeJournalSha256: terminal.sha(terminal.readPrivate(closedJournal)),
        restoreLoginRoles: [],
      });
      ctx.resumeJournalPath = closedJournal;
      await assert.rejects(() => executor.start(ctx), /BLOCKED/);
      assert.throws(() => lock.acquire(s.dir, 'launcher'));
    });
    await test('wrong resume journal binding rejects before credential rotation', async () => {
      const c = await context('closed-ack', id(11), null, null, {
        ackRequestId: id(203),
        expectedWindowEpoch: closedEpoch,
        resumeJournalSha256: '0'.repeat(64),
        restoreLoginRoles: [],
      });
      c.resumeJournalPath = closedJournal;
      await assert.rejects(() => executor.start(c), /resume journal/);
      assert(!fs.existsSync(c.credentialsPath));
    });
    await test('CLOSED helper execute ACL excludes runtime, issuer, executor and PUBLIC', async () => {
      for (const role of [
        'zhiban_runtime',
        'zhiban_reconcile_issuer',
        'zhiban_reconcile_executor',
      ]) {
        const c = await business();
        assert.equal(
          (
            await c.query(
              "SELECT has_function_privilege($1,'zhiban_reconcile.read_closed_result(uuid,uuid,bigint,text)','EXECUTE') allowed",
              [role],
            )
          ).rows[0].allowed,
          false,
        );
        await c.end();
      }
      const c = await business();
      assert.equal(
        (
          await c.query(
            "SELECT count(*)::int n FROM pg_proc p,LATERAL aclexplode(p.proacl) a WHERE p.oid='zhiban_reconcile.read_closed_result(uuid,uuid,bigint,text)'::regprocedure AND a.grantee=0",
          )
        ).rows[0].n,
        0,
      );
      await c.end();
    });
    await test('historical CLOSED ACK does not clear a later active window claim', async () => {
      // Fixture-only handoff reset permits an independent next normal scenario.
      fixtureHandoffReset();
      await admin.query('ALTER DATABASE zhiban_m5_native ALLOW_CONNECTIONS true');
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('normal', id(12));
      current = await executor.start(ctx);
      await current.block();
      current = null;
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('closed-ack', id(11), null, null, {
        ackRequestId: id(204),
        expectedWindowEpoch: closedEpoch,
        resumeJournalSha256: terminal.sha(terminal.readPrivate(closedJournal)),
        restoreLoginRoles: [],
      });
      ctx.resumeJournalPath = closedJournal;
      const result = await executor.start(ctx);
      assert.equal(result.ack.status, 'COMMITTED_CLOSED');
      assert.equal(result.ack.currentWindowId, id(12));
      assert.throws(() => lock.acquire(s.dir, 'launcher'));
    });
    await test('NOT_CLOSED after failed complete_resume never authorizes write replay', async () => {
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('takeover', id(13), id(12), id(130));
      current = await executor.start(ctx);
      const { Client } = require('pg');
      const original = Client.prototype.query;
      let injected = false;
      Client.prototype.query = async function (sql, args) {
        if (typeof sql === 'string' && sql.includes('SELECT zhiban_reconcile.complete_resume')) {
          injected = true;
          throw Error('Fixture failure before complete_resume');
        }
        return original.call(this, sql, args);
      };
      try {
        await assert.rejects(() => current.resume(), /BLOCKED/);
      } finally {
        Client.prototype.query = original;
        current = null;
      }
      assert(injected);
      const journal = ctx.journalPath;
      const c = await business();
      const epoch = (
        await c.query('SELECT epoch::text FROM zhiban_reconcile.windows WHERE window_id=$1', [
          id(13),
        ])
      ).rows[0].epoch;
      await c.end();
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('closed-ack', id(13), null, null, {
        ackRequestId: id(205),
        expectedWindowEpoch: epoch,
        resumeJournalSha256: terminal.sha(terminal.readPrivate(journal)),
        restoreLoginRoles: [],
      });
      ctx.resumeJournalPath = journal;
      const result = await executor.start(ctx);
      assert.equal(result.ack.status, 'NOT_CLOSED');
      assert.equal(result.ack.phase, 'RESUMING');
      assert.equal(result.ack.currentWindowId, id(13));
      assert.equal(result.ack.replayAllowed, false);
    });
    await test('wrong service scope refuses controller seed in CLOSED ACK bootstrap', async () => {
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('closed-ack', id(11), null, null, {
        serviceRef: 'other-service',
        ackRequestId: id(206),
        expectedWindowEpoch: closedEpoch,
        resumeJournalSha256: terminal.sha(terminal.readPrivate(closedJournal)),
        restoreLoginRoles: [],
      });
      ctx.resumeJournalPath = closedJournal;
      await assert.rejects(() => executor.start(ctx), /BLOCKED/);
      assert(!terminal.readPrivate(ctx.journalPath).toString().includes('bind-fresh-controller'));
    });
    await test('partial password rotation retains prepared secrets and exact per-role progress', async () => {
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('takeover', id(14), id(13), id(140));
      const original = admin.query.bind(admin);
      let altered = 0;
      admin.query = async (sql, args) => {
        if (
          typeof sql === 'string' &&
          sql.startsWith('ALTER ROLE ') &&
          sql.includes(' NOLOGIN PASSWORD ')
        ) {
          assert(fs.existsSync(ctx.credentialsPath));
          const prepared = JSON.parse(terminal.readPrivate(ctx.credentialsPath));
          assert.equal(prepared.status, 'PREPARED_UNDELIVERED');
          assert.equal(Object.keys(prepared.passwords).length, 12);
          if (++altered === 3) throw Error('Fixture third credential rotation failure');
        }
        return original(sql, args);
      };
      try {
        await assert.rejects(() => executor.start(ctx), /BLOCKED/);
      } finally {
        admin.query = original;
      }
      assert.equal(altered, 3);
      const events = terminal
        .readPrivate(ctx.journalPath)
        .toString()
        .trim()
        .split('\n')
        .map(JSON.parse);
      assert.equal(
        events.filter((e) => e.stage.startsWith('rotate:') && e.status === 'CONFIRMED').length,
        2,
      );
      assert.equal(events.at(-1).status, 'BLOCKED');
    });
    await test('prepared credential file drift prevents resume and never marks delivery ready', async () => {
      Object.assign(old, JSON.parse(terminal.readPrivate(ctx.credentialsPath)).passwords);
      ctx = await context('takeover', id(14), id(13), id(141));
      current = await executor.start(ctx);
      fs.appendFileSync(ctx.credentialsPath, '\n');
      await assert.rejects(() => current.resume(), /BLOCKED/);
      current = null;
      const log = terminal.readPrivate(ctx.journalPath).toString();
      assert(!log.includes('begin-resume-commit'));
      assert(!log.includes('"deliveryReady":true'));
      assert.throws(() => lock.acquire(s.dir, 'launcher'));
    });
    await test('secrets absent from durable journals; generated credential files are 0600', async () => {
      for (const name of fs.readdirSync(s.dir).filter((x) => x.endsWith('.jsonl'))) {
        const text = fs.readFileSync(path.join(s.dir, name), 'utf8');
        assert(!text.includes(adminPassword));
        for (const pw of Object.values(old)) assert(!text.includes(pw));
      }
      assert.equal(fs.statSync(ctx.credentialsPath).mode & 0o777, 0o600);
    });
  } finally {
    if (current) await current.block();
    if (admin) await admin.end().catch(() => {});
    if (fs.existsSync(path.join(s.dir, 'data/postmaster.pid')))
      execFileSync(
        path.join(bin, 'pg_ctl'),
        ['-D', path.join(s.dir, 'data'), '-m', 'immediate', '-w', 'stop'],
        { stdio: 'ignore' },
      );
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
  const evidence = {
    status: 'PASS',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    candidateInventorySha256: terminal.sources().inventorySha256,
    candidateMigrationSha256: terminal.sources().migrationSha256,
    checks,
    disposableClusterOnly: true,
    temporaryClusterStoppedAndRemoved: true,
    existingClustersConnected: false,
    runtimeAccepted: false,
    terminalActionsAllowed: false,
    limitations: [
      'Synthetic ready installation and minimal Native fixture; no production authority',
      'No Native proof/finalize or actual host restart acceptance',
    ],
  };
  const i = process.argv.indexOf('--output');
  if (i >= 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length }));
}
async function worker() {
  const value = JSON.parse(terminal.readPrivate(process.argv[3]));
  const admin = await io.connect(value.endpoint, 'postgres', 'postgres', value.adminPassword);
  const session = await executor.start({ ...value, admin });
  console.log(session.status().status);
  setInterval(() => {}, 1000);
}
(process.argv[2] === '--worker' ? worker() : main()).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
