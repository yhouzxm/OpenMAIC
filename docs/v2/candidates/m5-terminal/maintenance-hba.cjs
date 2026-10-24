const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { privateDirectory, writeExclusive, syncDir } = require('./maintenance-lock.cjs');
const terminal = require('./terminal-installation.cjs');
const BUSINESS = 'zhiban_m1_dev',
  NATIVE = 'zhiban_m5_native';
const WRITERS = [
  'zhiban_migrator',
  'zhiban_runtime',
  'zhiban_auth_runtime',
  'zhiban_control_runtime',
  'zhiban_bridge_runtime',
  'zhiban_academic_runtime',
  'zhiban_openmaic_migrator',
  'zhiban_openmaic_runtime',
];
const MAINTENANCE = [
  'zhiban_reconcile_controller',
  'zhiban_reconcile_issuer',
  'zhiban_reconcile_executor',
  'zhiban_reconcile_native_proof',
];
const dbFor = (role) =>
  role.includes('openmaic') || role.endsWith('native_proof') ? NATIVE : BUSINESS;
const secret = () => crypto.randomBytes(32).toString('hex');
// Send a SCRAM verifier to ALTER ROLE, never a plaintext password in SQL/logs.
function verifier(password) {
  if (!/^[a-f0-9]{64}$/.test(password)) throw Error('Generated credential required');
  const salt = crypto.randomBytes(16),
    salted = crypto.pbkdf2Sync(password, salt, 4096, 32, 'sha256');
  const client = crypto.createHmac('sha256', salted).update('Client Key').digest();
  return `SCRAM-SHA-256$4096:${salt.toString('base64')}$${crypto.createHash('sha256').update(client).digest('base64')}:${crypto.createHmac('sha256', salted).update('Server Key').digest('base64')}`;
}
function hba(roles, adminBootstrap = false) {
  if (
    roles.some((r) => ![...WRITERS, ...MAINTENANCE].includes(r)) ||
    new Set(roles).size !== roles.length
  )
    throw Error('Closed HBA roles required');
  return (
    '# LOCAL terminal maintenance: private Unix socket SCRAM only\nlocal postgres postgres scram-sha-256\n' +
    (adminBootstrap ? `local ${BUSINESS} postgres scram-sha-256\n` : '') +
    roles.map((r) => `local ${dbFor(r)} ${r} scram-sha-256\n`).join('') +
    'local all all reject\nlocal replication all reject\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\nhost replication all 0.0.0.0/0 reject\nhost replication all ::0/0 reject\n'
  );
}
async function replaceHba(admin, file, text) {
  privateDirectory(path.dirname(file));
  terminal.readPrivate(file);
  const tmp = file + '.' + secret() + '.tmp';
  writeExclusive(tmp, text);
  fs.renameSync(tmp, file);
  syncDir(path.dirname(file));
  const errors = (await admin.query('SELECT error FROM pg_hba_file_rules WHERE error IS NOT NULL'))
    .rows;
  if (errors.length || !(await admin.query('SELECT pg_reload_conf() ok')).rows[0].ok)
    throw Error('HBA reload rejected');
  // Reload is asynchronous. A successful fresh SCRAM connection plus negative
  // probes is required by the caller before any controller/helper mutation.
  if (terminal.sha(terminal.readPrivate(file)) !== terminal.sha(text))
    throw Error('HBA source drift');
}
function prepareCredentials(roles) {
  if (
    roles.some((r) => ![...WRITERS, ...MAINTENANCE].includes(r)) ||
    new Set(roles).size !== roles.length
  )
    throw Error('Credential roles rejected');
  return Object.fromEntries(roles.map((r) => [r, secret()]));
}
async function rotate(admin, roles, passwords) {
  terminal.keys(passwords, roles);
  for (const role of roles) {
    if (![...WRITERS, ...MAINTENANCE].includes(role)) throw Error('Rotation role rejected');
    await admin.query(`ALTER ROLE ${role} NOLOGIN PASSWORD '${verifier(passwords[role])}'`);
  }
  return passwords;
}
async function connect(endpoint, database, user, password) {
  const c = new Client({
    ...endpoint,
    database,
    user,
    password,
    connectionTimeoutMillis: 3000,
    query_timeout: 5000,
    statement_timeout: 5000,
    lock_timeout: 1000,
    idle_in_transaction_session_timeout: 10000,
  });
  c.on('error', () => {});
  try {
    await c.connect();
    return c;
  } catch (e) {
    await c.end().catch(() => {});
    throw e;
  }
}
async function denied(endpoint, database, user, password) {
  let c;
  try {
    c = await connect(endpoint, database, user, password);
  } catch (e) {
    if (['28000', '28P01', '55000'].includes(e.code)) return;
    throw Error('Negative authentication probe inconclusive');
  } finally {
    if (c) await c.end();
  }
  throw Error('Forbidden credential connected');
}
module.exports = {
  BUSINESS,
  NATIVE,
  WRITERS,
  MAINTENANCE,
  dbFor,
  secret,
  hba,
  verifier,
  replaceHba,
  rotate,
  prepareCredentials,
  connect,
  denied,
};
