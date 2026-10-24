// Candidate LOCAL control executor. No grant/proof/finalize or host start API.
const fs = require('node:fs');
const path = require('node:path');
const terminal = require('./terminal-installation.cjs');
const lock = require('./maintenance-lock.cjs');
const io = require('./maintenance-hba.cjs');
const { BUSINESS: B, NATIVE: N, WRITERS, MAINTENANCE } = io;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-7[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const same = (a, b) => terminal.canonical(a) === terminal.canonical(b);
function approval(ctx, source) {
  const p = terminal.verifyEnvelope(
    JSON.parse(terminal.readPrivate(ctx.approvalPath)),
    terminal.publicPin(ctx.trustPinPath),
    'LOCAL_MAINTENANCE_CONTROL',
  );
  terminal.keys(p, [
    'purpose',
    'formatVersion',
    'evidenceOrigin',
    'githubActions',
    'authorityKeySha256',
    'candidateInventorySha256',
    'approvalRef',
    'issuedAt',
    'expiresAt',
    'mode',
    'deploymentId',
    'serviceRef',
    'windowId',
    'oldWindowId',
    'takeoverRequestId',
    'target',
    'installation',
    'restoreLoginRoles',
    'oldCredentialsSha256',
    'expectedArtifactSha256',
    ...(p.mode === 'closed-ack'
      ? ['ackRequestId', 'expectedWindowEpoch', 'resumeJournalSha256']
      : []),
  ]);
  if (
    !['normal', 'takeover', 'closed-ack'].includes(p.mode) ||
    !uuid.test(p.deploymentId) ||
    !uuid.test(p.windowId) ||
    (p.mode === 'takeover'
      ? !uuid.test(p.oldWindowId) || !uuid.test(p.takeoverRequestId) || p.oldWindowId === p.windowId
      : p.oldWindowId !== null || p.takeoverRequestId !== null) ||
    p.candidateInventorySha256 !== source.inventorySha256 ||
    typeof p.approvalRef !== 'string' ||
    !p.approvalRef.trim() ||
    !Number.isSafeInteger(p.issuedAt) ||
    !Number.isSafeInteger(p.expiresAt) ||
    p.issuedAt > Date.now() ||
    p.expiresAt <= Date.now() ||
    p.expiresAt - p.issuedAt > 300000 ||
    !Array.isArray(p.restoreLoginRoles) ||
    p.restoreLoginRoles.some((r) => !WRITERS.includes(r)) ||
    new Set(p.restoreLoginRoles).size !== p.restoreLoginRoles.length
  )
    throw Error('Exact maintenance approval rejected');
  if (
    p.mode === 'closed-ack' &&
    (!uuid.test(p.ackRequestId) ||
      typeof p.expectedWindowEpoch !== 'string' ||
      !/^[1-9][0-9]{0,18}$/.test(p.expectedWindowEpoch) ||
      BigInt(p.expectedWindowEpoch) > 9223372036854775807n ||
      !/^[a-f0-9]{64}$/.test(p.resumeJournalSha256) ||
      p.restoreLoginRoles.length)
  )
    throw Error('Closed ACK scope rejected');
  if (
    typeof p.serviceRef !== 'string' ||
    !p.serviceRef.length ||
    Buffer.byteLength(p.serviceRef) > 256 ||
    /[\x00-\x1f\x7f]/.test(p.serviceRef)
  )
    throw Error('Service scope rejected');
  terminal.keys(p.target, [
    'cluster',
    'postmaster',
    'dataDirectory',
    'port',
    'businessOid',
    'nativeOid',
    'hbaFile',
    'hbaSha256',
    'socket',
  ]);
  terminal.keys(p.installation, [
    'migration_digest',
    'implementation_digest',
    'receipt_digest',
    'acl_digest',
    'storage_digest',
  ]);
  if (
    Object.values(p.installation).some((x) => !/^[a-f0-9]{64}$/.test(x)) ||
    p.installation.migration_digest !== source.migrationSha256
  )
    throw Error('Installation bindings rejected');
  return p;
}
async function facts(admin) {
  return (
    await admin.query(`SELECT (SELECT system_identifier::text FROM pg_control_system()) cluster,
    pg_postmaster_start_time()::text postmaster,current_setting('data_directory') "dataDirectory",
    current_setting('port') port,(SELECT oid::text FROM pg_database WHERE datname='${B}') "businessOid",
    (SELECT oid::text FROM pg_database WHERE datname='${N}') "nativeOid",current_setting('hba_file') "hbaFile",
    current_setting('unix_socket_directories') socket FROM pg_stat_activity WHERE pid=pg_backend_pid()
    AND datname='postgres' AND usename='postgres' AND current_user=session_user
    AND current_setting('server_version_num')::int BETWEEN 160000 AND 169999`)
  ).rows[0];
}
async function start(ctx) {
  const source = terminal.sources(),
    p = approval(ctx, source);
  const reviewed = terminal.trustedExpected(
    ctx.expectedPath,
    terminal.publicPin(ctx.trustPinPath),
    source,
  );
  if (reviewed.digest !== p.expectedArtifactSha256)
    throw Error('Reviewed expected artifact rejected');
  const expected = { ...p.target };
  delete expected.hbaSha256;
  if (!same(await facts(ctx.admin), expected)) throw Error('Exact owned PG16 target rejected');
  for (const dir of [ctx.directory, p.target.dataDirectory, p.target.socket])
    lock.privateDirectory(dir);
  if (
    ctx.directory !== path.dirname(p.target.dataDirectory) ||
    path.dirname(p.target.hbaFile) !== p.target.dataDirectory ||
    terminal.sha(terminal.readPrivate(p.target.hbaFile)) !== p.target.hbaSha256
  )
    throw Error('Owned HBA binding rejected');
  const logging = (
    await ctx.admin.query(
      "SELECT name,setting FROM pg_settings WHERE name IN('log_statement','log_min_duration_statement','log_min_duration_sample','log_parameter_max_length','log_parameter_max_length_on_error')",
    )
  ).rows;
  const expectedLogging = {
    log_statement: 'none',
    log_min_duration_statement: '-1',
    log_min_duration_sample: '-1',
    log_parameter_max_length: '0',
    log_parameter_max_length_on_error: '0',
  };
  if (logging.length !== 5 || logging.some((r) => expectedLogging[r.name] !== r.setting))
    throw Error('Secret-safe PG logging profile required');
  await ctx.admin.query(
    "SET log_min_error_statement='panic'; SET statement_timeout='5000ms'; SET lock_timeout='1000ms'; SET idle_in_transaction_session_timeout='10000ms'",
  );
  const overrides = (
    await ctx.admin.query('SELECT unnest(setconfig) value FROM pg_db_role_setting')
  ).rows;
  if (
    overrides.some((r) =>
      /^log_(statement|duration|min_duration_statement|min_duration_sample|parameter_max_length|parameter_max_length_on_error)=/.test(
        r.value,
      ),
    )
  )
    throw Error('Logging overrides require separate review');
  const oldRaw = terminal.readPrivate(ctx.oldCredentialsPath);
  if (terminal.sha(oldRaw) !== p.oldCredentialsSha256)
    throw Error('Old credential inventory rejected');
  const old = JSON.parse(oldRaw);
  terminal.keys(old, [...WRITERS, ...MAINTENANCE]);
  if (Object.values(old).some((v) => typeof v !== 'string' || !v.length))
    throw Error('Old credentials required for rejection probes');
  if (p.mode === 'closed-ack') {
    const raw = terminal.readPrivate(ctx.resumeJournalPath),
      events = raw.toString('utf8').trim().split('\n').map(JSON.parse),
      first = events[0];
    if (
      terminal.sha(raw) !== p.resumeJournalSha256 ||
      first?.stage !== 'preflight' ||
      first.status !== 'CONFIRMED' ||
      first.request?.windowId !== p.windowId ||
      first.request?.deploymentId !== p.deploymentId ||
      first.target?.cluster !== p.target.cluster ||
      first.target?.businessOid !== p.target.businessOid ||
      first.target?.nativeOid !== p.target.nativeOid ||
      !events.some((e) => e.stage === 'complete-resume-commit' && e.status === 'INTENT')
    )
      throw Error('Exact resume journal rejected');
  }
  const held = lock.acquire(ctx.directory, 'maintenance', p.mode !== 'normal');
  let log,
    state = 'PREPARING',
    busy = false,
    timer,
    deadline = 0,
    live = true,
    hbaHash = p.target.hbaSha256;
  const clients = new Set(),
    sessions = {},
    endpoint = { host: p.target.socket, port: Number(p.target.port) };
  let passwords, identity, credentialDigest, ackResult;
  const controllerSecret = io.secret(),
    nonce = io.secret();
  const guard = () => {
    held.assert();
    if (
      !live ||
      Date.now() > p.expiresAt ||
      (deadline && Date.now() > deadline) ||
      terminal.sources().inventorySha256 !== source.inventorySha256 ||
      terminal.sha(terminal.readPrivate(p.target.hbaFile)) !== hbaHash ||
      (credentialDigest &&
        terminal.sha(terminal.readPrivate(ctx.credentialsPath)) !== credentialDigest)
    )
      throw Error('Maintenance deadline/source/lock/HBA lost');
  };
  const q = async (c, sql, args) => {
    guard();
    const r = await c.query(sql, args);
    guard();
    return r;
  };
  const stage = async (name, work) => {
    guard();
    log.append({ stage: name, status: 'INTENT' });
    const r = await work();
    guard();
    log.append({ stage: name, status: 'CONFIRMED' });
    return r;
  };
  const admission = async (db, open) => {
    await stage(`admission:${db}:${open}`, async () => {
      await q(ctx.admin, `ALTER DATABASE ${db} ALLOW_CONNECTIONS ${open}`);
      if (
        (await q(ctx.admin, 'SELECT datallowconn FROM pg_database WHERE datname=$1', [db])).rows[0]
          ?.datallowconn !== open
      )
        throw Error('Admission unconfirmed');
    });
  };
  const writeHba = async (text) => {
    await stage('hba-reload', async () => {
      // Update expected bytes only after our atomic write; source file remains guarded elsewhere.
      await io.replaceHba(ctx.admin, p.target.hbaFile, text);
      hbaHash = terminal.sha(text);
      log.append({ stage: 'hba-bytes', status: 'CONFIRMED', sha256: hbaHash });
    });
  };
  const backendRows = async () =>
    (
      await q(
        ctx.admin,
        `SELECT pid,backend_start::text start,usename role,datid::text "databaseOid",backend_type type FROM pg_stat_activity WHERE datname IN('${B}','${N}') ORDER BY datid,pid`,
      )
    ).rows;
  const drain = async (keep) => {
    await stage('drain', async () => {
      const ends = Date.now() + 5000;
      while (true) {
        const rows = (await backendRows()).filter((r) => !keep.includes(r.pid));
        if (!rows.length) break;
        if (Date.now() >= ends || rows.some((r) => r.type !== 'client backend'))
          throw Error('Backend drain failed');
        for (const r of rows)
          await q(
            ctx.admin,
            'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid=$1 AND backend_start=$2::timestamptz AND datid=$3::oid',
            [r.pid, r.start, r.databaseOid],
          );
        await new Promise((r) => setTimeout(r, 30));
      }
    });
  };
  const newClient = async (role, database = io.dbFor(role), password = passwords[role]) => {
    guard();
    const c = await io.connect(endpoint, database, role, password);
    clients.add(c);
    c.on('error', () => {
      void block().catch(() => {});
    });
    c.on('end', () => {
      if (clients.has(c)) void block().catch(() => {});
    });
    guard();
    return c;
  };
  const end = async (c) => {
    clients.delete(c);
    await c.end();
  };
  const tx = async (sql, args) => {
    const c = sessions.controller;
    await q(c, 'BEGIN ISOLATION LEVEL READ COMMITTED');
    try {
      const r = await q(c, sql, args);
      await q(c, 'SET CONSTRAINTS ALL IMMEDIATE');
      await q(c, 'COMMIT');
      return r.rows[0];
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    }
  };
  const profile = async (loginRoles) => {
    const wanted = structuredClone(reviewed.payload.after);
    for (const part of [...Object.values(wanted.complete), wanted.terminal.business])
      for (const role of part.roles) {
        if ([...WRITERS, ...MAINTENANCE].includes(role.name))
          role.login = loginRoles.includes(role.name);
      }
    const actual = await terminal.collectAfter(
      { query: (sql, args) => q(sessions.controller, sql, args) },
      { query: (sql, args) => q(sessions.zhiban_reconcile_native_proof, sql, args) },
      true,
    );
    if (!same(actual, wanted)) throw Error('Full reviewed catalog/ACL drift');
  };
  const barrier = async () => {
    guard();
    if (!same(await facts(ctx.admin), expected)) throw Error('Postmaster/cluster changed');
    const rows = await backendRows();
    if (rows.length !== 4 || !same(rows, identity)) throw Error('Physical allowlist changed');
    const dbs = (
      await q(ctx.admin, `SELECT datallowconn FROM pg_database WHERE datname IN('${B}','${N}')`)
    ).rows;
    const unsafe = (
      await q(
        ctx.admin,
        `SELECT (SELECT count(*) FROM pg_roles WHERE rolcanlogin AND rolname=ANY($1::text[])) writers,
      (SELECT count(*) FROM pg_subscription WHERE subenabled) subscriptions,(SELECT count(*) FROM pg_prepared_xacts) prepared,
      current_setting('max_prepared_transactions') max_prepared`,
        [WRITERS],
      )
    ).rows[0];
    if (
      dbs.length !== 2 ||
      dbs.some((x) => x.datallowconn) ||
      Object.values(unsafe).some((x) => String(x) !== '0')
    )
      throw Error('Actual maintenance barrier rejected');
  };
  let blocking;
  const block = () => {
    if (state === 'CLOSED') return Promise.resolve();
    if (blocking) return blocking;
    blocking = (async () => {
      state = 'BLOCKED';
      live = false;
      clearInterval(timer);
      // No reopening/credential restoration on failure. Best effort CLOSURE only.
      for (const db of [B, N])
        await ctx.admin.query(`ALTER DATABASE ${db} ALLOW_CONNECTIONS false`).catch(() => {});
      await ctx.admin
        .query([...WRITERS, ...MAINTENANCE].map((r) => `ALTER ROLE ${r} NOLOGIN`).join(';'))
        .catch(() => {});
      const observed = await ctx.admin
        .query(
          `SELECT datname,datallowconn FROM pg_database WHERE datname IN('${B}','${N}') ORDER BY datname`,
        )
        .then((r) => r.rows)
        .catch(() => 'UNKNOWN');
      try {
        log?.append({
          stage: 'executor',
          status: 'BLOCKED',
          admissions: observed,
          replayAllowed: false,
        });
      } catch {}
      for (const c of [...clients]) await end(c).catch(() => {});
      try {
        log?.close();
      } finally {
        held.release();
      }
    })();
    return blocking;
  };
  const bounded = async (work) => {
    if (busy || !live) throw Error('Maintenance busy/blocked');
    busy = true;
    deadline = Date.now() + 30000;
    let timeout;
    try {
      return await Promise.race([
        work(),
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            live = false;
            reject(Error('Maintenance deadline'));
          }, 30000);
        }),
      ]);
    } catch {
      await block();
      throw Error(
        'Maintenance BLOCKED; preserve flag and use fresh authorized takeover, never replay',
      );
    } finally {
      clearTimeout(timeout);
      busy = false;
      deadline = 0;
    }
  };
  try {
    log = terminal.journal(ctx.journalPath);
    await bounded(async () => {
      const roles = (
        await q(
          ctx.admin,
          'SELECT rolname,rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls FROM pg_roles ORDER BY rolname',
        )
      ).rows;
      if (
        roles.some(
          (r) => r.rolcanlogin && !['postgres', ...WRITERS, ...MAINTENANCE].includes(r.rolname),
        ) ||
        roles.filter((r) => [...WRITERS, ...MAINTENANCE].includes(r.rolname)).length !== 12 ||
        roles.some(
          (r) =>
            [...WRITERS, ...MAINTENANCE].includes(r.rolname) &&
            [r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls].some(
              Boolean,
            ),
        )
      )
        throw Error('Closed role inventory rejected');
      const databases = (
        await q(
          ctx.admin,
          `SELECT datname,datallowconn,datacl::text FROM pg_database WHERE datname IN('${B}','${N}') ORDER BY datname`,
        )
      ).rows;
      if (p.mode === 'normal' && databases.some((d) => !d.datallowconn))
        throw Error('Closed database requires takeover');
      log.append({
        stage: 'preflight',
        status: 'CONFIRMED',
        target: p.target,
        request: {
          mode: p.mode,
          deploymentId: p.deploymentId,
          windowId: p.windowId,
          oldWindowId: p.oldWindowId,
          takeoverRequestId: p.takeoverRequestId,
        },
        candidateInventorySha256: source.inventorySha256,
        approvalSha256: terminal.sha(terminal.readPrivate(ctx.approvalPath)),
        roles,
        databases,
      });
      lock.writeExclusive(
        ctx.journalPath + '.original-hba',
        terminal.readPrivate(p.target.hbaFile),
      );
      await admission(B, false);
      await admission(N, false);
      passwords = io.prepareCredentials([...WRITERS, ...MAINTENANCE]);
      // Persist ALL intended credentials before the first ALTER; partial application
      // is tracked separately and is never presented as a completed handoff.
      lock.writeExclusive(
        ctx.credentialsPath,
        JSON.stringify({
          status: 'PREPARED_UNDELIVERED',
          evidenceOrigin: 'LOCAL',
          windowId: p.windowId,
          target: p.target,
          candidateInventorySha256: source.inventorySha256,
          passwords,
        }) + '\n',
      );
      credentialDigest = terminal.sha(terminal.readPrivate(ctx.credentialsPath));
      log.append({
        stage: 'credentials-prepared',
        status: 'CONFIRMED',
        sha256: credentialDigest,
        deliveryReady: false,
      });
      for (const role of [...WRITERS, ...MAINTENANCE])
        await stage('rotate:' + role, () =>
          io.rotate({ query: (sql, args) => q(ctx.admin, sql, args) }, [role], {
            [role]: passwords[role],
          }),
        );
      await drain([]);
      await writeHba(io.hba([MAINTENANCE[0]], true));
      await q(ctx.admin, `ALTER ROLE ${MAINTENANCE[0]} LOGIN`);
      await admission(B, true);
      // pg_reload_conf acknowledgement is not proof of loaded HBA: probe all old
      // credentials and an unlisted postgres/Native channel before authority seed.
      for (const r of [...WRITERS, ...MAINTENANCE])
        await io.denied(endpoint, io.dbFor(r), r, old[r]);
      await io.denied(endpoint, N, 'postgres', ctx.adminPassword);
      const bootstrap = await newClient('postgres', B, ctx.adminPassword);
      sessions.controller = await newClient(MAINTENANCE[0]);
      const installed = (
        await q(bootstrap, 'SELECT * FROM zhiban_reconcile.installations WHERE deployment_id=$1', [
          p.deploymentId,
        ])
      ).rows[0];
      if (
        !installed?.ready ||
        installed.cluster_identifier !== p.target.cluster ||
        String(installed.business_oid) !== p.target.businessOid ||
        String(installed.native_oid) !== p.target.nativeOid ||
        Object.entries(p.installation).some(([k, v]) => installed[k] !== v)
      )
        throw Error('Reviewed ready installation required; blocked receipt grants no authority');
      const ledger = (
        await q(
          bootstrap,
          'SELECT version,checksum FROM zhiban_content.schema_migrations ORDER BY version',
        )
      ).rows;
      if (
        !same(ledger, [
          {
            version: '0001',
            checksum: 'e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324',
          },
          { version: '0002', checksum: source.migrationSha256 },
        ])
      )
        throw Error('Installation ledger mismatch');
      const wantedBusiness = {
        complete: structuredClone(reviewed.payload.after.complete.business),
        terminal: structuredClone(reviewed.payload.after.terminal.business),
      };
      for (const part of Object.values(wantedBusiness))
        for (const role of part.roles)
          if ([...WRITERS, ...MAINTENANCE].includes(role.name))
            role.login = role.name === MAINTENANCE[0];
      const actualBusiness = await terminal.collectBusinessAfter({
        query: (sql, args) => q(bootstrap, sql, args),
      });
      if (!same(actualBusiness, wantedBusiness))
        throw Error('Business profile rejected before controller authority');
      if (p.mode !== 'normal') {
        const scope = (
          await q(
            bootstrap,
            'SELECT deployment_id,service_ref FROM zhiban_reconcile.windows WHERE window_id=$1',
            [p.mode === 'takeover' ? p.oldWindowId : p.windowId],
          )
        ).rows[0];
        if (scope?.deployment_id !== p.deploymentId || scope.service_ref !== p.serviceRef)
          throw Error('Window service scope rejected');
      }
      const seeded = await stage('bind-fresh-controller', () =>
        q(
          bootstrap,
          `INSERT INTO zhiban_reconcile.controller_authorizations(deployment_id,token_digest,backend_pid,backend_start,nonce_digest,expires_at,provenance_digest,status)
        SELECT $1,$2,pid,backend_start,$3,$4,$5,'ACTIVE' FROM pg_stat_activity WHERE pid=$6 AND usename='zhiban_reconcile_controller'
        ON CONFLICT(deployment_id) DO UPDATE SET token_digest=excluded.token_digest,backend_pid=excluded.backend_pid,backend_start=excluded.backend_start,nonce_digest=excluded.nonce_digest,expires_at=excluded.expires_at,provenance_digest=excluded.provenance_digest,status='ACTIVE'`,
          [
            p.deploymentId,
            terminal.sha(controllerSecret),
            terminal.sha(nonce),
            p.expiresAt,
            terminal.sha(p.approvalRef),
            sessions.controller.processID,
          ],
        ),
      );
      if (seeded.rowCount !== 1) throw Error('Controller authorization not bound');
      await end(bootstrap);
      await writeHba(io.hba([MAINTENANCE[0]]));
      await io.denied(endpoint, B, 'postgres', ctx.adminPassword);
      await drain([sessions.controller.processID]);
      if (p.mode === 'closed-ack') {
        const result = await tx('SELECT zhiban_reconcile.read_closed_result($1,$2,$3,$4) value', [
          p.deploymentId,
          p.windowId,
          p.expectedWindowEpoch,
          controllerSecret,
        ]);
        const ack = result.value;
        if (
          !['COMMITTED_CLOSED', 'NOT_CLOSED'].includes(ack?.status) ||
          ack.replayAllowed !== false ||
          ack.restoreAllowed !== false ||
          ack.clearMaintenanceFlagAllowed !== false
        )
          throw Error('Closed ACK result rejected');
        await admission(B, false);
        if (
          !same(await facts(ctx.admin), expected) ||
          terminal.sha(terminal.readPrivate(ctx.resumeJournalPath)) !== p.resumeJournalSha256
        )
          throw Error('Closed ACK observation changed');
        log.append({
          stage: 'closed-ack',
          status: 'CONFIRMED',
          requestId: p.ackRequestId,
          resumeJournalSha256: p.resumeJournalSha256,
          result: ack,
        });
        ackResult = {
          status: 'CLOSED_ACK_OBSERVED',
          ack,
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          replayAllowed: false,
          restoreAllowed: false,
          maintenanceFlagRetained: true,
          terminalActionsAllowed: false,
          runtimeAccepted: false,
        };
        return;
      }
      if (p.mode === 'takeover') {
        const ack = await tx('SELECT zhiban_reconcile.read_takeover_result($1,$2,$3,$4,$5) value', [
          p.deploymentId,
          p.oldWindowId,
          p.windowId,
          p.takeoverRequestId,
          controllerSecret,
        ]);
        log.append({ stage: 'takeover-ack-before-write', status: 'CONFIRMED', result: ack.value });
        if (ack.value.status !== 'NOT_OBSERVED')
          throw Error('Committed successor cannot be revived; fresh higher epoch required');
        await stage('takeover-commit', () =>
          tx('SELECT zhiban_reconcile.takeover_blocked_window($1,$2,$3,$4,$5)', [
            p.oldWindowId,
            p.windowId,
            p.takeoverRequestId,
            nonce,
            controllerSecret,
          ]),
        );
        const after = await tx(
          'SELECT zhiban_reconcile.read_takeover_result($1,$2,$3,$4,$5) value',
          [p.deploymentId, p.oldWindowId, p.windowId, p.takeoverRequestId, controllerSecret],
        );
        if (after.value.status !== 'COMMITTED' || !after.value.successorIsCurrent)
          throw Error('Takeover ACK rejected');
        log.append({ stage: 'takeover-ack-after-write', status: 'CONFIRMED', result: after.value });
      }
      await writeHba(io.hba(MAINTENANCE));
      for (const r of MAINTENANCE.slice(1)) await q(ctx.admin, `ALTER ROLE ${r} LOGIN`);
      await admission(N, true);
      for (const r of MAINTENANCE.slice(1)) sessions[r] = await newClient(r);
      // These probes run with both databases open and maintenance roles LOGIN:
      // fail-on-auth is independently proven, not masked by NOLOGIN/admission.
      for (const r of MAINTENANCE) await io.denied(endpoint, io.dbFor(r), r, old[r]);
      if (p.mode === 'normal')
        await stage('open-window', () =>
          tx('SELECT zhiban_reconcile.open_window($1,$2,$3,$4,$5)', [
            p.deploymentId,
            p.serviceRef,
            p.windowId,
            nonce,
            controllerSecret,
          ]),
        );
      await admission(B, false);
      await admission(N, false);
      identity = await backendRows();
      if (
        identity.length !== 4 ||
        identity.some((r) => r.type !== 'client backend') ||
        !same(identity.map((r) => r.pid).sort(), [...clients].map((c) => c.processID).sort())
      )
        throw Error('Exact maintained clients required');
      await barrier();
      await profile(MAINTENANCE);
      await barrier();
      await stage('drained', () =>
        tx('SELECT zhiban_reconcile.renew_barrier($1,$2)', [p.windowId, controllerSecret]),
      );
      state = 'DRAINED';
    });
  } catch (e) {
    await block();
    throw e;
  }
  if (p.mode === 'closed-ack') {
    await block();
    return ackResult;
  }
  const renew = () =>
    bounded(async () => {
      await barrier();
      await stage('renew-barrier', () =>
        tx('SELECT zhiban_reconcile.renew_barrier($1,$2)', [p.windowId, controllerSecret]),
      );
    });
  // A failed/late renewal blocks; no automatic reconnect or window revival.
  timer = setInterval(() => {
    if (!busy) void renew().catch(() => {});
  }, 8000);
  timer.unref();
  return {
    status: () => ({
      status: state,
      windowId: p.windowId,
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      terminalActionsAllowed: false,
      runtimeAccepted: false,
    }),
    renew,
    block,
    resume: () =>
      bounded(async () => {
        if (state !== 'DRAINED') throw Error('Resume state rejected');
        await barrier();
        await profile(MAINTENANCE);
        await barrier();
        await stage('begin-resume-commit', () =>
          tx('SELECT zhiban_reconcile.begin_resume($1,$2)', [p.windowId, controllerSecret]),
        );
        state = 'RESUMING';
        clearInterval(timer);
        for (const r of MAINTENANCE) await q(ctx.admin, `ALTER ROLE ${r} NOLOGIN PASSWORD NULL`);
        // Fixed generated SCRAM-only restore profile. Never restore PUBLIC CONNECT,
        // original trust/peer/cert rules, old passwords, or start a host here.
        await writeHba(io.hba(p.restoreLoginRoles));
        for (const r of p.restoreLoginRoles) await q(ctx.admin, `ALTER ROLE ${r} LOGIN`);
        await admission(B, true);
        await admission(N, true);
        for (const r of WRITERS) await io.denied(endpoint, io.dbFor(r), r, old[r]);
        for (const r of MAINTENANCE) await io.denied(endpoint, io.dbFor(r), r, passwords[r]);
        for (const r of p.restoreLoginRoles) {
          const probe = await newClient(r);
          await end(probe);
        }
        await profile(p.restoreLoginRoles);
        await stage('complete-resume-commit', () =>
          tx('SELECT zhiban_reconcile.complete_resume($1,$2)', [p.windowId, controllerSecret]),
        );
        // Confirm COMMIT before release. Lost ACK leaves flag present for lookup/recovery.
        state = 'CLOSED_ACKNOWLEDGED';
        log.append({
          stage: 'executor',
          status: 'CLOSED',
          credentialsFile: ctx.credentialsPath,
          credentialsSha256: credentialDigest,
          credentialDeliveryReady: false,
          maintenanceFlagRetained: true,
          terminalActionsAllowed: false,
        });
        for (const c of [...clients]) await end(c);
        // Product credential/build/receipt handoff is a separate unissued gate.
        live = false;
        log.close();
        held.release();
        state = 'CLOSED';
        return {
          status: 'CLOSED',
          hostStarted: false,
          credentialDeliveryReady: false,
          maintenanceFlagRetained: true,
          credentialsPath: ctx.credentialsPath,
          evidenceOrigin: 'LOCAL',
          runtimeAccepted: false,
        };
      }),
  };
}
module.exports = { start, facts, approval };
