#!/usr/bin/env node
// Offline authority operation only. Never contacts PG or creates a signing key.
const os = require('node:os'),
  path = require('node:path'),
  fs = require('node:fs');
const terminal = require('./terminal-installation.cjs'),
  executor = require('./maintenance-executor.cjs');
const { writeExclusive } = require('./maintenance-lock.cjs');
try {
  if (process.argv.length !== 3 || process.argv[2] !== '--sign-reviewed-control')
    throw Error('Explicit reviewed control purpose required');
  const dir = path.join(os.homedir(), '.local/share/zhiban-m1'),
    file = (n) => path.join(dir, n);
  const pin = terminal.publicPin(file('terminal-authority-public.pem')),
    source = terminal.sources();
  const draft = JSON.parse(terminal.readPrivate(file('terminal-maintenance-approval-draft.json')));
  const signed = terminal.signed(
    { ...draft, authorityKeySha256: pin.digest },
    terminal.readPrivate(file('terminal-authority-private.pem')),
    pin,
  );
  const temp = fs.mkdtempSync(file('terminal-control-review-'));
  fs.chmodSync(temp, 0o700);
  try {
    const candidate = path.join(temp, 'approval.json');
    writeExclusive(candidate, JSON.stringify(signed));
    const p = executor.approval(
      { approvalPath: candidate, trustPinPath: file('terminal-authority-public.pem') },
      source,
    );
    if (
      terminal.trustedExpected(file('terminal-reviewed-expected.json'), pin, source).digest !==
      p.expectedArtifactSha256
    )
      throw Error('Reviewed profile binding rejected');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  writeExclusive(
    file('terminal-maintenance-approval.json'),
    JSON.stringify(signed, null, 2) + '\n',
  );
  console.log(
    JSON.stringify({
      status: 'LOCAL_CONTROL_APPROVAL_SIGNED',
      runtimeAccepted: false,
      terminalActionsAllowed: false,
    }),
  );
} catch {
  console.error(
    'Offline control signing rejected; reviewed exact scope and existing authority required.',
  );
  process.exitCode = 1;
}
