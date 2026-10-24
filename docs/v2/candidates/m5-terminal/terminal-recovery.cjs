// LOCAL recovery wiring, observation only. No connect/open/replay/DDL/finalize API.
const fs = require('node:fs');
const path = require('node:path');
const terminal = require('./terminal-installation.cjs');

function boundJournal(file, target, source) {
  const raw = terminal.readPrivate(file);
  const events = raw.toString('utf8').trim().split('\n').map(JSON.parse);
  const first = events[0];
  if (
    !first ||
    first.stage !== 'preflight' ||
    first.status !== 'CONFIRMED' ||
    first.candidateInventorySha256 !== source.inventorySha256 ||
    terminal.canonical(first.target) !== terminal.canonical(target)
  )
    throw Error('Recovery journal target/source rejected');
  return {
    fileSha256: terminal.sha(raw),
    events,
    originalConnectChange: first.connectChange,
  };
}
async function inspectPartialInstallationImpl(ctx) {
  const source = terminal.sources();
  const target = await terminal.targetFacts(ctx.admin, ctx.business, ctx.native);
  const identity = await terminal.assertClosedBarrier(ctx.admin, ctx.business, ctx.native, target);
  const log = boundJournal(ctx.installJournalPath, target, source);
  const ledger = (
    await ctx.business.query(
      'SELECT version,checksum FROM zhiban_content.schema_migrations ORDER BY version',
    )
  ).rows;
  if (
    ledger.length < 1 ||
    ledger.length > 2 ||
    ledger[0].version !== '0001' ||
    ledger[0].checksum !== 'e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324' ||
    (ledger.length === 2 &&
      (ledger[1].version !== '0002' || ledger[1].checksum !== source.migrationSha256))
  )
    throw Error('Observed ledger/source mismatch');
  const catalog = await terminal.collectComplete(ctx.business, ctx.native, true);
  const installed = ledger.length === 2;
  let observedStatus = installed
    ? 'BUSINESS_LEDGER_PRESENT_NATIVE_UNVERIFIED'
    : 'BUSINESS_LEDGER_NOT_OBSERVED';
  if (installed) {
    const authority = (
      await ctx.business.query(
        'SELECT (SELECT count(*) FROM zhiban_reconcile.installations WHERE ready) ready,(SELECT count(*) FROM zhiban_reconcile.services) services,(SELECT count(*) FROM zhiban_reconcile.controller_authorizations) controllers,(SELECT count(*) FROM zhiban_reconcile.grants) grants',
      )
    ).rows[0];
    if (Object.values(authority).some((v) => String(v) !== '0'))
      throw Error('Technical recovery must not hold service authority');
    const expected = terminal.trustedExpected(
      ctx.expectedPath,
      terminal.publicPin(ctx.trustPinPath),
      source,
    );
    const after = await terminal.collectAfter(ctx.business, ctx.native);
    try {
      terminal.matchAfter(expected.payload.after, after, path.dirname(ctx.expectedPath));
      observedStatus = 'BOTH_CATALOGS_MATCH_BLOCKED';
    } catch {
      observedStatus = 'BUSINESS_LEDGER_PRESENT_CATALOG_INCOMPLETE_OR_DRIFTED';
    }
  }
  if (
    terminal.sources().inventorySha256 !== source.inventorySha256 ||
    terminal.canonical(await terminal.targetFacts(ctx.admin, ctx.business, ctx.native)) !==
      terminal.canonical(target) ||
    (await terminal.assertClosedBarrier(ctx.admin, ctx.business, ctx.native, target)) !==
      identity ||
    terminal.sha(terminal.readPrivate(ctx.installJournalPath)) !== log.fileSha256
  )
    throw Error('Recovery observation changed');
  return {
    status: 'RECOVERY_OBSERVATION_ONLY',
    observedStatus,
    target,
    candidateInventorySha256: source.inventorySha256,
    installationJournalSha256: log.fileSha256,
    observedCatalogSha256: terminal.sha(terminal.canonical(catalog)),
    originalConnectChange: log.originalConnectChange,
    lastRecordedStage: log.events.at(-1)?.stage,
    lastRecordedStatus: log.events.at(-1)?.status,
    replayAllowed: false,
    requiresFreshApproval: true,
    runtimeAccepted: false,
    terminalActionsAllowed: false,
    evidenceOrigin: 'LOCAL',
    githubActions: false,
  };
}
async function readTakeoverAckImpl(ctx) {
  const source = terminal.sources();
  const r = ctx.request;
  terminal.keys(r, ['deploymentId', 'oldWindowId', 'newWindowId', 'takeoverRequestId']);
  const v7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (
    !Object.values(r).every((v) => typeof v === 'string' && v7.test(v)) ||
    r.oldWindowId === r.newWindowId
  )
    throw Error('Exact recovery lookup scope rejected');
  // Dedicated restricted controller connection; no administrator fallback.
  const c = ctx.controller;
  const identity = (
    await c.query(
      "SELECT session_user role,current_user effective,current_database() db,current_setting('server_version_num')::int pg,pg_backend_pid() pid,backend_start::text start FROM pg_stat_activity WHERE pid=pg_backend_pid()",
    )
  ).rows[0];
  if (
    identity?.role !== 'zhiban_reconcile_controller' ||
    identity.effective !== identity.role ||
    identity.db !== 'zhiban_m1_dev' ||
    identity.pg < 160000 ||
    identity.pg > 169999
  )
    throw Error('Restricted recovery controller required');
  const log = terminal.journal(ctx.ackJournalPath);
  try {
    log.append({
      stage: 'takeover-ack',
      status: 'INTENT',
      request: r,
      candidateInventorySha256: source.inventorySha256,
      identity,
    });
    await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await c.query(
      "SET LOCAL statement_timeout='5000ms'; SET LOCAL lock_timeout='1000ms'; SET LOCAL idle_in_transaction_session_timeout='10000ms'",
    );
    const ack = (
      await c.query('SELECT zhiban_reconcile.read_takeover_result($1,$2,$3,$4,$5) value', [
        r.deploymentId,
        r.oldWindowId,
        r.newWindowId,
        r.takeoverRequestId,
        ctx.controllerSecret,
      ])
    ).rows[0]?.value;
    await c.query('COMMIT');
    if (
      !ack ||
      !['COMMITTED', 'NOT_OBSERVED'].includes(ack.status) ||
      ack.replayAllowed !== false ||
      terminal.sources().inventorySha256 !== source.inventorySha256
    )
      throw Error('Recovery acknowledgement rejected');
    log.append({ stage: 'takeover-ack', status: 'CONFIRMED', request: r, result: ack });
    return {
      status: 'RECOVERY_ACK_OBSERVED',
      ack,
      replayAllowed: false,
      terminalActionsAllowed: false,
      evidenceOrigin: 'LOCAL',
      githubActions: false,
    };
  } catch {
    await c.query('ROLLBACK').catch(() => {});
    log.append({
      stage: 'takeover-ack',
      status: 'BLOCKED',
      request: r,
      reason: 'ACK_UNKNOWN_OR_UNAUTHORIZED',
      replayAllowed: false,
    });
    throw Error('Recovery ACK blocked; never replay takeover or finalize');
  } finally {
    log.close();
  }
}
const busyClients = new WeakSet(),
  blockedClients = new WeakSet();
