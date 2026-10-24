#!/usr/bin/env node
// Fixed owned LOCAL endpoint, explicit modes, no DSN/SQL/path overrides.
const os = require('node:os'),
  path = require('node:path'),
  readline = require('node:readline');
const terminal = require('./terminal-installation.cjs');
const executor = require('./maintenance-executor.cjs');
const io = require('./maintenance-hba.cjs');
(async () => {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !['--normal', '--takeover', '--closed-ack'].includes(mode))
    throw Error('Explicit maintenance mode required');
  const directory = path.join(os.homedir(), '.local/share/zhiban-m1');
  const file = (name) => path.join(directory, name);
  const config = JSON.parse(terminal.readPrivate(file('terminal-maintenance-config.json')));
  terminal.keys(config, ['adminPassword']);
  if (typeof config.adminPassword !== 'string' || !config.adminPassword)
    throw Error('Private administrator credential required');
  const ctx = {
    directory,
    adminPassword: config.adminPassword,
    trustPinPath: file('terminal-authority-public.pem'),
    expectedPath: file('terminal-reviewed-expected.json'),
    approvalPath: file('terminal-maintenance-approval.json'),
    oldCredentialsPath: file('terminal-maintenance-old-credentials.json'),
  };
  const approved = executor.approval(ctx, terminal.sources());
  if (
    approved.mode !== mode.slice(2) ||
    approved.target.dataDirectory !== file('pgdata') ||
    approved.target.socket !== file('socket') ||
    approved.target.port !== '55433'
  )
    throw Error('Fixed local target required');
  const operation =
    approved.mode === 'closed-ack' ? `closed-ack-${approved.ackRequestId}` : approved.windowId;
  ctx.resumeJournalPath = file(`terminal-maintenance-${approved.windowId}.jsonl`);
  ctx.journalPath = file(`terminal-maintenance-${operation}.jsonl`);
  ctx.credentialsPath = file(`terminal-maintenance-${operation}-credentials.json`);
  let session, admin, lines;
  const stop = () => lines?.close();
  try {
    admin = await io.connect(
      { host: file('socket'), port: 55433 },
      'postgres',
      'postgres',
      config.adminPassword,
    );
    ctx.admin = admin;
    session = await executor.start(ctx);
    if (approved.mode === 'closed-ack') {
      console.log(JSON.stringify(session));
      session = null;
      return;
    }
    lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop);
    console.log(JSON.stringify(session.status()));
    // Normal restoration is a deliberate operator command under this signed scope.
    for await (const line of lines) {
      if (line === 'status') console.log(JSON.stringify(session.status()));
      else if (line === 'renew') await session.renew();
      else if (line === 'resume') {
        console.log(JSON.stringify(await session.resume()));
        break;
      } else if (line === 'block') break;
      else throw Error('Closed maintenance command required');
    }
  } finally {
    lines?.close();
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(signal, stop);
    if (session) await session.block();
    if (admin) await admin.end().catch(() => {});
  }
})().catch(() => {
  console.error(
    'LOCAL maintenance rejected/BLOCKED. Preserve flag and private journal; no automatic reopen or replay.',
  );
  process.exitCode = 1;
});
