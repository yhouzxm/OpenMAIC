// Only invoked by the disposable PG16 fixture; synthetic authority never becomes real approval.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict'),
  https = require('node:https');
const { execFileSync } = require('node:child_process');
const h = require('./handoff-contracts.cjs'),
  c = require('./release-contract.cjs'),
  issuer = require('./receipt-issuer.cjs'),
  launcher = require('./ordinary-launcher.cjs'),
  m = require('../m5-terminal/maintenance-lock.cjs');
function tlsFixture(dir) {
  const d = path.join(dir, 'tls-staging');
  fs.mkdirSync(d, { mode: 0o700 });
  const run = (a) => execFileSync('/usr/bin/openssl', a, { cwd: d, stdio: 'ignore' });
  run([
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'ca.key',
    '-out',
    'ca.pem',
    '-days',
    '2',
    '-subj',
    '/CN=Disposable Zhiban CA',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign,cRLSign',
  ]);
  run([
    'req',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    'leaf.key',
    '-out',
    'leaf.csr',
    '-subj',
    '/CN=127.0.0.1',
  ]);
  fs.writeFileSync(
    path.join(d, 'ext'),
    'subjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\n',
    { mode: 0o600 },
  );
  run([
    'x509',
    '-req',
    '-in',
    'leaf.csr',
    '-CA',
    'ca.pem',
    '-CAkey',
    'ca.key',
    '-CAcreateserial',
    '-out',
    'leaf.pem',
    '-days',
    '1',
    '-extfile',
    'ext',
  ]);
  for (const f of fs.readdirSync(d)) fs.chmodSync(path.join(d, f), 0o600);
  return {
    certificatePath: path.join(d, 'leaf.pem'),
    privateKeyPath: path.join(d, 'leaf.key'),
    caPath: path.join(d, 'ca.pem'),
  };
}
async function run(x) {
  const {
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
  } = x;
  const outputDirectory = path.join(root, 'issued');
  fs.mkdirSync(outputDirectory, { mode: 0o700 });
  const reviewer = crypto.generateKeyPairSync('ed25519'),
    reviewerPublicKeyPath = privateInput(
      reviewer.publicKey.export({ type: 'spki', format: 'pem' }),
    ),
    reviewPin = h.publicPin(reviewerPublicKeyPath),
    reviewKey = reviewer.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const issuerKeyPath = path.join(s.dir, 'issuer.key');
  m.writeExclusive(issuerKeyPath, key);
  const common = {
    controlDirectory: root,
    authorityPublicKeyPath: full.authorityPublicKeyPath,
    reviewerPublicKeyPath,
    issuerKeyPath,
    outputDirectory,
  };
  const previousReceiptPaths = Object.fromEntries(
    ['identity', 'academic', 'learning', 'assessment', 'content'].map((k) => [
      k,
      privateInput(JSON.stringify({ syntheticPriorReceipt: k, reviewOnly: true })),
    ]),
  );
  const proposalInput = {
      releaseDirectory: built.directory,
      authorityPublicKeyPath: full.authorityPublicKeyPath,
      previousReceiptPaths,
    },
    proposal = issuer.proposeBundle(proposalInput);
  let seq = 100;
  function approval(kind, bindings, overrides = {}) {
    const p = {
      formatVersion: 1,
      status: 'ISSUED',
      purpose: 'LOCAL_ORDINARY_ISSUANCE_APPROVAL',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      authorityKeySha256: reviewPin.digest,
      issuerKeySha256: pin.digest,
      controlDirectory: root,
      approvalId: id(++seq),
      kind,
      sourceBindingsSha256: source.inventorySha256,
      reviewRef: 'SYNTHETIC_DISPOSABLE_ONLY',
      bindings,
      issuedAt: Date.now() - 100,
      expiresAt: Date.now() + 280000,
      ...overrides,
    };
    return privateInput(Buffer.from(JSON.stringify(h.signed(p, reviewKey, reviewPin)) + '\n'));
  }
  const bindings = {
    compatibilityPayloadSha256: c.sha(c.canonical(proposal.compatibility)),
    tlsPayloadSha256: c.sha(c.canonical(proposal.tls)),
  };
  let bundle, issued;
  await test('issuer rejects wrong independent review, mixed generation and wrong private key before completion; failed intent is not replayable', async () => {
    const wrong = approval('COMPATIBILITY_TLS', { ...bindings, tlsPayloadSha256: 'a'.repeat(64) });
    await assert.rejects(() =>
      issuer.issueBundle({ ...common, ...proposalInput, reviewApprovalPath: wrong }),
    );
    const wrongKey = path.join(s.dir, 'wrong.key');
    m.writeExclusive(wrongKey, reviewKey);
    const reviewApprovalPath = approval('COMPATIBILITY_TLS', bindings),
      opts = { ...common, ...proposalInput, reviewApprovalPath, issuerKeyPath: wrongKey };
    await assert.rejects(() => issuer.issueBundle(opts), /key mismatch/);
    const approvalId = JSON.parse(c.bytes(reviewApprovalPath)).payload.approvalId;
    assert.equal(
      fs.existsSync(path.join(outputDirectory, approvalId, 'issuance-complete.json')),
      false,
    );
    await assert.rejects(() => issuer.issueBundle({ ...opts, issuerKeyPath }), { code: 'EEXIST' });
    const exp = approval('COMPATIBILITY_TLS', bindings, { expiresAt: Date.now() - 1 });
    await assert.rejects(() =>
      issuer.issueBundle({ ...common, ...proposalInput, reviewApprovalPath: exp }),
    );
  });
  await test('partial signed output without committed group is rejected and cannot be replayed', async () => {
    const reviewApprovalPath = approval('COMPATIBILITY_TLS', bindings),
      aid = JSON.parse(c.bytes(reviewApprovalPath)).payload.approvalId,
      write = m.writeExclusive;
    m.writeExclusive = (file, raw) => {
      if (file === path.join(outputDirectory, aid, 'tls-receipt.json'))
        throw Error('INJECTED_PARTIAL');
      return write(file, raw);
    };
    try {
      await assert.rejects(
        () => issuer.issueBundle({ ...common, ...proposalInput, reviewApprovalPath }),
        { code: 'ISSUANCE_NOT_COMMITTED' },
      );
    } finally {
      m.writeExclusive = write;
    }
    const partial = path.join(outputDirectory, aid, 'compatibility-receipts.json');
    assert.equal(fs.existsSync(partial), true);
    assert.throws(() =>
      require('./receipt-completion.cjs').check(
        partial,
        c.bytes(full.authorityPublicKeyPath),
        source.inventorySha256,
      ),
    );
    await assert.rejects(
      () => issuer.issueBundle({ ...common, ...proposalInput, reviewApprovalPath }),
      { code: 'EEXIST' },
    );
  });
  await test('same issuance approval cannot replay into another output directory or maintenance root', async () => {
    const reviewApprovalPath = approval('COMPATIBILITY_TLS', bindings),
      opts = { ...common, ...proposalInput, reviewApprovalPath };
    await issuer.issueBundle(opts);
    const elsewhere = path.join(root, 'alternate-outputs');
    fs.mkdirSync(elsewhere, { mode: 0o700 });
    await assert.rejects(() => issuer.issueBundle({ ...opts, outputDirectory: elsewhere }), {
      code: 'EEXIST',
    });
    await assert.rejects(
      () => issuer.issueBundle({ ...opts, controlDirectory: elsewhere }),
      /approval/,
    );
  });
  await test('independent reviewer authorizes exact same-generation compatibility and TLS outputs with a final complete marker', async () => {
    bundle = await issuer.issueBundle({
      ...common,
      ...proposalInput,
      reviewApprovalPath: approval('COMPATIBILITY_TLS', bindings),
    });
    assert.equal(bundle.status, 'ISSUED_LOCAL');
    assert.equal(Object.keys(bundle.files).length, 2);
    assert.equal(fs.existsSync(path.join(bundle.directory, 'issuance-complete.json')), true);
  });
  // Refresh the independently synthesized management observation before each fresh child.
  const t = JSON.parse(c.bytes(full.transportEvidencePath)).payload;
  t.observedAt = Date.now();
  t.expiresAt = Date.now() + 250000;
  const validation = {
    ...full,
    compatibilityReceiptPath: path.join(bundle.directory, 'compatibility-receipts.json'),
    transportEvidencePath: privateInput(signed(t)),
  };
  await test('incomplete live validation produces no ACK or complete issuance and removes its credential request file', async () => {
    const missing = { ...validation, transportEvidencePath: null },
      reviewApprovalPath = approval('HANDOFF_ACK', issuer.validationBindings(missing));
    await assert.rejects(
      () => issuer.issueHandoff({ ...common, validation: missing, reviewApprovalPath }),
      /Incomplete/,
    );
    const aid = JSON.parse(c.bytes(reviewApprovalPath)).payload.approvalId;
    assert.equal(fs.existsSync(path.join(outputDirectory, aid, 'host-validation-ack.json')), false);
    assert.equal(
      fs.readdirSync(root).some((n) => /^validation-.*\.request\.json$/.test(n)),
      false,
    );
  });
  await test('fresh child signed ACK and handoff receipt bind actual challenge, evidence, compatibility and generation', async () => {
    issued = await issuer.issueHandoff({
      ...common,
      validation,
      reviewApprovalPath: approval('HANDOFF_ACK', issuer.validationBindings(validation)),
    });
    const ack = JSON.parse(
      c.bytes(path.join(issued.directory, 'host-validation-ack.json')),
    ).payload;
    assert.equal(
      ack.compatibilityReceiptsSha256,
      c.sha(c.bytes(validation.compatibilityReceiptPath)),
    );
    assert.equal(ack.challengeSha256, c.sha(c.bytes(issued.challengePath).toString().trim()));
    assert.equal(
      Object.values(ack.checks).every((v) => v === true),
      true,
    );
  });
  const launchInput = {
    directory: root,
    expectedPath: full.expectedPath,
    authorityPublicKeyPath: full.authorityPublicKeyPath,
    receiptPath: path.join(issued.directory, 'handoff-receipt.json'),
    compatibilityReceiptPath: validation.compatibilityReceiptPath,
    tlsReceiptPath: path.join(bundle.directory, 'tls-receipt.json'),
  };
  await test('BLOCKED gate still rejects a fully signed ordinary release without publishing or repairing flags', async () => {
    const before = c.bytes(path.join(root, 'maintenance.json'));
    await assert.rejects(() => launcher.launch(launchInput));
    assert.deepEqual(c.bytes(path.join(root, 'maintenance.json')), before);
  });
  async function ownerConnections() {
    fs.writeFileSync(
      hbaFile,
      'local zhiban_m1_dev,zhiban_m5_native postgres scram-sha-256\nlocal zhiban_m1_dev zhiban_reconcile_controller scram-sha-256\n' +
        ordinaryText,
      { mode: 0o600 },
    );
    await admin.query('SELECT pg_reload_conf()');
    await new Promise((r) => setTimeout(r, 150));
    return [
      await connect('zhiban_m1_dev', 'postgres', false, adminPassword),
      await connect('zhiban_m5_native', 'postgres', false, adminPassword),
    ];
  }
  let [business, native] = await ownerConnections();
  const e = require('./handoff-executor.cjs');
  m.writeExclusive(
    path.join(root, 'handoff-permit-' + p.approvalId + '.json'),
    JSON.stringify({ approvalSha256: c.sha(c.bytes(full.approvalPath)) }),
  );
  const base = {
    directory: root,
    expectedPath: full.expectedPath,
    authorityPublicKeyPath: full.authorityPublicKeyPath,
    admin,
    business,
    native,
  };
  const readSecretPath = privateInput(read);
  await e.seal({
    ...base,
    approvalPath: full.approvalPath,
    receiptPath: launchInput.receiptPath,
    hostAckPath: path.join(issued.directory, 'host-validation-ack.json'),
    challengePath: issued.challengePath,
    readSecretPath,
  });
  const template = (name, values) => ({
    ...JSON.parse(fs.readFileSync(path.join(__dirname, name + '.template.json'))),
    status: 'ISSUED',
    authorityKeySha256: pin.digest,
    ...values,
  });
  const gate = template('cleared-gate', {
    approvalId: id(150),
    releaseId: p.releaseId,
    credentialGenerationId: p.credentialGenerationId,
    deploymentId: p.deploymentId,
    windowId: p.windowId,
    epoch: p.epoch,
    fenceId: p.fenceId,
    fenceSequence: p.fenceSequence,
    fenceHistorySha256: c.sha(c.bytes(path.join(root, 'handoff-fences.jsonl'))),
    pointerSha256: c.sha(c.bytes(path.join(root, 'handoff-current.json'))),
    handoffReceiptSha256: c.sha(c.bytes(launchInput.receiptPath)),
    artifactManifestSha256: p.artifactManifestSha256,
  });
  const gateRaw = signed(gate),
    receipt = JSON.parse(c.bytes(launchInput.receiptPath)).payload;
  const logging = (
    await admin.query(
      "SELECT name,setting FROM pg_settings WHERE name IN('log_statement','log_parameter_max_length','log_parameter_max_length_on_error','log_min_error_statement') ORDER BY name",
    )
  ).rows;
  const controllerPassword = crypto.randomBytes(32).toString('hex');
  // Generated test secret only; not returned in evidence.
  await admin.query(
    "ALTER ROLE zhiban_reconcile_controller LOGIN PASSWORD '" + controllerPassword + "'",
  );
  const controller = await connect(
    'zhiban_m1_dev',
    'zhiban_reconcile_controller',
    false,
    controllerPassword,
  );
  const clear = template('clear-approval', {
    ...Object.fromEntries(
      Object.keys(gate)
        .filter(
          (k) => k.endsWith('Id') || k.endsWith('Sha256') || ['epoch', 'fenceSequence'].includes(k),
        )
        .map((k) => [k, gate[k]]),
    ),
    handoffId: p.handoffId,
    closedEventSequence: p.closedEventSequence,
    target: p.target,
    hostAckSha256: receipt.hostAckSha256,
    sourceBindingsSha256: source.inventorySha256,
    profileSha256: p.expectedProfileSha256,
    hbaSha256: c.sha(c.bytes(hbaFile)),
    loggingSha256: c.sha(c.canonical(logging)),
    postmasterStart: (
      await admin.query('SELECT pg_postmaster_start_time() s')
    ).rows[0].s.toISOString(),
    expectedBlockedGateSha256: c.sha(c.bytes(path.join(root, 'maintenance.json'))),
    targetGateSha256: c.sha(gateRaw),
    issuedAt: Date.now() - 100,
    expiresAt: Date.now() + 280000,
  });
  await e.clear({
    ...base,
    controller,
    approvalPath: privateInput(signed(clear)),
    receiptPath: launchInput.receiptPath,
    gatePath: privateInput(gateRaw),
    hbaPath: hbaFile,
    controllerSecretPath: privateInput('a'.repeat(64)),
    clearSecretPath: privateInput('b'.repeat(64)),
  });
  await controller.end();
  fs.writeFileSync(hbaFile, ordinaryText, { mode: 0o600 });
  await admin.query('SELECT pg_reload_conf()');
  await new Promise((r) => setTimeout(r, 150));
  const ca = c.bytes(path.join(built.directory, 'tls/ca.pem'));
  function request(url = '/zhiban', options = {}) {
    return new Promise((resolve, reject) => {
      const req = https.get(
        'https://127.0.0.1:3443' + url,
        { ca, agent: false, timeout: 15000, ...options },
        (res) => {
          const chunks = [];
          res.on('data', (p) => chunks.push(p));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      req.on('error', reject);
      req.on('timeout', () => req.destroy(Error('timeout')));
    });
  }
  await test('occupied HTTPS port fails startup, leaves gate intact and releases inherited lock', async () => {
    const blocker = require('node:net').createServer();
    await new Promise((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(3443, '127.0.0.1', resolve);
    });
    const gateBefore = c.bytes(path.join(root, 'maintenance.json'));
    try {
      await assert.rejects(() => launcher.launch(launchInput));
    } finally {
      await new Promise((r) => blocker.close(r));
    }
    assert.deepEqual(c.bytes(path.join(root, 'maintenance.json')), gateBefore);
    const held = m.acquire(root, 'handoff', true);
    held.release();
  });
  let host;
  try {
    await test('ordinary HTTPS child holds inherited shared flock and serves actual workspace/editor and unauthenticated Identity with pinned CA', async () => {
      host = await launcher.launch(launchInput);
      assert.equal(host.status, 'LOCAL_HTTPS_LISTENING');
      assert.throws(() => m.acquire(root, 'handoff', true));
      const page = await request();
      assert.equal(page.status, 200);
      assert.match(page.body, /<html/);
      const editor = await request('/zhiban/content');
      assert.equal(editor.status, 200);
      assert.ok(!editor.headers['content-security-policy'].includes('unsafe-inline'));
      const me = await request('/api/zhiban/identity/me', {
        headers: { 'x-zhiban-request': 'identity-v1' },
      });
      assert.equal(me.status, 401);
      await assert.rejects(() => request('/zhiban', { ca: undefined }));
      assert.equal(
        (
          await request('/zhiban', {
            headers: { host: 'localhost:3443' },
            checkServerIdentity: (_host, cert) =>
              require('node:tls').checkServerIdentity('127.0.0.1', cert),
          })
        ).status,
        403,
      );
    });
    await test('running host stops on gate byte drift and releases both inherited and supervisor locks; no automatic restart', async () => {
      fs.writeFileSync(
        path.join(root, 'maintenance.json'),
        JSON.stringify({ status: 'BLOCKED', test: 'drift' }),
        { mode: 0o600 },
      );
      await Promise.race([
        host.done,
        new Promise((_, reject) =>
          setTimeout(() => reject(Error('Host did not stop')), 10000).unref(),
        ),
      ]);
      host = null;
      const held = m.acquire(root, 'handoff', true);
      held.release();
      await assert.rejects(() => request());
      await assert.rejects(() => launcher.launch(launchInput));
    });
    // Restore exact preexisting committed gate only within synthetic fixture to test another failure independently.
    fs.writeFileSync(path.join(root, 'maintenance.json'), gateRaw, { mode: 0o600 });
    await test('canonical completion drift stops an already running host; sidecars cannot authorize a group', async () => {
      const master = path.join(path.dirname(launchInput.tlsReceiptPath), 'issuance-complete.json'),
        raw = c.bytes(master);
      host = await launcher.launch(launchInput);
      fs.writeFileSync(master, 'invalid', { mode: 0o600 });
      const stopped = await host.done;
      assert.equal(stopped.status, 'STOPPED');
      assert.equal(stopped.localPgClosed, true);
      host = null;
      await assert.rejects(() => launcher.launch(launchInput));
      fs.writeFileSync(master, raw, { mode: 0o600 });
    });
    await test('missing committed sibling stops running host even with unchanged selected receipts and master', async () => {
      const ack = path.join(path.dirname(launchInput.receiptPath), 'host-validation-ack.json'),
        raw = c.bytes(ack);
      host = await launcher.launch(launchInput);
      fs.unlinkSync(ack);
      assert.equal((await host.done).status, 'STOPPED');
      host = null;
      await assert.rejects(() => launcher.launch(launchInput));
      fs.writeFileSync(ack, raw, { mode: 0o600 });
    });
    for (const signal of ['SIGTERM', 'SIGKILL'])
      await test(
        'actual disposable supervisor ' +
          signal +
          ' closes ordinary child and releases inherited lock',
        async () => {
          const { spawn } = require('node:child_process'),
            requestPath = privateInput(JSON.stringify(launchInput));
          const worker = spawn(
            process.execPath,
            [
              path.join(__dirname, 'ordinary-test-worker.cjs'),
              '--local-disposable-only',
              requestPath,
            ],
            {
              env: { PATH: '/usr/bin:/bin', LANG: 'C' },
              stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
            },
          );
          const workerClose = new Promise((resolve) => worker.once('close', resolve));
          let childPid;
          try {
            childPid = await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => reject(Error('Worker startup deadline')), 30000);
              worker.once('error', reject);
              worker.once('message', (m) => {
                clearTimeout(timeout);
                if (m.type === 'READY') resolve(m.childPid);
                else reject(Error('Worker bootstrap rejected'));
              });
            });
            assert.throws(() => m.acquire(root, 'handoff', true));
            worker.kill(signal);
            const deadline = Date.now() + 8000;
            while (Date.now() < deadline) {
              let alive = false;
              try {
                const state = fs
                  .readFileSync('/proc/' + childPid + '/stat', 'utf8')
                  .split(') ')[1]
                  .split(' ')[0];
                alive = state !== 'Z';
              } catch {}
              if (!alive) break;
              await new Promise((r) => setTimeout(r, 50));
            }
            let state;
            try {
              state = fs
                .readFileSync('/proc/' + childPid + '/stat', 'utf8')
                .split(') ')[1]
                .split(' ')[0];
            } catch {}
            assert.ok(state === undefined || state === 'Z', 'Ordinary child failed to exit');
            await Promise.race([
              workerClose,
              new Promise((_, reject) =>
                setTimeout(() => reject(Error('Supervisor failed to exit')), 5000).unref(),
              ),
            ]);
            const held = m.acquire(root, 'handoff', true);
            held.release();
            await assert.rejects(() => request());
          } finally {
            if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
            if (childPid) {
              try {
                process.kill(childPid, 'SIGKILL');
              } catch {}
            }
            await workerClose;
          }
        },
      );
    await test('TLS mismatch rejects launch before listener and without gate mutation', async () => {
      const keyPath = path.join(built.directory, 'tls/private-key.pem'),
        raw = c.bytes(keyPath);
      fs.chmodSync(keyPath, 0o600);
      fs.writeFileSync(keyPath, 'invalid');
      await assert.rejects(() => launcher.launch(launchInput));
      fs.writeFileSync(keyPath, raw);
      fs.chmodSync(keyPath, 0o400);
    });
    await test('database scope revocation terminates an already running host and subsequent launch stays rejected', async () => {
      host = await launcher.launch(launchInput);
      [business, native] = await ownerConnections();
      await business.query(
        "UPDATE zhiban_handoff.host_read_authorizations SET status='REVOKED' WHERE deployment_id=$1 AND release_id=$2",
        [p.deploymentId, p.releaseId],
      );
      await business.end();
      await native.end();
      fs.writeFileSync(hbaFile, ordinaryText, { mode: 0o600 });
      await admin.query('SELECT pg_reload_conf()');
      await Promise.race([
        host.done,
        new Promise((_, reject) =>
          setTimeout(() => reject(Error('Revoked host did not stop')), 10000).unref(),
        ),
      ]);
      host = null;
      await assert.rejects(() => launcher.launch(launchInput));
    });
  } finally {
    if (host) await host.stop();
  }
}
module.exports = { tlsFixture, run };
