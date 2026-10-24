#!/usr/bin/env node
// Offline explicit signing by the local review authority; NEVER reads a database.
// Keys must already exist and the PUBLIC trust pin must be independently pinned.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const terminal = require('./terminal-installation.cjs');
const directory = path.join(os.homedir(), '.local/share/zhiban-m1');
(async () => {
  const kind = process.argv[2];
  if (process.argv.length !== 3 || !['--expected', '--install-approval'].includes(kind))
    throw Error('Explicit offline signing purpose required');
  const read = (name) => {
    const file = path.join(directory, name);
    for (const p of [directory, file]) {
      const s = fs.lstatSync(p);
      if (s.isSymbolicLink() || s.uid !== process.getuid() || s.mode & 0o077)
        throw Error('Private review input rejected');
    }
    return fs.readFileSync(file);
  };
  const pin = terminal.publicPin(path.join(directory, 'terminal-authority-public.pem'));
  const source = terminal.sources();
  const draft = JSON.parse(
    read(
      kind === '--expected'
        ? 'terminal-expected-review-draft.json'
        : 'terminal-install-approval-draft.json',
    ),
  );
  if (
    draft.purpose !==
      (kind === '--expected'
        ? 'REVIEWED_TERMINAL_EXPECTED_PROFILE'
        : 'INSTALL_LOCAL_TERMINAL_BLOCKED') ||
    draft.evidenceOrigin !== 'LOCAL' ||
    draft.githubActions !== false ||
    draft.candidateInventorySha256 !== source.inventorySha256
  )
    throw Error('Review draft scope/source rejected');
  const signed = terminal.signed(
    { ...draft, authorityKeySha256: pin.digest },
    read('terminal-authority-private.pem'),
    pin,
  );
  const output = path.join(
    directory,
    kind === '--expected' ? 'terminal-reviewed-expected.json' : 'terminal-install-approval.json',
  );
  if (kind === '--expected') {
    const temp = fs.mkdtempSync(path.join(directory, 'terminal-review-'));
    fs.chmodSync(temp, 0o700);
    try {
      const file = path.join(temp, 'expected.json');
      fs.writeFileSync(file, JSON.stringify(signed), { mode: 0o600 });
      const expected = terminal.trustedExpected(file, pin, source);
      terminal.matchAfter(expected.payload.after, expected.payload.after, temp);
    } finally {
      fs.rmSync(temp, { recursive: true, force: true });
    }
  } else {
    const expected = terminal.trustedExpected(
      path.join(directory, 'terminal-reviewed-expected.json'),
      pin,
      source,
    );
    terminal.validateApproval(signed.payload, pin, expected, draft.target, source);
  }
  const fd = fs.openSync(
    output,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.writeFileSync(fd, JSON.stringify(signed, null, 2) + '\n');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  console.log(
    JSON.stringify({
      status: 'LOCAL_REVIEW_ARTIFACT_SIGNED',
      purpose: draft.purpose,
      runtimeAccepted: false,
      artifactSha256: terminal.sha(fs.readFileSync(output)),
    }),
  );
})().catch(() => {
  console.error(
    'Offline review signing rejected. Verify private reviewed draft and independent authority pin.',
  );
  process.exitCode = 1;
});
