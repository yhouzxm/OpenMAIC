/* eslint-disable @typescript-eslint/no-require-imports -- Real loopback TLS PG18 integration, no cloud access. */
const test = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  os = require('node:os'),
  cp = require('node:child_process'),
  crypto = require('node:crypto');
const rds = require('../../../scripts/zhiban-deploy/rds.cjs');
const bin = process.env.ZHIBAN_PG18_BIN;
test(
  'RDS tool uses verified TLS, explicit management DB, source pin and unapplied staging',
  { skip: !bin },
  async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiban-rds-tool-test-'));
    fs.chmodSync(root, 0o700);
    const socket = path.join(root, 'socket'),
      data = path.join(root, 'data');
    fs.mkdirSync(socket, { mode: 0o700 });
    let started = false;
    const run = (cmd, args, options = {}) =>
      cp.execFileSync(cmd, args, { stdio: 'pipe', ...options });
    const secret = (name, value) => {
      const p = path.join(root, name);
      fs.writeFileSync(p, value, { mode: 0o600 });
      return p;
    };
    try {
      assert.match(
        run(path.join(bin, 'postgres'), ['--version'], { encoding: 'utf8' }),
        /PostgreSQL\) 18\./,
      );
      run('openssl', [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        path.join(root, 'server.key'),
        '-out',
        path.join(root, 'server.crt'),
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
      ]);
      fs.chmodSync(path.join(root, 'server.key'), 0o600);
      fs.chmodSync(path.join(root, 'server.crt'), 0o600);
      run(path.join(bin, 'initdb'), [
        '-D',
        data,
        '-U',
        'postgres',
        '--auth-local=trust',
        '--auth-host=scram-sha-256',
        '--encoding=UTF8',
        '--no-locale',
      ]);
      run(path.join(bin, 'pg_ctl'), [
        '-D',
        data,
        '-l',
        path.join(root, 'postgres.log'),
        '-o',
        `-p 56541 -k ${socket} -c listen_addresses=127.0.0.1 -c ssl=on -c ssl_cert_file=${root}/server.crt -c ssl_key_file=${root}/server.key`,
        '-w',
        'start',
      ]);
      started = true;
      const password = 'local_' + crypto.randomUUID().replaceAll('-', '');
      run(
        path.join(bin, 'psql'),
        [
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-h',
          socket,
          '-p',
          '56541',
          '-U',
          'postgres',
          '-d',
          'postgres',
        ],
        { input: `ALTER ROLE postgres PASSWORD '${password}';` },
      );
      const env = secret(
        'admin.env',
        `DATABASE_URL=postgresql://postgres:${password}@127.0.0.1:56541/not_used_as_management\n`,
      );
      const pin = JSON.parse(
        fs.readFileSync('docs/v2/candidates/openmaic-130/pin-pg18.json'),
      ).sha256;
      const c = {
        kind: 'ZHIBAN_RDS_PG18_DEPLOYMENT_INPUT_V1',
        origin: 'https://127.0.0.1:88',
        expectedHost: '127.0.0.1',
        port: 56541,
        maintenanceDatabase: 'postgres',
        databases: {
          business: 'zhiban_business',
          content: 'zhiban_content',
          authoring: 'zhiban_authoring',
        },
        adminEnvFile: env,
        caFile: path.join(root, 'server.crt'),
        expectedReferenceSha256: pin,
      };
      const config = secret('config.json', JSON.stringify(c));
      const p = rds.plan(config);
      assert.equal(p.executesDdl, false);
      assert.equal(JSON.stringify(p).includes(password), false);
      const f = await rds.preflight(config);
      assert.equal(f.status, 'READ_ONLY_PREFLIGHT_PASS');
      assert.equal(f.tlsVerified, true);
      assert.equal(f.productionReady, false);
      assert.equal(f.mutated, false);
      assert.deepEqual(f.existingDedicatedDatabases, []);
      const out = path.join(root, 'stage');
      assert.throws(() => rds.stage(config, out, '0'.repeat(64)), /pin/);
      assert.equal(fs.existsSync(out), false);
      const staged = rds.stage(config, out, p.planSha256);
      assert.equal(staged.credentialsCopied, false);
      assert.equal(staged.executesDdl, false);
      assert.throws(() => rds.stage(config, out, p.planSha256), /exists/);
      const missing = secret(
        'missing.json',
        JSON.stringify({ ...c, maintenanceDatabase: 'absent_management' }),
      );
      await assert.rejects(rds.preflight(missing), (e) => e.code === '3D000');
      const badOrigin = secret(
        'http.json',
        JSON.stringify({ ...c, origin: 'http://127.0.0.1:88' }),
      );
      assert.throws(() => rds.plan(badOrigin), /HTTPS/);
      const badTargets = secret(
        'targets.json',
        JSON.stringify({ ...c, databases: { ...c.databases, business: 'openmaic' } }),
      );
      assert.throws(() => rds.plan(badTargets), /dedicated/);
      const wrongPin = secret(
        'pin.json',
        JSON.stringify({ ...c, expectedReferenceSha256: '0'.repeat(64) }),
      );
      assert.throws(() => rds.plan(wrongPin), /pin/);
      const badUrl = secret(
        'insecure.env',
        `DATABASE_URL=postgresql://postgres:${password}@127.0.0.1:56541/postgres?sslmode=disable\n`,
      );
      const insecure = secret('insecure.json', JSON.stringify({ ...c, adminEnvFile: badUrl }));
      assert.throws(() => rds.plan(insecure), /query overrides/);
      run('openssl', [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        path.join(root, 'wrong.key'),
        '-out',
        path.join(root, 'wrong.crt'),
        '-days',
        '1',
        '-subj',
        '/CN=Untrusted',
      ]);
      fs.chmodSync(path.join(root, 'wrong.crt'), 0o600);
      const wrongCa = secret(
        'wrong-ca.json',
        JSON.stringify({ ...c, caFile: path.join(root, 'wrong.crt') }),
      );
      await assert.rejects(rds.preflight(wrongCa));
      const after = await rds.preflight(config);
      assert.deepEqual(after.existingDedicatedDatabases, []);
      assert.deepEqual(after.existingZhibanRoles, []);
      assert.equal(after.canonicalRolePreparation.status, 'PRIVILEGED_BOOTSTRAP_REQUIRED');
      const local = ['-X', '-v', 'ON_ERROR_STOP=1', '-h', socket, '-p', '56541', '-d', 'postgres'];
      run(path.join(bin, 'psql'), [...local, '-U', 'postgres'], {
        input: `CREATE ROLE rds_creator LOGIN CREATEDB CREATEROLE NOINHERIT NOSUPERUSER PASSWORD '${password}';`,
      });
      run(path.join(bin, 'psql'), [...local, '-U', 'rds_creator'], {
        input: 'CREATE ROLE zhiban_probe_owner NOLOGIN NOINHERIT;',
      });
      const restrictedEnv = secret(
        'restricted.env',
        `DATABASE_URL=postgresql://rds_creator:${password}@127.0.0.1:56541/postgres\n`,
      );
      const restricted = secret(
        'restricted.json',
        JSON.stringify({ ...c, adminEnvFile: restrictedEnv }),
      );
      const observed = await rds.preflight(restricted);
      assert.equal(observed.canCreateDatabases, true);
      assert.equal(observed.canCreateRoles, true);
      assert.equal(observed.canCreateDedicatedObjects, false);
      assert.equal(
        observed.canonicalRolePreparation.status,
        'BLOCKED_NEEDS_PRIVILEGED_ROLE_PREPARATION',
      );
      assert.ok(
        observed.canonicalRolePreparation.unexpectedEdges.some(
          (e) => e.role === 'zhiban_probe_owner' && e.member === 'rds_creator' && e.admin_option,
        ),
      );
      assert.equal(observed.mutated, false);
    } finally {
      if (started) run(path.join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
