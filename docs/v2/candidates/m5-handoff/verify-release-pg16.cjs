#!/usr/bin/env node
// Actual product/frontend/native build + guarded child in a unique loopback PG16.
// Test authority and CLOSED/profile fixture remain synthetic, never real-target signoff.
require('tsx/cjs');
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process'),
  { Client } = require('pg');
const { bootstrap } = require('../m5-terminal/verify-local-pg16.cjs'),
  h = require('./handoff-contracts.cjs'),
  c = require('./release-contract.cjs'),
  builder = require('./release-builder.cjs'),
  physical = require('./physical-closure.cjs'),
  parent = require('./validation-parent.cjs');
const { writeExclusive } = require('../m5-terminal/maintenance-lock.cjs');
const {
  admissionPolicyDigest,
  purposes,
} = require('../../../../lib/zhiban/infrastructure/identity/composition/admission.ts');
const { catalogConfig } = require('../../../../tests/zhiban/identity/authorization/fixtures.ts');
const id = (n) => `0199dddd-aabb-7000-8000-${String(n).padStart(12, '0')}`;
const checks = [];
async function test(name, f) {
  await f();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
}
(async () => {
  const s = { dir: fs.mkdtempSync('/tmp/zhiban-release-pg16-'), port: 56496 };
  fs.chmodSync(s.dir, 0o700);
  const source = h.sources(),
    clients = [],
    passwords = Object.fromEntries(c.ROLE.map((r) => [r, crypto.randomBytes(32).toString('hex')])),
    old = Object.fromEntries(c.ROLE.map((r) => [r, crypto.randomBytes(32).toString('hex')])),
    adminPassword = crypto.randomBytes(32).toString('hex'),
    root = path.join(s.dir, 'control'),
    deployment = id(1),
    release = id(2),
    credential = id(3),
    window = id(4),
    fence = id(5),
    approvalId = id(6),
    read = crypto.randomBytes(32).toString('hex'),
    digest = 'e'.repeat(64),
    nonce = h.sha('f'.repeat(64));
  fs.mkdirSync(root, { mode: 0o700 });
  fs.mkdirSync(path.join(root, 'releases'), { mode: 0o700 });
  const keys = crypto.generateKeyPairSync('ed25519'),
    publicPath = path.join(root, 'authority.pub');
  writeExclusive(publicPath, keys.publicKey.export({ format: 'pem', type: 'spki' }));
  const pin = h.publicPin(publicPath),
    key = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    signed = (p) => Buffer.from(JSON.stringify(h.signed(p, key, pin)) + '\n');
  let seq = 0;
  function privateInput(raw) {
    const p = path.join(root, 'input-' + ++seq + '.json');
    writeExclusive(p, raw);
    return p;
  }
  async function connect(db = 'postgres', user = 'postgres', tcp = false, password) {
    const client = new Client({
      host: tcp ? '127.0.0.1' : s.socket,
      port: s.port,
      database: db,
      user,
      password,
      connectionTimeoutMillis: 2000,
      query_timeout: 5000,
    });
    client.on('error', () => {});
    await client.connect();
    clients.push(client);
    return client;
  }
  let built, beforeBusiness;
  async function businessSnapshot(client) {
    const tables = (
      await client.query(
        "SELECT schemaname,tablename FROM pg_tables WHERE schemaname LIKE 'zhiban_%' AND schemaname<>'zhiban_handoff' AND NOT (schemaname='zhiban_reconcile' AND tablename='controller_authorizations') ORDER BY schemaname,tablename",
      )
    ).rows;
    const rows = [];
    for (const t of tables) {
      assert.match(t.schemaname, /^[a-z_]+$/);
      assert.match(t.tablename, /^[a-z0-9_]+$/);
      rows.push({
        table: t.schemaname + '.' + t.tablename,
        facts: (
          await client.query(
            "SELECT count(*)::text n,md5(coalesce(string_agg(to_jsonb(x)::text,'' ORDER BY to_jsonb(x)::text),'')) digest FROM " +
              t.schemaname +
              '.' +
              t.tablename +
              ' x',
          )
        ).rows[0],
      });
    }
    return rows;
  }
  try {
    await bootstrap(s);
    let admin = await connect(),
      b = await connect('zhiban_m1_dev'),
      n = await connect('zhiban_m5_native');
    await b.query('BEGIN');
    await b.query('SET LOCAL ROLE zhiban_identity_owner');
    for (const name of source.inv.migration.orderedComponents)
      await b.query(fs.readFileSync(path.join(__dirname, name), 'utf8'));
    await b.query("INSERT INTO zhiban_handoff.schema_migrations VALUES('0001',$1)", [
      source.inv.migration.aggregateSha256,
    ]);
    await b.query('COMMIT');
    await admin.query('GRANT CONNECT ON DATABASE zhiban_m5_native TO zhiban_openmaic_runtime');
    // Ordinary fixture credentials are actually rotated; secrets never appear in logs.
    const verifier = require('../m5-terminal/maintenance-hba.cjs').verifier;
    await admin.query("ALTER ROLE postgres PASSWORD '" + verifier(adminPassword) + "'");
    for (const role of c.ROLE)
      await admin.query(`ALTER ROLE ${role} LOGIN PASSWORD '${verifier(old[role])}'`);
    const policyDigests = {};
    for (const purpose of purposes) {
      const policy = {
        purpose,
        approval_ref: 'LOCAL_RELEASE_FIXTURE',
        environment_ref: 'LOCAL_RELEASE_FIXTURE',
        created_at: '0',
        window_ms: '60000',
        global_limit: '100',
        ip_limit: purpose === 'INITIAL_PROVISION' ? null : '30',
        locator_limit: purpose === 'INITIAL_PROVISION' ? null : '15',
        pair_limit: purpose === 'INITIAL_PROVISION' ? null : '15',
        user_limit: purpose === 'LOGIN' ? null : '15',
        max_buckets: '1000',
      };
      policyDigests[purpose] = admissionPolicyDigest(policy);
      await b.query(
        'INSERT INTO zhiban_identity.admission_policies(purpose,policy_digest,approval_ref,environment_ref,created_at,window_ms,global_limit,ip_limit,locator_limit,pair_limit,user_limit,max_buckets) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',
        [purpose, policyDigests[purpose], ...Object.values(policy).slice(1)],
      );
      await b.query('INSERT INTO zhiban_identity.admission_gate(purpose) VALUES($1)', [purpose]);
    }
    const phy = (
      await b.query(
        "SELECT (SELECT system_identifier::text FROM pg_control_system()) cluster,(SELECT oid::text FROM pg_database WHERE datname='zhiban_m1_dev') business,(SELECT oid::text FROM pg_database WHERE datname='zhiban_m5_native') native",
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
      [deployment, phy.cluster, phy.business, phy.native, digest],
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
      "INSERT INTO zhiban_reconcile.windows(window_id,service_ref,deployment_id,epoch,phase,cluster_identifier,business_oid,native_oid,postmaster_start,nonce_digest,build_digest,allowlist,lease_until,created_at) VALUES($1,'fixture',$2,1,'CLOSED',$3,$4,$5,pg_postmaster_start_time(),$6,$7,'[{\"pid\":-1}]',1,0)",
      [window, deployment, phy.cluster, phy.business, phy.native, nonce, digest],
    );
    await b.query(
      'INSERT INTO zhiban_reconcile.window_database_claims VALUES($1,$2,NULL),($1,$3,NULL)',
      [phy.cluster, phy.business, phy.native],
    );
    for (const event of ['RESUMING', 'CLOSED'])
      await b.query(
        "INSERT INTO zhiban_reconcile.control_events(deployment_id,window_id,event_type,actor_role,occurred_at,provenance_digest,facts) VALUES($1,$2,$3,'zhiban_reconcile_controller',0,$4,'{}')",
        [deployment, window, event, nonce],
      );
    await b.query('COMMIT');
    beforeBusiness = await businessSnapshot(b);
    // Fixed owned cluster only: restart to enable loopback TCP and exact SCRAM profile.
    for (const client of clients) await client.end();
    execFileSync('/usr/lib/postgresql/16/bin/pg_ctl', ['-D', s.data, '-m', 'fast', '-w', 'stop'], {
      stdio: 'ignore',
    });
    fs.writeFileSync(
      path.join(s.data, 'postgresql.auto.conf'),
      "listen_addresses='127.0.0.1'\nlog_parameter_max_length=0\nlog_parameter_max_length_on_error=0\nlog_statement='none'\nlog_min_error_statement='panic'\n",
      { mode: 0o600 },
    );
    fs.writeFileSync(path.join(s.data, 'pg_hba.conf'), require('./ordinary-transport.cjs').text(), {
      mode: 0o600,
    });
    execFileSync(
      '/usr/lib/postgresql/16/bin/pg_ctl',
      [
        '-D',
        s.data,
        '-l',
        path.join(s.dir, 'server.log'),
        '-o',
        `-c unix_socket_directories='${s.socket}' -c port=${s.port} -c max_prepared_transactions=0`,
        '-w',
        'start',
      ],
      { stdio: 'ignore' },
    );
    admin = await connect('postgres', 'postgres', false, adminPassword);
    await test('six prior credentials really authenticate through exact loopback SCRAM before fixture rotation', async () => {
      for (const role of c.ROLE) {
        const client = await connect(
          role === 'zhiban_openmaic_runtime' ? 'zhiban_m5_native' : 'zhiban_m1_dev',
          role,
          true,
          old[role],
        );
        await client.end();
      }
    });
    for (const role of c.ROLE)
      await admin.query(`ALTER ROLE ${role} PASSWORD '${verifier(passwords[role])}'`);
    const target = {
      environment: 'LOCAL_DISPOSABLE',
      cluster: phy.cluster,
      businessOid: phy.business,
      nativeOid: phy.native,
      dataDirectory: s.data,
      socketDirectory: s.socket,
      port: s.port,
      origin: 'https://127.0.0.1:3443',
    };
    const corpus = ['passwordpassword', '123456789012345'],
      cfg = {
        formatVersion: 1,
        profile: h.PROFILE,
        releaseId: release,
        credentialGenerationId: credential,
        deploymentId: deployment,
        target,
        readSecret: read,
        connections: c.ROLE.map((role) => ({
          role,
          database: role === 'zhiban_openmaic_runtime' ? 'zhiban_m5_native' : 'zhiban_m1_dev',
          password: passwords[role],
        })),
        identity: {
          manifest: {
            approvalRef: 'LOCAL_RELEASE_FIXTURE',
            networkApprovalRef: 'LOCAL_RELEASE_FIXTURE',
            migrationPreflightRef: 'LOCAL_RELEASE_FIXTURE',
            operationalAcceptanceRef: 'LOCAL_RELEASE_FIXTURE',
            backendPrivate: true,
            fixedOverwritingProxy: true,
            poolMax: 3,
            connectionTimeoutMs: 3000,
            statementTimeoutMs: 5000,
            endpoint: { hostname: '127.0.0.1', port: s.port, database: 'zhiban_m1_dev' },
            runtimeSecrets: {
              auth: 'LOCAL_M1_AUTH',
              tenant: 'LOCAL_M1_TENANT',
              control: 'LOCAL_M1_CONTROL',
            },
            policy: {
              origin: target.origin,
              concurrentRequests: 8,
              bodyTimeoutMs: 3000,
              retryAfterSeconds: 1,
            },
          },
          composition: {
            origin: target.origin,
            sessionPolicy: { absoluteMs: 28800000, idleMs: 1800000 },
            catalog: catalogConfig(),
            admission: {
              environment: 'LOCAL_RELEASE_FIXTURE',
              approvalRef: 'LOCAL_RELEASE_FIXTURE',
              hmacKey: crypto.randomBytes(32).toString('hex'),
              policyDigests,
            },
            corpus: {
              approvalRef: 'LOCAL_RELEASE_FIXTURE',
              expectedDigest: h.sha(JSON.stringify(corpus)),
              values: corpus,
            },
            operator: null,
            membership: null,
            transportApprovalRef: 'LOCAL_RELEASE_FIXTURE',
            deployment: 'SINGLE_PROCESS_HTTPS',
          },
        },
      };
    const tlsPaths = require('./verify-ordinary-https.cjs').tlsFixture(s.dir);
    const configurationPath = privateInput(JSON.stringify(cfg) + '\n');
    await test('actual immutable build emits product, validator, browser assets, pinned native/ELF and manifests', async () => {
      built = await builder.build({
        parentDirectory: path.join(root, 'releases'),
        releaseId: release,
        credentialGenerationId: credential,
        configurationPath,
        tlsPaths,
      });
      assert.equal(built.status, 'BUILT_UNACTIVATED');
      assert.equal(built.runtimeAccepted, false);
      assert.ok(built.files > 15);
      assert.ok(fs.statSync(path.join(built.directory, 'host/product.cjs')).size > 100000);
      assert.ok(fs.statSync(path.join(built.directory, 'assets/content-client.js')).size > 100000);
    });
    await test('fault injection clone proves child cannot listen/write/load ambient packages/spawn/connect outside approved target', async () => {
      const probes = await require('./guard-probes.cjs').run(root, built.directory);
      assert.equal(probes.length, 5);
      assert.equal(
        probes.every((x) => x.status === 'PASS'),
        true,
      );
    });
    await test('same release ID cannot overwrite an existing generation; no workspace symlink/external package leaves', async () => {
      await assert.rejects(
        () =>
          builder.build({
            parentDirectory: path.join(root, 'releases'),
            releaseId: release,
            credentialGenerationId: credential,
            configurationPath,
          }),
        { code: 'EEXIST' },
      );
      const closure = JSON.parse(c.bytes(path.join(built.directory, 'closure-manifest.json')));
      assert.equal(closure.unresolved.length, 0);
      assert.equal(
        closure.edges.some((x) => x.resolutionKind === 'ambient'),
        false,
      );
      assert.equal(closure.nativeAddons.length, 1);
      physical.verify(built.directory, closure);
    });
    await test('staged configuration drift during a build fails before an artifact manifest can activate the partial generation', async () => {
      const next = id(82),
        raw = { ...cfg, releaseId: next },
        configurationPath = privateInput(JSON.stringify(raw) + '\n');
      const pending = builder.build({
        parentDirectory: path.join(root, 'releases'),
        releaseId: next,
        credentialGenerationId: credential,
        configurationPath,
      });
      fs.writeFileSync(configurationPath, JSON.stringify({ ...raw, deploymentId: id(83) }) + '\n');
      await assert.rejects(() => pending, /Candidate\/config changed during build/);
      assert.equal(
        fs.existsSync(path.join(root, 'releases', next, 'artifact-manifest.json')),
        false,
      );
    });
    const control = await connect(
        'zhiban_m1_dev',
        'zhiban_control_runtime',
        true,
        passwords.zhiban_control_runtime,
      ),
      native = await connect(
        'zhiban_m5_native',
        'zhiban_openmaic_runtime',
        true,
        passwords.zhiban_openmaic_runtime,
      ),
      after = await h.collect(control, native);
    await control.end();
    await native.end();
    const expected = {
        formatVersion: 1,
        purpose: 'REVIEWED_ORDINARY_HANDOFF_PROFILE',
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        authorityKeySha256: pin.digest,
        profile: h.PROFILE,
        sourceBindingsSha256: source.inventorySha256,
        review: {
          sourceKind: 'INDEPENDENT_SHADOW_PG16',
          approvalRef: 'SYNTHETIC_LOCAL_SHADOW_FIXTURE',
          referenceEvidenceSha256: digest,
        },
        before: after,
        after,
      },
      expectedRaw = signed(expected),
      expectedPath = privateInput(expectedRaw),
      expectedDigest = h.sha(expectedRaw);
    const blocked = Buffer.from(JSON.stringify({ status: 'BLOCKED' }) + '\n'),
      history = Buffer.from(
        JSON.stringify({
          status: 'INTENT',
          deploymentId: deployment,
          fenceId: fence,
          fenceSequence: '1',
        }) + '\n',
      ),
      pointer = Buffer.from(JSON.stringify({ status: 'UNDELIVERED' }) + '\n');
    writeExclusive(path.join(root, 'maintenance.json'), blocked);
    writeExclusive(path.join(root, 'handoff-fences.jsonl'), history);
    writeExclusive(path.join(root, 'handoff-current.json'), pointer);
    const template = JSON.parse(
        fs.readFileSync(path.join(__dirname, 'prepare-approval.template.json')),
      ),
      p = {
        ...template,
        status: 'ISSUED',
        authorityKeySha256: pin.digest,
        approvalId,
        handoffId: id(7),
        releaseId: release,
        credentialGenerationId: credential,
        deploymentId: deployment,
        target,
        sourceBindingsSha256: source.inventorySha256,
        artifactManifestSha256: built.artifactManifestSha256,
        expectedProfileSha256: expectedDigest,
        configurationSha256: built.configurationSha256,
        windowId: window,
        epoch: '1',
        closedEventSequence: '2',
        fenceId: fence,
        fenceSequence: '1',
        fenceHistorySha256: h.sha(history),
        expectedBlockedGateSha256: h.sha(blocked),
        pointerSha256: h.sha(pointer),
        issuedAt: Date.now() - 100,
        expiresAt: Date.now() + 280000,
      },
      approvalPath = privateInput(signed(p));
    // Fixed owner seed only in this disposable fixture; no real installer or authority.

    const owner = await connect('zhiban_m1_dev', 'postgres', false, adminPassword).catch(
      () => null,
    );
    // Current HBA intentionally rejects owner target admission; use already approved test admin via a transient local fixture rule, then restore exact HBA.
    if (owner) await owner.end();
    const hbaFile = path.join(s.data, 'pg_hba.conf'),
      ordinaryText = require('./ordinary-transport.cjs').text();
    fs.writeFileSync(hbaFile, 'local zhiban_m1_dev postgres scram-sha-256\n' + ordinaryText, {
      mode: 0o600,
    });
    await admin.query('SELECT pg_reload_conf()');
    await new Promise((r) => setTimeout(r, 150));
    b = await connect('zhiban_m1_dev', 'postgres', false, adminPassword);
    await b.query(
      "INSERT INTO zhiban_handoff.host_read_authorizations VALUES($1,$2,$3,1,$4,$5,NULL,$6,$7,$8,'REGISTERED')",
      [
        deployment,
        release,
        credential,
        h.sha(read),
        built.artifactManifestSha256,
        built.configurationSha256,
        expectedDigest,
        source.inventorySha256,
      ],
    );
    await b.end();
    fs.writeFileSync(hbaFile, ordinaryText, { mode: 0o600 });
    await admin.query('SELECT pg_reload_conf()');
    await new Promise((r) => setTimeout(r, 150));
    const base = {
      controlDirectory: root,
      approvalPath,
      expectedPath,
      authorityPublicKeyPath: publicPath,
      compatibilityReceiptPath: null,
      transportEvidencePath: null,
      previousCredentialsPath: null,
      shadowEvidencePath: null,
    };
    let incomplete;
    await test('fresh guarded child loads actual frozen composition/native via six TCP roles without HTTP or business writes', async () => {
      incomplete = await require('./handoff-executor.cjs').validate(base);
      assert.equal(incomplete.status, 'VALIDATION_INCOMPLETE');
      for (const k of [
        'sixRoleTcpScram',
        'configurationComposition',
        'physicalClosure',
        'loaderInstrumentation',
        'nativeAbiLibraries',
        'freshShadowLoad',
      ])
        assert.equal(incomplete.result.checks[k], true);
      assert.equal(incomplete.result.checks.compatibilityReceipts, false);
      assert.equal(incomplete.result.checks.oldCredentialsDenied, false);
      assert.equal(incomplete.result.httpListening, false);
      assert.equal(incomplete.result.businessWrites, false);
    });
    const product = require(path.join(built.directory, 'host/product.cjs')); // Test harness only, never a live host.
    const ledgers = h.ordinaryLedgers(source),
      contexts = {};
    for (const k of ['identity', 'academic', 'learning', 'assessment', 'content'])
      contexts[k] = {
        policySha256: h.sha(
          h.canonical(
            k === 'identity'
              ? cfg.identity.manifest.policy
              : k === 'content'
                ? JSON.parse(c.bytes(path.join(built.directory, 'assets/content-csp.json'))).policy
                : product.policies[k],
          ),
        ),
        ledgerSha256: h.sha(h.canonical(ledgers.filter((x) => x.context === k))),
        previousReceiptSha256: digest,
      };
    const common = {
      status: 'ISSUED',
      formatVersion: 1,
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      authorityKeySha256: pin.digest,
      releaseId: release,
      credentialGenerationId: credential,
      deploymentId: deployment,
      sourceBindingsSha256: source.inventorySha256,
    };
    const compatibility = {
        ...common,
        purpose: 'LOCAL_ORDINARY_COMPATIBILITY_RECEIPTS',
        configurationSha256: built.configurationSha256,
        buildManifestSha256: built.buildManifestSha256,
        contexts,
        launchAllowed: false,
        terminalActionsAllowed: false,
      },
      compatibilityReceiptPath = privateInput(signed(compatibility));
    const hbaRules = (
      await admin.query(
        "SELECT type,array_to_string(database,',') database,array_to_string(user_name,',') role,address,netmask,auth_method method,options,error FROM pg_hba_file_rules ORDER BY rule_number",
      )
    ).rows;
    assert.deepEqual(hbaRules, require('./ordinary-transport.cjs').rules());
    const now = Date.now(),
      postmasterStart = (
        await admin.query('SELECT pg_postmaster_start_time() start')
      ).rows[0].start.toISOString(),
      transport = {
        ...common,
        purpose: 'LOCAL_ORDINARY_TRANSPORT_EVIDENCE',
        target,
        hbaSha256: h.sha(c.bytes(hbaFile)),
        hbaRules,
        postmasterStart,
        observedAt: now,
        expiresAt: now + 250000,
        credentialLineageSha256: h.sha(h.canonical(old)),
        oldCredentialDigests: Object.fromEntries(
          Object.entries(old).map(([r, p]) => [r, h.sha(p)]),
        ),
      },
      transportEvidencePath = privateInput(signed(transport)),
      previousCredentialsPath = privateInput(
        JSON.stringify(Object.entries(old).map(([role, password]) => ({ role, password }))),
      );
    const full = {
      ...base,
      compatibilityReceiptPath,
      transportEvidencePath,
      previousCredentialsPath,
    };
    let verified;
    await test('independent test receipts and full HBA/actual old credentials complete all nine validation checks', async () => {
      verified = await parent.run(full);
      assert.equal(verified.status, 'VALIDATED_FOR_LAUNCH');
      assert.equal(Object.values(verified.result.checks).every(Boolean), true);
      assert.equal(verified.result.launchAllowed, false);
      assert.notEqual(verified.result.challengeSha256, incomplete.result.challengeSha256);
      assert.equal(verified.result.childPid === incomplete.result.childPid, false);
    });
    await test('reviewed shadow evidence binds the exact executable/native closure; another build cannot substitute', async () => {
      const shadow = {
        formatVersion: 1,
        status: 'ISSUED',
        purpose: 'LOCAL_ORDINARY_SHADOW_VALIDATION',
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        authorityKeySha256: pin.digest,
        sourceKind: 'INDEPENDENT_SHADOW_PG16',
        approvalRef: 'SYNTHETIC_SHADOW_ONLY',
        sourceBindingsSha256: source.inventorySha256,
        codeClosureSha256: verified.result.codeClosureSha256,
        validationEvidenceSha256: verified.validationEvidenceSha256,
        shadowExpectedProfileSha256: expectedDigest,
        checks: verified.result.checks,
        launchAllowed: false,
        runtimeAccepted: false,
      };
      assert.equal(
        (await parent.run({ ...full, shadowEvidencePath: privateInput(signed(shadow)) })).status,
        'VALIDATED_FOR_LAUNCH',
      );
      await assert.rejects(() =>
        parent.run({
          ...full,
          shadowEvidencePath: privateInput(signed({ ...shadow, codeClosureSha256: digest })),
        }),
      );
    });
    await test('wrong signed compatibility generation is rejected by child without a partial positive ACK', async () => {
      const wrong = { ...compatibility, credentialGenerationId: id(80) };
      await assert.rejects(() =>
        parent.run({ ...full, compatibilityReceiptPath: privateInput(signed(wrong)) }),
      );
    });
    await test('missing/truncated/unknown source, mixed config and artifact mutations fail before child admission', async () => {
      const f = path.join(built.directory, 'ordinary.json'),
        saved = c.bytes(f);
      fs.chmodSync(f, 0o600);
      fs.writeFileSync(f, Buffer.from('{}'));
      await assert.rejects(() => parent.run(full));
      fs.writeFileSync(f, saved);
      fs.chmodSync(f, 0o400);
      const extra = path.join(built.directory, 'host/ambient.cjs');
      writeExclusive(extra, 'module.exports={}');
      assert.throws(() =>
        physical.verify(
          built.directory,
          JSON.parse(c.bytes(path.join(built.directory, 'closure-manifest.json'))),
        ),
      );
      fs.unlinkSync(extra);
    });
    await test('native bytes/ABI/system-library drift and nonliteral dynamic import cannot be silently accepted', async () => {
      const m = JSON.parse(c.bytes(path.join(built.directory, 'closure-manifest.json'))),
        bad = structuredClone(m);
      bad.nodeAbi = '0';
      assert.throws(() => physical.verify(built.directory, bad));
      bad.nodeAbi = m.nodeAbi;
      bad.systemLibraries[0].sha256 = digest;
      assert.throws(() => physical.verify(built.directory, bad));
      assert.throws(() =>
        builder.scan(
          'require(process.env.NODE_PATH)',
          'host/test.cjs',
          require('../../../../node_modules/.pnpm/acorn@8.16.0/node_modules/acorn/dist/acorn.js'),
        ),
      );
      assert.throws(() =>
        builder.scan(
          'import("./unknown.js")',
          'host/test.cjs',
          require('../../../../node_modules/.pnpm/acorn@8.16.0/node_modules/acorn/dist/acorn.js'),
        ),
      );
    });
    await require('./verify-ordinary-https.cjs').run({
      root,
      s,
      source,
      built,
      full,
      p,
      pin,
      key,
      privateInput,
      signed,
      connect,
      admin,
      adminPassword,
      hbaFile,
      ordinaryText,
      read,
      id,
      test,
    });
    await test('expired approval and changed fence block validation; raw secrets do not enter argv/env/result', async () => {
      const expired = { ...p, expiresAt: Date.now() - 1 };
      await assert.rejects(() =>
        parent.run({ ...full, approvalPath: privateInput(signed(expired)) }),
      );
      fs.appendFileSync(
        path.join(root, 'handoff-fences.jsonl'),
        JSON.stringify({
          status: 'INTENT',
          deploymentId: deployment,
          fenceId: id(81),
          fenceSequence: '2',
        }) + '\n',
      );
      await assert.rejects(() => parent.run(full));
      const result = c.bytes(verified.resultPath).toString();
      for (const secret of [
        ...Object.values(passwords),
        ...Object.values(old),
        read,
        cfg.identity.composition.admission.hmacKey,
      ])
        assert.equal(result.includes(secret), false);
    });
    await test('after all child exits target backends are gone and ready/claims/session/admission business counts unchanged', async () => {
      assert.equal(
        (
          await admin.query(
            "SELECT count(*)::int n FROM pg_stat_activity WHERE datname IN('zhiban_m1_dev','zhiban_m5_native')",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await admin.query(
            "SELECT rolcanlogin FROM pg_roles WHERE rolname='zhiban_reconcile_controller'",
          )
        ).rows[0].rolcanlogin,
        false,
      );
      fs.writeFileSync(hbaFile, 'local zhiban_m1_dev postgres scram-sha-256\n' + ordinaryText, {
        mode: 0o600,
      });
      await admin.query('SELECT pg_reload_conf()');
      await new Promise((r) => setTimeout(r, 150));
      const audit = await connect('zhiban_m1_dev', 'postgres', false, adminPassword);
      assert.deepEqual(await businessSnapshot(audit), beforeBusiness);
      assert.equal(
        (
          await audit.query(
            'SELECT ready FROM zhiban_reconcile.installations WHERE deployment_id=$1',
            [deployment],
          )
        ).rows[0].ready,
        false,
      );
      assert.equal(
        (
          await audit.query(
            'SELECT count(*)::int n FROM zhiban_reconcile.window_database_claims WHERE current_window_id IS NOT NULL',
          )
        ).rows[0].n,
        0,
      );
      await audit.end();
      fs.writeFileSync(hbaFile, ordinaryText, { mode: 0o600 });
      await admin.query('SELECT pg_reload_conf()');
    });
  } finally {
    for (const client of clients) await client.end().catch(() => {});
    if (fs.existsSync(path.join(s.dir, 'data/postmaster.pid')))
      execFileSync(
        '/usr/lib/postgresql/16/bin/pg_ctl',
        ['-D', s.data, '-m', 'immediate', '-w', 'stop'],
        { stdio: 'ignore' },
      );
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
  const evidence = {
    status: 'PASS',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    candidateInventorySha256: source.inventorySha256,
    candidateMigrationSha256: source.inv.migration.aggregateSha256,
    checks,
    build: built && {
      artifactManifestSha256: built.artifactManifestSha256,
      buildManifestSha256: built.buildManifestSha256,
      closureManifestSha256: built.closureManifestSha256,
      files: built.files,
    },
    actualProductCompositionBuilt: true,
    actualRendererEditorAssetsBuilt: true,
    actualArgon2NativeExecuted: true,
    sixRoleLoopbackTcpScramVerified: true,
    oldCredentialNegativeProbesVerified: true,
    disposableClusterStoppedAndRemoved: true,
    existingClustersConnected: false,
    realReceiptIssued: false,
    realGatePublished: false,
    runtimeAccepted: false,
    limitations: [
      'Synthetic test keys/signed expected/compatibility/transport lineage and privileged CLOSED fixture; minimal Native and local corpus',
      'Actual HTTPS pages/unauthenticated Identity and shutdown tested; no authenticated business writes or full browser journey. Test clear adds a controller authorization; other business/terminal row digests unchanged',
      'No real target credentials, artifact delivery, authority signing, target HBA mutation or clear execution',
    ],
  };
  const x = process.argv.indexOf('--output');
  if (x >= 0) fs.writeFileSync(process.argv[x + 1], JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length }));
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
