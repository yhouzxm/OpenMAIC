#!/usr/bin/env node
// LOCAL disposable control-plane tests; synthetic profile, keys, receipts and ACK.
// Never reads the real development root. Does NOT validate a product host or HBA.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { execFileSync } = require('node:child_process'),
  { Client } = require('pg');
const { bootstrap } = require('../m5-terminal/verify-local-pg16.cjs');
const h = require('./handoff-contracts.cjs'),
  e = require('./handoff-executor.cjs');
const { writeExclusive } = require('../m5-terminal/maintenance-lock.cjs');
const id = (n) => `0199ccdd-aabb-7000-8000-${String(n).padStart(12, '0')}`;
const checks = [];
async function test(name, f) {
  await f();
  checks.push({ name, status: 'PASS' });
  console.log('PASS ' + name);
}
(async () => {
  const s = {
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-handoff-executor-')),
    port: 56495,
  };
  fs.chmodSync(s.dir, 0o700);
  const clients = [],
    source = h.sources(),
    deployment = id(1),
    window = id(2),
    credential = id(3),
    d = 'e'.repeat(64),
    nonce = h.sha('f'.repeat(64));
  const root = path.join(s.dir, 'control');
  fs.mkdirSync(root, { mode: 0o700 });
  fs.mkdirSync(path.join(root, 'releases'), { mode: 0o700 });
  const keys = crypto.generateKeyPairSync('ed25519'),
    pub = path.join(root, 'authority.pub');
  writeExclusive(pub, keys.publicKey.export({ format: 'pem', type: 'spki' }));
  const pin = h.publicPin(pub),
    key = keys.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    signed = (p) => Buffer.from(JSON.stringify(h.signed(p, key, pin)) + '\n');
  const template = (n, fields = {}) => ({
    ...JSON.parse(fs.readFileSync(path.join(__dirname, n + '.template.json'))),
    status: 'ISSUED',
    authorityKeySha256: pin.digest,
    ...fields,
  });
  let fileSeq = 0;
  function file(raw, prefix = 'input') {
    const n = path.join(root, prefix + '-' + ++fileSeq + '.json');
    writeExclusive(n, raw);
    return n;
  }
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
  const time = () => ({ issuedAt: Date.now() - 100, expiresAt: Date.now() + 250000 });
  try {
    await bootstrap(s);
    const admin = await connect(),
      b = await connect('zhiban_m1_dev'),
      n = await connect('zhiban_m5_native');
    for (const r of h.LOGIN) await admin.query('ALTER ROLE ' + r + ' LOGIN');
    await admin.query('GRANT CONNECT ON DATABASE zhiban_m5_native TO zhiban_openmaic_runtime');
    const physical = (
      await b.query(
        "SELECT (SELECT system_identifier::text FROM pg_control_system()) cluster,(SELECT oid::text FROM pg_database WHERE datname='zhiban_m1_dev') business,(SELECT oid::text FROM pg_database WHERE datname='zhiban_m5_native') native,pg_postmaster_start_time() start",
      )
    ).rows[0];
    const target = {
      environment: 'LOCAL_DISPOSABLE',
      cluster: physical.cluster,
      businessOid: physical.business,
      nativeOid: physical.native,
      dataDirectory: s.data,
      socketDirectory: s.socket,
      port: s.port,
      origin: 'https://127.0.0.1:3443',
    };
    const before = await h.collect(b, n, false);
    await b.query('BEGIN');
    await b.query('SET LOCAL ROLE zhiban_identity_owner');
    for (const x of source.inv.migration.orderedComponents)
      await b.query(fs.readFileSync(path.join(__dirname, x), 'utf8'));
    await b.query("INSERT INTO zhiban_handoff.schema_migrations VALUES('0001',$1)", [
      source.inv.migration.aggregateSha256,
    ]);
    await b.query('COMMIT');
    const after = await h.collect(b, n);
    await b.query('DROP SCHEMA zhiban_handoff CASCADE');
    const expectedPayload = {
      formatVersion: 1,
      purpose: 'REVIEWED_ORDINARY_HANDOFF_PROFILE',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      authorityKeySha256: pin.digest,
      profile: h.PROFILE,
      sourceBindingsSha256: source.inventorySha256,
      review: {
        sourceKind: 'INDEPENDENT_SHADOW_PG16',
        approvalRef: 'SYNTHETIC_TEST_AUTHORITY_ONLY',
        referenceEvidenceSha256: d,
      },
      before,
      after,
    };
    const expectedRaw = signed(expectedPayload),
      expectedPath = file(expectedRaw),
      expectedDigest = h.sha(expectedRaw);
    writeExclusive(
      path.join(root, 'maintenance.json'),
      JSON.stringify({ status: 'BLOCKED' }) + '\n',
    );
    writeExclusive(
      path.join(root, 'handoff-fences.jsonl'),
      JSON.stringify({
        status: 'INTENT',
        deploymentId: deployment,
        fenceId: id(4),
        fenceSequence: '1',
      }) + '\n',
    );
    writeExclusive(
      path.join(root, 'handoff-current.json'),
      JSON.stringify({ status: 'UNDELIVERED' }) + '\n',
    );
    const base = {
      directory: root,
      authorityPublicKeyPath: pub,
      expectedPath,
      business: b,
      native: n,
      admin,
    };
    await test('trusted purpose/source/extra-field/deadline rejection occurs before owner seed', async () => {
      const a = template('install-approval', {
        approvalId: id(5),
        target,
        sourceBindingsSha256: source.inventorySha256,
        expectedProfileSha256: expectedDigest,
        ...time(),
      });
      for (const change of [
        (x) => {
          x.purpose = 'WRONG';
        },
        (x) => {
          x.extra = true;
        },
        (x) => {
          x.sourceBindingsSha256 = d;
        },
      ]) {
        const bad = structuredClone(a);
        change(bad);
        assert.throws(() => h.verify(signed(bad), pin, 'LOCAL_HANDOFF_INSTALL', source));
      }
      assert.throws(() => h.live({ ...a, expiresAt: Date.now() - 1 }));
      const forged = JSON.parse(signed(a));
      forged.signature = 'a'.repeat(88);
      assert.throws(() =>
        h.verify(Buffer.from(JSON.stringify(forged)), pin, 'LOCAL_HANDOFF_INSTALL', source),
      );
    });
    await test('installer rolls back DDL/ledger when reviewed after profile differs', async () => {
      const wrong = structuredClone(expectedPayload);
      wrong.after.business.complete.schemas[0].owner = 'wrong';
      const raw = signed(wrong),
        xp = file(raw);
      const a = template('install-approval', {
        approvalId: id(6),
        target,
        sourceBindingsSha256: source.inventorySha256,
        expectedProfileSha256: h.sha(raw),
        ...time(),
      });
      await assert.rejects(() =>
        e.install({ ...base, expectedPath: xp, approvalPath: file(signed(a)) }),
      );
      assert.equal((await b.query("SELECT to_regnamespace('zhiban_handoff') ns")).rows[0].ns, null);
    });
    await test('reviewed installer applies only new handoff ledger in one owner transaction', async () => {
      const a = template('install-approval', {
        approvalId: id(7),
        target,
        sourceBindingsSha256: source.inventorySha256,
        expectedProfileSha256: expectedDigest,
        ...time(),
      });
      assert.equal(
        (await e.install({ ...base, approvalPath: file(signed(a)) })).status,
        'INSTALLED_BLOCKED',
      );
      h.profile(await h.collect(b, n), after);
    });
    // Privileged synthetic CLOSED history only; no product/terminal readiness claims.
    await b.query('BEGIN');
    await b.query("SET LOCAL session_replication_role='replica'");
    await b.query(
      "INSERT INTO zhiban_bridge.deployment_registry VALUES($1,'fixture',$2,'0.31.1','0.11.2','0.1.11',$3,'VERIFIED',1,0,0)",
      [deployment, 'd'.repeat(40), d],
    );
    await b.query(
      "INSERT INTO zhiban_reconcile.installations VALUES($1,'terminal-reconciliation-local-v1',$2,$3,$4,$5,$5,$5,$5,$5,false)",
      [deployment, physical.cluster, physical.business, physical.native, d],
    );
    await b.query(
      "INSERT INTO zhiban_reconcile.services VALUES('fixture',$1,'RECONCILE',1,'ACTIVE','zhiban_reconcile_executor')",
      [deployment],
    );
    await b.query(
      "INSERT INTO zhiban_reconcile.service_versions VALUES('fixture',1,'ACTIVE',$1,0)",
      [d],
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
        d,
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
    const closedSequence = (
      await b.query(
        "SELECT sequence::text FROM zhiban_reconcile.control_events WHERE event_type='CLOSED'",
      )
    ).rows[0].sequence;
    await test('direct ACTIVE/CONSUMED insert is rejected, including privileged normal DML', async () => {
      await assert.rejects(
        () =>
          b.query(
            "INSERT INTO zhiban_handoff.host_read_authorizations VALUES($1,$2,$3,1,$4,$4,$4,$4,$4,$4,'ACTIVE')",
            [deployment, id(80), credential, d],
          ),
        { code: '23514' },
      );
      await assert.rejects(
        () =>
          b.query(
            "INSERT INTO zhiban_handoff.clear_authorizations SELECT $1,$2,$3,$4,1,$5,90,$6,$6,$6,$6,$6,pg_backend_pid(),backend_start,pg_postmaster_start_time(),1,2,'CONSUMED' FROM pg_stat_activity WHERE pid=pg_backend_pid()",
            [id(81), deployment, id(80), window, id(82), d],
          ),
        { code: '23514' },
      );
    });
    await test('all-client ACL and new automatic control audit are owner-only and append-only', async () => {
      for (const r of h.LOGIN)
        assert.equal(
          (
            await b.query(
              "SELECT has_table_privilege($1,'zhiban_handoff.authorization_events','SELECT,INSERT,UPDATE,DELETE') ok",
              [r],
            )
          ).rows[0].ok,
          false,
        );
      assert.equal(
        (
          await b.query(
            "SELECT has_function_privilege('zhiban_control_runtime','zhiban_handoff.verify_clear_publication(uuid,text,text)','EXECUTE') ok",
          )
        ).rows[0].ok,
        false,
      );
    });
    const read = 'd'.repeat(64),
      readPath = file(read, 'read-secret'),
      challenge = 'b'.repeat(64),
      challengePath = file(challenge, 'challenge');
    async function prepared(num, seq, business, native) {
      const release = id(num),
        fence = id(num + 1),
        approvalId = id(num + 2),
        handoff = id(num + 3),
        dir = path.join(root, 'releases', release);
      fs.mkdirSync(dir, { mode: 0o700 });
      writeExclusive(path.join(dir, 'control-fixture.txt'), 'NOT_A_PRODUCT_HOST\n');
      const manifestRaw = Buffer.from(
        JSON.stringify({
          formatVersion: 1,
          releaseId: release,
          credentialGenerationId: credential,
          files: [{ path: 'control-fixture.txt', sha256: h.sha('NOT_A_PRODUCT_HOST\n') }],
        }) + '\n',
      );
      writeExclusive(path.join(dir, 'artifact-manifest.json'), manifestRaw);
      const fenceRow = {
        status: 'INTENT',
        deploymentId: deployment,
        fenceId: fence,
        fenceSequence: String(seq),
      };
      if (seq === 1)
        fs.writeFileSync(path.join(root, 'handoff-fences.jsonl'), JSON.stringify(fenceRow) + '\n');
      else
        fs.appendFileSync(path.join(root, 'handoff-fences.jsonl'), JSON.stringify(fenceRow) + '\n');
      fs.writeFileSync(
        path.join(root, 'maintenance.json'),
        JSON.stringify({ status: 'BLOCKED', fenceId: fence, fenceSequence: String(seq) }) + '\n',
      );
      const p = template('prepare-approval', {
        approvalId,
        handoffId: handoff,
        releaseId: release,
        credentialGenerationId: credential,
        deploymentId: deployment,
        target,
        sourceBindingsSha256: source.inventorySha256,
        artifactManifestSha256: h.sha(manifestRaw),
        expectedProfileSha256: expectedDigest,
        configurationSha256: d,
        windowId: window,
        epoch: '1',
        closedEventSequence: closedSequence,
        fenceId: fence,
        fenceSequence: String(seq),
        fenceHistorySha256: h.sha(h.privateBytes(path.join(root, 'handoff-fences.jsonl'))),
        expectedBlockedGateSha256: h.sha(h.privateBytes(path.join(root, 'maintenance.json'))),
        pointerSha256: h.sha(h.privateBytes(path.join(root, 'handoff-current.json'))),
        ...time(),
      });
      const ap = file(signed(p)),
        context = {
          ...base,
          business,
          native,
          approvalPath: ap,
          readSecretPath: readPath,
          challengePath,
        };
      const ack = template('host-ack', {
        releaseId: release,
        credentialGenerationId: credential,
        deploymentId: deployment,
        sourceBindingsSha256: source.inventorySha256,
        artifactManifestSha256: p.artifactManifestSha256,
        configurationSha256: d,
        expectedProfileSha256: expectedDigest,
        challengeSha256: h.sha(challenge),
        validationEvidenceSha256: d,
        compatibilityReceiptsSha256: d,
      });
      for (const k of Object.keys(ack.checks)) ack.checks[k] = true;
      const issuanceDirectory = path.join(root, 'issued-fixture-' + release);
      fs.mkdirSync(issuanceDirectory, { mode: 0o700 });
      const ackRaw = signed(ack),
        hostAckPath = path.join(issuanceDirectory, 'host-validation-ack.json');
      fs.writeFileSync(hostAckPath, ackRaw, { mode: 0o600, flag: 'wx' });
      const receipt = template('handoff-receipt', {
        handoffId: handoff,
        prepareApprovalId: approvalId,
        releaseId: release,
        credentialGenerationId: credential,
        deploymentId: deployment,
        target,
        sourceBindingsSha256: source.inventorySha256,
        artifactManifestSha256: p.artifactManifestSha256,
        configurationSha256: d,
        profileSha256: expectedDigest,
        compatibilityReceiptsSha256: d,
        hostAckSha256: h.sha(ackRaw),
        windowId: window,
        epoch: '1',
        closedEventSequence: closedSequence,
        fenceId: fence,
        fenceSequence: String(seq),
        readAuthorization: {
          deploymentId: deployment,
          releaseId: release,
          permissionDigest: h.sha(read),
        },
      });
      const receiptRaw = signed(receipt),
        receiptPath = path.join(issuanceDirectory, 'handoff-receipt.json');
      fs.writeFileSync(receiptPath, receiptRaw, { mode: 0o600, flag: 'wx' });
      const completion = signed({
        formatVersion: 1,
        status: 'ISSUANCE_COMPLETE',
        purpose: 'LOCAL_ORDINARY_ISSUANCE_COMPLETE',
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        authorityKeySha256: pin.digest,
        approvalSha256: h.sha(signed(p)),
        sourceBindingsSha256: source.inventorySha256,
        groupKind: 'HANDOFF_ACK',
        releaseId: release,
        credentialGenerationId: credential,
        deploymentId: deployment,
        files: {
          [path.basename(receiptPath)]: h.sha(receiptRaw),
          [path.basename(hostAckPath)]: h.sha(ackRaw),
        },
        launchAllowed: false,
      });
      fs.writeFileSync(path.join(issuanceDirectory, 'issuance-complete.json'), completion, {
        mode: 0o600,
        flag: 'wx',
      });
      return { context: { ...context, hostAckPath, receiptPath }, p, receipt, receiptRaw, ack };
    }
    const r = await prepared(10, 1, b, n);
    await test('prepare registers exact release read scope without a future receipt', async () => {
      assert.equal((await e.register(r.context)).status, 'REGISTERED_UNACTIVATED');
      assert.equal(
        (
          await b.query(
            'SELECT status,handoff_receipt_digest FROM zhiban_handoff.host_read_authorizations',
          )
        ).rows[0].handoff_receipt_digest,
        null,
      );
    });
    await test('prepare approval is single-use and source/profile registration stays immutable', async () => {
      await assert.rejects(() => e.register(r.context));
      await assert.rejects(
        () => b.query('UPDATE zhiban_handoff.host_read_authorizations SET epoch=2'),
        { code: '23514' },
      );
    });
    await test('incomplete validation ACK and stale challenge cannot authorize owner seal', async () => {
      const ack = structuredClone(r.ack);
      ack.checks.physicalClosure = false;
      const receipt = structuredClone(r.receipt);
      receipt.hostAckSha256 = h.sha(signed(ack));
      const owner = require('./handoff-owner.cjs');
      assert.throws(() =>
        owner.bindReceipt(
          h.verify(signed(receipt), pin, 'LOCAL_PRODUCT_HANDOFF_VERIFIED'),
          h.verify(h.privateBytes(r.context.approvalPath), pin, 'LOCAL_PRODUCT_HANDOFF_PREPARE'),
          h.verify(signed(ack), pin, 'LOCAL_HANDOFF_HOST_ACK'),
          read,
        ),
      );
      const got = h.verify(signed(r.ack), pin, 'LOCAL_HANDOFF_HOST_ACK');
      assert.notEqual(got.payload.challengeSha256, h.sha('a'.repeat(64)));
      await assert.rejects(
        () =>
          owner.seal(
            e.scope(r.context),
            h.verify(h.privateBytes(r.context.approvalPath), pin, 'LOCAL_PRODUCT_HANDOFF_PREPARE'),
            h.expected(expectedRaw, pin),
            h.verify(r.receiptRaw, pin, 'LOCAL_PRODUCT_HANDOFF_VERIFIED'),
            got,
            read,
            h.sha('a'.repeat(64)),
          ),
        /Fresh ACK challenge required/,
      );
      assert.equal(
        (
          await b.query(
            'SELECT status FROM zhiban_handoff.host_read_authorizations WHERE release_id=$1',
            [r.p.releaseId],
          )
        ).rows[0].status,
        'REGISTERED',
      );
    });
    await test('seal binds signed synthetic ACK once and atomically publishes same-generation pointer under BLOCKED', async () => {
      const result = await e.seal(r.context);
      assert.equal(result.status, 'HANDOFF_VERIFIED');
      const pointer = JSON.parse(h.privateBytes(path.join(root, 'handoff-current.json')));
      assert.equal(pointer.handoffReceiptSha256, h.sha(r.receiptRaw));
      assert.equal(
        JSON.parse(h.privateBytes(path.join(root, 'maintenance.json'))).status,
        'BLOCKED',
      );
      await assert.rejects(() => e.seal(r.context));
      const audit = (
        await b.query(
          'SELECT old_status,new_status FROM zhiban_handoff.authorization_events ORDER BY event_sequence',
        )
      ).rows;
      assert.deepEqual(audit.slice(-2), [
        { old_status: null, new_status: 'REGISTERED' },
        { old_status: 'REGISTERED', new_status: 'ACTIVE' },
      ]);
      await assert.rejects(() => b.query('DELETE FROM zhiban_handoff.authorization_events'), {
        code: '23514',
      });
    });
    await test('private artifacts reject symlinks/hardlinks/byte drift and higher reserved fence blocks old permission', async () => {
      const f = path.join(root, 'linked.json');
      fs.linkSync(r.context.receiptPath, f);
      assert.throws(() => h.privateBytes(f));
      fs.unlinkSync(f);
      fs.symlinkSync(r.context.receiptPath, f);
      assert.throws(() => h.privateBytes(f));
      fs.unlinkSync(f);
      const extra = path.join(root, 'releases', r.p.releaseId, 'unbound.mjs');
      writeExclusive(extra, 'unbound');
      const declared = JSON.parse(
        h.privateBytes(path.join(root, 'releases', r.p.releaseId, 'artifact-manifest.json')),
      );
      assert.throws(() =>
        h.artifacts(
          path.join(root, 'releases', r.p.releaseId),
          declared,
          r.p.artifactManifestSha256,
        ),
      );
      fs.unlinkSync(extra);
      const manifest = JSON.parse(
        h.privateBytes(path.join(root, 'releases', r.p.releaseId, 'artifact-manifest.json')),
      );
      manifest.files[0].sha256 = d;
      assert.throws(() =>
        h.artifacts(
          path.join(root, 'releases', r.p.releaseId),
          manifest,
          r.p.artifactManifestSha256,
        ),
      );
      assert.throws(() =>
        e.history(
          Buffer.from(
            JSON.stringify({
              status: 'INTENT',
              deploymentId: deployment,
              fenceId: id(99),
              fenceSequence: '2',
            }) + '\n',
          ),
          r.p,
        ),
      );
    });
    await test('shared maintenance flock prevents a second delivery owner from acting', async () => {
      const m = require('../m5-terminal/maintenance-lock.cjs'),
        lock = m.acquire(root, 'handoff', true);
      try {
        await assert.rejects(() => e.seal(r.context));
      } finally {
        lock.release();
      }
    });
    const controllerSecret = 'a'.repeat(64),
      clearSecret = 'c'.repeat(64),
      controllerSecretPath = file(controllerSecret, 'controller'),
      clearSecretPath = file(clearSecret, 'clear');
    async function clearContext(r, business, native, approvalNum) {
      await admin.query('ALTER ROLE zhiban_reconcile_controller LOGIN');
      const controller = await connect('zhiban_m1_dev', 'zhiban_reconcile_controller');
      const gate = template('cleared-gate', {
          approvalId: id(approvalNum),
          releaseId: r.p.releaseId,
          credentialGenerationId: credential,
          deploymentId: deployment,
          windowId: window,
          epoch: '1',
          fenceId: r.p.fenceId,
          fenceSequence: r.p.fenceSequence,
          fenceHistorySha256: h.sha(h.privateBytes(path.join(root, 'handoff-fences.jsonl'))),
          pointerSha256: h.sha(h.privateBytes(path.join(root, 'handoff-current.json'))),
          handoffReceiptSha256: h.sha(r.receiptRaw),
          artifactManifestSha256: r.p.artifactManifestSha256,
        }),
        gateRaw = signed(gate);
      const logging = (
        await admin.query(
          "SELECT name,setting FROM pg_settings WHERE name IN('log_statement','log_parameter_max_length','log_parameter_max_length_on_error','log_min_error_statement') ORDER BY name",
        )
      ).rows;
      const p = template('clear-approval', {
        ...Object.fromEntries(
          Object.keys(gate)
            .filter(
              (k) =>
                k.endsWith('Id') || k.endsWith('Sha256') || ['epoch', 'fenceSequence'].includes(k),
            )
            .map((k) => [k, gate[k]]),
        ),
        handoffId: r.p.handoffId,
        closedEventSequence: closedSequence,
        target,
        hostAckSha256: r.receipt.hostAckSha256,
        sourceBindingsSha256: source.inventorySha256,
        profileSha256: expectedDigest,
        hbaSha256: h.sha(h.privateBytes(path.join(s.data, 'pg_hba.conf'))),
        loggingSha256: h.sha(h.canonical(logging)),
        postmasterStart: physical.start.toISOString(),
        expectedBlockedGateSha256: h.sha(h.privateBytes(path.join(root, 'maintenance.json'))),
        targetGateSha256: h.sha(gateRaw),
        ...time(),
      });
      return {
        ...base,
        business,
        native,
        controller,
        approvalPath: file(signed(p)),
        receiptPath: r.context.receiptPath,
        gatePath: file(gateRaw),
        hbaPath: path.join(s.data, 'pg_hba.conf'),
        controllerSecretPath,
        clearSecretPath,
        p,
        gateRaw,
      };
    }
    const c1 = await clearContext(r, b, n, 20);
    await test('clear performs nonrotating bootstrap, known DB COMMIT, fresh check and exact gate publication', async () => {
      const result = await e.clear(c1);
      assert.equal(result.status, 'CLEARED_FILE_PUBLISHED');
      assert.equal(result.hostStarted, false);
      assert.equal(h.sha(h.privateBytes(path.join(root, 'maintenance.json'))), h.sha(c1.gateRaw));
      assert.equal(
        (
          await admin.query(
            "SELECT rolcanlogin FROM pg_roles WHERE rolname='zhiban_reconcile_controller'",
          )
        ).rows[0].rolcanlogin,
        false,
      );
    });
    const control = await connect('zhiban_m1_dev', 'zhiban_control_runtime'),
      nativeRuntime = await connect('zhiban_m5_native', 'zhiban_openmaic_runtime');
    await test('ordinary limited loader requires matching signature, DB commit, latest scope and all ledgers', async () => {
      assert.equal(
        (
          await e.verifyLaunch(
            { ...base, receiptPath: r.context.receiptPath },
            control,
            nativeRuntime,
            read,
          )
        ).status,
        'CONTROL_GATE_VERIFIED',
      );
      await assert.rejects(() =>
        e.verifyLaunch(
          { ...base, receiptPath: r.context.receiptPath },
          control,
          nativeRuntime,
          '0'.repeat(64),
        ),
      );
    });
    await control.end();
    await nativeRuntime.end();
    const b2 = await connect('zhiban_m1_dev'),
      n2 = await connect('zhiban_m5_native');
    await test('unexpected namespace and new unrelated role are rejected by complete profile', async () => {
      await b2.query('CREATE SCHEMA unexpected');
      assert.throws(() =>
        h.profile(
          {
            ...after,
            business: {
              ...after.business,
              complete: { ...after.business.complete, userNamespaceInventory: [] },
            },
          },
          after,
        ),
      );
      await assert.rejects(async () => h.profile(await h.collect(b2, n2), after));
      await b2.query('DROP SCHEMA unexpected');
      await admin.query('CREATE ROLE unrelated NOLOGIN');
      await assert.rejects(async () => h.profile(await h.collect(b2, n2), after));
      await admin.query('DROP ROLE unrelated');
    });
    const r2 = await prepared(30, 2, b2, n2);
    await e.register(r2.context);
    await e.seal(r2.context);
    const c2 = await clearContext(r2, b2, n2, 40);
    const realQuery = c2.controller.query.bind(c2.controller);
    c2.controller.query = async (sql, args) => {
      if (sql.includes('verify_clear_publication')) throw Error('Injected after durable COMMIT');
      return realQuery(sql, args);
    };
    await test('failure after durable COMMIT retains BLOCKED, no publisher replay and closes partial bootstrap sessions', async () => {
      await assert.rejects(() => e.clear(c2));
      assert.equal(
        JSON.parse(h.privateBytes(path.join(root, 'maintenance.json'))).status,
        'BLOCKED',
      );
      assert.equal(
        (
          await admin.query(
            "SELECT rolcanlogin FROM pg_roles WHERE rolname='zhiban_reconcile_controller'",
          )
        ).rows[0].rolcanlogin,
        false,
      );
      const audit = await connect('zhiban_m1_dev');
      assert.equal(
        (await audit.query('SELECT count(*)::int n FROM zhiban_handoff.clear_commits')).rows[0].n,
        2,
      );
      assert.equal(
        (await audit.query('SELECT count(*)::int n FROM zhiban_handoff.guard_scopes')).rows[0].n,
        0,
      );
      await audit.end();
    });
    const inspectorOwner = await connect('zhiban_m1_dev');
    await admin.query('ALTER ROLE zhiban_reconcile_controller LOGIN');
    const inspector = await connect('zhiban_m1_dev', 'zhiban_reconcile_controller');
    await inspectorOwner.query(
      'UPDATE zhiban_reconcile.controller_authorizations SET backend_pid=$2,backend_start=(SELECT backend_start FROM pg_stat_activity WHERE pid=$2),expires_at=$3 WHERE deployment_id=$1',
      [deployment, inspector.processID, Date.now() + 200000],
    );
    await inspectorOwner.end();
    await admin.query('ALTER ROLE zhiban_reconcile_controller NOLOGIN');
    await test('fresh exact ACK observes control commit without publishing or granting write replay', async () => {
      const result = await e.inspect(base, inspector, controllerSecret, id(40));
      assert.equal(result.status, 'COMMITTED');
      assert.equal(result.publishGateAllowed, false);
      assert.equal(result.replayAllowed, false);
      assert.equal(
        JSON.parse(h.privateBytes(path.join(root, 'maintenance.json'))).status,
        'BLOCKED',
      );
    });
    await inspector.end();
    const b3 = await connect('zhiban_m1_dev'),
      n3 = await connect('zhiban_m5_native'),
      ctrl3 = await connect('zhiban_m1_dev', 'zhiban_control_runtime');
    await test('newer committed release prevents old per-release activation even at unchanged epoch', async () => {
      const facts = (
        await ctrl3.query('SELECT zhiban_handoff.inspect_host_installation($1,$2,$3) value', [
          deployment,
          r.p.releaseId,
          read,
        ])
      ).rows[0].value;
      assert.equal(facts.activationStatus, 'REGISTERED_UNACTIVATED');
      assert.equal(facts.fenceSequence, '2');
    });
    await test('facts read lock serializes owner revocation; after commit token stops working', async () => {
      await ctrl3.query('BEGIN');
      await ctrl3.query('SELECT zhiban_handoff.inspect_host_installation($1,$2,$3)', [
        deployment,
        r2.p.releaseId,
        read,
      ]);
      await b3.query("SET lock_timeout='100ms'");
      await assert.rejects(
        () =>
          b3.query(
            "UPDATE zhiban_handoff.host_read_authorizations SET status='REVOKED' WHERE release_id=$1",
            [r2.p.releaseId],
          ),
        { code: '55P03' },
      );
      await ctrl3.query('COMMIT');
      const revoke = template('revoke-approval', {
        approvalId: id(50),
        deploymentId: deployment,
        releaseId: r2.p.releaseId,
        sourceBindingsSha256: source.inventorySha256,
        hostPermissionSha256: h.sha(read),
        target,
        expectedProfileSha256: expectedDigest,
        ...time(),
      });
      assert.equal(
        (await e.revoke({ ...base, business: b3, native: n3, approvalPath: file(signed(revoke)) }))
          .status,
        'REVOKED',
      );
      await assert.rejects(
        () =>
          ctrl3.query('SELECT zhiban_handoff.inspect_host_installation($1,$2,$3)', [
            deployment,
            r2.p.releaseId,
            read,
          ]),
        { code: '42501' },
      );
      await assert.rejects(
        () =>
          b3.query(
            "UPDATE zhiban_handoff.host_read_authorizations SET status='ACTIVE' WHERE release_id=$1",
            [r2.p.releaseId],
          ),
        { code: '23514' },
      );
    });
    await ctrl3.end();
    const r3 = await prepared(60, 3, b3, n3);
    await e.register(r3.context);
    await e.seal(r3.context);
    const rev3 = template('revoke-approval', {
      approvalId: id(65),
      deploymentId: deployment,
      releaseId: r3.p.releaseId,
      sourceBindingsSha256: source.inventorySha256,
      hostPermissionSha256: h.sha(read),
      target,
      expectedProfileSha256: expectedDigest,
      ...time(),
    });
    await e.revoke({ ...base, business: b3, native: n3, approvalPath: file(signed(rev3)) });
    const c3 = await clearContext(r3, b3, n3, 66);
    await test('revocation before clear bootstrap rejects seeding, preserves BLOCKED and closes controller', async () => {
      await assert.rejects(() => e.clear(c3));
      assert.equal(
        JSON.parse(h.privateBytes(path.join(root, 'maintenance.json'))).status,
        'BLOCKED',
      );
      const x = await connect('zhiban_m1_dev');
      assert.equal(
        (
          await x.query(
            'SELECT count(*)::int n FROM zhiban_handoff.clear_authorizations WHERE approval_id=$1',
            [id(66)],
          )
        ).rows[0].n,
        0,
      );
      await x.end();
      assert.equal(
        (
          await admin.query(
            "SELECT rolcanlogin FROM pg_roles WHERE rolname='zhiban_reconcile_controller'",
          )
        ).rows[0].rolcanlogin,
        false,
      );
    });
    const b4 = await connect('zhiban_m1_dev'),
      n4 = await connect('zhiban_m5_native');
    const r4 = await prepared(70, 4, b4, n4);
    await e.register(r4.context);
    await e.seal(r4.context);
    const c4 = await clearContext(r4, b4, n4, 76);
    const query4 = c4.controller.query.bind(c4.controller);
    let commitAckLost = false;
    c4.controller.query = async (sql, args) => {
      if (sql.includes('commit_clear'))
        await test('guarded clear prevents concurrent owner revocation before control COMMIT', async () => {
          const rival = await connect('zhiban_m1_dev');
          try {
            await rival.query("SET lock_timeout='100ms'");
            await assert.rejects(
              () =>
                rival.query(
                  "UPDATE zhiban_handoff.host_read_authorizations SET status='REVOKED' WHERE release_id=$1",
                  [r4.p.releaseId],
                ),
              { code: '55P03' },
            );
          } finally {
            await rival.end();
          }
        });
      const result = await query4(sql, args);
      if (sql === 'COMMIT' && !commitAckLost) {
        commitAckLost = true;
        throw Error('Injected committed ACK loss');
      }
      return result;
    };
    await test('lost COMMIT ACK never publishes dormant signed gate or retries control write', async () => {
      await assert.rejects(() => e.clear(c4));
      assert.equal(commitAckLost, true);
      assert.equal(
        JSON.parse(h.privateBytes(path.join(root, 'maintenance.json'))).status,
        'BLOCKED',
      );
    });
    const b5 = await connect('zhiban_m1_dev'),
      n5 = await connect('zhiban_m5_native');
    await admin.query('ALTER ROLE zhiban_reconcile_controller LOGIN');
    const ackC = await connect('zhiban_m1_dev', 'zhiban_reconcile_controller');
    await b5.query(
      'UPDATE zhiban_reconcile.controller_authorizations SET backend_pid=$2,backend_start=(SELECT backend_start FROM pg_stat_activity WHERE pid=$2),expires_at=$3 WHERE deployment_id=$1',
      [deployment, ackC.processID, Date.now() + 200000],
    );
    await admin.query('ALTER ROLE zhiban_reconcile_controller NOLOGIN');
    await test('unknown COMMIT is exactly observed COMMITTED, inspection leaves gate and write state unchanged', async () => {
      const before = (await b5.query('SELECT count(*)::int n FROM zhiban_handoff.clear_commits'))
        .rows[0].n;
      assert.equal((await e.inspect(base, ackC, controllerSecret, id(76))).status, 'COMMITTED');
      assert.equal(
        (await b5.query('SELECT count(*)::int n FROM zhiban_handoff.clear_commits')).rows[0].n,
        before,
      );
      assert.equal(
        JSON.parse(h.privateBytes(path.join(root, 'maintenance.json'))).status,
        'BLOCKED',
      );
    });
    await ackC.end();
    const bFinal = b5;
    await test('handoff changes no ready/service/window/claim/grant/proof or tenant business state', async () => {
      assert.equal(
        (await bFinal.query('SELECT ready FROM zhiban_reconcile.installations')).rows[0].ready,
        false,
      );
      assert.equal(
        (await bFinal.query('SELECT epoch::text,phase FROM zhiban_reconcile.windows')).rows[0]
          .phase,
        'CLOSED',
      );
      assert.equal(
        (
          await bFinal.query(
            'SELECT count(*)::int n FROM zhiban_reconcile.window_database_claims WHERE current_window_id IS NOT NULL',
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (await bFinal.query('SELECT count(*)::int n FROM zhiban_reconcile.grants')).rows[0].n,
        0,
      );
      assert.equal(
        (await bFinal.query('SELECT count(*)::int n FROM zhiban_reconcile.proofs')).rows[0].n,
        0,
      );
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
    candidateInventorySha256: source.inventorySha256,
    candidateMigrationSha256: source.inv.migration.aggregateSha256,
    checks,
    disposableClusterOnly: true,
    existingClustersConnected: false,
    temporaryClusterStoppedAndRemoved: true,
    runtimeAccepted: false,
    realReceiptIssued: false,
    realGatePublished: false,
    fixtureControlGatePublished: true,
    limitations: [
      'Synthetic privileged replica CLOSED fixture and test authority/profile/ACK; no independent real-target provenance',
      'Minimal Native and control-fixture leaf only; full host/native ABI/dependency closure/TCP-HBA/old password/compatibility receipt validation NOT_RUN',
      'No real target installer/receipt/launcher/clear execution; complete OS crash/restart matrix deferred',
    ],
  };
  const x = process.argv.indexOf('--output');
  if (x >= 0) fs.writeFileSync(process.argv[x + 1], JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ status: 'PASS', checks: checks.length }));
})().catch((e) => {
  console.error(e.message);

  process.exitCode = 1;
});
