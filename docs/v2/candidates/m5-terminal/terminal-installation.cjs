// LOCAL technical installation only: ready remains false; no host/finalize activation.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const HERE = __dirname;
const ROOT = path.resolve(HERE, '../../../..');
const PROFILE = 'terminal-reconciliation-local-v1';
const LEGACY_SCHEMAS = [
  'zhiban_identity',
  'zhiban_bridge',
  'zhiban_academic',
  'zhiban_learning',
  'zhiban_assessment',
  'zhiban_content',
];
const ROLES = [
  'zhiban_identity_owner',
  'zhiban_migrator',
  'zhiban_runtime',
  'zhiban_auth_runtime',
  'zhiban_control_runtime',
  'zhiban_bridge_runtime',
  'zhiban_academic_runtime',
  'zhiban_openmaic_owner',
  'zhiban_openmaic_migrator',
  'zhiban_openmaic_runtime',
  'zhiban_reconcile_controller',
  'zhiban_reconcile_issuer',
  'zhiban_reconcile_executor',
  'zhiban_reconcile_native_proof',
  'zhiban_reconcile_observer',
];
const WRITERS = ROLES.filter((r) => !r.endsWith('_owner') && !r.startsWith('zhiban_reconcile_'));
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(value[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
function insist(ok, message) {
  if (!ok) throw Error(message);
}
function keys(value, list) {
  insist(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      canonical(Object.keys(value).sort()) === canonical([...list].sort()),
    'Closed signed contract rejected',
  );
}
function readPrivate(file) {
  insist(path.isAbsolute(file), 'Private absolute path required');
  for (const target of [path.dirname(file), file]) {
    const s = fs.lstatSync(target);
    insist(
      !s.isSymbolicLink() && s.uid === process.getuid() && !(s.mode & 0o077),
      'Private ownership/mode rejected',
    );
  }
  insist(
    fs.statSync(file).isFile() && fs.statSync(file).size <= 16 * 1024 * 1024,
    'Private file size/type rejected',
  );
  return fs.readFileSync(file);
}
function publicPin(file) {
  const raw = readPrivate(file);
  const key = crypto.createPublicKey(raw);
  insist(key.asymmetricKeyType === 'ed25519', 'Ed25519 trust pin required');
  return { key, digest: sha(key.export({ format: 'der', type: 'spki' })) };
}
function verifyEnvelope(envelope, pin, purpose) {
  keys(envelope, ['payload', 'signature']);
  const p = envelope.payload;
  insist(
    p?.purpose === purpose &&
      p.formatVersion === 1 &&
      p.evidenceOrigin === 'LOCAL' &&
      p.githubActions === false &&
      p.authorityKeySha256 === pin.digest,
    'Signed purpose/authority rejected',
  );
  insist(
    typeof envelope.signature === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(envelope.signature),
    'Signature encoding rejected',
  );
  insist(
    crypto.verify(
      null,
      Buffer.from(canonical(p)),
      pin.key,
      Buffer.from(envelope.signature, 'base64'),
    ),
    'Signed authority rejected',
  );
  return p;
}
function signed(payload, key, pin) {
  const privateKey = crypto.createPrivateKey(key);
  insist(privateKey.asymmetricKeyType === 'ed25519', 'Issuer key rejected');
  insist(
    sha(crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' })) === pin.digest,
    'Issuer differs from pinned authority',
  );
  return {
    payload,
    signature: crypto.sign(null, Buffer.from(canonical(payload)), privateKey).toString('base64'),
  };
}
function sources() {
  const raw = fs.readFileSync(path.join(HERE, 'inventory.json'));
  const inv = JSON.parse(raw);
  insist(
    inv.status === 'UNAPPLIED' && inv.profile === PROFILE && !inv.runtimeAccepted,
    'Candidate state rejected',
  );
  for (const [name, digest] of Object.entries(inv.filesSha256))
    insist(sha(fs.readFileSync(path.join(HERE, name))) === digest, 'Candidate source drift');
  for (const [name, digest] of Object.entries(inv.recoveryWiringSha256 || {}))
    insist(sha(fs.readFileSync(path.join(ROOT, name))) === digest, 'Recovery wiring source drift');
  for (const [name, digest] of Object.entries(inv.prerequisitesSha256))
    insist(
      sha(fs.readFileSync(path.join(ROOT, name))) === digest,
      'Applied prerequisite byte drift',
    );
  insist(
    sha(
      Buffer.concat(
        inv.migration.orderedComponents.map((n) => fs.readFileSync(path.join(HERE, n))),
      ),
    ) === inv.migration.aggregateSha256,
    'Candidate aggregate drift',
  );
  return { inv, inventorySha256: sha(raw), migrationSha256: inv.migration.aggregateSha256 };
}
function trustedExpected(file, pin, source = sources()) {
  const raw = readPrivate(file);
  const p = verifyEnvelope(JSON.parse(raw), pin, 'REVIEWED_TERMINAL_EXPECTED_PROFILE');
  keys(p, [
    'purpose',
    'formatVersion',
    'evidenceOrigin',
    'githubActions',
    'authorityKeySha256',
    'profile',
    'candidateInventorySha256',
    'candidateMigrationSha256',
    'review',
    'before',
    'after',
  ]);
  keys(p.review, ['approvalRef', 'sourceKind', 'referenceEvidenceSha256']);
  insist(
    p.profile === PROFILE &&
      p.candidateInventorySha256 === source.inventorySha256 &&
      p.candidateMigrationSha256 === source.migrationSha256,
    'Expected source binding rejected',
  );
  insist(
    p.review.sourceKind === 'INDEPENDENT_SHADOW_PG16' &&
      typeof p.review.approvalRef === 'string' &&
      p.review.approvalRef.length > 0 &&
      /^[a-f0-9]{64}$/.test(p.review.referenceEvidenceSha256),
    'Independent reviewed reference required',
  );
  keys(p.before, ['business', 'native']);
  keys(p.after, ['complete', 'terminal']);
  keys(p.after.complete, ['business', 'native']);
  keys(p.after.terminal, ['business', 'native']);
  return { payload: p, digest: sha(raw) };
}
async function collectComplete(business, native, after) {
  const sql = fs.readFileSync(path.join(HERE, '11-complete-installation-catalog.sql'), 'utf8');
  const result = {};
  for (const [part, c, schemas] of [
    [
      'business',
      business,
      [...LEGACY_SCHEMAS, ...(after ? ['zhiban_reconcile', 'zhiban_reconcile_catalog'] : [])],
    ],
    ['native', native, ['public']],
  ]) {
    await c.query('BEGIN READ ONLY');
    try {
      await c.query('SET LOCAL search_path=pg_catalog');
      result[part] = (await c.query(sql, [schemas, ROLES])).rows[0].installation_catalog;
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  }
  return result;
}
// Before controller authority seed: fixed Business metadata only, no Native admission.
async function collectBusinessAfter(c) {
  await c.query('BEGIN READ ONLY');
  try {
    await c.query('SET LOCAL search_path=pg_catalog');
    const complete = (
      await c.query(
        fs.readFileSync(path.join(HERE, '11-complete-installation-catalog.sql'), 'utf8'),
        [[...LEGACY_SCHEMAS, 'zhiban_reconcile', 'zhiban_reconcile_catalog'], ROLES],
      )
    ).rows[0].installation_catalog;
    const terminal = (
      await c.query(fs.readFileSync(path.join(HERE, '09-catalog-inspect.sql'), 'utf8'))
    ).rows[0].terminal_catalog;
    await c.query('COMMIT');
    return { complete, terminal };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  }
}
async function collectAfter(business, native) {
  const complete = await collectComplete(business, native, true);
  const terminal = {};
  for (const [part, c, name, column] of [
    ['business', business, '09-catalog-inspect.sql', 'terminal_catalog'],
    ['native', native, '10-native-catalog-inspect.sql', 'terminal_native_catalog'],
  ]) {
    await c.query('BEGIN READ ONLY');
    try {
      await c.query('SET LOCAL search_path=pg_catalog');
      terminal[part] = (await c.query(fs.readFileSync(path.join(HERE, name), 'utf8'))).rows[0][
        column
      ];
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    }
  }
  return { complete, terminal };
}
function matchAfter(expected, actual, privateDirectory) {
  // Temporary 0600 snapshots; no subprocess shell/DSNs/Native content.
  const dir = fs.mkdtempSync(path.join(privateDirectory, 'terminal-profile-'));
  fs.chmodSync(dir, 0o700);
  try {
    const expectedFile = path.join(dir, 'expected.json'),
      actualFile = path.join(dir, 'actual.json');
    fs.writeFileSync(expectedFile, JSON.stringify(expected.terminal), { mode: 0o600 });
    fs.writeFileSync(actualFile, JSON.stringify(actual.terminal), { mode: 0o600 });
    try {
      execFileSync(
        'python3',
        [path.join(HERE, 'verify-profile.py'), '--expected', expectedFile, '--actual', actualFile],
        { stdio: 'pipe' },
      );
    } catch {
      throw Error('Terminal effective profile rejected');
    }
    insist(
      canonical(expected.complete) === canonical(actual.complete),
      'Complete existing/terminal profile drift',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
async function targetFacts(admin, business, native) {
  const result = [];
  for (const [c, db] of [
    [admin, 'postgres'],
    [business, 'zhiban_m1_dev'],
    [native, 'zhiban_m5_native'],
  ]) {
    const v = (
      await c.query(
        "SELECT current_database() db,session_user role,current_user effective,(SELECT rolsuper FROM pg_roles WHERE rolname=current_user) super,current_setting('server_version_num')::int pg,current_setting('port')::int port,current_setting('data_directory') dir,(SELECT system_identifier::text FROM pg_control_system()) cluster",
      )
    ).rows[0];
    insist(
      v.db === db &&
        v.role === 'postgres' &&
        v.effective === 'postgres' &&
        v.super &&
        v.pg >= 160000 &&
        v.pg <= 169999,
      'Private installer connection identity rejected',
    );
    result.push(v);
  }
  insist(
    result.every(
      (v) =>
        v.cluster === result[0].cluster && v.dir === result[0].dir && v.port === result[0].port,
    ),
    'Installer cross-cluster connection rejected',
  );
  const dbs = (
    await admin.query(
      "SELECT datname,oid::text oid,datallowconn FROM pg_database WHERE datname IN('zhiban_m1_dev','zhiban_m5_native') ORDER BY datname",
    )
  ).rows;
  insist(dbs.length === 2, 'Owned database scope incomplete');
  return {
    pgMajor: 16,
    port: result[0].port,
    dataDirectory: result[0].dir,
    clusterSystemIdentifier: result[0].cluster,
    businessDatabase: 'zhiban_m1_dev',
    nativeDatabase: 'zhiban_m5_native',
    businessDatabaseOid: dbs.find((v) => v.datname === 'zhiban_m1_dev').oid,
    nativeDatabaseOid: dbs.find((v) => v.datname === 'zhiban_m5_native').oid,
  };
}
async function assertClosedBarrier(admin, business, native, target, requireClosed = true) {
  const dbs = (
    await admin.query('SELECT oid,datallowconn FROM pg_database WHERE oid=ANY($1::oid[])', [
      [target.businessDatabaseOid, target.nativeDatabaseOid],
    ])
  ).rows;
  insist(
    dbs.length === 2 && (!requireClosed || dbs.every((v) => !v.datallowconn)),
    'Both database admissions must remain closed',
  );
  const writers = (
    await admin.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1) AND rolcanlogin', [
      WRITERS,
    ])
  ).rows;
  insist(writers.length === 0, 'Ordinary writer LOGIN blocks installation');
  const pids = [business.processID, native.processID];
  await admin.query('SELECT pg_stat_clear_snapshot()');
  const backends = (
    await admin.query(
      'SELECT pid,backend_start::text backend_start,datname,usename,backend_type FROM pg_stat_activity WHERE datid=ANY($1::oid[])',
      [[target.businessDatabaseOid, target.nativeDatabaseOid]],
    )
  ).rows;
  insist(
    backends.length === 2 &&
      backends.every(
        (v) =>
          pids.includes(v.pid) && v.usename === 'postgres' && v.backend_type === 'client backend',
      ),
    'Non-installer backend blocks installation',
  );
  const extra = (
    await admin.query(
      "SELECT current_setting('max_prepared_transactions')::int prepared_enabled,(SELECT count(*)::int FROM pg_prepared_xacts WHERE database IN('zhiban_m1_dev','zhiban_m5_native')) prepared,(SELECT count(*)::int FROM pg_subscription WHERE subdbid=ANY($1::oid[]) AND subenabled) subscriptions",
      [[target.businessDatabaseOid, target.nativeDatabaseOid]],
    )
  ).rows[0];
  insist(
    extra.prepared_enabled === 0 && extra.prepared === 0 && extra.subscriptions === 0,
    'Prepared/subscription writer blocks installation',
  );
  const adminIdentity = (
    await admin.query(
      'SELECT pg_backend_pid() pid,pg_postmaster_start_time()::text postmaster,backend_start::text backend_start FROM pg_stat_activity WHERE pid=pg_backend_pid()',
    )
  ).rows[0];
  return canonical({
    target,
    adminIdentity,
    backends: [...backends].sort((a, b) => a.pid - b.pid),
  });
}
async function businessConnectPlan(business) {
  const ordinary = [
    'zhiban_identity_owner',
    'zhiban_migrator',
    'zhiban_runtime',
    'zhiban_auth_runtime',
    'zhiban_control_runtime',
    'zhiban_bridge_runtime',
    'zhiban_academic_runtime',
  ];
  const row = (
    await business.query(`SELECT datacl::text acl,datallowconn,
    (SELECT jsonb_agg(jsonb_build_object('role',CASE WHEN a.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END,'privilege',a.privilege_type,'grantOption',a.is_grantable) ORDER BY a.grantee,a.privilege_type)
     FROM aclexplode(coalesce(datacl,acldefault('d',datdba))) a) entries
    FROM pg_database WHERE datname=current_database()`)
  ).rows[0];
  const allowed = [...ordinary, 'postgres'];
  insist(
    row &&
      (row.entries || []).every(
        (v) =>
          allowed.includes(v.role) ||
          (v.role === 'PUBLIC' && v.privilege === 'CONNECT' && !v.grantOption),
      ),
    'Unreviewed Business admission ACL',
  );
  const effective = (
    await business.query(
      "SELECT r,has_database_privilege(r,current_database(),'CONNECT') allowed FROM unnest($1::text[]) r",
      [ordinary],
    )
  ).rows;
  insist(
    effective.length === ordinary.length && effective.every((v) => v.allowed),
    'Approved ordinary Business CONNECT missing',
  );
  return {
    originalDatabaseAcl: row.acl,
    originalAllowConnections: row.datallowconn,
    preservedOrdinaryRoles: ordinary,
    publicConnectRemoved: true,
  };
}
async function finalBlockedValidation(ctx, source, target, identity) {
  insist(sources().inventorySha256 === source.inventorySha256, 'Source changed during validation');
  insist(
    canonical(await targetFacts(ctx.admin, ctx.business, ctx.native)) === canonical(target),
    'Target changed during validation',
  );
  await checkLedgers(ctx.business, source, true);
  await readyFalse(ctx.business);
  insist(
    (await assertClosedBarrier(ctx.admin, ctx.business, ctx.native, target)) === identity,
    'Physical maintenance identity changed',
  );
}
async function checkLedgers(business, source, installed) {
  for (const group of ['identity', 'academic', 'learning', 'assessment']) {
    const rows = (
      await business.query(
        `SELECT version,checksum FROM zhiban_${group}.schema_migrations ORDER BY version`,
      )
    ).rows;
    const names = Object.keys(source.inv.prerequisitesSha256)
      .filter((n) => n.startsWith(`lib/zhiban/infrastructure/${group}/postgres/migrations/`))
      .sort();
    insist(
      rows.length === names.length &&
        names.every(
          (n, i) =>
            rows[i].version === path.basename(n).slice(0, 4) &&
            rows[i].checksum === source.inv.prerequisitesSha256[n],
        ),
      'Prerequisite ledger rejected',
    );
  }
  const rows = (
    await business.query(
      'SELECT version,checksum FROM zhiban_content.schema_migrations ORDER BY version',
    )
  ).rows;
  insist(
    rows.length === (installed ? 2 : 1) &&
      rows[0].version === '0001' &&
      rows[0].checksum === 'e335f83bb48cc6c4ec754f8e3270dc0e6941e14f38306bd67aa29844c3713324' &&
      (!installed || (rows[1].version === '0002' && rows[1].checksum === source.migrationSha256)),
    'Terminal ledger rejected',
  );
}
function approval(file, pin, expected, target, source) {
  const p = verifyEnvelope(JSON.parse(readPrivate(file)), pin, 'INSTALL_LOCAL_TERMINAL_BLOCKED');
  return validateApproval(p, pin, expected, target, source);
}
function validateApproval(p, pin, expected, target, source) {
  insist(
    p.purpose === 'INSTALL_LOCAL_TERMINAL_BLOCKED' &&
      p.formatVersion === 1 &&
      p.evidenceOrigin === 'LOCAL' &&
      p.githubActions === false &&
      p.authorityKeySha256 === pin.digest,
    'Approval purpose rejected',
  );
  keys(p, [
    'purpose',
    'formatVersion',
    'evidenceOrigin',
    'githubActions',
    'authorityKeySha256',
    'approvalRef',
    'expectedArtifactSha256',
    'candidateInventorySha256',
    'target',
    'expiresAt',
    'maintenanceAttestation',
  ]);
  insist(
    p.expectedArtifactSha256 === expected.digest &&
      p.candidateInventorySha256 === source.inventorySha256 &&
      canonical(p.target) === canonical(target),
    'Install approval scope rejected',
  );
  insist(
    p.maintenanceAttestation === 'HOST_STOPPED_KEEP_BOTH_DATABASES_CLOSED' &&
      typeof p.approvalRef === 'string' &&
      p.approvalRef.length > 0 &&
      Number.isSafeInteger(p.expiresAt) &&
      p.expiresAt > Date.now() &&
      p.expiresAt - Date.now() <= 300000,
    'Install approval expired/maintenance scope rejected',
  );
  return p;
}
function atomicPrivate(file, bytes) {
  const dir = path.dirname(file),
    s = fs.lstatSync(dir);
  insist(
    !s.isSymbolicLink() && s.uid === process.getuid() && !(s.mode & 0o077),
    'Private output directory rejected',
  );
  // Never overwrite a receipt or journal from a previous attempt.
  const fd = fs.openSync(
    file,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
    0o600,
  );
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const d = fs.openSync(dir, 'r');
  try {
    fs.fsyncSync(d);
  } finally {
    fs.closeSync(d);
  }
}
function journal(file) {
  atomicPrivate(file, '');
  const fd = fs.openSync(
    file,
    fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW,
  );
  return {
    append(event) {
      fs.writeSync(
        fd,
        canonical({ ...event, evidenceOrigin: 'LOCAL', occurredAt: Date.now() }) + '\n',
      );
      fs.fsyncSync(fd);
    },
    close() {
      fs.closeSync(fd);
    },
  };
}
async function readyFalse(business) {
  const row = (
    await business.query(
      'SELECT (SELECT count(*) FROM zhiban_reconcile.installations WHERE ready) ready,(SELECT count(*) FROM zhiban_reconcile.services) services,(SELECT count(*) FROM zhiban_reconcile.controller_authorizations) controllers,(SELECT count(*) FROM zhiban_reconcile.grants) grants',
    )
  ).rows[0];
  insist(
    Object.values(row).every((v) => String(v) === '0'),
    'Activation/authority seeded unexpectedly',
  );
}
async function installBlocked(ctx) {
  const source = sources(),
    pin = publicPin(ctx.trustPinPath),
    expected = trustedExpected(ctx.expectedPath, pin, source);
  const issuerKey = readPrivate(ctx.issuerKeyPath); // Verify signing key BEFORE any DDL.
  signed({ probe: true }, issuerKey, pin);
  const target = await targetFacts(ctx.admin, ctx.business, ctx.native);
  const authorized = approval(ctx.approvalPath, pin, expected, target, source);
  const identity = await assertClosedBarrier(
    ctx.admin,
    ctx.business,
    ctx.native,
    target,
    !ctx.closeAdmissions,
  );
  const connectChange = await businessConnectPlan(ctx.business);
  await checkLedgers(ctx.business, source, false);
  insist(
    canonical(await collectComplete(ctx.business, ctx.native, false)) ===
      canonical(expected.payload.before),
    'Reviewed pre-install profile drift',
  );
  const log = journal(ctx.journalPath);
  let stage = 'preflight';
  try {
    log.append({
      stage,
      status: 'CONFIRMED',
      target,
      candidateInventorySha256: source.inventorySha256,
      expectedArtifactSha256: expected.digest,
      connectChange,
      physicalIdentity: JSON.parse(identity),
    });
    if (ctx.closeAdmissions) {
      insist(authorized.expiresAt > Date.now(), 'Approval expired before admission change');
      for (const db of ['zhiban_m1_dev', 'zhiban_m5_native']) {
        stage = 'admission-' + db;
        log.append({ stage, status: 'INTENT', allowConnections: false });
        await ctx.admin.query('ALTER DATABASE ' + db + ' ALLOW_CONNECTIONS false');
        log.append({ stage, status: 'CONFIRMED' });
      }
    }
    await assertClosedBarrier(ctx.admin, ctx.business, ctx.native, target);
    for (const [name, client, component] of [
      ['roles', ctx.admin, '00-role-bootstrap.sql'],
      ['business-connect', ctx.business, '00-business-connect.sql'],
      ['observer', ctx.business, '00-catalog-observer.sql'],
    ]) {
      stage = name;
      log.append({ stage, status: 'INTENT', source: source.inv.filesSha256[component] });
      await assertClosedBarrier(ctx.admin, ctx.business, ctx.native, target);
      insist(authorized.expiresAt > Date.now(), 'Approval expired before DDL');
      await client.query(fs.readFileSync(path.join(HERE, component), 'utf8'));
      log.append({ stage, status: 'CONFIRMED' });
    }
    stage = 'business';
    log.append({ stage, status: 'INTENT', aggregate: source.migrationSha256 });
    insist(authorized.expiresAt > Date.now(), 'Approval expired before Business DDL');
    await ctx.business.query('BEGIN');
    try {
      await ctx.business.query('SET LOCAL ROLE zhiban_identity_owner');
      for (const n of source.inv.migration.orderedComponents)
        await ctx.business.query(fs.readFileSync(path.join(HERE, n), 'utf8'));
      await ctx.business.query(
        "INSERT INTO zhiban_content.schema_migrations(version,checksum) VALUES('0002',$1)",
        [source.migrationSha256],
      );
      await ctx.business.query('COMMIT');
    } catch (e) {
      await ctx.business.query('ROLLBACK');
      throw e;
    }
    log.append({ stage, status: 'CONFIRMED' });
    stage = 'native';
    log.append({ stage, status: 'INTENT' });
    insist(authorized.expiresAt > Date.now(), 'Approval expired before Native DDL');
    await ctx.native.query('BEGIN');
    try {
      await ctx.native.query('SET LOCAL ROLE zhiban_openmaic_owner');
      await ctx.native.query(fs.readFileSync(path.join(HERE, '08-native-proof-acl.sql'), 'utf8'));
      await ctx.native.query('COMMIT');
    } catch (e) {
      await ctx.native.query('ROLLBACK');
      throw e;
    }
    log.append({ stage, status: 'CONFIRMED' });
    stage = 'verify';
    await assertClosedBarrier(ctx.admin, ctx.business, ctx.native, target);
    await checkLedgers(ctx.business, source, true);
    await readyFalse(ctx.business);
    const actual = await collectAfter(ctx.business, ctx.native);
    matchAfter(expected.payload.after, actual, path.dirname(ctx.receiptPath));
    await finalBlockedValidation(ctx, source, target, identity);
    insist(authorized.expiresAt > Date.now(), 'Approval expired before receipt');
    const payload = {
      purpose: 'TERMINAL_TECHNICAL_INSTALLATION_BLOCKED',
      formatVersion: 1,
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      authorityKeySha256: pin.digest,
      profile: PROFILE,
      status: 'INSTALLED_BLOCKED',
      runtimeAccepted: false,
      terminalActionsAllowed: false,
      installationReady: false,
      approvalRef: authorized.approvalRef,
      issuedAt: new Date().toISOString(),
      candidateInventorySha256: source.inventorySha256,
      candidateMigrationSha256: source.migrationSha256,
      expectedArtifactSha256: expected.digest,
      combinedCatalogSha256: sha(canonical(actual)),
      target,
    };
    const envelope = signed(payload, issuerKey, pin);
    atomicPrivate(ctx.receiptPath, JSON.stringify(envelope, null, 2) + '\n');
    log.append({
      stage: 'receipt',
      status: 'CONFIRMED',
      receiptSha256: sha(fs.readFileSync(ctx.receiptPath)),
      installationReady: false,
    });
    return envelope;
  } catch (e) {
    await ctx.business.query('ROLLBACK').catch(() => {});
    await ctx.native.query('ROLLBACK').catch(() => {});
    log.append({
      stage,
      status: 'BLOCKED',
      reason: 'INSTALLATION_INCOMPLETE_OR_UNVERIFIED',
      admissionRestored: false,
    });
    throw Error(
      'Terminal installation blocked; keep admissions closed and inspect private journal',
    );
  } finally {
    log.close();
  }
}
async function loadBlockedReceipt(ctx) {
  const source = sources(),
    pin = publicPin(ctx.trustPinPath),
    expected = trustedExpected(ctx.expectedPath, pin, source);
  const raw = readPrivate(ctx.receiptPath),
    payload = verifyEnvelope(JSON.parse(raw), pin, 'TERMINAL_TECHNICAL_INSTALLATION_BLOCKED');
  keys(payload, [
    'purpose',
    'formatVersion',
    'evidenceOrigin',
    'githubActions',
    'authorityKeySha256',
    'profile',
    'status',
    'runtimeAccepted',
    'terminalActionsAllowed',
    'installationReady',
    'approvalRef',
    'issuedAt',
    'candidateInventorySha256',
    'candidateMigrationSha256',
    'expectedArtifactSha256',
    'combinedCatalogSha256',
    'target',
  ]);
  insist(
    payload.profile === PROFILE &&
      payload.status === 'INSTALLED_BLOCKED' &&
      payload.runtimeAccepted === false &&
      payload.terminalActionsAllowed === false &&
      payload.installationReady === false &&
      typeof payload.approvalRef === 'string' &&
      payload.approvalRef.length > 0 &&
      Number.isFinite(Date.parse(payload.issuedAt)),
    'Blocked receipt semantics rejected',
  );
  insist(
    payload.expectedArtifactSha256 === expected.digest &&
      payload.candidateInventorySha256 === source.inventorySha256 &&
      payload.candidateMigrationSha256 === source.migrationSha256,
    'Receipt source binding rejected',
  );
  const target = await targetFacts(ctx.admin, ctx.business, ctx.native);
  insist(canonical(target) === canonical(payload.target), 'Receipt target binding rejected');
  const identity = await assertClosedBarrier(ctx.admin, ctx.business, ctx.native, target);
  await checkLedgers(ctx.business, source, true);
  await readyFalse(ctx.business);
  const actual = await collectAfter(ctx.business, ctx.native);
  matchAfter(expected.payload.after, actual, path.dirname(ctx.receiptPath));
  insist(
    sha(canonical(actual)) === payload.combinedCatalogSha256,
    'Receipt catalog binding rejected',
  );
  await finalBlockedValidation(ctx, source, target, identity);
  return {
    status: 'LOCAL_TERMINAL_TECHNICAL_INSTALLED_BLOCKED',
    runtimeAccepted: false,
    terminalActionsAllowed: false,
    installationReady: false,
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    receiptSha256: sha(raw),
  };
}
module.exports = {
  canonical,
  sha,
  publicPin,
  signed,
  sources,
  trustedExpected,
  verifyEnvelope,
  collectComplete,
  collectBusinessAfter,
  collectAfter,
  matchAfter,
  validateApproval,
  targetFacts,
  installBlocked,
  loadBlockedReceipt,
  assertClosedBarrier,
  readPrivate,
  journal,
  keys,
};
