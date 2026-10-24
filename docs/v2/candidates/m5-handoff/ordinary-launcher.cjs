// Explicit candidate launcher. Never clears a gate, signs, seeds or performs recovery.
const fs = require('node:fs'),
  path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const c = require('./release-contract.cjs'),
  h = require('./handoff-contracts.cjs'),
  physical = require('./physical-closure.cjs'),
  e = require('./handoff-executor.cjs');
async function launch(input) {
  c.keys(input, [
    'directory',
    'expectedPath',
    'authorityPublicKeyPath',
    'receiptPath',
    'compatibilityReceiptPath',
    'tlsReceiptPath',
  ]);
  c.directory(input.directory);
  c.insist(
    [
      'NODE_OPTIONS',
      'NODE_PATH',
      'LD_PRELOAD',
      'LD_LIBRARY_PATH',
      'NAPI_RS_NATIVE_LIBRARY_PATH',
      'NAPI_RS_FORCE_WASI',
      'NODE_PG_FORCE_NATIVE',
    ].every((k) => !process.env[k]),
    'Ambient launch override rejected',
  );
  const source = h.sources(),
    pin = h.publicPin(input.authorityPublicKeyPath),
    gateRaw = c.bytes(path.join(input.directory, 'maintenance.json')),
    gate = h.verify(gateRaw, pin, 'LOCAL_STARTUP_RELEASE_GATE', source),
    p = gate.payload;
  const root = path.join(input.directory, 'releases', p.releaseId),
    artifactRaw = c.bytes(path.join(root, 'artifact-manifest.json'));
  c.insist(c.sha(artifactRaw) === p.artifactManifestSha256, 'Pinned launch artifact required');
  h.artifacts(root, JSON.parse(artifactRaw), p.artifactManifestSha256);
  const closure = JSON.parse(c.bytes(path.join(root, 'closure-manifest.json'))),
    build = JSON.parse(c.bytes(path.join(root, 'build-manifest.json')));
  physical.verify(root, closure);
  const cfg0 = JSON.parse(c.bytes(path.join(root, 'ordinary.json'))),
    cfg = c.config(cfg0, p.releaseId, p.credentialGenerationId);
  c.insist(
    build.sourceBindingsSha256 === source.inventorySha256 &&
      build.configurationSha256 === c.sha(c.bytes(path.join(root, 'ordinary.json'))),
    'Launch build/config mismatch',
  );
  const receipt = h.verify(
      c.bytes(input.receiptPath),
      pin,
      'LOCAL_PRODUCT_HANDOFF_VERIFIED',
      source,
    ),
    ack = h.verify(
      c.bytes(path.join(root, 'host-validation-ack.json')),
      pin,
      'LOCAL_HANDOFF_HOST_ACK',
      source,
    );
  for (const file of [input.receiptPath, input.compatibilityReceiptPath, input.tlsReceiptPath])
    require('./receipt-completion.cjs').check(
      file,
      c.bytes(input.authorityPublicKeyPath),
      source.inventorySha256,
    );
  const compatRaw = c.bytes(input.compatibilityReceiptPath),
    compat = c.signed(
      compatRaw,
      c.bytes(input.authorityPublicKeyPath),
      'LOCAL_ORDINARY_COMPATIBILITY_RECEIPTS',
      Object.keys(
        JSON.parse(fs.readFileSync(path.join(__dirname, 'compatibility-receipts.template.json'))),
      ),
    );
  c.insist(
    receipt.payload.hostAckSha256 === ack.digest &&
      receipt.payload.compatibilityReceiptsSha256 === c.sha(compatRaw) &&
      ack.payload.compatibilityReceiptsSha256 === c.sha(compatRaw) &&
      Object.values(ack.payload.checks).every((x) => x === true),
    'Launch ACK/compatibility mismatch',
  );
  const tlsRaw = c.bytes(input.tlsReceiptPath),
    tls = c.signed(
      tlsRaw,
      c.bytes(input.authorityPublicKeyPath),
      'LOCAL_ORDINARY_TLS_RECEIPT',
      Object.keys(JSON.parse(fs.readFileSync(path.join(__dirname, 'tls-receipt.template.json')))),
    ),
    binding = require('./release-tls.cjs').load(root).binding;
  for (const evidence of [receipt.payload, ack.payload, compat, tls]) {
    for (const k of ['releaseId', 'credentialGenerationId', 'deploymentId'])
      c.insist(evidence[k] === cfg[k], 'Same-generation launch evidence required');
    c.insist(
      evidence.status === 'ISSUED' &&
        evidence.sourceBindingsSha256 === source.inventorySha256 &&
        evidence.configurationSha256 === build.configurationSha256,
      'Launch source/config evidence mismatch',
    );
  }
  c.insist(
    tls.artifactManifestSha256 === p.artifactManifestSha256 &&
      tls.origin === cfg.target.origin &&
      tls.launchAllowed === false &&
      tls.trust === 'PINNED_LOCAL_CA_REQUIRES_CLIENT_TRUST',
    'TLS scope rejected',
  );
  for (const k of Object.keys(binding))
    c.insist(tls[k] === binding[k], 'TLS byte binding mismatch');
  const file = path.join(input.directory, 'maintenance.lock');
  c.bytes(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW),
    stat = fs.fstatSync(fd);
  let phase = 'LOCK',
    child,
    timer,
    startTimer,
    clients = [],
    closed = false,
    ready = false,
    stopping,
    resolveDone;
  const done = new Promise((r) => {
    resolveDone = r;
  });
  const inode = () => {
    const s = fs.lstatSync(file);
    c.insist(
      !s.isSymbolicLink() && s.ino === stat.ino && s.dev === stat.dev,
      'Lifetime maintenance lock changed',
    );
  };
  const aliases = () => {
    for (const x of build.libraryAliases)
      c.insist(fs.realpathSync(x.alias) === x.canonical, 'ELF alias changed');
  };
  const pinnedFiles = new Map();
  async function stop() {
    if (stopping) return stopping;
    stopping = (async () => {
      closed = true;
      clearInterval(timer);
      clearTimeout(startTimer);
      const summary = await require('./ordinary-shutdown.cjs').close(child, clients);
      if (summary.childExitConfirmed && summary.localPgClosed) {
        fs.closeSync(fd);
        for (const signal of ['SIGTERM', 'SIGINT']) process.off(signal, onSignal);
        process.off('exit', onExit);
        const result = {
          ...summary,
          status: 'STOPPED',
          sharedLockHeld: false,
          evidenceOrigin: 'LOCAL',
        };
        resolveDone(result);
        return result;
      }
      const result = {
        ...summary,
        status: 'SHUTDOWN_INCOMPLETE',
        sharedLockHeld: true,
        evidenceOrigin: 'LOCAL',
      };
      resolveDone(result);
      return result;
    })();
    return stopping;
  }
  const onSignal = () => {
      void stop();
    },
    onExit = () => {
      child?.kill('SIGKILL');
    };
  try {
    for (const n of ['maintenance.json', 'handoff-fences.jsonl', 'handoff-current.json']) {
      const file = path.join(input.directory, n);
      pinnedFiles.set(file, c.sha(c.bytes(file)));
    }
    for (const f of [
      input.authorityPublicKeyPath,
      input.expectedPath,
      input.receiptPath,
      input.compatibilityReceiptPath,
      input.tlsReceiptPath,
    ])
      pinnedFiles.set(f, c.sha(c.bytes(f)));
    for (const file of [input.receiptPath, input.compatibilityReceiptPath, input.tlsReceiptPath]) {
      const master = path.join(path.dirname(file), 'issuance-complete.json');
      pinnedFiles.set(master, c.sha(c.bytes(master)));
    }
    execFileSync('/usr/bin/flock', ['-n', '-s', '3'], {
      stdio: ['ignore', 'ignore', 'ignore', fd],
    });
    inode();
    aliases();
    phase = 'CONNECT';
    const product = require(path.join(root, 'host/product.cjs'));
    for (const role of ['zhiban_control_runtime', 'zhiban_openmaic_runtime']) {
      const x = cfg.connections.find((x) => x.role === role),
        client = new product.Client({
          host: '127.0.0.1',
          port: cfg.target.port,
          user: x.role,
          password: x.password,
          database: x.database,
          connectionTimeoutMillis: 3000,
          statement_timeout: 5000,
          query_timeout: 6000,
        });
      client.on('error', () => void stop());
      clients.push(client);
      await client.connect();
    }
    let queue = Promise.resolve();
    async function verify() {
      c.insist(!closed, 'Supervisor stopped');
      inode();
      aliases();
      for (const [file, sha] of pinnedFiles)
        c.insist(c.sha(c.bytes(file)) === sha, 'Launch authority/fence drift');
      c.insist(
        h.sources().inventorySha256 === source.inventorySha256 && Date.now() < binding.validUntil,
        'Launch source/TLS expiry',
      );
      // Check bytes on every admission; ordinary process runs an immutable reviewed bundle.
      h.artifacts(root, JSON.parse(artifactRaw), p.artifactManifestSha256);
      physical.verify(root, closure);
      for (const file of [input.receiptPath, input.compatibilityReceiptPath, input.tlsReceiptPath])
        require('./receipt-completion.cjs').check(
          file,
          c.bytes(input.authorityPublicKeyPath),
          source.inventorySha256,
        );
      await e.verifyLaunchLocked(input, clients[0], clients[1], cfg.readSecret);
      inode();
      for (const [file, sha] of pinnedFiles)
        c.insist(c.sha(c.bytes(file)) === sha, 'Gate changed during admission');
    }
    const checked = () => {
      const next = queue.then(verify);
      queue = next.catch(() => {});
      return next;
    };
    phase = 'PREFLIGHT';
    await checked();
    phase = 'CHILD';
    const permissions = [
      '--permission',
      '--allow-addons',
      '--allow-fs-read=' + root,
      '--allow-fs-read=' + fs.realpathSync(process.execPath),
      '--allow-fs-read=/proc/self/stat',
      ...closure.systemLibraries.map((x) => '--allow-fs-read=' + x.path),
    ];
    await new Promise((resolve, reject) => {
      child = spawn(
        fs.realpathSync(process.execPath),
        [
          ...permissions,
          '--require',
          path.join(root, 'host/ordinary-guard.cjs'),
          path.join(root, 'host/ordinary-host.cjs'),
          '--ordinary-handoff',
          root,
        ],
        {
          cwd: root,
          env: { PATH: '/usr/bin:/bin', LANG: 'C' },
          stdio: ['ignore', 'ignore', 'ignore', 'ipc', fd],
        },
      );
      startTimer = setTimeout(() => {
        reject(Error('HTTPS bootstrap deadline'));
        void stop();
      }, 30000);
      child.on('error', () => {
        reject(Error('HTTPS child spawn rejected'));
        void stop();
      });
      child.on('disconnect', () => void stop());
      child.on('exit', () => {
        if (!ready) reject(Error('HTTPS child exited before ready'));
        void stop();
      });
      child.on('close', () => {
        if (!ready) reject(Error('HTTPS child closed before ready'));
        void stop();
      });
      child.on('message', (msg) => {
        if (msg?.type === 'CHECK' && /^\d{1,10}$/.test(msg.id || '')) {
          checked()
            .then(() => {
              if (!closed && child.connected)
                child.send({ type: 'CHECKED', id: msg.id, ok: true }, () => {});
            })
            .catch(() => void stop());
        } else if (
          msg?.type === 'LISTENING' &&
          !ready &&
          msg.releaseId === p.releaseId &&
          msg.credentialGenerationId === p.credentialGenerationId
        ) {
          ready = true;
          clearTimeout(startTimer);
          resolve();
        } else {
          phase =
            msg?.type === 'FAILED'
              ? 'CHILD_' +
                String(msg.phase)
                  .replace(/[^A-Z_]/g, '')
                  .slice(0, 40) +
                '_' +
                String(msg.code)
                  .replace(/[^A-Z_]/g, '')
                  .slice(0, 40)
              : 'CHILD_MESSAGE';
          reject(Error('Unexpected HTTPS child message'));
          void stop();
        }
      });
    });
    let polling = false;
    timer = setInterval(() => {
      if (polling || closed) return;
      polling = true;
      checked()
        .catch(() => void stop())
        .finally(() => {
          polling = false;
        });
    }, 1000);
    for (const s of ['SIGTERM', 'SIGINT']) process.on(s, onSignal);
    process.on('exit', onExit);
    return {
      status: 'LOCAL_HTTPS_LISTENING',
      origin: cfg.target.origin,
      releaseId: p.releaseId,
      childPid: child.pid,
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      runtimeAccepted: false,
      terminalActionsAllowed: false,
      stop,
      done,
    };
  } catch (error) {
    await stop();
    throw Error('Ordinary HTTPS launch rejected at ' + phase + '; gate remains unchanged');
  }
}
module.exports = { launch };
