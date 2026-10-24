// Candidate control-plane wiring. NOT a real-target CLI, builder or product host.
// Independent signed inputs are required; this module has no signing key/API.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'),
  path = require('node:path');
const h = require('./handoff-contracts.cjs'),
  owner = require('./handoff-owner.cjs');
const m = require('../m5-terminal/maintenance-lock.cjs');
function load(ctx, name, purpose) {
  return h.verify(h.privateBytes(ctx[name]), ctx.pin, purpose, ctx.source);
}
function scope(ctx) {
  h.privateBytes(ctx.authorityPublicKeyPath);
  const source = h.sources(),
    pin = h.publicPin(ctx.authorityPublicKeyPath);
  const expected = h.expected(h.privateBytes(ctx.expectedPath), pin, source);
  return { ...ctx, source, pin, expected };
}
function lock(ctx) {
  h.privateBytes(path.join(ctx.directory, 'maintenance.json'));
  h.privateBytes(path.join(ctx.directory, 'handoff-fences.jsonl'));
  return m.acquire(ctx.directory, 'handoff', true);
}
function journal(ctx, id, stage, digest) {
  const file = path.join(ctx.directory, 'handoff-journal-' + id + '.jsonl');
  const flags = fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW;
  if (!fs.existsSync(file)) m.writeExclusive(file, '');
  const fd = fs.openSync(file, flags);
  try {
    const s = fs.fstatSync(fd);
    h.requireValue(
      s.isFile() && s.uid === process.getuid() && !(s.mode & 0o077) && s.nlink === 1,
      'Journal leaf rejected',
    );
    fs.writeFileSync(
      fd,
      JSON.stringify({
        stage,
        artifactSha256: digest,
        evidenceOrigin: 'LOCAL',
        githubActions: false,
      }) + '\n',
    );
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}
function permit(ctx, id, digest) {
  m.writeExclusive(
    path.join(ctx.directory, 'handoff-permit-' + id + '.json'),
    JSON.stringify({
      status: 'INTENT',
      approvalSha256: digest,
      evidenceOrigin: 'LOCAL',
      githubActions: false,
    }) + '\n',
  );
  journal(ctx, id, 'INTENT', digest);
}
function history(raw, p) {
  const rows = raw
    .toString()
    .trim()
    .split('\n')
    .map((x) => JSON.parse(x));
  let highest = 0n,
    last;
  for (const r of rows) {
    h.keys(r, ['status', 'deploymentId', 'fenceId', 'fenceSequence']);
    h.requireValue(
      h.uuid.test(r.fenceId) &&
        h.positive.test(r.fenceSequence) &&
        r.deploymentId === p.deploymentId &&
        ['INTENT', 'CONFIRMED'].includes(r.status),
      'Fence history rejected',
    );
    const n = BigInt(r.fenceSequence);
    if (r.status === 'INTENT') h.requireValue(n > highest, 'Monotonic fence intent required');
    else
      h.requireValue(
        n === highest && last?.status === 'INTENT' && r.fenceId === last.fenceId,
        'Exact fence confirmation required',
      );
    highest = n;
    last = r;
  }
  h.requireValue(
    last && highest === BigInt(p.fenceSequence) && last.fenceId === p.fenceId,
    'Highest reserved fence rejected',
  );
}
function cas(ctx, p, requireBlocked = true) {
  const gate = h.privateBytes(path.join(ctx.directory, 'maintenance.json'));
  const fences = h.privateBytes(path.join(ctx.directory, 'handoff-fences.jsonl'));
  const pointer = h.privateBytes(path.join(ctx.directory, 'handoff-current.json'));
  h.requireValue(
    h.sha(fences) === p.fenceHistorySha256 && h.sha(pointer) === p.pointerSha256,
    'Fence/pointer CAS rejected',
  );
  history(fences, p);
  if (requireBlocked)
    h.requireValue(
      h.sha(gate) === p.expectedBlockedGateSha256 && JSON.parse(gate).status === 'BLOCKED',
      'Exact BLOCKED gate required',
    );
  return { gate, fences, pointer };
}
function release(ctx, p) {
  const dir = path.join(ctx.directory, 'releases', p.releaseId);
  const raw = h.privateBytes(path.join(dir, 'artifact-manifest.json')),
    manifest = JSON.parse(raw);
  h.artifacts(dir, manifest, p.artifactManifestSha256);
  h.requireValue(
    manifest.releaseId === p.releaseId &&
      manifest.credentialGenerationId === p.credentialGenerationId,
    'Pinned release generation required',
  );
  return dir;
}
async function action(input, purpose, f) {
  const ctx = scope(input),
    approval = load(ctx, 'approvalPath', purpose),
    p = approval.payload;
  h.live(p);
  const held = lock(ctx),
    deadline = Date.now() + 30000;
  const check = () => {
    held.assert();
    h.live(p);
    h.requireValue(Date.now() < deadline, 'Handoff work budget exhausted');
    h.requireValue(
      h.sources().inventorySha256 === ctx.source.inventorySha256,
      'Source changed during handoff',
    );
  };
  try {
    check();
    permit(ctx, p.approvalId, approval.digest);
    const r = await f(ctx, approval, check);
    check();
    journal(ctx, p.approvalId, r.status, approval.digest);
    return { ...r, evidenceOrigin: 'LOCAL', githubActions: false, productionSignoff: false };
  } catch (e) {
    journal(ctx, p.approvalId, 'ACK_UNKNOWN_NO_REPLAY', approval.digest);
    throw Error('Handoff action blocked; exact inspection required');
  } finally {
    held.release();
  }
}
async function install(input) {
  return action(input, 'LOCAL_HANDOFF_INSTALL', async (ctx, a, check) => {
    h.requireValue(
      JSON.parse(h.privateBytes(path.join(ctx.directory, 'maintenance.json'))).status === 'BLOCKED',
      'Installer requires BLOCKED gate',
    );
    const r = await owner.install(ctx, a, ctx.expected);
    check();
    return r;
  });
}
async function register(input) {
  return action(input, 'LOCAL_PRODUCT_HANDOFF_PREPARE', async (ctx, a, check) => {
    cas(ctx, a.payload);
    release(ctx, a.payload);
    const r = await owner.register(
      ctx,
      a,
      ctx.expected,
      h.privateBytes(ctx.readSecretPath).toString().trim(),
    );
    check();
    return r;
  });
}
async function seal(input) {
  // Register and seal are phases of one prepare approval, with separate durable phase permits.
  const ctx = scope(input),
    approval = load(ctx, 'approvalPath', 'LOCAL_PRODUCT_HANDOFF_PREPARE'),
    p = approval.payload;
  h.live(p);
  const held = lock(ctx),
    deadline = Date.now() + 30000;
  try {
    h.requireValue(
      JSON.parse(
        h.privateBytes(path.join(ctx.directory, 'handoff-permit-' + p.approvalId + '.json')),
      ).approvalSha256 === approval.digest,
      'Prepare registration permit required',
    );
    m.writeExclusive(
      path.join(ctx.directory, 'handoff-seal-' + p.approvalId + '.json'),
      JSON.stringify({ status: 'INTENT', approvalSha256: approval.digest }) + '\n',
    );
    cas(ctx, p);
    const releaseDirectory = release(ctx, p);
    require('./receipt-completion.cjs').check(
      ctx.receiptPath,
      h.privateBytes(ctx.authorityPublicKeyPath),
      ctx.source.inventorySha256,
    );
    const receipt = load(ctx, 'receiptPath', 'LOCAL_PRODUCT_HANDOFF_VERIFIED'),
      ack = load(ctx, 'hostAckPath', 'LOCAL_HANDOFF_HOST_ACK');
    // Challenge persisted BEFORE child validation by the approved private orchestrator.
    const challenge = h.privateBytes(ctx.challengePath).toString().trim();
    h.requireValue(h.digest.test(challenge), 'Persisted random challenge required');
    const result = await owner.seal(
      ctx,
      approval,
      ctx.expected,
      receipt,
      ack,
      h.privateBytes(ctx.readSecretPath).toString().trim(),
      h.sha(challenge),
    );
    held.assert();
    h.live(p);
    h.requireValue(
      Date.now() < deadline && h.sources().inventorySha256 === ctx.source.inventorySha256,
      'Seal deadline/source changed',
    );
    cas(ctx, p);
    release(ctx, p);
    m.writeExclusive(path.join(releaseDirectory, 'handoff-receipt.json'), receipt.raw);
    m.writeExclusive(path.join(releaseDirectory, 'host-validation-ack.json'), ack.raw);
    const pointerRaw = Buffer.from(
      JSON.stringify({
        releaseId: p.releaseId,
        artifactManifestSha256: p.artifactManifestSha256,
        handoffReceiptSha256: receipt.digest,
      }) + '\n',
    );
    const pointerStage = path.join(ctx.directory, 'pointer-staged-' + p.approvalId + '.json');
    m.writeExclusive(pointerStage, pointerRaw);
    h.live(p);
    cas(ctx, p);
    fs.renameSync(pointerStage, path.join(ctx.directory, 'handoff-current.json'));
    m.syncDir(ctx.directory);
    journal(ctx, p.approvalId, 'HANDOFF_VERIFIED', receipt.digest);
    return {
      pointerSha256: h.sha(pointerRaw),
      ...result,
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      productionSignoff: false,
    };
  } catch (e) {
    journal(ctx, p.approvalId, 'SEAL_ACK_UNKNOWN_NO_REPLAY', approval.digest);
    throw Error('Handoff seal blocked; exact inspection required');
  } finally {
    held.release();
  }
}
async function revoke(input) {
  return action(input, 'LOCAL_HANDOFF_SCOPE_REVOKE', async (ctx, a, check) => {
    const r = await owner.revoke(ctx, a, ctx.expected);
    check();
    return r;
  });
}
function gateBindings(clear, gate, receipt) {
  for (const k of [
    'approvalId',
    'releaseId',
    'credentialGenerationId',
    'deploymentId',
    'windowId',
    'epoch',
    'fenceId',
    'fenceSequence',
    'fenceHistorySha256',
    'pointerSha256',
    'handoffReceiptSha256',
    'artifactManifestSha256',
  ])
    h.requireValue(clear.payload[k] === gate.payload[k], 'Clear/gate tuple rejected');
  h.requireValue(
    clear.payload.targetGateSha256 === gate.digest &&
      clear.payload.handoffReceiptSha256 === receipt.digest,
    'Exact dormant gate/receipt required',
  );
  for (const k of [
    'releaseId',
    'credentialGenerationId',
    'deploymentId',
    'windowId',
    'epoch',
    'fenceId',
    'fenceSequence',
    'handoffId',
    'sourceBindingsSha256',
    'artifactManifestSha256',
    'hostAckSha256',
    'target',
  ])
    h.requireValue(
      h.canonical(clear.payload[k]) === h.canonical(receipt.payload[k]),
      'Clear/handoff scope rejected',
    );
  h.requireValue(
    clear.payload.profileSha256 === receipt.payload.profileSha256,
    'Clear/profile scope rejected',
  );
}
async function clear(input) {
  return action(input, 'LOCAL_RESUME_FLAG_CLEAR', async (ctx, approval, check) => {
    const p = approval.payload,
      gate = load(ctx, 'gatePath', 'LOCAL_STARTUP_RELEASE_GATE'),
      receipt = load(ctx, 'receiptPath', 'LOCAL_PRODUCT_HANDOFF_VERIFIED');
    let physicalAdminBound = false;
    try {
      gateBindings(approval, gate, receipt);
      await h.target(ctx.business, p.target);
      const physicalAdmin = (
        await ctx.admin.query(
          "SELECT current_database() db,(SELECT system_identifier::text FROM pg_control_system()) cluster,current_setting('data_directory') data",
        )
      ).rows[0];
      h.requireValue(
        physicalAdmin.db === 'postgres' &&
          physicalAdmin.cluster === p.target.cluster &&
          physicalAdmin.data === p.target.dataDirectory,
        'Same-cluster management session required',
      );
      physicalAdminBound = true;
      cas(ctx, p);
      const releaseDirectory = release(ctx, p);
      h.requireValue(
        h.sha(h.privateBytes(path.join(releaseDirectory, 'handoff-receipt.json'))) ===
          receipt.digest &&
          h.sha(h.privateBytes(path.join(releaseDirectory, 'host-validation-ack.json'))) ===
            receipt.payload.hostAckSha256,
        'Pinned handoff outputs required',
      );
      h.requireValue(
        p.profileSha256 === ctx.expected.digest,
        'Independent expected profile required',
      );
      h.requireValue(
        h.sha(h.privateBytes(ctx.hbaPath)) === p.hbaSha256 &&
          ctx.hbaPath === path.join(p.target.dataDirectory, 'pg_hba.conf'),
        'Approved HBA bytes required',
      );
      const logging = (
        await ctx.admin.query(
          "SELECT name,setting FROM pg_settings WHERE name IN('log_statement','log_parameter_max_length','log_parameter_max_length_on_error','log_min_error_statement') ORDER BY name",
        )
      ).rows;
      h.requireValue(
        h.sha(h.canonical(logging)) === p.loggingSha256 &&
          logging
            .filter((x) => x.name.startsWith('log_parameter_max_length'))
            .every((x) => x.setting === '0'),
        'Approved no-parameter logging required',
      );
      const controllerSecret = h.privateBytes(ctx.controllerSecretPath).toString().trim(),
        clearSecret = h.privateBytes(ctx.clearSecretPath).toString().trim();
      await owner.seedClear(
        ctx,
        approval,
        ctx.expected,
        ctx.controller,
        controllerSecret,
        clearSecret,
      );
      // No ordinary passwords changed. Owner/Native sessions must really disappear.
      await ctx.business.end();
      await ctx.native.end();
      await ctx.admin.query('ALTER ROLE zhiban_reconcile_controller NOLOGIN PASSWORD NULL');
      check();
      cas(ctx, p);
      const c = ctx.controller,
        stage = path.join(ctx.directory, 'gate-staged-' + p.approvalId + '.json');
      let attemptedCommit = false,
        knownCommit = false;
      try {
        await c.query('BEGIN READ WRITE ISOLATION LEVEL READ COMMITTED');
        await c.query("SET LOCAL statement_timeout='5000ms'");
        await c.query("SET LOCAL lock_timeout='1000ms'");
        await c.query("SET LOCAL idle_in_transaction_session_timeout='10000ms'");
        await c.query('SELECT zhiban_handoff.begin_clear($1,$2,$3)', [
          p.approvalId,
          controllerSecret,
          clearSecret,
        ]);
        check();
        cas(ctx, p);
        m.writeExclusive(stage, gate.raw);
        check();
        const result = (
          await c.query('SELECT zhiban_handoff.commit_clear($1,$2,$3) value', [
            p.approvalId,
            controllerSecret,
            clearSecret,
          ])
        ).rows[0].value;
        h.requireValue(
          result.status === 'COMMIT_PENDING' && result.targetGateSha256 === gate.digest,
          'Pending control commit required',
        );
        attemptedCommit = true;
        await c.query('COMMIT');
        knownCommit = true;
        journal(ctx, p.approvalId, 'CLEAR_DB_COMMITTED', gate.digest);
        // Faults/unknown ACK never call this write sequence a second time.
        check();
        cas(ctx, p);
        release(ctx, p);
        await c.query('BEGIN READ WRITE ISOLATION LEVEL READ COMMITTED');
        const fresh = (
          await c.query('SELECT zhiban_handoff.verify_clear_publication($1,$2,$3) value', [
            p.approvalId,
            controllerSecret,
            clearSecret,
          ])
        ).rows[0].value;
        h.requireValue(
          fresh.status === 'COMMITTED_CURRENT' && fresh.targetGateSha256 === gate.digest,
          'Fresh committed publication scope required',
        );
        check();
        cas(ctx, p);
        h.requireValue(h.sha(h.privateBytes(stage)) === gate.digest, 'Staged gate drift');
        fs.renameSync(stage, path.join(ctx.directory, 'maintenance.json'));
        m.syncDir(ctx.directory);
        await c.query('COMMIT');
        return {
          status: 'CLEARED_FILE_PUBLISHED',
          launchAllowed: false,
          hostStarted: false,
          gateSha256: gate.digest,
        };
      } catch (e) {
        await c.query('ROLLBACK').catch(() => {});
        journal(
          ctx,
          p.approvalId,
          knownCommit
            ? 'DB_COMMITTED_FILE_ACK_UNKNOWN'
            : attemptedCommit
              ? 'DB_COMMIT_ACK_UNKNOWN'
              : 'CONTROL_ATTEMPT_FAILED',
          gate.digest,
        );
        // Inspection is a separate call. COMMITTED observation has no publish permission.
        throw e;
      } finally {
        await c.end().catch(() => {});
      }
    } finally {
      // Cleanup executes under the acquired flock, after signed physical target verification.
      if (physicalAdminBound)
        await ctx.admin
          .query('ALTER ROLE zhiban_reconcile_controller NOLOGIN PASSWORD NULL')
          .catch(() => {});
      for (const client of [ctx.business, ctx.native, ctx.controller])
        await client.end().catch(() => {});
    }
  });
}
async function inspect(input, controller, controllerSecret, approvalId) {
  const ctx = scope(input);
  h.requireValue(
    h.uuid.test(approvalId) && h.digest.test(controllerSecret),
    'Exact lookup required',
  );
  const held = lock(ctx);
  try {
    const result = (
      await controller.query('SELECT zhiban_handoff.read_clear_result($1,$2) value', [
        approvalId,
        controllerSecret,
      ])
    ).rows[0].value;
    const raw = h.privateBytes(path.join(ctx.directory, 'maintenance.json'));
    let published = false;
    try {
      const gate = h.verify(raw, ctx.pin, 'LOCAL_STARTUP_RELEASE_GATE', ctx.source);
      published =
        result.status === 'COMMITTED' &&
        gate.payload.approvalId === approvalId &&
        gate.digest === result.targetGateSha256;
    } catch {}
    return {
      status: published ? 'COMMITTED_FILE_OBSERVED' : result.status,
      approvalId,
      publishGateAllowed: false,
      replayAllowed: false,
      launchAllowed: false,
      hostStarted: false,
      evidenceOrigin: 'LOCAL',
      githubActions: false,
    };
  } finally {
    held.release();
  }
}
async function verifyLaunchLocked(input, business, native, readSecret) {
  // Loader only; product launcher is deliberately not switched to this candidate.
  const ctx = scope(input),
    raw = h.privateBytes(path.join(ctx.directory, 'maintenance.json')),
    gate = h.verify(raw, ctx.pin, 'LOCAL_STARTUP_RELEASE_GATE', ctx.source),
    p = gate.payload;
  cas(ctx, p, false);
  const pointer = JSON.parse(h.privateBytes(path.join(ctx.directory, 'handoff-current.json')));
  h.keys(pointer, ['releaseId', 'artifactManifestSha256', 'handoffReceiptSha256']);
  for (const k of Object.keys(pointer))
    h.requireValue(pointer[k] === p[k], 'Pinned pointer rejected');
  const releaseDirectory = release(ctx, p);
  require('./receipt-completion.cjs').check(
    ctx.receiptPath,
    h.privateBytes(ctx.authorityPublicKeyPath),
    ctx.source.inventorySha256,
  );
  const receipt = load(ctx, 'receiptPath', 'LOCAL_PRODUCT_HANDOFF_VERIFIED');
  h.requireValue(
    receipt.digest === p.handoffReceiptSha256 &&
      receipt.payload.profileSha256 === ctx.expected.digest,
    'Pinned handoff receipt required',
  );
  h.requireValue(
    h.sha(h.privateBytes(path.join(releaseDirectory, 'handoff-receipt.json'))) === receipt.digest &&
      h.sha(h.privateBytes(path.join(releaseDirectory, 'host-validation-ack.json'))) ===
        receipt.payload.hostAckSha256,
    'Pinned handoff outputs required',
  );
  h.ordinaryEndpoint(business, receipt.payload.target, 'zhiban_control_runtime');
  h.ordinaryEndpoint(native, receipt.payload.target, 'zhiban_openmaic_runtime');
  h.profile(await h.collect(business, native), ctx.expected.payload.after);
  const f = (
    await business.query('SELECT zhiban_handoff.inspect_host_installation($1,$2,$3) value', [
      p.deploymentId,
      p.releaseId,
      readSecret,
    ])
  ).rows[0].value;
  h.requireValue(
    f.activationStatus === 'COMMITTED' &&
      f.claimsEmpty === true &&
      f.readPermissionPhase === 'ACTIVE' &&
      f.epoch === p.epoch &&
      f.artifactManifestSha256 === p.artifactManifestSha256 &&
      f.handoffReceiptSha256 === p.handoffReceiptSha256 &&
      f.profileSha256 === ctx.expected.digest &&
      f.sourceSha256 === ctx.source.inventorySha256 &&
      f.credentialGenerationId === p.credentialGenerationId,
    'Current DB activation facts required',
  );
  for (const k of ['approvalId', 'fenceId', 'fenceSequence'])
    h.requireValue(f[k] === p[k], 'Current committed gate tuple required');
  h.requireValue(
    f.targetGateSha256 === gate.digest &&
      f.cluster === receipt.payload.target.cluster &&
      Number(f.pg) >= 160000 &&
      Number(f.pg) < 170000,
    'Current target/gate digest required',
  );
  const nativeFact = (
    await native.query(
      'SELECT current_database() db,pg_postmaster_start_time() start,(SELECT oid::text FROM pg_database WHERE datname=current_database()) oid',
    )
  ).rows[0];
  h.requireValue(
    nativeFact.db === 'zhiban_m5_native' &&
      nativeFact.oid === receipt.payload.target.nativeOid &&
      nativeFact.start.toISOString() === new Date(f.postmasterStart).toISOString(),
    'Native endpoint/OID/postmaster rejected',
  );
  const targets = (f.databases || [])
    .map((x) => ({ name: x.name, oid: x.oid, allowConnections: x.allowConnections }))
    .sort((a, b) => a.name.localeCompare(b.name));
  h.requireValue(
    h.canonical(targets) ===
      h.canonical([
        { name: 'zhiban_m1_dev', oid: receipt.payload.target.businessOid, allowConnections: true },
        { name: 'zhiban_m5_native', oid: receipt.payload.target.nativeOid, allowConnections: true },
      ]),
    'Dual database identity/admission required',
  );
  h.requireValue(
    h.canonical(f.ledgers) === h.canonical(h.ordinaryLedgers(ctx.source)),
    'All ordinary composition ledgers required',
  );
  return {
    status: 'CONTROL_GATE_VERIFIED',
    releaseId: p.releaseId,
    hostStarted: false,
    runtimeAccepted: false,
    evidenceOrigin: 'LOCAL',
    githubActions: false,
  };
}
async function verifyLaunch(input, business, native, readSecret) {
  // A scoped observation only: shared lock is held through checks, then released.
  // A future real supervisor must keep/inherit the FD through child lifetime.
  const file = path.join(input.directory, 'maintenance.lock');
  h.privateBytes(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW),
    stat = fs.fstatSync(fd);
  try {
    execFileSync('/usr/bin/flock', ['-n', '-s', '3'], {
      stdio: ['ignore', 'ignore', 'ignore', fd],
    });
    const result = await verifyLaunchLocked(input, business, native, readSecret);
    h.requireValue(fs.lstatSync(file).ino === stat.ino, 'Shared observation lock changed');
    return result;
  } finally {
    fs.closeSync(fd);
  }
}
async function validate(input) {
  return require('./validation-parent.cjs').run(input);
}
module.exports = {
  validate,
  install,
  register,
  seal,
  revoke,
  clear,
  inspect,
  verifyLaunch,
  verifyLaunchLocked,
  scope,
  cas,
  history,
};
