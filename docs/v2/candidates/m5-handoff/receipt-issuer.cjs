// Offline scoped issuer. Independent review pin is separate from the operational signing pin.
// No arbitrary signing API, owner SQL, controller, credential rotation or flag publication.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const c = require('./release-contract.cjs'),
  h = require('./handoff-contracts.cjs'),
  physical = require('./physical-closure.cjs');
const m = require('../m5-terminal/maintenance-lock.cjs');
const contexts = ['identity', 'academic', 'learning', 'assessment', 'content'];
const template = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, n + '.template.json')));
function release(root, pub) {
  const source = h.sources(),
    artifactRaw = c.bytes(path.join(root, 'artifact-manifest.json'));
  h.artifacts(root, JSON.parse(artifactRaw), c.sha(artifactRaw));
  const closure = JSON.parse(c.bytes(path.join(root, 'closure-manifest.json')));
  physical.verify(root, closure);
  const buildRaw = c.bytes(path.join(root, 'build-manifest.json')),
    build = JSON.parse(buildRaw),
    raw = c.bytes(path.join(root, 'ordinary.json')),
    v = JSON.parse(raw),
    cfg = c.config(v, v.releaseId, v.credentialGenerationId);
  c.insist(
    build.sourceBindingsSha256 === source.inventorySha256 &&
      build.configurationSha256 === c.sha(raw),
    'Issuer current build required',
  );
  const pin = h.publicPin(pub);
  return {
    source,
    buildRaw,
    build,
    cfg,
    artifactRaw,
    common: {
      formatVersion: 1,
      status: 'ISSUED',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      authorityKeySha256: pin.digest,
      releaseId: cfg.releaseId,
      credentialGenerationId: cfg.credentialGenerationId,
      deploymentId: cfg.deploymentId,
      sourceBindingsSha256: source.inventorySha256,
    },
  };
}
function proposeBundle(input) {
  c.keys(input, ['releaseDirectory', 'authorityPublicKeyPath', 'previousReceiptPaths']);
  c.keys(input.previousReceiptPaths, contexts);
  const r = release(input.releaseDirectory, input.authorityPublicKeyPath),
    product = require(path.join(input.releaseDirectory, 'host/product.cjs')),
    entries = {};
  for (const k of contexts) {
    const policy =
      k === 'identity'
        ? r.cfg.identity.manifest.policy
        : k === 'content'
          ? JSON.parse(c.bytes(path.join(input.releaseDirectory, 'assets/content-csp.json'))).policy
          : product.policies[k];
    entries[k] = {
      policySha256: c.sha(c.canonical(policy)),
      ledgerSha256: c.sha(c.canonical(r.build.ledgerBindings.filter((x) => x.context === k))),
      previousReceiptSha256: c.sha(c.bytes(input.previousReceiptPaths[k])),
    };
  }
  const compatibility = {
    ...r.common,
    purpose: 'LOCAL_ORDINARY_COMPATIBILITY_RECEIPTS',
    configurationSha256: r.build.configurationSha256,
    buildManifestSha256: c.sha(r.buildRaw),
    contexts: entries,
    launchAllowed: false,
    terminalActionsAllowed: false,
  };
  const binding = require('./release-tls.cjs').load(input.releaseDirectory).binding;
  const tls = {
    ...r.common,
    purpose: 'LOCAL_ORDINARY_TLS_RECEIPT',
    artifactManifestSha256: c.sha(r.artifactRaw),
    configurationSha256: r.build.configurationSha256,
    origin: r.cfg.target.origin,
    ...binding,
    trust: 'PINNED_LOCAL_CA_REQUIRES_CLIENT_TRUST',
    launchAllowed: false,
  };
  return { compatibility, tls };
}
function review(input, kind, bindings) {
  const raw = c.bytes(input.reviewApprovalPath),
    reviewer = c.bytes(input.reviewerPublicKeyPath),
    pub = c.bytes(input.authorityPublicKeyPath);
  const p = c.signed(
    raw,
    reviewer,
    'LOCAL_ORDINARY_ISSUANCE_APPROVAL',
    Object.keys(template('issuance-approval')),
  );
  const issuer = h.publicPin(input.authorityPublicKeyPath);
  c.insist(
    p.status === 'ISSUED' &&
      p.kind === kind &&
      p.controlDirectory === input.controlDirectory &&
      p.issuerKeySha256 === issuer.digest &&
      p.authorityKeySha256 !== issuer.digest &&
      c.UUID.test(p.approvalId) &&
      p.sourceBindingsSha256 === h.sources().inventorySha256 &&
      p.reviewRef?.length > 0 &&
      c.canonical(p.bindings) === c.canonical(bindings),
    'Independent exact issuance approval required',
  );
  h.live(p);
  c.directory(input.outputDirectory);
  // Never put private signing material into a release/child-accessible control directory.
  c.insist(
    !input.issuerKeyPath.startsWith(input.controlDirectory + '/') &&
      !input.issuerKeyPath.startsWith(input.outputDirectory + '/'),
    'Issuer key must be outside delivery/child tree',
  );
  return { p, digest: c.sha(raw), pub };
}
function reservation(input, review) {
  c.directory(input.controlDirectory);
  m.writeExclusive(
    path.join(input.controlDirectory, 'issuance-permit-' + review.p.approvalId + '.json'),
    JSON.stringify({ status: 'INTENT_NO_REPLAY', approvalSha256: review.digest }) + '\n',
  );
  const out = path.join(input.outputDirectory, review.p.approvalId);
  fs.mkdirSync(out, { mode: 0o700 });
  m.syncDir(input.outputDirectory);
  m.writeExclusive(
    path.join(out, 'intent.json'),
    JSON.stringify({
      status: 'INTENT_NO_REPLAY',
      approvalSha256: review.digest,
      evidenceOrigin: 'LOCAL',
    }) + '\n',
  );
  return out;
}
function publish(input, r, out, payloads) {
  h.live(r.p);
  c.insist(h.sources().inventorySha256 === r.p.sourceBindingsSha256, 'Issuer source drift');
  const raw = c.bytes(input.issuerKeyPath),
    key = crypto.createPrivateKey(raw);
  raw.fill(0);
  c.insist(
    key.asymmetricKeyType === 'ed25519' &&
      c.sha(crypto.createPublicKey(key).export({ format: 'der', type: 'spki' })) ===
        r.p.issuerKeySha256,
    'Scoped issuer key mismatch',
  );
  const files = {},
    completion = require('./receipt-completion.cjs');
  c.insist(Object.hasOwn(completion.groups, r.p.kind), 'Scoped issuance kind rejected');
  c.keys(payloads, Object.keys(completion.groups[r.p.kind]));
  const first = Object.values(payloads)[0];
  for (const [name, p] of Object.entries(payloads))
    c.insist(
      p.purpose === completion.groups[r.p.kind][name] &&
        ['releaseId', 'credentialGenerationId', 'deploymentId', 'sourceBindingsSha256'].every(
          (k) => p[k] === first[k],
        ),
      'Issuer group generation mismatch',
    );
  let phase = 'LEAVES';
  try {
    for (const [name, p] of Object.entries(payloads)) {
      const bytes = Buffer.from(
        JSON.stringify({
          payload: p,
          signature: crypto.sign(null, Buffer.from(c.canonical(p)), key).toString('base64'),
        }) + '\n',
      );
      m.writeExclusive(path.join(out, name), bytes);
      files[name] = c.sha(bytes);
    }
    h.live(r.p);
    c.insist(h.sources().inventorySha256 === r.p.sourceBindingsSha256, 'Issuer final source drift');
    const complete = {
      formatVersion: 1,
      status: 'ISSUANCE_COMPLETE',
      purpose: 'LOCAL_ORDINARY_ISSUANCE_COMPLETE',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      authorityKeySha256: r.p.issuerKeySha256,
      approvalSha256: r.digest,
      sourceBindingsSha256: r.p.sourceBindingsSha256,
      groupKind: r.p.kind,
      releaseId: first.releaseId,
      credentialGenerationId: first.credentialGenerationId,
      deploymentId: first.deploymentId,
      files,
      launchAllowed: false,
    };
    const completeRaw = Buffer.from(
      JSON.stringify({
        payload: complete,
        signature: crypto.sign(null, Buffer.from(c.canonical(complete)), key).toString('base64'),
      }) + '\n',
    );
    phase = 'STAGED_MASTER';
    m.writeExclusive(path.join(out, '.issuance-complete-staged.json'), completeRaw);
    h.live(r.p);
    c.insist(
      h.sources().inventorySha256 === r.p.sourceBindingsSha256,
      'Issuer source drift before commit',
    );
    c.insist(
      !fs.existsSync(path.join(out, 'issuance-complete.json')),
      'Canonical master already exists; no replay',
    );
    phase = 'COMMIT_RENAME';
    fs.renameSync(
      path.join(out, '.issuance-complete-staged.json'),
      path.join(out, 'issuance-complete.json'),
    );
    phase = 'COMMIT_FSYNC';
    m.syncDir(out);
    return {
      directory: out,
      files,
      status: 'ISSUED_LOCAL',
      completionManifestSha256: c.sha(completeRaw),
      acknowledged: true,
      launchAllowed: false,
    };
  } catch (error) {
    // The master may be present after a lost rename/fsync ACK. Never rewrite it or re-sign.
    if (fs.existsSync(path.join(out, 'issuance-complete.json'))) {
      return {
        directory: out,
        files,
        status: 'ISSUANCE_COMMITTED_ACK_UNKNOWN',
        failedPhase: phase,
        acknowledged: false,
        inspectionRequired: true,
        launchAllowed: false,
      };
    }
    throw Object.assign(Error('Issuance not committed; inspection required, no replay'), {
      code: 'ISSUANCE_NOT_COMMITTED',
      failedPhase: phase,
    });
  }
}
function commonKeys() {
  return [
    'controlDirectory',
    'authorityPublicKeyPath',
    'reviewerPublicKeyPath',
    'reviewApprovalPath',
    'issuerKeyPath',
    'outputDirectory',
  ];
}
async function issueBundle(input) {
  c.keys(input, [...commonKeys(), 'releaseDirectory', 'previousReceiptPaths']);
  const payloads = proposeBundle({
    releaseDirectory: input.releaseDirectory,
    authorityPublicKeyPath: input.authorityPublicKeyPath,
    previousReceiptPaths: input.previousReceiptPaths,
  });
  const bindings = {
      compatibilityPayloadSha256: c.sha(c.canonical(payloads.compatibility)),
      tlsPayloadSha256: c.sha(c.canonical(payloads.tls)),
    },
    r = review(input, 'COMPATIBILITY_TLS', bindings);
  c.bytes(path.join(input.controlDirectory, 'maintenance.json'));
  const held = m.acquire(input.controlDirectory, 'handoff', true);
  try {
    c.insist(
      JSON.parse(c.bytes(path.join(input.controlDirectory, 'maintenance.json'))).status ===
        'BLOCKED',
      'Issuance requires BLOCKED',
    );
    const out = reservation(input, r);
    const fresh = proposeBundle({
      releaseDirectory: input.releaseDirectory,
      authorityPublicKeyPath: input.authorityPublicKeyPath,
      previousReceiptPaths: input.previousReceiptPaths,
    });
    c.insist(c.canonical(fresh) === c.canonical(payloads), 'Issuer input drift');
    held.assert();
    return publish(input, r, out, {
      'compatibility-receipts.json': payloads.compatibility,
      'tls-receipt.json': payloads.tls,
    });
  } finally {
    held.release();
  }
}
function validationBindings(v) {
  const fields = [
    'approvalPath',
    'expectedPath',
    'compatibilityReceiptPath',
    'transportEvidencePath',
    'previousCredentialsPath',
    'shadowEvidencePath',
  ];
  return Object.fromEntries(fields.map((k) => [k, v[k] === null ? null : c.sha(c.bytes(v[k]))]));
}
async function issueHandoff(input) {
  c.keys(input, [...commonKeys(), 'validation']);
  c.insist(
    input.validation.controlDirectory === input.controlDirectory &&
      input.validation.authorityPublicKeyPath === input.authorityPublicKeyPath,
    'Issuer/validator scope mismatch',
  );
  const bindings = validationBindings(input.validation),
    r = review(input, 'HANDOFF_ACK', bindings),
    out = reservation(input, r);
  // A fresh guarded child is mandatory. No resultPath/boolean or externally supplied ACK input.
  require('./receipt-completion.cjs').check(
    input.validation.compatibilityReceiptPath,
    c.bytes(input.authorityPublicKeyPath),
    r.p.sourceBindingsSha256,
  );
  const validated = await require('./validation-parent.cjs').run(input.validation);
  c.insist(
    validated.status === 'VALIDATED_FOR_LAUNCH' &&
      Object.values(validated.result.checks).every((x) => x === true),
    'Incomplete validation cannot be signed',
  );
  const held = m.acquire(input.controlDirectory, 'handoff', true);
  try {
    const source = h.sources(),
      pin = h.publicPin(input.authorityPublicKeyPath),
      a = h.verify(
        c.bytes(input.validation.approvalPath),
        pin,
        'LOCAL_PRODUCT_HANDOFF_PREPARE',
        source,
      ),
      p = a.payload;
    h.live(p);
    held.assert();
    require('./handoff-executor.cjs').cas({ directory: input.controlDirectory }, p);
    c.insist(
      c.canonical(validationBindings(input.validation)) === c.canonical(bindings),
      'Validation inputs changed before signing',
    );
    const root = path.join(input.controlDirectory, 'releases', p.releaseId);
    release(root, input.authorityPublicKeyPath);
    const result = validated.result,
      ack = { ...template('host-ack'), status: 'ISSUED', authorityKeySha256: pin.digest };
    for (const k of Object.keys(ack)) if (Object.hasOwn(result, k)) ack[k] = result[k];
    ack.status = 'ISSUED';
    ack.purpose = 'LOCAL_HANDOFF_HOST_ACK';
    ack.validationEvidenceSha256 = validated.validationEvidenceSha256;
    const cfg = JSON.parse(c.bytes(path.join(root, 'ordinary.json')));
    // Sign ACK first in memory; its exact bytes form the handoff receipt binding.
    const keyRaw = c.bytes(input.issuerKeyPath),
      key = crypto.createPrivateKey(keyRaw);
    keyRaw.fill(0);
    c.insist(
      c.sha(crypto.createPublicKey(key).export({ format: 'der', type: 'spki' })) === pin.digest,
      'Issuer key mismatch',
    );
    const ackRaw = Buffer.from(
      JSON.stringify({
        payload: ack,
        signature: crypto.sign(null, Buffer.from(c.canonical(ack)), key).toString('base64'),
      }) + '\n',
    );
    const receipt = {
      ...template('handoff-receipt'),
      status: 'ISSUED',
      authorityKeySha256: pin.digest,
    };
    for (const k of Object.keys(receipt)) if (Object.hasOwn(p, k)) receipt[k] = p[k];
    Object.assign(receipt, {
      purpose: 'LOCAL_PRODUCT_HANDOFF_VERIFIED',
      prepareApprovalId: p.approvalId,
      profileSha256: p.expectedProfileSha256,
      compatibilityReceiptsSha256: result.compatibilityReceiptsSha256,
      hostAckSha256: c.sha(ackRaw),
      readAuthorization: {
        deploymentId: p.deploymentId,
        releaseId: p.releaseId,
        permissionDigest: c.sha(cfg.readSecret),
      },
    });
    const got = publish(input, r, out, {
      'host-validation-ack.json': ack,
      'handoff-receipt.json': receipt,
    });
    c.insist(
      got.files['host-validation-ack.json'] === receipt.hostAckSha256,
      'Deterministic ACK binding rejected',
    );
    return {
      ...got,
      challengePath: validated.challengePath,
      validationResultPath: validated.resultPath,
    };
  } finally {
    held.release();
  }
}
function inspectIssuance(input) {
  c.keys(input, ['directory', 'authorityPublicKeyPath', 'expectedApprovalSha256']);
  c.directory(input.directory);
  c.insist(c.HASH.test(input.expectedApprovalSha256), 'Exact approval digest required');
  const intent = JSON.parse(c.bytes(path.join(input.directory, 'intent.json')));
  c.insist(
    intent.status === 'INTENT_NO_REPLAY' && intent.approvalSha256 === input.expectedApprovalSha256,
    'Exact issuance intent required',
  );
  const master = path.join(input.directory, 'issuance-complete.json');
  if (!fs.existsSync(master))
    return {
      status: 'NOT_COMMITTED_OBSERVED',
      writeReplayAllowed: false,
      launchAllowed: false,
      evidenceOrigin: 'LOCAL',
    };
  try {
    const p = require('./receipt-completion.cjs').read(
      input.directory,
      c.bytes(input.authorityPublicKeyPath),
      h.sources().inventorySha256,
    );
    c.insist(p.approvalSha256 === input.expectedApprovalSha256, 'Committed approval mismatch');
    return {
      status: 'SIGNED_COMMIT_OBSERVED',
      completionManifestSha256: p.manifestSha256,
      groupKind: p.groupKind,
      releaseId: p.releaseId,
      credentialGenerationId: p.credentialGenerationId,
      writeReplayAllowed: false,
      launchAllowed: false,
      evidenceOrigin: 'LOCAL',
    };
  } catch {
    return {
      status: 'UNKNOWN_OR_INVALID',
      writeReplayAllowed: false,
      launchAllowed: false,
      evidenceOrigin: 'LOCAL',
    };
  }
}
module.exports = { proposeBundle, issueBundle, issueHandoff, validationBindings, inspectIssuance };
