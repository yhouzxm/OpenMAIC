// PREPARATION ONLY. Adopts three already-held clients; never connects or installs.
// No issuer key, arbitrary SQL endpoint, recovery, window lease or activation API.
const terminal = require('../m5-terminal/terminal-installation.cjs');
const recovery = require('../m5-terminal/terminal-recovery.cjs');
const { performance } = require('node:perf_hooks');

async function adoptTechnicalBroker(ctx, mode = 'installed') {
  if (!['installed', 'partial-recovery'].includes(mode)) throw Error('Closed broker mode required');
  const names = ['admin', 'business', 'native'];
  const clients = names.map((n) => ctx[n]);
  if (new Set(clients).size !== 3 || clients.some((c) => !c?.processID))
    throw Error('Three preheld physical clients required');
  let state = 'ADOPTING';
  let busy = false;
  let identity;
  let checkedAt = null;
  let lastReceipt = null;
  let observedInstallationStatus = null;
  let deadline = 0;
  const fail = () => {
    if (state === 'BLOCKED' || state === 'CLOSED') return;
    state = 'BLOCKED';
    lastReceipt = null;
    for (const c of clients) void c.end().catch(() => {});
  };
  for (const c of clients) {
    c.on('error', fail);
    c.on('end', () => {
      if (state !== 'CLOSED') fail();
    });
  }
  const guarded = Object.fromEntries(
    names.map((name) => [
      name,
      {
        processID: ctx[name].processID,
        end: () => ctx[name].end(),
        async query(sql, args) {
          if (state === 'BLOCKED' || state === 'CLOSED' || performance.now() >= deadline)
            throw Error('Broker session unavailable');
          const result = await ctx[name].query(sql, args);
          if (state === 'BLOCKED' || state === 'CLOSED' || performance.now() >= deadline)
            throw Error('Broker session expired');
          return result;
        },
      },
    ]),
  );
  // Deliberately strip install approval, journal and private signing key paths.
  const readContext = {
    ...guarded,
    trustPinPath: ctx.trustPinPath,
    expectedPath: ctx.expectedPath,
    receiptPath: ctx.receiptPath,
    installJournalPath: ctx.installJournalPath,
  };
  async function barrier() {
    const target = await terminal.targetFacts(guarded.admin, guarded.business, guarded.native);
    await guarded.admin.query('SELECT pg_stat_clear_snapshot()');
    const snapshot = (
      await guarded.admin.query(
        `SELECT
      pg_postmaster_start_time()::text postmaster,
      (SELECT jsonb_agg(jsonb_build_object('pid',pid,'start',backend_start::text,'role',usename,'db',datname,'kind',backend_type) ORDER BY pid)
       FROM pg_stat_activity WHERE datid=ANY($1::oid[]) OR pid=pg_backend_pid()) backends,
      (SELECT bool_and(NOT datallowconn) FROM pg_database WHERE oid=ANY($1::oid[])) closed`,
        [[target.businessDatabaseOid, target.nativeDatabaseOid]],
      )
    ).rows[0];
    if (
      !snapshot.closed ||
      snapshot.backends?.length !== 3 ||
      snapshot.backends.some(
        (b) =>
          !clients.some((c) => c.processID === b.pid) ||
          b.role !== 'postgres' ||
          b.kind !== 'client backend',
      )
    )
      throw Error('Broker barrier drift');
    const actual = terminal.canonical({
      target,
      postmaster: snapshot.postmaster,
      backends: snapshot.backends,
    });
    if (identity && identity !== actual) throw Error('Broker physical identity changed');
    return actual;
  }
  async function inspect() {
    if (busy || state === 'BLOCKED' || state === 'CLOSED')
      throw Error('Broker unavailable; no retry');
    busy = true;
    deadline = performance.now() + 30000;
    let timer;
    try {
      // A timeout closes the physical clients. Late results cannot restore authority.
      return await Promise.race([
        (async () => {
          for (const c of Object.values(guarded))
            await c.query(
              "SET statement_timeout='5000ms'; SET lock_timeout='1000ms'; SET idle_in_transaction_session_timeout='10000ms'",
            );
          const before = await barrier();
          const receipt =
            mode === 'installed'
              ? await terminal.loadBlockedReceipt(readContext)
              : await recovery.inspectPartialInstallation(readContext);
          const after = await barrier();
          if (before !== after || state === 'BLOCKED' || state === 'CLOSED')
            throw Error('Broker changed during inspection');
          identity = after;
          lastReceipt = receipt.receiptSha256 ?? null;
          observedInstallationStatus = receipt.observedStatus ?? null;
          checkedAt = new Date().toISOString();
          state =
            mode === 'installed' ? 'HELD_BLOCKED_TECHNICAL' : 'HELD_BLOCKED_RECOVERY_OBSERVATION';
          return status();
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            fail();
            reject(Error('Broker inspection deadline'));
          }, 30000);
        }),
      ]);
    } catch {
      fail();
      throw Error(
        'Broker blocked; preserve isolation and use a separately reviewed recovery procedure',
      );
    } finally {
      clearTimeout(timer);
      busy = false;
    }
  }
  function status() {
    return Object.freeze({
      state,
      mode,
      observedInstallationStatus,
      checkedAt,
      receiptSha256: lastReceipt,
      observationOnly: true,
      runtimeAccepted: false,
      terminalActionsAllowed: false,
      leaseIssued: false,
      evidenceOrigin: 'LOCAL',
      githubActions: false,
    });
  }
  try {
    await inspect();
  } catch {
    fail();
    throw Error('Broker adoption rejected');
  }
  return Object.freeze({
    inspect,
    status,
    async close() {
      state = 'CLOSED';
      lastReceipt = null;
      await Promise.allSettled(clients.map((c) => c.end()));
    },
  });
}
module.exports = { adoptTechnicalBroker };