async function bounded(ctx, names, work) {
  const clients = names.map((n) => ctx[n]);
  if (clients.some((c) => !c?.processID || busyClients.has(c) || blockedClients.has(c)))
    throw Error('Recovery physical client unavailable');
  clients.forEach((c) => busyClients.add(c));
  let timer,
    live = true;
  const expire = () => {
    live = false;
    clients.forEach((c) => {
      blockedClients.add(c);
      void c.end().catch(() => {});
    });
  };
  const guarded = {
    ...ctx,
    ...Object.fromEntries(
      names.map((n) => [
        n,
        {
          processID: ctx[n].processID,
          query: async (sql, args) => {
            if (!live) throw Error('Recovery expired');
            const result = await ctx[n].query(sql, args);
            if (!live) throw Error('Recovery expired');
            return result;
          },
        },
      ]),
    ),
  };
  try {
    return await Promise.race([
      (async () => {
        for (const n of names)
          await guarded[n].query(
            "SET statement_timeout='5000ms'; SET lock_timeout='1000ms'; SET idle_in_transaction_session_timeout='10000ms'",
          );
        return work(guarded);
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          expire();
          reject(Error('Recovery deadline'));
        }, 30000);
      }),
    ]);
  } catch (e) {
    expire();
    throw e;
  } finally {
    clearTimeout(timer);
    clients.forEach((c) => busyClients.delete(c));
  }
}
const inspectPartialInstallation = (ctx) =>
  bounded(ctx, ['admin', 'business', 'native'], inspectPartialInstallationImpl);
const readTakeoverAck = (ctx) => bounded(ctx, ['controller'], readTakeoverAckImpl);
module.exports = { inspectPartialInstallation, readTakeoverAck };
