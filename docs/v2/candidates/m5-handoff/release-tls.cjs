// Pinned local TLS material; no trust-store installation or certificate generation.
const crypto = require('node:crypto'),
  path = require('node:path');
const c = require('./release-contract.cjs');
function inspect(cert, key, ca) {
  const leaf = new crypto.X509Certificate(cert),
    root = new crypto.X509Certificate(ca);
  const secret = crypto.createPrivateKey(key),
    now = Date.now();
  for (const x of [leaf, root])
    c.insist(
      Date.parse(x.validFrom) <= now && now < Date.parse(x.validTo),
      'TLS validity rejected',
    );
  c.insist(
    !leaf.ca &&
      root.ca &&
      leaf.checkIP('127.0.0.1') === '127.0.0.1' &&
      leaf.keyUsage?.includes('1.3.6.1.5.5.7.3.1') &&
      leaf.verify(root.publicKey) &&
      root.verify(root.publicKey) &&
      root.subject === root.issuer &&
      leaf.checkPrivateKey(secret),
    'TLS key/SAN/EKU/CA rejected',
  );
  c.insist(
    secret.asymmetricKeyType === 'rsa' && secret.asymmetricKeyDetails.modulusLength >= 2048,
    'Reviewed TLS RSA key required',
  );
  return {
    certificateSha256: c.sha(cert),
    privateKeySha256: c.sha(key),
    caSha256: c.sha(ca),
    validUntil: Math.min(Date.parse(leaf.validTo), Date.parse(root.validTo)),
  };
}
function load(root) {
  const cert = c.bytes(path.join(root, 'tls/certificate.pem')),
    key = c.bytes(path.join(root, 'tls/private-key.pem')),
    ca = c.bytes(path.join(root, 'tls/ca.pem'));
  return { cert, key, ca, binding: inspect(cert, key, ca) };
}
module.exports = { inspect, load };
