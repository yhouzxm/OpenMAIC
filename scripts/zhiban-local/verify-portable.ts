/** Local install/restore acceptance. Never emits credentials or row contents. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { request } from 'node:https';
import { Pool } from 'pg';
import { chromium } from '@playwright/test';
import { trustedDevelopmentCa } from './config';
import { privateEntry } from './persistent-snapshot';
const hash = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
async function capture() {
  const m = JSON.parse(
    await readFile('docs/v2/evidence/zhiban-trial-content-demo-local.json', 'utf8'),
  );
  assert.equal(m.status, 'RUNNING_LOCAL_PERSISTENT');
  assert.equal(m.evidenceOrigin, 'LOCAL');
  assert.equal(m.githubActions, false);
  assert.equal(m.origin, 'https://127.0.0.1:3461');
  assert.equal(m.port, 56517);
  assert.match(m.root, /^\/tmp\/zhiban-trial-content-[a-zA-Z0-9]+$/);
  await privateEntry(m.accountsPath);
  const accountsHash = hash(await readFile(m.accountsPath));
  const databases: Record<string, Record<string, { rows: number; hash: string }>> = {};
  for (const database of [
    'zhiban_trial_content_disposable',
    'zhiban_trial_content_native',
    'zhiban_trial_lesson_native',
  ]) {
    const pool = new Pool({
      host: join(m.root, 'socket'),
      port: 56517,
      user: 'postgres',
      database,
      max: 1,
    });
    try {
      const target = (
        await pool.query(
          "SELECT current_setting('data_directory') AS dir,current_setting('listen_addresses') AS tcp,current_setting('server_version_num') AS version",
        )
      ).rows[0];
      assert.equal(target.dir, join(m.root, 'data'));
      assert.equal(target.tcp, '');
      assert.match(target.version, /^16\d{4}$/);
      const tables = (
        await pool.query(
          "SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema','zhiban_identity') ORDER BY 1,2",
        )
      ).rows;
      const counts: Record<string, { rows: number; hash: string }> = {};
      for (const t of tables) {
        assert.match(t.schemaname, /^[a-zA-Z0-9_]+$/);
        assert.match(t.tablename, /^[a-zA-Z0-9_]+$/);
        const rows = (
          await pool.query(
            `SELECT to_jsonb(t)::text AS v FROM "${t.schemaname}"."${t.tablename}" t ORDER BY 1`,
          )
        ).rows;
        counts[t.schemaname + '.' + t.tablename] = {
          rows: rows.length,
          hash: hash(JSON.stringify(rows.map((r) => r.v))),
        };
      }
      databases[database] = counts;
    } finally {
      await pool.end();
    }
  }
  return { accountsHash, databases };
}
async function main() {
  const [mode, baseline, output] = process.argv.slice(2);
  assert.ok(['capture', 'compare'].includes(mode) && baseline && (mode === 'capture' || output));
  const actual = await capture();
  if (mode === 'capture') {
    await writeFile(baseline, JSON.stringify(actual), { mode: 0o600, flag: 'wx' });
    console.log('Captured private account and three-database row fingerprints');
    return;
  }
  await privateEntry(baseline);
  assert.deepEqual(actual, JSON.parse(await readFile(baseline, 'utf8')));
  const m = JSON.parse(
    await readFile('docs/v2/evidence/zhiban-trial-content-demo-local.json', 'utf8'),
  );
  const ca = await trustedDevelopmentCa();
  const accounts = JSON.parse(await readFile(m.accountsPath, 'utf8'));
  const checks = [
    'Identical account file and every non-Identity business/Native table row fingerprint across three databases',
    'PG16 private socket, exact data directory and TCP disabled',
  ];
  function call(url: string, body?: unknown, cookie?: string) {
    return new Promise<{ status: number; cookie: string }>((done, reject) => {
      const r = request(
        m.origin + url,
        {
          ca,
          method: body ? 'POST' : 'GET',
          headers: {
            'x-zhiban-request': 'identity-v1',
            ...(cookie ? { cookie } : {}),
            ...(body ? { 'content-type': 'application/json', origin: m.origin } : {}),
          },
        },
        (res) => {
          res.resume();
          res.on('end', () =>
            done({
              status: res.statusCode!,
              cookie: res.headers['set-cookie']?.[0]?.split(';')[0] ?? '',
            }),
          );
        },
      );
      r.on('error', reject);
      r.setTimeout(10000, () => r.destroy(Error('HTTPS timeout')));
      r.end(body ? JSON.stringify(body) : undefined);
    });
  }
  for (const a of accounts.accounts.slice(0, 3)) {
    const login = await call('/api/zhiban/identity/login', {
      userId: a.userId,
      password: a.password,
    });
    assert.equal(login.status, 200);
    assert.equal(
      (await call('/zhiban?space=' + m.trial.tenantId, undefined, login.cookie)).status,
      200,
    );
    checks.push('Original ' + a.role + ' login and workspace over certificate-verified HTTPS');
  }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(m.origin + '/zhiban');
    assert.ok(await page.getByLabel('账号 ID 或 @登录标识').count());
    checks.push('Browser trusted HTTPS login page renders');
  } finally {
    await browser.close();
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        at: new Date().toISOString(),
        workspace: process.cwd(),
        checks,
        accountsHash: actual.accountsHash,
        tables: Object.values(actual.databases).reduce((n, v) => n + Object.keys(v).length, 0),
        rows: Object.values(actual.databases)
          .flatMap((v) => Object.values(v))
          .reduce((n, v) => n + v.rows, 0),
        sourceHashes: m.sourceHashes,
        scope: 'SAME_HOST_DIFFERENT_WORKSPACE_AND_PRIVATE_STATE_SAME_INTERNAL_PG_ROOT',
        crossMachine: 'NOT_TESTED',
        fullClassroomRetest: false,
        modelRetest: false,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  console.log(
    'PASS independent workspace restore, all data fingerprints, original accounts and trusted HTTPS',
  );
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Portable verification failed');
  process.exitCode = 1;
});
