#!/usr/bin/env node
// Dedicated disposable PG16 lifecycle acceptance; no real config/credentials or migrations.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const c = require('./observer-contract.cjs'),
  e = require('./observer-executor.cjs');
const checks = [],
  bin = c.bin,
  root = fs.mkdtempSync('/tmp/zhiban-observer-pg16-');
fs.chmodSync(root, 0o700);
const data = path.join(root, 'data'),
  bootstrapSocket = path.join(root, 'bootstrap'),
  auth = path.join(root, 'auth');
fs.mkdirSync(bootstrapSocket, { mode: 0o700 });
fs.mkdirSync(auth, { mode: 0o700 });
const password = crypto.randomBytes(32).toString('hex'),
  keys = crypto.generateKeyPairSync('ed25519');
const publicPath = path.join(auth, 'review.pub');
c.writeNew(publicPath, keys.publicKey.export({ type: 'spki', format: 'pem' }));
const pin = c.sha(keys.publicKey.export({ type: 'spki', format: 'der' }));
const binHashes = Object.fromEntries(
  ['postgres', 'pg_ctl', 'psql', 'pg_controldata'].map((n) => [
    n,
    c.sha(fs.readFileSync(path.join(bin, n))),
  ]),
);
binHashes.node = c.sha(fs.readFileSync(process.execPath));
let counter = 0,
  systemIdentifier,
  baseline,
  fixturePid,
  children = [];
