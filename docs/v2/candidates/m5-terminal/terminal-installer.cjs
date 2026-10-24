#!/usr/bin/env node
// Explicit operator CLI; reads only fixed private files. No role/cluster overrides.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { Client } = require('pg');
const terminal = require('./terminal-installation.cjs');
const { adoptTechnicalBroker } = require('../m5-terminal-preparation/technical-broker.cjs');
const readline = require('node:readline');
const directory = path.join(os.homedir(), '.local/share/zhiban-m1');
function privateJson(name) {
  const file = path.join(directory, name);
  for (const p of [directory, file]) {
    const s = fs.lstatSync(p);
    if (s.isSymbolicLink() || s.uid !== process.getuid() || s.mode & 0o077)
      throw Error('Private installer configuration rejected');
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
(async () => {
  const mode = process.argv[2];
  if (
    process.argv.length !== 3 ||
    !['--install-blocked', '--install-blocked-hold', '--inspect-blocked'].includes(mode)
  )
    throw Error('Explicit blocked install/hold/inspect mode required; no target overrides');
  const config = privateJson('terminal-installer-config.json');
  if (
    JSON.stringify(Object.keys(config).sort()) !==
    JSON.stringify(['admin', 'business', 'native'].sort())
  )
    throw Error('Closed installer configuration required');
  const clients = [];
  const ctx = {
    trustPinPath: path.join(directory, 'terminal-authority-public.pem'),
    expectedPath: path.join(directory, 'terminal-reviewed-expected.json'),
    issuerKeyPath: path.join(directory, 'terminal-authority-private.pem'),
    approvalPath: path.join(directory, 'terminal-install-approval.json'),
    receiptPath: path.join(directory, 'terminal-installation-receipt.json'),
    journalPath: path.join(directory, 'terminal-install-journal.jsonl'),
  };
  // Verify expected purpose/source pin before attempting any connection.
  terminal.trustedExpected(ctx.expectedPath, terminal.publicPin(ctx.trustPinPath));
  try {
    for (const [name, db] of [
      ['admin', 'postgres'],
      ['business', 'zhiban_m1_dev'],
      ['native', 'zhiban_m5_native'],
    ]) {
      const url = new URL(config[name]);
      if (
        url.protocol !== 'postgresql:' ||
        url.hostname !== '127.0.0.1' ||
        url.port !== '55433' ||
        url.pathname !== '/' + db ||
        url.username !== 'postgres' ||
        url.search ||
        url.hash
      )
        throw Error('Fixed LOCAL PG16 installer endpoint required');
      const c = new Client({
        connectionString: config[name],
        connectionTimeoutMillis: 3000,
        query_timeout: 5000,
        statement_timeout: 5000,
        lock_timeout: 1000,
        idle_in_transaction_session_timeout: 10000,
      });
      await c.connect();
      clients.push(c);
      ctx[name] = c;
    }
    const target = await terminal.targetFacts(ctx.admin, ctx.business, ctx.native);
    if (target.dataDirectory !== path.join(directory, 'pgdata'))
      throw Error('Owned local cluster directory rejected');
    // Installer preopens its exact two target clients, verifies signed maintenance
    // scope and drained/NOLOGIN facts, then only CLOSES admissions. Inspect requires
    // preopened broker clients when admission is closed; this CLI never opens a DB.
    ctx.closeAdmissions = mode.startsWith('--install-blocked');
    const result = ctx.closeAdmissions
      ? await terminal.installBlocked(ctx)
      : await terminal.loadBlockedReceipt(ctx);
    console.log(
      JSON.stringify({
        status: result.payload?.status ?? result.status,
        runtimeAccepted: false,
        terminalActionsAllowed: false,
        evidenceOrigin: 'LOCAL',
      }),
    );
    if (mode === '--install-blocked-hold') {
      // Same-process handoff: no target reconnect after closing admissions.
      // No signing or installation API is exposed through this broker.
      const broker = await adoptTechnicalBroker({
        admin: ctx.admin,
        business: ctx.business,
        native: ctx.native,
        trustPinPath: ctx.trustPinPath,
        expectedPath: ctx.expectedPath,
        receiptPath: ctx.receiptPath,
      });
      const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
      const stop = () => lines.close();
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop);
      try {
        console.log(JSON.stringify(broker.status()));
        // Closed command vocabulary; no SQL, secrets, paths, approvals or retries.
        for await (const line of lines) {
          if (line === 'close') break;
          if (line === 'inspect') console.log(JSON.stringify(await broker.inspect()));
          else if (line === 'status') console.log(JSON.stringify(broker.status()));
          else throw Error('Closed broker command required');
        }
      } finally {
        lines.close();
        for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(signal, stop);
        await broker.close(); // Never changes database admissions.
      }
    }
  } finally {
    for (const c of clients) await c.end().catch(() => {});
  }
})().catch(() => {
  console.error(
    'Terminal operation rejected/blocked. Keep isolation; inspect private configuration/journal.',
  );
  process.exitCode = 1;
});
