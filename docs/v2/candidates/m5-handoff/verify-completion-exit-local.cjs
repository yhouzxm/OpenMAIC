// Review-only fault reproductions. No real authority, HTTPS listener, PG cluster or credentials.
// Publisher uses generated keys. Launcher auth/profile/TLS are stubbed; real pg sockets,
// actual launcher stop(), actual Node child and actual inherited flock exercise shutdown only.
const fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  crypto = require('node:crypto'),
  net = require('node:net'),
  vm = require('node:vm'),
  Module = require('node:module'),
  assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '../../../..'),
  DIR = path.join(ROOT, 'docs/v2/candidates/m5-handoff');
const c = require(path.join(DIR, 'release-contract.cjs')),
  h = require(path.join(DIR, 'handoff-contracts.cjs')),
  m = require(path.join(DIR, '../m5-terminal/maintenance-lock.cjs')),
  complete = require(path.join(DIR, 'receipt-completion.cjs'));
const source = h.sources(),
  sha = c.sha,
  checks = [];
const bindings = Object.fromEntries(
  [
    'receipt-issuer.cjs',
    'receipt-completion.cjs',
    'ordinary-launcher.cjs',
    'ordinary-shutdown.cjs',
  ].map((n) => [n, sha(fs.readFileSync(path.join(DIR, n)))]),
);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function completionCuts(base) {
  const pair = crypto.generateKeyPairSync('ed25519'),
    pub = pair.publicKey.export({ format: 'pem', type: 'spki' }),
    keyFile = path.join(base, 'synthetic-issuer.key'),
    pubFile = path.join(base, 'synthetic-issuer.pub');
  m.writeExclusive(keyFile, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }));
  m.writeExclusive(pubFile, pub);
  const file = path.join(DIR, 'receipt-issuer.cjs'),
    unit = new Module(file, module);
  unit.filename = file;
  unit.paths = module.paths;
  unit._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.reviewPublisher=publish;', file);
  const id = '0199eeee-aabb-7000-8000-000000000001',
    common = {
      formatVersion: 1,
      status: 'ISSUED',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      authorityKeySha256: sha(pair.publicKey.export({ type: 'spki', format: 'der' })),
      releaseId: id,
      credentialGenerationId: id,
      deploymentId: id,
      sourceBindingsSha256: source.inventorySha256,
    };
  const payloads = {
    'compatibility-receipts.json': { ...common, purpose: 'LOCAL_ORDINARY_COMPATIBILITY_RECEIPTS' },
    'tls-receipt.json': { ...common, purpose: 'LOCAL_ORDINARY_TLS_RECEIPT' },
  };
  const cuts = [
    'BEFORE_LEAF_1',
    'AFTER_LEAF_1',
    'BEFORE_LEAF_2',
    'AFTER_LEAF_2',
    'LEAF_FSYNC',
    'BEFORE_STAGE',
    'AFTER_STAGE',
    'STAGE_FSYNC',
    'BEFORE_RENAME',
    'AFTER_RENAME',
    'FINAL_DIR_FSYNC',
    'RETURN_ACK_LOST',
    'SUCCESS',
  ];
  for (const cut of cuts) {
    const out = path.join(base, 'issuance-' + cut);
    fs.mkdirSync(out, { mode: 0o700 });
    const approvalSha = sha('synthetic-reviewed-approval-' + cut);
    m.writeExclusive(
      path.join(out, 'intent.json'),
      JSON.stringify({ status: 'INTENT_NO_REPLAY', approvalSha256: approvalSha }),
    );
    const write = m.writeExclusive,
      rename = fs.renameSync,
      fsync = fs.fsyncSync,
      sync = m.syncDir;
    m.writeExclusive = (file, raw) => {
      const name = path.basename(file);
      if (
        (cut === 'BEFORE_LEAF_1' && name === 'compatibility-receipts.json') ||
        (cut === 'BEFORE_LEAF_2' && name === 'tls-receipt.json') ||
        (cut === 'BEFORE_STAGE' && name === '.issuance-complete-staged.json')
      )
        throw Error('INJECTED');
      write(file, raw);
      if (
        (cut === 'AFTER_LEAF_1' && name === 'compatibility-receipts.json') ||
        (cut === 'AFTER_LEAF_2' && name === 'tls-receipt.json') ||
        (cut === 'AFTER_STAGE' && name === '.issuance-complete-staged.json')
      )
        throw Error('INJECTED');
    };
    fs.fsyncSync = (fd) => {
      const name = fs.readlinkSync('/proc/self/fd/' + fd);
      if (
        (cut === 'LEAF_FSYNC' && name === path.join(out, 'tls-receipt.json')) ||
        (cut === 'STAGE_FSYNC' && name === path.join(out, '.issuance-complete-staged.json'))
      )
        throw Error('INJECTED');
      return fsync(fd);
    };
    fs.renameSync = (from, to) => {
      if (cut === 'BEFORE_RENAME') throw Error('INJECTED');
      rename(from, to);
      if (cut === 'AFTER_RENAME') throw Error('INJECTED');
    };
    m.syncDir = (dir) => {
      if (cut === 'FINAL_DIR_FSYNC') throw Error('INJECTED');
      return sync(dir);
    };
    let got, rejected;
    try {
      got = unit.exports.reviewPublisher(
        { issuerKeyPath: keyFile },
        {
          digest: approvalSha,
          p: {
            kind: 'COMPATIBILITY_TLS',
            issuedAt: Date.now() - 1,
            expiresAt: Date.now() + 60000,
            issuerKeySha256: common.authorityKeySha256,
            sourceBindingsSha256: source.inventorySha256,
          },
        },
        out,
        payloads,
      );
    } catch (error) {
      rejected = error.code;
    } finally {
      m.writeExclusive = write;
      fs.renameSync = rename;
      fs.fsyncSync = fsync;
      m.syncDir = sync;
    }
    const after = ['AFTER_RENAME', 'FINAL_DIR_FSYNC', 'RETURN_ACK_LOST', 'SUCCESS'].includes(cut);
    for (const name of Object.keys(payloads)) {
      if (after)
        assert.equal(
          complete.check(path.join(out, name), pub, source.inventorySha256).status,
          'ISSUANCE_COMPLETE',
        );
      else assert.throws(() => complete.check(path.join(out, name), pub, source.inventorySha256));
    }
    if (after) {
      assert.ok(['ISSUED_LOCAL', 'ISSUANCE_COMMITTED_ACK_UNKNOWN'].includes(got.status));
      if (['AFTER_RENAME', 'FINAL_DIR_FSYNC'].includes(cut))
        assert.equal(got.status, 'ISSUANCE_COMMITTED_ACK_UNKNOWN');
    } else assert.equal(rejected, 'ISSUANCE_NOT_COMMITTED');
    const before = fs
      .readdirSync(out)
      .sort()
      .map((n) => [n, sha(c.bytes(path.join(out, n)))]);
    const inspected = unit.exports.inspectIssuance({
      directory: out,
      authorityPublicKeyPath: pubFile,
      expectedApprovalSha256: approvalSha,
    });
    assert.equal(inspected.status, after ? 'SIGNED_COMMIT_OBSERVED' : 'NOT_COMMITTED_OBSERVED');
    assert.equal(inspected.writeReplayAllowed, false);
    assert.deepEqual(
      fs
        .readdirSync(out)
        .sort()
        .map((n) => [n, sha(c.bytes(path.join(out, n)))]),
      before,
    );
    checks.push({
      name: 'issuance cut ' + cut,
      status: 'PASS',
      bothConsumersAccepted: after,
      issuerStatus: got?.status || rejected,
      inspection: inspected.status,
      scope:
        'Actual publisher/completion/inspection; generated authority and minimal signed leaves; approval/build/PG pipeline tested separately',
    });
    if (cut === 'SUCCESS') {
      const master = path.join(out, 'issuance-complete.json'),
        raw = c.bytes(master);
      fs.writeFileSync(path.join(out, 'compatibility-receipts.json.issuance.json'), raw, {
        mode: 0o600,
      });
      fs.unlinkSync(master);
      assert.throws(() =>
        complete.check(path.join(out, 'compatibility-receipts.json'), pub, source.inventorySha256),
      );
      fs.writeFileSync(master, raw, { mode: 0o600 });
      const leaf = path.join(out, 'tls-receipt.json'),
        leafRaw = c.bytes(leaf);
      fs.writeFileSync(leaf, 'invalid', { mode: 0o600 });
      assert.throws(() =>
        complete.check(path.join(out, 'compatibility-receipts.json'), pub, source.inventorySha256),
      );
      assert.equal(
        unit.exports.inspectIssuance({
          directory: out,
          authorityPublicKeyPath: pubFile,
          expectedApprovalSha256: approvalSha,
        }).status,
        'UNKNOWN_OR_INVALID',
      );
      fs.writeFileSync(leaf, leafRaw, { mode: 0o600 });
      checks.push({
        name: 'sidecar cannot replace master and sibling byte drift invalidates whole group',
        status: 'PASS',
      });
    }
  }
}
async function shutdownCase(base, mode) {
  console.log('CHECK shutdown ' + mode);
  const instances = [],
    sockets = new Set();
  let host,
    clientEnds = 0,
    closeSettled = false,
    childGone = false;
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    let startup = true;
    socket.on('data', () => {
      if (!startup) return;
      startup = false;
      socket.write(
        Buffer.from([
          0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x4b, 0, 0, 0, 12, 0, 0, 0, 1, 0, 0, 0, 2, 0x5a, 0, 0, 0, 5,
          0x49,
        ]),
      );
    });
    // On receiving Terminate/FIN, keep the write side open to model an idle teardown peer stall.
    socket.on('end', () => {
      if (mode === 'HEALTHY') socket.end();
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port,
    dir = path.join(base, 'launch-' + mode),
    releaseId = '0199eeee-aabb-7000-8000-000000000001',
    credentialGenerationId = '0199eeee-aabb-7000-8000-000000000002',
    deploymentId = '0199eeee-aabb-7000-8000-000000000003',
    d = 'a'.repeat(64);
  fs.mkdirSync(dir, { mode: 0o700 });
  fs.mkdirSync(path.join(dir, 'releases'), { mode: 0o700 });
  const root = path.join(dir, 'releases', releaseId);
  fs.mkdirSync(root, { mode: 0o700 });
  fs.mkdirSync(path.join(root, 'host'), { mode: 0o700 });
  const input = {
    directory: dir,
    expectedPath: path.join(dir, 'expected.json'),
    authorityPublicKeyPath: path.join(dir, 'pub'),
    receiptPath: path.join(dir, 'receipt.json'),
    compatibilityReceiptPath: path.join(dir, 'compat.json'),
    tlsReceiptPath: path.join(dir, 'tls.json'),
  };
  const write = (f, v) => m.writeExclusive(f, typeof v === 'string' ? v : JSON.stringify(v));
  const env = {
    releaseId,
    credentialGenerationId,
    deploymentId,
    status: 'ISSUED',
    sourceBindingsSha256: d,
    configurationSha256: d,
  };
  const tlsBinding = {
    certificateSha256: d,
    privateKeySha256: d,
    caSha256: d,
    validUntil: Date.now() + 60000,
  };
  const artifactRaw = Buffer.from('{}'),
    artifactSha = sha(artifactRaw),
    compatRaw = Buffer.from(JSON.stringify({ payload: { ...env } })),
    ackRaw = Buffer.from(
      JSON.stringify({
        payload: {
          ...env,
          compatibilityReceiptsSha256: sha(compatRaw),
          checks: { syntheticOnly: true },
        },
      }),
    );
  write(input.compatibilityReceiptPath, compatRaw.toString());
  write(path.join(root, 'host-validation-ack.json'), ackRaw.toString());
  write(input.receiptPath, {
    payload: { ...env, hostAckSha256: sha(ackRaw), compatibilityReceiptsSha256: sha(compatRaw) },
  });
  write(input.tlsReceiptPath, {
    payload: {
      ...env,
      artifactManifestSha256: artifactSha,
      origin: 'https://127.0.0.1:3443',
      launchAllowed: false,
      trust: 'PINNED_LOCAL_CA_REQUIRES_CLIENT_TRUST',
      ...tlsBinding,
    },
  });
  write(path.join(root, 'artifact-manifest.json'), artifactRaw.toString());
  write(path.join(root, 'closure-manifest.json'), { systemLibraries: [] });
  write(path.join(root, 'build-manifest.json'), {
    sourceBindingsSha256: d,
    configurationSha256: d,
    libraryAliases: [],
  });
  const cfg = {
    releaseId,
    credentialGenerationId,
    deploymentId,
    target: { port, origin: 'https://127.0.0.1:3443' },
    readSecret: d,
    connections: ['zhiban_control_runtime', 'zhiban_openmaic_runtime'].map((role) => ({
      role,
      database: 'synthetic',
      password: 'synthetic-not-a-real-secret',
    })),
  };
  const cfgRaw = JSON.stringify(cfg);
  write(path.join(root, 'ordinary.json'), cfgRaw);
  write(path.join(dir, 'maintenance.lock'), '');
  write(path.join(dir, 'maintenance.json'), {
    payload: { ...env, artifactManifestSha256: artifactSha },
  });
  write(path.join(dir, 'handoff-fences.jsonl'), 'synthetic');
  write(path.join(dir, 'handoff-current.json'), 'synthetic');
  write(path.join(dir, 'issuance-complete.json'), 'synthetic');
  write(input.expectedPath, 'synthetic');
  write(input.authorityPublicKeyPath, 'synthetic');
  write(
    path.join(root, 'host/ordinary-guard.cjs'),
    '// Review child: no business or HTTPS listener.\n',
  );
  write(
    path.join(root, 'host/ordinary-host.cjs'),
    `process.on('message',m=>{if(m.type==='STOP' && ${JSON.stringify(mode)}!=='IGNORE_TERM')process.exit(0);});if(${JSON.stringify(mode)}==='IGNORE_TERM')process.on('SIGTERM',()=>{});process.on('disconnect',()=>process.exit(0));process.send({type:'LISTENING',releaseId:${JSON.stringify(releaseId)},credentialGenerationId:${JSON.stringify(credentialGenerationId)}});`,
  );
  const Client = require('pg').Client;
  class ReviewClient extends Client {
    constructor(...args) {
      super(...args);
      instances.push(this);
    }
    end(...args) {
      clientEnds++;
      return super.end(...args);
    }
  }
  const wrapped = { ...c, config: (v) => v, signed: (raw) => JSON.parse(raw).payload };
  const wrappedH = {
    sources: () => ({ inventorySha256: d }),
    publicPin: () => ({ digest: d }),
    verify: (raw) => ({ payload: JSON.parse(raw).payload, digest: sha(raw) }),
    artifacts: () => {},
  };
  const file = path.join(DIR, 'ordinary-launcher.cjs'),
    text = fs.readFileSync(file, 'utf8'),
    req = Module.createRequire(file);
  let actualChild;
  const childTools = require('node:child_process'),
    spawnTools = {
      ...childTools,
      spawn: (exe, args, options) => {
        actualChild = childTools.spawn(
          mode === 'SPAWN_FAILURE' ? '/not-a-real-zhiban-node' : exe,
          args,
          options,
        );
        return actualChild;
      },
    };
  const fakeRequire = (name) =>
    name === './release-contract.cjs'
      ? wrapped
      : name === './handoff-contracts.cjs'
        ? wrappedH
        : name === './physical-closure.cjs'
          ? { verify: () => {} }
          : name === './handoff-executor.cjs'
            ? { verifyLaunchLocked: async () => {} }
            : name === './receipt-completion.cjs'
              ? { check: () => {} }
              : name === './release-tls.cjs'
                ? { load: () => ({ binding: tlsBinding }) }
                : name === path.join(root, 'host/product.cjs')
                  ? { Client: ReviewClient }
                  : name === 'node:child_process'
                    ? spawnTools
                    : req(name);
  // Keep actual configuration byte binding despite stubbing authorization predicates.
  wrappedH.sources = () => ({ inventorySha256: d });
  const originalSha = wrapped.sha;
  wrapped.sha = (raw) => (Buffer.from(raw).toString() === cfgRaw ? d : originalSha(raw));
  const sandbox = {
    __dirname: DIR,
    module: { exports: {} },
    require: fakeRequire,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  vm.runInNewContext(text, sandbox, { filename: file });
  try {
    if (mode === 'SPAWN_FAILURE') {
      await assert.rejects(() => sandbox.module.exports.launch(input), /launch rejected/);
      const held = m.acquire(dir, 'handoff', true);
      held.release();
      assert.equal(
        instances.every((x) => x.connection.stream.closed),
        true,
      );
      checks.push({ name: 'shutdown spawn failure closes PG and releases fd', status: 'PASS' });
      return;
    }
    host = await sandbox.module.exports.launch(input);
    host.done.then(() => {
      closeSettled = true;
    });
    if (mode === 'ACTIVE_QUERY') {
      instances[0].query('SELECT synthetic_stall').catch(() => {});
      await delay(20);
    }
    const started = Date.now();
    let stopped;
    if (mode === 'IPC_DISCONNECT') {
      actualChild.disconnect();
      stopped = host.done;
    } else {
      stopped = host.stop();
      if (mode === 'REPEATED_STOP') host.stop();
    }
    const result = await Promise.race([
      stopped,
      delay(6000).then(() => {
        throw Error('Shutdown exceeded bound: ' + mode);
      }),
    ]);
    assert.equal(result.status, 'STOPPED');
    assert.equal(result.childExitConfirmed, true);
    assert.equal(result.localPgClosed, true);
    assert.equal(result.remoteBackendDrainConfirmed, false);
    try {
      process.kill(host.childPid, 0);
    } catch (error) {
      assert.equal(error.code, 'ESRCH');
      childGone = true;
    }
    assert.equal(childGone, true);
    assert.equal(clientEnds, 2);
    assert.equal(
      instances.every((x) => x.connection.stream.closed),
      true,
    );
    const held = m.acquire(dir, 'handoff', true);
    held.release();
    if (mode !== 'HEALTHY') assert.ok(result.forcedPgConnections >= 1);
    checks.push({
      name: 'bounded shutdown ' + mode,
      status: 'PASS',
      elapsedMs: Date.now() - started,
      actualPgClientVersion: require('pg/package.json').version,
      actualChildExited: true,
      localPgClosed: true,
      forcedPgConnections: result.forcedPgConnections,
      lockReleased: true,
      remoteBackendDrainConfirmed: false,
      scope:
        'Actual launcher/shutdown, real pg sockets/Node child/flock; auth/profile/TLS stubbed; real HTTPS and PG16 tested separately',
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    if (host) await host.stop();
    await new Promise((r) => server.close(r));
  }
}
(async () => {
  const base = fs.mkdtempSync('/tmp/zhiban-completion-exit-fixed-');
  fs.chmodSync(base, 0o700);
  try {
    await completionCuts(base);
    for (const mode of [
      'HEALTHY',
      'IDLE_STALL',
      'ACTIVE_QUERY',
      'IGNORE_TERM',
      'SPAWN_FAILURE',
      'IPC_DISCONNECT',
      'REPEATED_STOP',
    ])
      await shutdownCase(base, mode);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
  const EventEmitter = require('node:events'),
    unconfirmed = new EventEmitter();
  Object.assign(unconfirmed, {
    pid: 123456789,
    exitCode: null,
    signalCode: null,
    connected: false,
    kill: () => false,
  });
  const uncertain = await require('./ordinary-shutdown.cjs').close(unconfirmed, []);
  assert.equal(uncertain.childExitConfirmed, false);
  assert.equal(uncertain.localPgClosed, true);
  assert.ok(uncertain.elapsedMs < 5500);
  checks.push({
    name: 'unconfirmed process exit returns incomplete facts rather than claiming stopped',
    status: 'PASS',
    scope: 'Synthetic process observation; no OS process killed',
    elapsedMs: uncertain.elapsedMs,
  });
  assert.equal(h.sources().inventorySha256, source.inventorySha256);
  const evidence = {
    status: 'PASS',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    candidateInventorySha256: source.inventorySha256,
    candidateMigrationSha256: source.inv.migration.aggregateSha256,
    reviewedFilesSha256: bindings,
    checks,
    sourceBound: true,
    existingClustersConnected: false,
    realCredentialsRead: false,
    realAuthorityIssued: false,
    realHttpsStarted: false,
    runtimeAccepted: false,
  };
  const idx = process.argv.indexOf('--output');
  if (idx >= 0) fs.writeFileSync(process.argv[idx + 1], JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
