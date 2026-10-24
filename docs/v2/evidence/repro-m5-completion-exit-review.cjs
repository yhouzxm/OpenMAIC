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
const ROOT = path.resolve(__dirname, '../../..'),
  DIR = path.join(ROOT, 'docs/v2/candidates/m5-handoff');
const c = require(path.join(DIR, 'release-contract.cjs')),
  h = require(path.join(DIR, 'handoff-contracts.cjs')),
  m = require(path.join(DIR, '../m5-terminal/maintenance-lock.cjs')),
  complete = require(path.join(DIR, 'receipt-completion.cjs'));
const source = h.sources(),
  sha = c.sha,
  checks = [];
const bindings = Object.fromEntries(
  ['receipt-issuer.cjs', 'receipt-completion.cjs', 'ordinary-launcher.cjs'].map((n) => [
    n,
    sha(fs.readFileSync(path.join(DIR, n))),
  ]),
);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function completionFailure(base) {
  const out = path.join(base, 'issuance');
  fs.mkdirSync(out, { mode: 0o700 });
  const pair = crypto.generateKeyPairSync('ed25519'),
    pub = pair.publicKey.export({ format: 'pem', type: 'spki' }),
    keyFile = path.join(base, 'synthetic-issuer.key');
  m.writeExclusive(keyFile, pair.privateKey.export({ format: 'pem', type: 'pkcs8' }));
  const file = path.join(DIR, 'receipt-issuer.cjs'),
    unit = new Module(file, module);
  unit.filename = file;
  unit.paths = module.paths;
  unit._compile(fs.readFileSync(file, 'utf8') + '\nmodule.exports.reviewPublisher=publish;', file);
  const original = m.writeExclusive;
  m.writeExclusive = (file, raw) => {
    if (file === path.join(out, 'tls-receipt.json.issuance.json'))
      throw Error('INJECTED_LAST_SIDECAR_FAILURE');
    return original(file, raw);
  };
  let failed = false;
  try {
    unit.exports.reviewPublisher(
      { issuerKeyPath: keyFile },
      {
        digest: sha('synthetic-reviewed-approval'),
        p: {
          issuedAt: Date.now() - 1,
          expiresAt: Date.now() + 60000,
          issuerKeySha256: sha(pair.publicKey.export({ type: 'spki', format: 'der' })),
          sourceBindingsSha256: source.inventorySha256,
        },
      },
      out,
      {
        'compatibility-receipts.json': { purpose: 'SYNTHETIC_COMPATIBILITY' },
        'tls-receipt.json': { purpose: 'SYNTHETIC_TLS' },
      },
    );
  } catch (e) {
    assert.equal(e.message, 'INJECTED_LAST_SIDECAR_FAILURE');
    failed = true;
  } finally {
    m.writeExclusive = original;
  }
  assert.equal(failed, true);
  const accepted = complete.check(
    path.join(out, 'compatibility-receipts.json'),
    pub,
    source.inventorySha256,
  );
  assert.equal(accepted.status, 'ISSUANCE_COMPLETE');
  assert.throws(
    () => complete.check(path.join(out, 'tls-receipt.json'), pub, source.inventorySha256),
    { code: 'ENOENT' },
  );
  assert.equal(fs.existsSync(path.join(out, 'issuance-complete.json')), true);
  checks.push({
    name: 'failure after complete marker and first sidecar creates asymmetric consumption',
    status: 'REPRODUCED',
    issuerCallThrew: true,
    signedMasterExists: true,
    compatibilityAccepted: true,
    tlsAccepted: false,
    scope:
      'Actual internal publisher and actual completion checker, generated test authority; approval/build/PG pipeline not signed off',
  });
}
async function shutdownFailure(base) {
  const sockets = new Set();
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
    socket.on('end', () => {});
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port,
    dir = path.join(base, 'launch'),
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
  write(input.expectedPath, 'synthetic');
  write(input.authorityPublicKeyPath, 'synthetic');
  write(
    path.join(root, 'host/ordinary-guard.cjs'),
    '// Review child: no business or HTTPS listener.\n',
  );
  write(
    path.join(root, 'host/ordinary-host.cjs'),
    `process.on('message',m=>{if(m.type==='STOP')process.exit(0);});process.on('disconnect',()=>process.exit(0));process.send({type:'LISTENING',releaseId:${JSON.stringify(releaseId)},credentialGenerationId:${JSON.stringify(credentialGenerationId)}});`,
  );
  const Client = require('pg').Client;
  class ReviewClient extends Client {
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
    host = await sandbox.module.exports.launch(input);
    host.done.then(() => {
      closeSettled = true;
    });
    const started = Date.now(),
      stopped = host.stop();
    await delay(2600);
    try {
      process.kill(host.childPid, 0);
    } catch (e) {
      assert.equal(e.code, 'ESRCH');
      childGone = true;
    }
    assert.equal(childGone, true);
    assert.equal(closeSettled, false);
    assert.equal(clientEnds, 2);
    assert.throws(() => m.acquire(dir, 'handoff', true));
    const observation = {
      name: 'idle PG teardown stalls supervisor after actual child exits',
      status: 'REPRODUCED',
      elapsedMs: Date.now() - started,
      actualPgClientVersion: require('pg/package.json').version,
      actualChildExited: childGone,
      supervisorDoneResolved: closeSettled,
      sharedLockStillHeld: true,
      scope:
        'Actual launcher stop and actual pg.Client.end against a disposable protocol peer; authorization/profile/TLS stubbed, no real PG or HTTPS acceptance',
    };
    // Fault removal permits both idle pg clients to close, proving the wait location.
    for (const socket of sockets) socket.destroy();
    await Promise.race([
      stopped,
      delay(3000).then(() => {
        throw Error('Teardown cleanup failed');
      }),
    ]);
    assert.equal(closeSettled, true);
    const lock = m.acquire(dir, 'handoff', true);
    lock.release();
    observation.afterPeerDestroyedDoneResolved = true;
    observation.afterPeerDestroyedLockReleased = true;
    checks.push(observation);
  } finally {
    for (const socket of sockets) socket.destroy();
    if (host) await host.stop();
    await new Promise((r) => server.close(r));
  }
}
(async () => {
  const base = fs.mkdtempSync('/tmp/zhiban-completion-exit-review-');
  fs.chmodSync(base, 0o700);
  try {
    await completionFailure(base);
    await shutdownFailure(base);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
  assert.equal(h.sources().inventorySha256, source.inventorySha256);
  const evidence = {
    status: 'REVIEW_FAULTS_REPRODUCED',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    candidateInventorySha256: source.inventorySha256,
    candidateMigrationSha256: source.inv.migration.aggregateSha256,
    reviewedFilesSha256: bindings,
    checks,
    candidateChanged: false,
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
