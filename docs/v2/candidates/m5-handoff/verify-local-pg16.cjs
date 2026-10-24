#!/usr/bin/env node
// Disposable PG16 candidate compile/contracts only; synthetic control authorization.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { bootstrap } = require('../m5-terminal/verify-local-pg16.cjs');
const term = require('../m5-terminal/terminal-installation.cjs');
const closure = require('./dependency-closure.cjs');
const id = (n) => `0199aabb-ccdd-7000-8000-${String(n).padStart(12, '0')}`;
const checks = [];
async function test(name, f) {
  await f();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
}
(async () => {
  const inv = JSON.parse(fs.readFileSync(path.join(__dirname, 'inventory.json'))),
    s = { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-handoff-candidate-')), port: 56494 };
  fs.chmodSync(s.dir, 0o700);
  const clients = [];
  async function connect(db = 'postgres', user = 'postgres') {
    const c = new Client({
      host: s.socket,
      port: s.port,
      database: db,
      user,
      connectionTimeoutMillis: 3000,
      query_timeout: 5000,
    });
    c.on('error', () => {});
    await c.connect();
    clients.push(c);
    return c;
  }
  const deployment = id(1),
    window = id(2),
    release = id(3),
    credential = id(4),
    approval = id(5),
    fence = id(6),
    secret = 'b'.repeat(64),
    clear = 'c'.repeat(64),
    read = 'd'.repeat(64),
    digest = 'e'.repeat(64),
    nonce = term.sha('f'.repeat(64));
  try {
    await bootstrap(s);
    const admin = await connect(),
      b = await connect('zhiban_m1_dev');
    await test('new handoff SQL/helper/ACL compiles in one owner transaction with separate ledger', async () => {
      await b.query('BEGIN');
      await b.query('SET LOCAL ROLE zhiban_identity_owner');
      for (const n of inv.migration.orderedComponents)
        await b.query(fs.readFileSync(path.join(__dirname, n), 'utf8'));
      await b.query("INSERT INTO zhiban_handoff.schema_migrations VALUES('0001',$1)", [
        inv.migration.aggregateSha256,
      ]);
      await b.query('COMMIT');
    });
    const physical = (
      await b.query(
        "SELECT (SELECT system_identifier::text FROM pg_control_system()) cluster,pg_postmaster_start_time() start,(SELECT oid FROM pg_database WHERE datname='zhiban_m1_dev') business,(SELECT oid FROM pg_database WHERE datname='zhiban_m5_native') native",
      )
    ).rows[0];
    await b.query('BEGIN');
    await b.query("SET LOCAL session_replication_role='replica'");
    await b.query(
      "INSERT INTO zhiban_bridge.deployment_registry VALUES($1,'fixture',$2,'0.31.1','0.11.2','0.1.11',$3,'VERIFIED',1,0,0)",
      [deployment, 'd'.repeat(40), digest],
    );
    await b.query(
      "INSERT INTO zhiban_reconcile.installations VALUES($1,'terminal-reconciliation-local-v1',$2,$3,$4,$5,$5,$5,$5,$5,false)",
      [deployment, physical.cluster, physical.business, physical.native, digest],
    );
    await b.query(
      "INSERT INTO zhiban_reconcile.services VALUES('fixture',$1,'RECONCILE',1,'ACTIVE','zhiban_reconcile_executor')",
      [deployment],
    );
    await b.query(
      "INSERT INTO zhiban_reconcile.service_versions VALUES('fixture',1,'ACTIVE',$1,0)",
      [digest],
    );
    await b.query('INSERT INTO zhiban_reconcile.epoch_counters VALUES($1,1)', [deployment]);
    await b.query(
      "INSERT INTO zhiban_reconcile.windows(window_id,service_ref,deployment_id,epoch,phase,cluster_identifier,business_oid,native_oid,postmaster_start,nonce_digest,build_digest,allowlist,lease_until,created_at) VALUES($1,'fixture',$2,1,'CLOSED',$3,$4,$5,$6,$7,$8,'[{\"pid\":-1}]',1,0)",
      [
        window,
        deployment,
        physical.cluster,
        physical.business,
        physical.native,
        physical.start,
        nonce,
        digest,
      ],
    );
    await b.query(
      'INSERT INTO zhiban_reconcile.window_database_claims VALUES($1,$2,NULL),($1,$3,NULL)',
      [physical.cluster, physical.business, physical.native],
    );
    for (const event of ['RESUMING', 'CLOSED'])
      await b.query(
        "INSERT INTO zhiban_reconcile.control_events(deployment_id,window_id,event_type,actor_role,occurred_at,provenance_digest,facts) VALUES($1,$2,$3,'zhiban_reconcile_controller',0,$4,'{}')",
        [deployment, window, event, nonce],
      );
    await b.query('COMMIT');
    const logins = [
      'zhiban_auth_runtime',
      'zhiban_runtime',
      'zhiban_control_runtime',
      'zhiban_academic_runtime',
      'zhiban_bridge_runtime',
      'zhiban_openmaic_runtime',
    ];
    for (const r of [...logins, 'zhiban_reconcile_controller'])
      await admin.query(`ALTER ROLE ${r} LOGIN`);
    let c = await connect('zhiban_m1_dev', 'zhiban_reconcile_controller');
    let activeApproval = approval;
    await b.query(
      "INSERT INTO zhiban_reconcile.controller_authorizations SELECT $1,$2,pid,backend_start,$3,(extract(epoch FROM clock_timestamp())*1000)::bigint+300000,$3,'ACTIVE' FROM pg_stat_activity WHERE pid=$4",
      [deployment, term.sha(secret), nonce, c.processID],
    );
    await b.query(
      "INSERT INTO zhiban_handoff.host_read_authorizations VALUES($1,$2,$3,1,$4,$5,NULL,$5,$5,$5,'REGISTERED')",
      [deployment, release, credential, term.sha(read), digest],
    );
    await b.query(
      "UPDATE zhiban_handoff.host_read_authorizations SET status='ACTIVE',handoff_receipt_digest=$1 WHERE deployment_id=$2 AND release_id=$3",
      [digest, deployment, release],
    );
    await b.query(
      "INSERT INTO zhiban_handoff.clear_authorizations SELECT $1,$2,$3,$4,1,$5,1,$6,$7,$7,$7,$7,pid,backend_start,pg_postmaster_start_time(),(extract(epoch FROM clock_timestamp())*1000)::bigint,(extract(epoch FROM clock_timestamp())*1000)::bigint+290000,'ISSUED' FROM pg_stat_activity WHERE pid=$8",
      [approval, deployment, release, window, fence, term.sha(clear), digest, c.processID],
    );
    await test('ordinary read token cannot enumerate another release and receives no raw table rights', async () => {
      const h = await connect('zhiban_m1_dev', 'zhiban_control_runtime');
      await assert.rejects(
        () =>
          h.query('SELECT zhiban_handoff.inspect_host_installation($1,$2,$3)', [
            deployment,
            id(99),
            read,
          ]),
        { code: '42501' },
      );
      await assert.rejects(() => h.query('SELECT * FROM zhiban_handoff.clear_authorizations'), {
        code: '42501',
      });
      const facts = (
        await h.query('SELECT zhiban_handoff.inspect_host_installation($1,$2,$3) value', [
          deployment,
          release,
          read,
        ])
      ).rows[0].value;
      assert.equal(facts.activationStatus, 'REGISTERED_UNACTIVATED');
      assert.equal(facts.terminalActionsAllowed, false);
      await h.end();
    });
    await test('REGISTERED read scope precedes receipt and owner seals digest exactly once', async () => {
      const pending = id(20);
      await b.query(
        "INSERT INTO zhiban_handoff.host_read_authorizations VALUES($1,$2,$3,1,$4,$5,NULL,$5,$5,$5,'REGISTERED')",
        [deployment, pending, credential, term.sha(read), digest],
      );
      const h = await connect('zhiban_m1_dev', 'zhiban_control_runtime');
      const facts = (
        await h.query('SELECT zhiban_handoff.inspect_host_installation($1,$2,$3) value', [
          deployment,
          pending,
          read,
        ])
      ).rows[0].value;
      assert.equal(facts.readPermissionPhase, 'REGISTERED');
      assert.equal(facts.handoffReceiptSha256, null);
      assert.equal(facts.activationStatus, 'REGISTERED_UNACTIVATED');
      await assert.rejects(
        () =>
          h.query(
            "UPDATE zhiban_handoff.host_read_authorizations SET status='ACTIVE',handoff_receipt_digest=$1 WHERE release_id=$2",
            [digest, pending],
          ),
        { code: '42501' },
      );
      await h.end();
      await b.query(
        "UPDATE zhiban_handoff.host_read_authorizations SET status='ACTIVE',handoff_receipt_digest=$1 WHERE release_id=$2",
        [digest, pending],
      );
      await assert.rejects(
        () =>
          b.query(
            'UPDATE zhiban_handoff.host_read_authorizations SET handoff_receipt_digest=$1 WHERE release_id=$2',
            ['0'.repeat(64), pending],
          ),
        { code: '23514' },
      );
    });
    await test('ordinary runtime/issuer/executor cannot call clear helpers', async () => {
      for (const r of [
        'zhiban_runtime',
        'zhiban_control_runtime',
        'zhiban_reconcile_issuer',
        'zhiban_reconcile_executor',
      ])
        assert.equal(
          (
            await b.query(
              "SELECT has_function_privilege($1,'zhiban_handoff.begin_clear(uuid,text,text)','EXECUTE') allowed",
              [r],
            )
          ).rows[0].allowed,
          false,
        );
    });
    await b.end();
    await admin.query('ALTER ROLE zhiban_reconcile_controller NOLOGIN');
    await test('guard-only COMMIT rejects deferred consistency and creates no activation', async () => {
      await c.query('BEGIN');
      await c.query('SELECT zhiban_handoff.begin_clear($1,$2,$3)', [activeApproval, secret, clear]);
      await assert.rejects(() => c.query('COMMIT'), { code: '23514' });
      await c.query('ROLLBACK');
      const result = (
        await c.query('SELECT zhiban_handoff.read_clear_result($1,$2) value', [
          activeApproval,
          secret,
        ])
      ).rows[0].value;
      assert.equal(result.status, 'NOT_OBSERVED');
      assert.equal(result.replayAllowed, false);
    });
    await test('guard serializes epoch writer and rejects a late target backend before commit', async () => {
      await c.query('BEGIN');
      await c.query('SELECT zhiban_handoff.begin_clear($1,$2,$3)', [activeApproval, secret, clear]);
      const rival = await connect('zhiban_m1_dev');
      await rival.query("SET lock_timeout='100ms'");
      await assert.rejects(
        () =>
          rival.query(
            'UPDATE zhiban_reconcile.epoch_counters SET epoch=epoch+1 WHERE deployment_id=$1',
            [deployment],
          ),
        { code: '55P03' },
      );
      await assert.rejects(
        () =>
          c.query('SELECT zhiban_handoff.commit_clear($1,$2,$3)', [activeApproval, secret, clear]),
        { code: '42501' },
      );
      await c.query('ROLLBACK');
      await rival.end();
    });
    await test('real idle transaction timeout destroys guard; fresh backend can only lookup old attempt', async () => {
      await c.query('BEGIN');
      await c.query('SELECT zhiban_handoff.begin_clear($1,$2,$3)', [activeApproval, secret, clear]);
      await c.query("SET LOCAL idle_in_transaction_session_timeout='100ms'");
      await new Promise((r) => setTimeout(r, 350));
      await assert.rejects(() =>
        c.query('SELECT zhiban_handoff.commit_clear($1,$2,$3)', [activeApproval, secret, clear]),
      );
      await c.end().catch(() => {});
      await admin.query('ALTER ROLE zhiban_reconcile_controller LOGIN');
      c = await connect('zhiban_m1_dev', 'zhiban_reconcile_controller');
      const owner = await connect('zhiban_m1_dev');
      await owner.query(
        'UPDATE zhiban_reconcile.controller_authorizations SET backend_pid=$2,backend_start=(SELECT backend_start FROM pg_stat_activity WHERE pid=$2) WHERE deployment_id=$1',
        [deployment, c.processID],
      );
      activeApproval = id(7);
      await owner.query(
        "INSERT INTO zhiban_handoff.clear_authorizations SELECT $1,$2,$3,$4,1,$5,2,$6,$7,$7,$7,$7,pid,backend_start,pg_postmaster_start_time(),(extract(epoch FROM clock_timestamp())*1000)::bigint,(extract(epoch FROM clock_timestamp())*1000)::bigint+290000,'ISSUED' FROM pg_stat_activity WHERE pid=$8",
        [activeApproval, deployment, release, window, id(8), term.sha(clear), digest, c.processID],
      );
      await owner.end();
      await admin.query('ALTER ROLE zhiban_reconcile_controller NOLOGIN');
      const ack = (
        await c.query('SELECT zhiban_handoff.read_clear_result($1,$2) value', [approval, secret])
      ).rows[0].value;
      assert.equal(ack.status, 'NOT_OBSERVED');
      assert.equal(ack.replayAllowed, false);
      await assert.rejects(
        () => c.query('SELECT zhiban_handoff.begin_clear($1,$2,$3)', [approval, secret, clear]),
        { code: '42501' },
      );
    });
    await test('commit_clear without same guarded transaction refuses', async () => {
      await assert.rejects(
        () =>
          c.query('SELECT zhiban_handoff.commit_clear($1,$2,$3)', [activeApproval, secret, clear]),
        { code: '42501' },
      );
    });
    await test('guard + final recheck consumes only control approval; exact ACK is COMMITTED', async () => {
      await c.query('BEGIN');
      await c.query('SELECT zhiban_handoff.begin_clear($1,$2,$3)', [activeApproval, secret, clear]);
      const before = (
        await c.query('SELECT zhiban_handoff.commit_clear($1,$2,$3) value', [
          activeApproval,
          secret,
          clear,
        ])
      ).rows[0].value;
      assert.equal(before.status, 'COMMIT_PENDING');
      assert.equal(before.launchAllowed, false);
      await c.query('COMMIT');
      const result = (
        await c.query('SELECT zhiban_handoff.read_clear_result($1,$2) value', [
          activeApproval,
          secret,
        ])
      ).rows[0].value;
      assert.equal(result.status, 'COMMITTED');
      assert.equal(result.publishGateAllowed, false);
      assert.equal(result.targetGateSha256, digest);
    });
    await test('consumed clear approval cannot be replayed', async () => {
      await assert.rejects(
        () =>
          c.query('SELECT zhiban_handoff.begin_clear($1,$2,$3)', [activeApproval, secret, clear]),
        { code: '42501' },
      );
    });
    await c.end();
    await test('host facts requires exact token and exposes committed gate binding without enabling ready', async () => {
      const h = await connect('zhiban_m1_dev', 'zhiban_control_runtime');
      await assert.rejects(
        () =>
          h.query('SELECT zhiban_handoff.inspect_host_installation($1,$2,$3)', [
            deployment,
            release,
            '0'.repeat(64),
          ]),
        { code: '42501' },
      );
      const facts = (
        await h.query('SELECT zhiban_handoff.inspect_host_installation($1,$2,$3) value', [
          deployment,
          release,
          read,
        ])
      ).rows[0].value;
      assert.equal(facts.activationStatus, 'COMMITTED');
      assert.equal(facts.targetGateSha256, digest);
      assert.equal(facts.installationReady, false);
      await h.end();
    });
    await test('offline closure structurally rejects ambient imports, escape and undeclared native addon', async () => {
      const m = {
        formatVersion: 1,
        status: 'CLOSURE_DECLARED',
        nodeAbi: process.versions.modules,
        platform: 'linux',
        arch: 'x64',
        libc: 'glibc',
        nodeExecutableSha256: digest,
        files: [{ path: 'host/server.mjs', sha256: digest, kind: 'javascript' }],
        edges: [],
        nativeAddons: [],
        systemLibraries: [],
        dynamicImports: [],
        unresolved: [],
        evidenceOrigin: 'LOCAL',
      };
      assert.equal(closure.verify(m).physicalFilesVerified, false);
      for (const mutate of [
        (x) => x.unresolved.push('dynamic'),
        (x) => (x.files[0].path = '../outside'),
        (x) => x.files.push({ path: 'addon.node', kind: 'native', sha256: digest }),
        (x) =>
          x.edges.push({
            from: 'host/server.mjs',
            specifier: 'pg',
            resolvedPath: 'node_modules/pg.js',
            resolutionKind: 'ambient',
          }),
      ]) {
        const bad = structuredClone(m);
        mutate(bad);
        assert.throws(() => closure.verify(bad));
      }
    });
  } finally {
    for (const c of clients) await c.end().catch(() => {});
    if (fs.existsSync(path.join(s.dir, 'data/postmaster.pid')))
      execFileSync(
        '/usr/lib/postgresql/16/bin/pg_ctl',
        ['-D', path.join(s.dir, 'data'), '-m', 'immediate', '-w', 'stop'],
        { stdio: 'ignore' },
      );
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
  const evidence = {
    status: 'PASS',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    candidateInventorySha256: term.sha(fs.readFileSync(path.join(__dirname, 'inventory.json'))),
    candidateMigrationSha256: inv.migration.aggregateSha256,
    checks,
    disposableClusterOnly: true,
    existingClustersConnected: false,
    temporaryClusterStoppedAndRemoved: true,
    runtimeAccepted: false,
    gatePublished: false,
    realReceiptIssued: false,
    limitations: [
      'Synthetic privileged replica control fixture; minimal Native, no product provenance',
      'No trusted owner/signing authority, real release, dependency resolution, gate fsync/publisher or complete crash/concurrency matrix',
    ],
  };
  const n = process.argv.indexOf('--output');
  if (n >= 0) fs.writeFileSync(process.argv[n + 1], JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length }));
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
