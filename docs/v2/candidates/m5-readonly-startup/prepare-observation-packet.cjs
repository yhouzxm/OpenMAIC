#!/usr/bin/env node
// Offline only: sources and public executable bytes. No target/credential/config reads.
const fs = require('node:fs'),
  path = require('node:path'),
  c = require('./observer-contract.cjs');
function prepare() {
  const payload = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'observation-approval.template.json')),
  );
  payload.source = c.sources();
  payload.target.uid = process.getuid();
  for (const n of ['postgres', 'pg_ctl', 'psql', 'pg_controldata'])
    payload.binarySha256[n] = c.sha(fs.readFileSync(path.join(c.bin, n)));
  payload.binarySha256.node = c.sha(fs.readFileSync(process.execPath));
  return {
    formatVersion: 1,
    status: 'INCOMPLETE_UNSIGNED_PACKET',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    executionAllowed: false,
    realTargetExecuted: false,
    payload,
    signature: null,
    authority: { publicKeyPath: null, externallyTrustedPublicKeySha256: null },
    preflightReadRequest: {
      status: 'UNISSUED',
      executionAllowed: false,
      explicitConfigurationFiles: payload.configurationClosure.map((x) => x.path),
      additionalIncludeFiles:
        'Only explicit canonical paths separately reviewed; include_dir/include_if_exists rejected',
      credentialRead: 'Only approved staging pgpass path; never discover original secrets',
      controlRead:
        'Existing maintenance.json/maintenance.lock from supplied actual control root; no root/flag creation',
      targetMetadata:
        'Fixed PG_VERSION/control header, signal/PID presence and relevant endpoints; no Business/Native connection',
    },
    missingInputs: [
      'actual existing control root and BLOCKED guard hash',
      'existing lock device/inode',
      'new attempt ID and stage path under same control root',
      'explicit separate private staged pgpass path and private digest',
      'explicit fresh private authenticationStageDirectory outside data/control; snapshot staging scope',
      'reviewed original configuration closure hashes; auto.conf must have no active entries',
      'externally trusted Ed25519 public key path/pin; no fixture authority',
      'exact start argument hash',
      'explicit human authorization reference and fresh <=300s validity',
      'independent approval signature',
    ],
    allowedLifecycleAfterIssued:
      'One socket-only management observation; PG internal lifecycle writes; READ ONLY catalog SQL; close client; fast stop exact attempt postmaster; independently prove stopped before releasing custody',
    unknownPolicy:
      'Keep PG-stop, guardian departure and global release distinct; loss of release notification is checked with bound authorization plus actual child exit. Unknown custody must remain with verified guardian or resident parent; no replay/clear/fallback/restart. Inspect only; separate recovery approval required',
    notGranted: [
      'preflight reads now',
      'real startup now',
      'business writes',
      'receipt/expected/transport issuance',
      'clear',
      'ordinary HTTPS/Runtime launch',
      'commit/push/CI',
    ],
  };
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--output') throw Error('EXPLICIT_NEW_OUTPUT_REQUIRED');
  c.writeNew(path.resolve(args[1]), JSON.stringify(prepare(), null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: 'INCOMPLETE_UNSIGNED_PACKET',
      executionAllowed: false,
      realTargetExecuted: false,
    }),
  );
}
module.exports = { prepare };
