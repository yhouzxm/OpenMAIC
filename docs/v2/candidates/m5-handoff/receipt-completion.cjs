// The canonical signed master is the sole group commit point. Sidecars carry no authority.
const path = require('node:path'),
  c = require('./release-contract.cjs');
const groups = {
  COMPATIBILITY_TLS: {
    'compatibility-receipts.json': 'LOCAL_ORDINARY_COMPATIBILITY_RECEIPTS',
    'tls-receipt.json': 'LOCAL_ORDINARY_TLS_RECEIPT',
  },
  HANDOFF_ACK: {
    'host-validation-ack.json': 'LOCAL_HANDOFF_HOST_ACK',
    'handoff-receipt.json': 'LOCAL_PRODUCT_HANDOFF_VERIFIED',
  },
};
function read(directory, pub, sourceSha) {
  const manifestPath = path.join(directory, 'issuance-complete.json'),
    raw = c.bytes(manifestPath);
  const p = c.signed(raw, pub, 'LOCAL_ORDINARY_ISSUANCE_COMPLETE', [
    'formatVersion',
    'status',
    'purpose',
    'evidenceOrigin',
    'githubActions',
    'authorityKeySha256',
    'approvalSha256',
    'sourceBindingsSha256',
    'groupKind',
    'releaseId',
    'credentialGenerationId',
    'deploymentId',
    'files',
    'launchAllowed',
  ]);
  c.insist(
    p.status === 'ISSUANCE_COMPLETE' &&
      p.sourceBindingsSha256 === sourceSha &&
      c.HASH.test(p.approvalSha256) &&
      p.launchAllowed === false &&
      Object.hasOwn(groups, p.groupKind) &&
      [p.releaseId, p.credentialGenerationId, p.deploymentId].every((x) => c.UUID.test(x)),
    'Complete scoped issuance required',
  );
  c.keys(p.files, Object.keys(groups[p.groupKind]));
  for (const [name, purpose] of Object.entries(groups[p.groupKind])) {
    const bytes = c.bytes(path.join(directory, name)),
      e = JSON.parse(bytes);
    c.insist(
      c.HASH.test(p.files[name]) && c.sha(bytes) === p.files[name],
      'Incomplete issuance output group',
    );
    // Individual consumers still enforce their complete payload schema and business bindings.
    const leaf = c.signed(bytes, pub, purpose, Object.keys(e.payload));
    c.insist(
      leaf.status === 'ISSUED' &&
        ['releaseId', 'credentialGenerationId', 'deploymentId', 'sourceBindingsSha256'].every(
          (k) => leaf[k] === p[k],
        ),
      'Completion group generation/purpose mismatch',
    );
  }
  return { ...p, manifestPath, manifestSha256: c.sha(raw) };
}
function check(file, pub, sourceSha) {
  const p = read(path.dirname(file), pub, sourceSha);
  c.insist(
    Object.hasOwn(p.files, path.basename(file)) &&
      p.files[path.basename(file)] === c.sha(c.bytes(file)),
    'Leaf absent from committed issuance',
  );
  return p;
}
module.exports = { read, check, groups };