const safeEnv = e.environment();
function shell(file, args, options = {}) {
  return execFileSync(file, args, {
    env: safeEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 35000,
    ...options,
  }).toString();
}
function pid() {
  if (!fs.existsSync(path.join(data, 'postmaster.pid'))) return null;
  return Number(fs.readFileSync(path.join(data, 'postmaster.pid'), 'utf8').split('\n')[0]);
}
async function test(name, f) {
  const start = Date.now();
  const details = await f();
  checks.push({ name, status: 'PASS', elapsedMs: Date.now() - start, ...details });
  console.log('PASS ' + name);
}
function request(overrides = {}) {
  const id = 'fixture_' + String(++counter).padStart(4, '0'),
    control = path.join(root, 'c' + counter),
    stage = path.join(control, 'observe-' + id);
  fs.mkdirSync(control, { mode: 0o700 });
  c.writeNew(path.join(control, 'maintenance.lock'), '');
  c.writeNew(
    path.join(control, 'maintenance.json'),
    JSON.stringify({ status: 'BLOCKED_UNTIL_CLOSED', testOnly: true }) + '\n',
  );
  const passPath = path.join(auth, 'pass-' + counter);
  c.writeNew(
    passPath,
    path.join(stage, 'socket') +
      ':56497:postgres:postgres:' +
      (overrides.wrongPassword ? crypto.randomBytes(32).toString('hex') : password) +
      '\n',
  );
  const stat = fs.statSync(path.join(control, 'maintenance.lock'));
  const closure = ['postgresql.conf', 'postgresql.auto.conf'].map((n) => ({
    path: path.join(data, n),
    sha256: c.sha(fs.readFileSync(path.join(data, n))),
  }));
  const v = {
    formatVersion: 1,
    purpose: 'LOCAL_MANAGEMENT_READONLY_OBSERVATION',
    status: 'ISSUED',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    humanAuthorizationRef: 'LOCAL_DISPOSABLE_FIXTURE_ONLY',
    approvalId: id,
    attemptId: id,
    issuedAt: Date.now() - 1000,
    expiresAt: Date.now() + 290000,
    source: c.sources(),
    target: {
      environment: 'LOCAL_DISPOSABLE',
      dataDirectory: data,
      systemIdentifier,
      port: 56497,
      uid: process.getuid(),
    },
    paths: {
      controlDirectory: control,
      stageDirectory: stage,
      pgpassFilePath: passPath,
      authenticationStageDirectory: path.join(auth, 'observe-auth-' + id),
    },
    hashes: {
      guardSha256: c.sha(fs.readFileSync(path.join(control, 'maintenance.json'))),
      pgpassSha256: c.sha(fs.readFileSync(passPath)),
      configurationClosureSha256: c.sha(Buffer.from(c.canonical(closure))),
    },
    lock: { device: stat.dev, inode: stat.ino },
    configurationClosure: closure,
    binarySha256: binHashes,
    expectedStartArgumentsSha256: '0'.repeat(64),
    scope: {
      managementReadOnly: true,
      internalLifecycleWrites: true,
      privateAuthenticationStaging: true,
      businessWrites: false,
      launch: false,
      clear: false,
      receiptIssuance: false,
      credentialMutation: false,
      persistentConfigurationMutation: false,
    },
  };
  v.expectedStartArgumentsSha256 = c.sha(Buffer.from(c.canonical(c.argumentsFor(v))));
  return { v, control, stage, passPath };
}
function signed(s, mutate = () => {}) {
  mutate(s.v);
  const file = path.join(
    auth,
    'approval-' + counter + '-' + crypto.randomBytes(3).toString('hex') + '.json',
  );
  c.writeNew(
    file,
    JSON.stringify({
      payload: s.v,
      signature: crypto
        .sign(null, Buffer.from(c.canonical(s.v)), keys.privateKey)
        .toString('base64'),
    }) + '\n',
  );
  return file;
}
async function execute(
  s,
  {
    mode = null,
    mutate,
    corruptSignature = false,
    signal = null,
    onCut = null,
    onResident = null,
  } = {},
) {
  const file = signed(s, mutate);
  if (corruptSignature) {
    const json = JSON.parse(fs.readFileSync(file));
    json.signature = 'AAAA';
    fs.writeFileSync(file, JSON.stringify(json));
  }
  const args = mode
    ? [path.join(__dirname, 'observer-test-driver.cjs'), file, publicPath, pin, mode]
    : [path.join(__dirname, 'observer-cli.cjs'), 'observe', file, publicPath, pin];
  const child = spawn(process.execPath, args, {
    env: safeEnv,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  children.push(child);
  let out = '',
    err = '';
  child.stdout.on('data', (b) => (out += b));
  let residentObserved = null,
    residentHandled = false;
  child.stdout.on('data', () => {
    if (!onResident || residentHandled) return;
    for (const line of out.split('\n').filter(Boolean)) {
      let result;
      try {
        result = JSON.parse(line);
      } catch {
        continue;
      }
      if (result.releaseState === 'PARENT_CUSTODY_HELD') {
        residentHandled = true;
        Promise.resolve()
          .then(() => onResident(child, result))
          .then((v) => {
            residentObserved = v;
            child.kill('SIGKILL');
          })
          .catch((e) => {
            cutError = e;
            child.kill('SIGKILL');
          });
        break;
      }
    }
  });
  child.stderr.on('data', (b) => (err += b));
  let cut,
    cutError,
    initPauseApplied = false;
  child.on('message', (m) => {
    if (m.type === 'pg-initialization-paused') initPauseApplied = true;
    if (m.type === 'cut') {
      cut = m.state;
      if (onCut) {
        try {
          onCut(child);
          child.kill('SIGCONT');
        } catch (error) {
          cutError = error;
          child.kill('SIGKILL');
        }
      } else {
        child.kill(signal || 'SIGKILL');
        if (signal === 'SIGTERM') child.kill('SIGCONT');
      }
    }
  });
  const closed = await new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Error('FIXTURE_CHILD_TIMEOUT'));
    }, 45000);
    child.once('close', (code, signal) => {
      clearTimeout(t);
      resolve({ code, signal });
    });
  });
  if (cutError) throw cutError;
  assert.equal(err, '');
  const lines = out.trim().split('\n').filter(Boolean);
  const result = lines.length ? JSON.parse(lines.at(-1)) : null;
  return {
    ...closed,
    cut,
    initPauseApplied,
    residentObserved,
    result,
    approvalPath: file,
  };
}
function lockBusy(s) {
  const fd = fs.openSync(path.join(s.control, 'maintenance.lock'), 'r+');
  try {
    try {
      execFileSync('/usr/bin/flock', ['-n', '-x', '3'], {
        stdio: ['ignore', 'ignore', 'ignore', fd],
      });
      return false;
    } catch {
      return true;
    }
  } finally {
    fs.closeSync(fd);
  }
}
function unchanged() {
  for (const [n, h] of Object.entries(baseline))
    assert.equal(c.sha(fs.readFileSync(path.join(data, n))), h, n);
}
async function cleanUnknown(s) {
  assert.match(data, /^\/tmp\/zhiban-observer-pg16-[A-Za-z0-9_-]+\/data$/);
  // Test-only restoration of this disposable pid metadata, never a recovery API.
  if (pid()) {
    const original = path.join(s.stage, 'postmaster.json');
    if (fs.existsSync(original)) {
      const tuple = JSON.parse(fs.readFileSync(original)),
        lines = fs.readFileSync(path.join(data, 'postmaster.pid'), 'utf8').split('\n');
      assert.equal(Number(lines[0]), tuple.pid);
      lines[4] = tuple.socket;
      fs.writeFileSync(path.join(data, 'postmaster.pid'), lines.join('\n'));
    }
    shell(path.join(bin, 'pg_ctl'), ['stop', '-D', data, '-m', 'fast', '-w', '-t', '10']);
  }
  const gp = path.join(s.stage, 'guardian.json');
  if (fs.existsSync(gp)) {
    const g = JSON.parse(fs.readFileSync(gp));
    try {
      const ticks = fs
        .readFileSync('/proc/' + g.pid + '/stat', 'utf8')
        .split(') ')[1]
        .split(' ')[19];
      assert.equal(ticks, g.startTicks);
      process.kill(g.pid, 'SIGKILL');
    } catch (err) {
      if (err.code !== 'ENOENT' && err.code !== 'ESRCH') throw err;
    }
  }
  for (let n = 0; n < 30 && lockBusy(s); n++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(lockBusy(s), false);
  assert.equal(pid(), null);
  unchanged();
}
(async () => {
  let proof;
  try {
    const pw = path.join(auth, 'initdb-password');
    c.writeNew(pw, password + '\n');
    shell(path.join(bin, 'initdb'), [
      '-D',
      data,
      '-U',
      'postgres',
      '--auth-local=scram-sha-256',
      '--auth-host=scram-sha-256',
      '--pwfile',
      pw,
      '--no-locale',
    ]);
    systemIdentifier = shell(path.join(bin, 'pg_controldata'), [data]).match(
      /Database system identifier:\s*(\d+)/,
    )[1];
    const bootstrapPass = path.join(auth, 'bootstrap-pass');
    c.writeNew(
      bootstrapPass,
      ['postgres', 'zhiban_m1_dev', 'zhiban_m5_native']
        .map((db) => bootstrapSocket + ':56497:' + db + ':postgres:' + password)
        .join('\n') + '\n',
    );
    shell(path.join(bin, 'pg_ctl'), [
      'start',
      '-D',
      data,
      '-l',
      path.join(root, 'bootstrap.log'),
      '-w',
      '-t',
      '10',
      '-o',
      "-k '" + bootstrapSocket + "' -h '' -p 56497",
    ]);
    fixturePid = pid();
    const sql = (database, text) =>
      shell(
        path.join(bin, 'psql'),
        [
          '-X',
          '-w',
          '-v',
          'ON_ERROR_STOP=1',
          '-A',
          '-t',
          '-h',
          bootstrapSocket,
          '-p',
          '56497',
          '-U',
          'postgres',
          '-d',
          database,
          '-c',
          text,
        ],
        { env: { ...safeEnv, PGPASSFILE: bootstrapPass } },
      );
    sql('postgres', 'CREATE DATABASE zhiban_m1_dev');
    sql('postgres', 'CREATE DATABASE zhiban_m5_native');
    sql(
      'zhiban_m1_dev',
      "CREATE TABLE sentinel(id integer primary key, value text); INSERT INTO sentinel VALUES (1,'unchanged');",
    );
    sql(
      'zhiban_m5_native',
      "CREATE TABLE sentinel(id integer primary key, value text); INSERT INTO sentinel VALUES (1,'native-unchanged');",
    );
    shell(path.join(bin, 'pg_ctl'), ['stop', '-D', data, '-m', 'fast', '-w', '-t', '10']);
    baseline = Object.fromEntries(
      ['postgresql.conf', 'postgresql.auto.conf', 'pg_hba.conf', 'pg_ident.conf'].map((n) => [
        n,
        c.sha(fs.readFileSync(path.join(data, n))),
      ]),
    );
    await test('normal actual SCRAM management observation stops and preserves original configuration', async () => {
      const s = request(),
        r = await execute(s);
      assert.equal(r.result.status, 'OBSERVED_STOP_CONFIRMED', r.result.code);
      assert.equal(pid(), null);
      assert.equal(lockBusy(s), false);
      unchanged();
      const o = JSON.parse(fs.readFileSync(path.join(s.stage, 'observation.json')));
      assert.equal(o.rows.length, 5);
      assert.equal(o.rows[0].transactionReadOnly, 'on');
      assert.equal(o.rows[0].listenAddresses, '');
      assert.equal(o.rows[1].values.length, 2);
      assert.equal(r.result.runtimeAccepted, false);
      assert.equal(r.result.releaseState, 'RELEASE_CONFIRMED');
      assert.equal(r.result.stopConfirmed, true);
      assert(!fs.existsSync(s.v.paths.authenticationStageDirectory));
      assert.equal(c.sha(fs.readFileSync(s.passPath)), s.v.hashes.pgpassSha256);
    });
    await test('actual delayed initialization keeps distinct PID-file and SQL start facts without weakening process binding', async () => {
      const s = request(),
        r = await execute(s, { mode: 'slow-pg-initialization' });
      assert.equal(r.initPauseApplied, true);
      assert.equal(r.result.status, 'OBSERVED_STOP_CONFIRMED', r.result.code);
      const o = JSON.parse(fs.readFileSync(path.join(s.stage, 'observation.json')));
      const delta =
        Date.parse(o.rows[0].postmasterStart) / 1000 - Number(o.postmaster.pidFileStartSeconds);
      assert(delta >= 1);
      assert.equal(pid(), null);
      assert.equal(lockBusy(s), false);
      unchanged();
      return { deltaSeconds: delta };
    });
    await test('wrong scoped SCRAM credential fails without fallback and stops exact child', async () => {
      const s = request({ wrongPassword: true }),
        r = await execute(s);
      assert.equal(r.result.code, 'AUTHENTICATION_OR_READ_FAILED');
      assert.equal(r.result.status, 'FAILED_STOP_CONFIRMED');
      assert.equal(pid(), null);
      assert.equal(lockBusy(s), false);
      assert(!fs.existsSync(path.join(s.stage, 'observation.json')));
      unchanged();
    });
    await test('old staging scope is rejected before any secret snapshot or startup', async () => {
      const s = request(),
        r = await execute(s, {
          mutate: (v) => {
            v.scope.privateAuthenticationStaging = false;
          },
        });
      assert.equal(r.result.status, 'REJECTED');
      assert(!fs.existsSync(s.stage));
      assert(!fs.existsSync(s.v.paths.authenticationStageDirectory));
    });
    for (const mode of ['pgpass-before-read', 'pgpass-during-read', 'pgpass-after-read'])
      await test(mode + ' cannot accept unapproved source bytes or fallback', async () => {
        const s = request(),
          r = await execute(s, { mode });
        assert.equal(r.result.status, 'FAILED_STOP_CONFIRMED', r.result.code);
        assert.equal(r.result.code, 'PGPASS_DRIFT');
        assert.equal(r.result.stopConfirmed, true);
        assert.equal(r.result.releaseState, 'RELEASE_CONFIRMED');
        assert(!fs.existsSync(path.join(s.stage, 'observation.json')));
        assert(!fs.existsSync(s.v.paths.authenticationStageDirectory));
        assert.equal(pid(), null);
        assert.equal(lockBusy(s), false);
        if (mode !== 'pgpass-before-read') {
          const read = JSON.parse(fs.readFileSync(path.join(s.stage, 'read-tool.json')));
          assert.equal(read.code, 0);
          const snap = JSON.parse(fs.readFileSync(path.join(s.stage, 'auth-snapshot.json')));
          assert.equal(snap.sha256, s.v.hashes.pgpassSha256);
        }
      });
    await test('changed sealed snapshot stops PG and keeps verified guardian custody', async () => {
      const s = request(),
        r = await execute(s, { mode: 'snapshot-before-read' });
      assert.equal(r.result.code, 'AUTHENTICATION_SNAPSHOT_DRIFT');
      assert.equal(r.result.status, 'LIFECYCLE_UNKNOWN');
      assert.equal(r.result.stopConfirmed, true);
      assert.equal(r.result.lockRetainedByCustodian, true);
      assert.equal(lockBusy(s), true);
      assert.equal(pid(), null);
      assert(!fs.existsSync(path.join(s.stage, 'read-tool.json')));
      await cleanUnknown(s);
    });
    for (const [name, options] of [
      ['forged signature rejects before lifecycle', { corruptSignature: true }],
      [
        'expired authorization rejects before lifecycle',
        {
          mutate: (v) => {
            v.expiresAt = Date.now() - 1;
            v.issuedAt = v.expiresAt - 1000;
          },
        },
      ],
      [
        'wrong source authorization rejects before lifecycle',
        {
          mutate: (v) => {
            v.source.observerInventorySha256 = '0'.repeat(64);
          },
        },
      ],
      [
        'business write scope rejects before lifecycle',
        {
          mutate: (v) => {
            v.scope.businessWrites = true;
          },
        },
      ],
      [
        'real target cannot enter disposable alias',
        {
          mutate: (v) => {
            v.target.dataDirectory = '/home/zxm/.local/share/zhiban-m1/pgdata';
          },
        },
      ],
      [
        'unissued approval is not executable',
        {
          mutate: (v) => {
            v.status = 'UNISSUED_PLAN';
          },
        },
      ],
    ])
      await test(name, async () => {
        const s = request(),
          r = await execute(s, options);
        assert.equal(r.result.status, 'REJECTED');
        assert(!fs.existsSync(s.stage));
        assert.equal(pid(), null);
        assert.equal(lockBusy(s), false);
      });
    await test('existing shared lock blocks observer without creating stage or changing guard', async () => {
      const s = request(),
        fd = fs.openSync(path.join(s.control, 'maintenance.lock'), 'r+');
      execFileSync('/usr/bin/flock', ['-n', '-s', '3'], {
        stdio: ['ignore', 'ignore', 'ignore', fd],
      });
      try {
        const r = await execute(s);
        assert.equal(r.result.code, 'EXISTING_LOCK_BUSY_OR_INVALID');
        assert(!fs.existsSync(s.stage));
        assert.equal(pid(), null);
      } finally {
        fs.closeSync(fd);
      }
    });
    await test('missing lock is never created', async () => {
      const s = request();
      fs.unlinkSync(path.join(s.control, 'maintenance.lock'));
      const r = await execute(s);
      assert.equal(r.result.code, 'PRIVATE_PREFLIGHT_OR_LIFECYCLE_ERROR');
      assert(!fs.existsSync(path.join(s.control, 'maintenance.lock')));
      assert(!fs.existsSync(s.stage));
    });
    await test('approved nonempty auto.conf is rejected before startup hooks', async () => {
      const auto = path.join(data, 'postgresql.auto.conf'),
        original = fs.readFileSync(auto);
      fs.writeFileSync(auto, "shared_preload_libraries = 'not_a_real_library'\n");
      try {
        const s = request(),
          r = await execute(s);
        assert.equal(r.result.code, 'AUTO_CONFIGURATION_NOT_EMPTY');
        assert(!fs.existsSync(s.stage));
        assert.equal(pid(), null);
      } finally {
        fs.writeFileSync(auto, original);
      }
    });
    await test('binary hash drift rejects before stage/start', async () => {
      const s = request(),
        r = await execute(s, {
          mutate: (v) => {
            v.binarySha256 = { ...v.binarySha256, postgres: '0'.repeat(64) };
          },
        });
      assert.equal(r.result.code, 'BINARY_DRIFT');
      assert(!fs.existsSync(s.stage));
    });
    await test('wildcard password entry rejects before stage/start', async () => {
      const s = request();
      fs.writeFileSync(s.passPath, '*:56497:postgres:postgres:' + password + '\n');
      const r = await execute(s, {
        mutate: (v) => {
          v.hashes.pgpassSha256 = c.sha(fs.readFileSync(s.passPath));
        },
      });
      assert.equal(r.result.code, 'PGPASS_EXACT_ENTRY');
      assert(!fs.existsSync(s.stage));
    });
    await test('actual control identity mismatch rejects before stage/start', async () => {
      const s = request(),
        r = await execute(s, {
          mutate: (v) => {
            v.target.systemIdentifier = '1';
          },
        });
      assert.equal(r.result.code, 'CONTROL_TARGET_MISMATCH');
      assert(!fs.existsSync(s.stage));
    });
    for (const keyword of ['include_dir', 'include_if_exists'])
      await test(keyword + ' is rejected before startup', async () => {
        const file = path.join(data, 'postgresql.conf'),
          original = fs.readFileSync(file);
        fs.writeFileSync(file, original.toString() + '\n' + keyword + " = 'unreviewed-path'\n");
        try {
          const s = request(),
            r = await execute(s);
          assert.equal(r.result.code, 'UNSUPPORTED_CONFIG_INCLUDE');
          assert(!fs.existsSync(s.stage));
          assert.equal(pid(), null);
        } finally {
          fs.writeFileSync(file, original);
        }
      });
    for (const input of [
      "include = 'unlisted config.conf'",
      "include = 'unlisted#config.conf'",
      "include = 'escaped\\\\config.conf'",
    ])
      await test('unsupported include cannot fall through to generic GUC: ' + input, async () => {
        const file = path.join(data, 'postgresql.conf'),
          original = fs.readFileSync(file);
        fs.writeFileSync(file, original.toString() + '\n' + input + '\n');
        try {
          const s = request(),
            r = await execute(s);
          assert.equal(r.result.code, 'UNSUPPORTED_CONFIG_INCLUDE_SYNTAX');
          assert(!fs.existsSync(s.stage));
          assert.equal(pid(), null);
        } finally {
          fs.writeFileSync(file, original);
        }
      });
    await test('unlisted required include is never silently read', async () => {
      const file = path.join(data, 'postgresql.conf'),
        original = fs.readFileSync(file),
        extra = path.join(auth, 'required.conf');
      c.writeNew(extra, "work_mem = '8MB'\n");
      fs.writeFileSync(file, original.toString() + "\ninclude '" + extra + "'\n");
      try {
        const s = request(),
          r = await execute(s);
        assert.equal(r.result.code, 'CONFIG_CLOSURE_INCOMPLETE');
        assert(!fs.existsSync(s.stage));
        assert.equal(pid(), null);
      } finally {
        fs.writeFileSync(file, original);
      }
    });
    await test('explicitly approved include closure is bound and observed without persistence changes', async () => {
      const file = path.join(data, 'postgresql.conf'),
        original = fs.readFileSync(file),
        extra = path.join(auth, 'required.conf');
      fs.writeFileSync(file, original.toString() + "\ninclude '" + extra + "'\n");
      try {
        const s = request(),
          r = await execute(s, {
            mutate: (v) => {
              v.configurationClosure.push({ path: extra, sha256: c.sha(fs.readFileSync(extra)) });
              v.hashes.configurationClosureSha256 = c.sha(
                Buffer.from(c.canonical(v.configurationClosure)),
              );
            },
          });
        assert.equal(r.result.status, 'OBSERVED_STOP_CONFIRMED', r.result.code);
        assert.equal(pid(), null);
      } finally {
        fs.writeFileSync(file, original);
      }
      unchanged();
    });
    await test('existing postmaster is refused and never stopped', async () => {
      shell(path.join(bin, 'pg_ctl'), [
        'start',
        '-D',
        data,
        '-l',
        path.join(root, 'existing.log'),
        '-w',
        '-t',
        '10',
        '-o',
        "-k '" + bootstrapSocket + "' -h '' -p 56497",
      ]);
      const existing = pid();
      try {
        const s = request(),
          r = await execute(s);
        assert.equal(r.result.code, 'TARGET_NOT_CLEAN_STOPPED');
        assert.equal(r.result.status, 'REJECTED_BEFORE_START');
        assert.equal(r.result.stopConfirmed, false);
        assert.equal(pid(), existing);
        assert(!fs.existsSync(s.stage));
      } finally {
        shell(path.join(bin, 'pg_ctl'), ['stop', '-D', data, '-m', 'fast', '-w', '-t', '10']);
      }
    });
    await test('actual staged HBA rejects Business and Native connections', async () => {
      const s = request(),
        r = await execute(s, {
          mode: 'pause-start-bound',
          onCut: () => {
            for (const db of ['zhiban_m1_dev', 'zhiban_m5_native']) {
              let rejected = false;
              try {
                shell(
                  path.join(bin, 'psql'),
                  [
                    '-X',
                    '-w',
                    '-h',
                    path.join(s.stage, 'socket'),
                    '-p',
                    '56497',
                    '-U',
                    'postgres',
                    '-d',
                    db,
                    '-c',
                    'SELECT 1',
                  ],
                  { env: { ...safeEnv, PGPASSFILE: s.passPath } },
                );
              } catch (error) {
                rejected = /pg_hba.conf rejects connection/.test(error.stderr.toString());
              }
              assert(rejected);
            }
          },
        });
      assert.equal(r.result.status, 'OBSERVED_STOP_CONFIRMED', r.result.code);
    });
    await test('lost start ACK observes exact real postmaster and stops; never replays start', async () => {
      const s = request(),
        r = await execute(s, { mode: 'start-ack-lost' });
      assert.equal(r.result.startAckUnknown, true);
      assert.equal(r.result.status, 'FAILED_STOP_CONFIRMED');
      assert.equal(pid(), null);
      assert.equal(lockBusy(s), false);
      const j = fs.readFileSync(path.join(s.stage, 'journal.jsonl'), 'utf8');
      assert.equal(j.match(/START_INTENT/g).length, 1);
      assert(!fs.existsSync(path.join(s.stage, 'observation.json')));
    });
    await test('lost stop ACK independently confirms real shutdown without replay', async () => {
      const s = request(),
        r = await execute(s, { mode: 'stop-ack-lost' });
      assert.equal(r.result.status, 'OBSERVED_STOP_CONFIRMED', r.result.code);
      assert.equal(r.result.stopAckUnknown, true);
      assert.equal(pid(), null);
      assert.equal(lockBusy(s), false);
      assert.equal(
        fs.readFileSync(path.join(s.stage, 'journal.jsonl'), 'utf8').match(/STOP_REQUESTED/g)
          .length,
        1,
      );
    });
    await test('OR-01 lost release notification is resolved by bound authorization and actual exit', async () => {
      const s = request(),
        r = await execute(s, { mode: 'release-ack-lost' });
      assert.equal(r.result.status, 'OBSERVED_STOP_CONFIRMED', r.result.code);
      assert.equal(r.result.stopConfirmed, true);
      assert.equal(r.result.releaseAckUnknown, true);
      assert.equal(r.result.releaseState, 'RELEASE_CONFIRMED');
      assert.equal(r.result.lockRetained, false);
      assert.equal(lockBusy(s), false);
      assert.equal(pid(), null);
      assert(fs.existsSync(path.join(s.stage, 'guardian-release-authorized.json')));
      assert(fs.existsSync(path.join(s.stage, 'parent-release-authorized.json')));
    });
    await test('OR-02 positive short writes complete full UTF-8 audit before guardian departure', async () => {
      const s = request(),
        r = await execute(s, { mode: 'release-positive-short' });
      assert.equal(r.result.status, 'OBSERVED_STOP_CONFIRMED', r.result.code);
      assert.equal(e.inspect(s.stage).auditMalformed, false);
      const events = fs
        .readFileSync(path.join(s.stage, 'journal.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map(JSON.parse);
      assert(events.some((x) => x.testUnicode === '本地审计'));
      assert.equal(pid(), null);
      assert.equal(lockBusy(s), false);
    });
    for (const mode of ['release-zero', 'release-partial-enospc', 'release-fsync'])
      await test(
        mode + ' never authorizes departure and preserves stop fact and custody',
        async () => {
          const s = request(),
            r = await execute(s, { mode });
          assert.equal(r.result.status, 'LIFECYCLE_UNKNOWN');
          assert.equal(r.result.stopConfirmed, true);
          assert.equal(r.result.pgState, 'STOP_CONFIRMED');
          assert.equal(r.result.releaseState, 'CUSTODY_HELD');
          assert.equal(r.result.lockRetainedByCustodian, true);
          assert.equal(lockBusy(s), true);
          assert.equal(pid(), null);
          assert(!fs.existsSync(path.join(s.stage, 'guardian-release-authorized.json')));
          if (mode === 'release-partial-enospc')
            assert.equal(e.inspect(s.stage).auditMalformed, true);
          await cleanUnknown(s);
        },
      );
    for (const mode of ['release-missing-authorization', 'release-wrong-binding'])
      await test(mode + ' retains sole parent fd without claiming guardian custody', async () => {
        const s = request(),
          r = await execute(s, {
            mode,
            onResident: async (child, result) => {
              assert.equal(result.stopConfirmed, true);
              assert.equal(result.releaseState, 'PARENT_CUSTODY_HELD');
              assert.equal(result.lockRetainedByParent, true);
              assert.equal(result.lockRetainedByCustodian, false);
              assert.equal(lockBusy(s), true);
              assert.equal(pid(), null);
              child.kill('SIGTERM');
              await new Promise((r) => setTimeout(r, 100));
              assert.equal(child.exitCode, null);
              assert.equal(child.signalCode, null);
              assert.equal(lockBusy(s), true);
              return {
                parentActuallyHeld: true,
                sigtermRefused: true,
                testKillOnlyAfterPgStopped: true,
              };
            },
          });
        assert(r.residentObserved);
        assert.equal(r.signal, 'SIGKILL');
        assert.equal(lockBusy(s), false);
        await cleanUnknown(s);
        return r.residentObserved;
      });
    for (const mode of ['release-paused-after-authorization', 'release-zero-held-ack-lost'])
      await test(
        mode + ' cannot let an in-flight custodian drop the last fd after UNKNOWN',
        async () => {
          const s = request(),
            r = await execute(s, {
              mode,
              onResident: async (child, result) => {
                assert.equal(result.stopConfirmed, true);
                assert.equal(result.lockRetainedByParent, true);
                assert.equal(result.lockRetainedByCustodian, true);
                assert.equal(result.releaseState, 'PARENT_CUSTODY_HELD');
                assert.equal(lockBusy(s), true);
                assert.equal(pid(), null);
                if (mode === 'release-paused-after-authorization') {
                  assert(fs.existsSync(path.join(s.stage, 'guardian-release-authorized.json')));
                  process.kill(result.guardian.pid, 'SIGCONT');
                  for (let n = 0; n < 40; n++) {
                    if (!fs.existsSync('/proc/' + result.guardian.pid)) break;
                    await new Promise((r) => setTimeout(r, 25));
                  }
                  assert(!fs.existsSync('/proc/' + result.guardian.pid));
                  assert.equal(lockBusy(s), true);
                }
                child.kill('SIGTERM');
                await new Promise((r) => setTimeout(r, 100));
                assert.equal(child.exitCode, null);
                assert.equal(child.signalCode, null);
                assert.equal(lockBusy(s), true);
                return {
                  parentRetainedDuringUnknown: true,
                  authorizationAloneNeverReleased: mode === 'release-paused-after-authorization',
                  lateGuardianExitDidNotUnlock: mode === 'release-paused-after-authorization',
                  testKillOnlyAfterPgStopped: true,
                };
              },
            });
          assert(r.residentObserved);
          await cleanUnknown(s);
          return r.residentObserved;
        },
      );
    await test('result record failure after known release reports delivery unknown without false held lock', async () => {
      const s = request(),
        r = await execute(s, { mode: 'result-record-failure' });
      assert.equal(r.result.status, 'RELEASED_RESULT_UNKNOWN');
      assert.equal(r.result.stopConfirmed, true);
      assert.equal(r.result.releaseState, 'RELEASE_CONFIRMED');
      assert.equal(r.result.lockRetained, false);
      assert.equal(r.result.resultRecordUnknown, true);
      assert.equal(pid(), null);
      assert.equal(lockBusy(s), false);
      assert(fs.existsSync(path.join(s.stage, 'parent-release-authorized.json')));
      assert(!fs.existsSync(path.join(s.stage, 'result.json')));
    });
    await test('refused stop leaves actual PG alive and custodian lock held', async () => {
      const s = request(),
        r = await execute(s, { mode: 'stop-refused' });
      assert.equal(r.result.status, 'LIFECYCLE_UNKNOWN');
      assert.equal(r.result.lockRetained, true);
      assert(pid());
      assert.equal(lockBusy(s), true);
      assert.equal(e.inspect(s.stage).replayAllowed, false);
      await cleanUnknown(s);
    });
    await test('start tool failure without bound tuple is UNKNOWN and cannot release lock', async () => {
      const s = request(),
        r = await execute(s, { mode: 'start-refused' });
      assert.equal(r.result.status, 'LIFECYCLE_UNKNOWN');
      assert.equal(pid(), null);
      assert.equal(lockBusy(s), true);
      await cleanUnknown(s);
    });
    await test('changed postmaster tuple never triggers unbound stop', async () => {
      const s = request(),
        r = await execute(s, { mode: 'tuple-drift' });
      assert.equal(r.result.status, 'LIFECYCLE_UNKNOWN');
      assert(pid());
      assert.equal(lockBusy(s), true);
      assert(!fs.existsSync(path.join(s.stage, 'stop-tool.json')));
      await cleanUnknown(s);
    });
    await test('postmaster tuple drift after actual SQL rejects observation and preserves custody', async () => {
      const s = request(),
        r = await execute(s, { mode: 'tuple-drift-after-read' });
      assert.equal(r.result.status, 'LIFECYCLE_UNKNOWN');
      assert.equal(r.result.lockRetainedByCustodian, true);
      assert(pid());
      assert.equal(lockBusy(s), true);
      assert(!fs.existsSync(path.join(s.stage, 'observation.json')));
      assert(!fs.existsSync(path.join(s.stage, 'stop-tool.json')));
      await cleanUnknown(s);
    });
    await test('SIGTERM after start binding stops exact postmaster and releases lock', async () => {
      const s = request(),
        r = await execute(s, { mode: 'term-start-bound', signal: 'SIGTERM' });
      assert.equal(r.cut, 'START_BOUND');
      assert.equal(r.result.status, 'FAILED_STOP_CONFIRMED');
      assert.equal(r.result.code, 'ATTEMPT_ABORTED_OR_EXPIRED');
      assert.equal(pid(), null);
      assert.equal(lockBusy(s), false);
    });
    for (const mode of ['cut-start-intent', 'cut-start-bound', 'cut-start-bound-audit-fail'])
      await test('SIGKILL ' + mode + ' retains independent lock and BLOCKED guard', async () => {
        const s = request(),
          r = await execute(s, { mode });
        assert.equal(r.signal, 'SIGKILL');
        if (mode === 'cut-start-bound-audit-fail') {
          await new Promise((r) => setTimeout(r, 300));
          fs.chmodSync(path.join(s.stage, 'journal.jsonl'), 0o600);
        }
        assert.equal(lockBusy(s), true);
        assert.equal(
          c.sha(fs.readFileSync(path.join(s.control, 'maintenance.json'))),
          s.v.hashes.guardSha256,
        );
        const view = e.inspect(s.stage);
        assert.equal(view.launchAllowed, false);
        assert.equal(view.lockReleaseAllowed, false);
        if (mode !== 'cut-start-intent') assert(pid());
        await cleanUnknown(s);
      });
    await test('single-use approval and stage cannot be replayed', async () => {
      const s = request(),
        r = await execute(s);
      assert.equal(r.result.status, 'OBSERVED_STOP_CONFIRMED', r.result.code);
      const child = spawn(
        process.execPath,
        [path.join(__dirname, 'observer-cli.cjs'), 'observe', r.approvalPath, publicPath, pin],
        { env: safeEnv, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let out = '';
      child.stdout.on('data', (b) => (out += b));
      await new Promise((r) => child.once('close', r));
      assert.equal(JSON.parse(out).code, 'FRESH_STAGE');
      assert.equal(pid(), null);
    });
    // Test-only bootstrap read after all observers, proving no business/Native row changes.
    shell(path.join(bin, 'pg_ctl'), [
      'start',
      '-D',
      data,
      '-l',
      path.join(root, 'bootstrap-final.log'),
      '-w',
      '-t',
      '10',
      '-o',
      "-k '" + bootstrapSocket + "' -h '' -p 56497",
    ]);
    await test('business and Native sentinel rows remain unchanged', async () => {
      assert.equal(sql('zhiban_m1_dev', 'SELECT id,value FROM sentinel').trim(), '1|unchanged');
      assert.equal(
        sql('zhiban_m5_native', 'SELECT id,value FROM sentinel').trim(),
        '1|native-unchanged',
      );
    });
    shell(path.join(bin, 'pg_ctl'), ['stop', '-D', data, '-m', 'fast', '-w', '-t', '10']);
    unchanged();
    proof = {
      status: 'PASS',
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      ...c.sources(),
      checks,
      pgMajor: 16,
      postgresVersion: shell(path.join(bin, 'postgres'), ['--version']).trim(),
      nodeVersion: process.versions.node,
      port: 56497,
      target: 'UNIQUE_DISPOSABLE_PG16',
      actualScram: true,
      actualPostmaster: true,
      actualReadOnlyTransaction: true,
      actualCustodianFlock: true,
      faultToolAckAndStop: 'TEST_ADAPTER_ONLY',
      realTargetExecuted: false,
      realCredentialsRead: false,
      runtimeAccepted: false,
      launchAllowed: false,
      cleanup: 'PENDING_FINALLY',
    };
  } finally {
    for (const child of children)
      try {
        child.kill('SIGKILL');
      } catch {}
    if (fs.existsSync(path.join(data, 'postmaster.pid')))
      try {
        shell(path.join(bin, 'pg_ctl'), ['stop', '-D', data, '-m', 'fast', '-w', '-t', '10']);
      } catch {}
    for (const dir of fs.readdirSync(root).filter((x) => /^c\d+$/.test(x))) {
      const control = path.join(root, dir);
      for (const n of fs.readdirSync(control).filter((x) => x.startsWith('observe-'))) {
        const gp = path.join(control, n, 'guardian.json');
        if (fs.existsSync(gp)) {
          const g = JSON.parse(fs.readFileSync(gp));
          try {
            if (
              fs
                .readFileSync('/proc/' + g.pid + '/stat', 'utf8')
                .split(') ')[1]
                .split(' ')[19] === g.startTicks
            )
              process.kill(g.pid, 'SIGKILL');
          } catch {}
        }
      }
    }
    assert.equal(pid(), null, 'DISPOSABLE CLEANUP FAILED');
    fs.rmSync(root, { recursive: true, force: true });
  }
  assert(!fs.existsSync(root));
  proof.cleanup = 'CONFIRMED_STOPPED_AND_TEST_ROOT_REMOVED';
  const idx = process.argv.indexOf('--output');
  if (idx >= 0) fs.writeFileSync(process.argv[idx + 1], JSON.stringify(proof, null, 2) + '\n');
  console.log(
    JSON.stringify({
      status: 'PASS',
      checks: checks.length,
      cleanup: proof.cleanup,
      ...c.sources(),
    }),
  );
})().catch((error) => {
  console.error('FAIL ' + error.message);
  process.exitCode = 1;
});
