#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Deployment tools run without TS/app startup. */
'use strict';
/** RDS readiness/staging only. Never runs DDL, imports LOCAL fixtures, changes SSL or enables an application. */
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const { parseEnv } = require('node:util');
const { Pool } = require('pg');
const tls = require('node:tls');
const net = require('node:net');
const { ancestors, privatePath } = require('../zhiban-portable.cjs');
const official = 'c0f296aa36096ec3d1e1e2b94a7a48e20075e0a1';
const referencePath = 'docs/v2/candidates/openmaic-130/reference-pg18.json';
const pinPath = 'docs/v2/candidates/openmaic-130/pin-pg18.json';
const digest = (b) => crypto.createHash('sha256').update(b).digest('hex');
function check(v, m) {
  if (!v) throw Error(m);
}
function secretFile(p) {
  check(typeof p === 'string' && path.resolve(p) === p, 'Absolute configuration path required');
  privatePath(p);
  return fs.readFileSync(p);
}
function load(config) {
  const raw = secretFile(config),
    c = JSON.parse(raw);
  check(c.kind === 'ZHIBAN_RDS_PG18_DEPLOYMENT_INPUT_V1', 'Unsupported RDS configuration');
  const u = new URL(c.origin);
  check(
    u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      u.pathname === '/' &&
      !u.search &&
      !u.hash,
    'Canonical HTTPS origin required',
  );
  check(c.origin === u.origin, 'HTTPS origin must omit the trailing slash');
  check(
    typeof c.expectedHost === 'string' && /^[a-zA-Z0-9.-]+$/.test(c.expectedHost),
    'Exact expected RDS hostname required',
  );
  check(Number.isInteger(c.port) && c.port > 0 && c.port < 65536, 'Explicit RDS port required');
  check(
    /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(c.maintenanceDatabase),
    'Explicit existing management database required',
  );
  const targets = Object.values(c.databases ?? {});
  check(
    Object.keys(c.databases ?? {})
      .sort()
      .join(',') === 'authoring,business,content' &&
      targets.length === 3 &&
      new Set(targets).size === 3 &&
      targets.every((v) => /^zhiban_[a-z0-9_]{1,50}$/.test(v)),
    'Three distinct dedicated zhiban_ databases required',
  );
  const ca = secretFile(c.caFile),
    envRaw = secretFile(c.adminEnvFile),
    values = parseEnv(envRaw.toString());
  check(
    typeof values.DATABASE_URL === 'string' && values.DATABASE_URL.length > 0,
    'Admin credential file needs DATABASE_URL',
  );
  const d = new URL(values.DATABASE_URL);
  check(
    ['postgres:', 'postgresql:'].includes(d.protocol) && !d.search && !d.hash,
    'Plain PostgreSQL URL without TLS/query overrides required',
  );
  check(
    d.hostname === c.expectedHost && Number(d.port || 5432) === c.port,
    'Credential endpoint differs from reviewed RDS target',
  );
  check(d.username && d.password, 'Restricted admin credentials required');
  const r = JSON.parse(fs.readFileSync(referencePath)),
    pin = JSON.parse(fs.readFileSync(pinPath));
  check(
    pin.kind === 'OPENMAIC_130_REFERENCE_PIN_V1' &&
      pin.sha256 === digest(fs.readFileSync(referencePath)) &&
      c.expectedReferenceSha256 === pin.sha256 &&
      r.kind === 'OPENMAIC_130_SOURCE_BUILT_REFERENCE_V1' &&
      r.major === 18 &&
      r.provider.sha === official,
    'Approved v1.3.0 PG18 reference pin required',
  );
  for (const [p, h] of Object.entries(r.sourceHashes))
    check(
      !path.isAbsolute(p) &&
        path.normalize(p) === p &&
        !p.startsWith('../') &&
        digest(fs.readFileSync(p)) === h,
      'Reference source closure drift',
    );
  return {
    c,
    raw,
    ca,
    envRaw,
    reference: r,
    pin,
    connection: {
      host: c.expectedHost,
      port: c.port,
      database: c.maintenanceDatabase,
      user: decodeURIComponent(d.username),
      password: decodeURIComponent(d.password),
      ssl: {
        ca: ca.toString(),
        rejectUnauthorized: true,
        ...(!net.isIP(c.expectedHost) ? { servername: c.expectedHost } : {}),
        checkServerIdentity: (_host, cert) => tls.checkServerIdentity(c.expectedHost, cert),
      },
      application_name: 'zhiban-rds-readonly-preflight',
      max: 1,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
    },
  };
}
function plan(config) {
  const x = load(config),
    c = x.c;
  const sources = {};
  for (const [p, h] of Object.entries(x.reference.sourceHashes))
    if (p.endsWith('.sql')) sources[p] = h;
  const facts = {
    kind: 'ZHIBAN_RDS_PG18_READINESS_PLAN_V1',
    applicationVersion: '1.3.0',
    officialSha: official,
    origin: c.origin,
    endpoint: { host: c.expectedHost, port: c.port, maintenanceDatabase: c.maintenanceDatabase },
    databases: c.databases,
    configSha256: digest(x.raw),
    credentialFileSha256: digest(x.envRaw),
    caSha256: digest(x.ca),
    referenceSha256: x.pin.sha256,
    sources,
    executesDdl: false,
    applicationEnabled: false,
    requires: [
      'Real RDS TLS certificate and network access',
      'Dedicated empty databases and exact minimum role graph',
      'RDS-specific independently approved catalog/ACL profile; LOCAL postgres grantor/ownership is not normalized away',
      'Versioned full host installer/loader and first administrator approval',
      'Public HTTPS IP certificate and reviewed systemd/reverse-proxy switch',
      'Complete database, original bytes, instance secrets and runtime configuration restore rehearsal',
    ],
  };
  return { ...facts, planSha256: digest(JSON.stringify(facts)) };
}
async function preflight(config) {
  const x = load(config),
    reviewed = plan(config),
    p = new Pool(x.connection);
  let began = false;
  try {
    check(
      reviewed.configSha256 === digest(x.raw) &&
        reviewed.credentialFileSha256 === digest(x.envRaw) &&
        reviewed.caSha256 === digest(x.ca),
      'Inputs changed before preflight',
    );
    await p.query('BEGIN READ ONLY');
    began = true;
    const r = (
      await p.query(
        "SELECT current_database() AS database,session_user AS role,current_setting('server_version_num')::int AS version,current_setting('default_transaction_read_only') AS default_read_only,ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()",
      )
    ).rows[0];
    check(r?.ssl === true, 'Verified TLS is mandatory; no plaintext fallback');
    check(r.version >= 180000 && r.version < 190000, 'Actual PG18 server required');
    check(r.database === x.c.maintenanceDatabase, 'Management database mismatch');
    const capability = (
      await p.query(
        'SELECT rolcreatedb,rolcreaterole,rolsuper FROM pg_roles WHERE rolname=session_user',
      )
    ).rows[0];
    const databases = (
      await p.query('SELECT datname FROM pg_database WHERE datname=ANY($1) ORDER BY 1', [
        Object.values(x.c.databases),
      ])
    ).rows.map((r) => r.datname);
    const roles = (
      await p.query(
        "SELECT rolname,rolsuper,rolinherit,rolcreaterole,rolcreatedb,rolcanlogin,rolbypassrls,rolreplication FROM pg_roles WHERE rolname LIKE 'zhiban_%' ORDER BY rolname",
      )
    ).rows;
    const roleEdges = (
      await p.query(
        "SELECT a.rolname AS role,b.rolname AS member,g.rolname AS grantor,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles a ON a.oid=m.roleid JOIN pg_roles b ON b.oid=m.member JOIN pg_roles g ON g.oid=m.grantor WHERE a.rolname LIKE 'zhiban_%' OR b.rolname LIKE 'zhiban_%' ORDER BY a.rolname,b.rolname,g.rolname",
      )
    ).rows;
    const requiredRoles = [
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
      'zhiban_autograde_worker',
    ];
    const requiredEdges = [
      ['zhiban_identity_owner', 'zhiban_migrator'],
      ['zhiban_openmaic_owner', 'zhiban_openmaic_migrator'],
    ];
    const missingRoles = requiredRoles.filter((n) => !roles.some((r) => r.rolname === n));
    const unsafeRoleAttributes = roles
      .filter(
        (r) =>
          requiredRoles.includes(r.rolname) &&
          (r.rolsuper ||
            r.rolinherit ||
            r.rolcreatedb ||
            r.rolcreaterole ||
            r.rolbypassrls ||
            r.rolreplication ||
            r.rolcanlogin === r.rolname.endsWith('_owner')),
      )
      .map((r) => r.rolname);
    const unexpectedEdges = roleEdges.filter(
      (e) =>
        !requiredEdges.some(
          ([role, member]) =>
            e.role === role &&
            e.member === member &&
            !e.admin_option &&
            !e.inherit_option &&
            e.set_option,
        ),
    );
    const missingEdges = requiredEdges.filter(
      ([role, member]) => !roleEdges.some((e) => e.role === role && e.member === member),
    );
    const roleGraphReady =
      !missingRoles.length &&
      !unsafeRoleAttributes.length &&
      !unexpectedEdges.length &&
      !missingEdges.length &&
      roleEdges.length === requiredEdges.length;
    await p.query('COMMIT');
    began = false;
    check(plan(config).planSha256 === reviewed.planSha256, 'Inputs changed during preflight');
    return {
      kind: 'ZHIBAN_RDS_PG18_READONLY_PREFLIGHT_V1',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      status: 'READ_ONLY_PREFLIGHT_PASS',
      planSha256: reviewed.planSha256,
      serverVersion: r.version,
      tlsVerified: true,
      managementDatabase: r.database,
      capabilities: capability,
      existingDedicatedDatabases: databases,
      existingZhibanRoles: roles,
      canCreateDatabases: capability.rolcreatedb || capability.rolsuper,
      canCreateRoles: capability.rolcreaterole || capability.rolsuper,
      // CREATEROLE is not authority to reproduce the frozen membership/grantor graph.
      canonicalRolePreparation: {
        status: roleGraphReady
          ? 'PREPROVISIONED_EXACT_GRAPH'
          : capability.rolsuper
            ? 'PRIVILEGED_BOOTSTRAP_REQUIRED'
            : 'BLOCKED_NEEDS_PRIVILEGED_ROLE_PREPARATION',
        roleGraphReady,
        missingRoles,
        unsafeRoleAttributes,
        unexpectedEdges,
        missingEdges,
        roleEdges,
      },
      canCreateDedicatedObjects: capability.rolsuper,

      productionReady: false,
      mutated: false,
      sourceDataRead: false,
    };
  } finally {
    if (began) await p.query('ROLLBACK').catch(() => {});
    await p.end();
  }
}
function stage(config, out, pin) {
  const p = plan(config);
  check(p.planSha256 === pin, 'Reviewed plan pin mismatch');
  check(path.resolve(out) === out && out !== '/', 'Canonical staging path required');
  ancestors(out);
  check(!fs.lstatSync(out, { throwIfNoEntry: false }), 'Staging target exists');
  fs.mkdirSync(out, { mode: 0o700 });
  for (const file of Object.keys(p.sources)) {
    const target = path.join(out, 'reviewed-sql', file);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    const bytes = fs.readFileSync(file);
    check(digest(bytes) === p.sources[file], 'Source changed during staging');
    fs.writeFileSync(target, bytes, { mode: 0o600, flag: 'wx' });
  }
  fs.writeFileSync(path.join(out, 'PLAN.json'), JSON.stringify(p, null, 2) + '\n', {
    mode: 0o600,
    flag: 'wx',
  });
  fs.writeFileSync(
    path.join(out, 'README.txt'),
    'UNAPPLIED READINESS PACKAGE. No credentials, private keys, local accounts, or runtime activation are included.\nRun the repository preflight against the explicitly named existing management database. A 3D000 response identifies an absent management database; correct the configuration explicitly rather than probing other application databases.\nThe staged SQL preserves reviewed bytes and is not an automatic RDS installer. RDS grantor/ownership, MAINTAIN and catalog differences require an independently approved RDS profile; do not relabel LOCAL PG18 receipts.\nDo not execute local initdb/pg_ctl or point local trial launchers at RDS. Do not stop OpenMAIC, change shared RDS SSL, use pm2 next as the Zhiban host, or enable port 88 without the full host/TLS gates.\n',
    { mode: 0o600, flag: 'wx' },
  );
  return {
    status: 'STAGED_UNAPPLIED',
    path: out,
    planSha256: p.planSha256,
    credentialsCopied: false,
    executesDdl: false,
  };
}
async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'plan' && args.length === 1) return plan(args[0]);
  if (action === 'preflight' && args.length === 1) return preflight(args[0]);
  if (action === 'stage' && args.length === 3) return stage(...args);
  throw Error(
    'Use plan CONFIG | preflight CONFIG | stage CONFIG OUTPUT PLAN_SHA256 (private absolute paths)',
  );
}
module.exports = { load, plan, preflight, stage };
if (require.main === module)
  main()
    .then((v) => console.log(JSON.stringify(v, null, 2)))
    .catch((e) => {
      // Driver errors may contain host/account details. Never dump a URL, config or raw error stack.
      const code = typeof e.code === 'string' && /^[A-Z0-9_]{3,40}$/.test(e.code) ? e.code : null;
      console.error(
        JSON.stringify({
          status: 'REFUSED',
          code,
          reason: code
            ? 'RDS connection/check refused; verify TLS, explicit maintenance database and privileges'
            : e.message,
          productionReady: false,
        }),
      );
      process.exitCode = 1;
    });
