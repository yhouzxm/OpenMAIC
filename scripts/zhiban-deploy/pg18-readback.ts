/** PG18 deployment readback: private baselines, certificate-verified HTTPS, no provider calls. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { request } from 'node:https';
import { Pool } from 'pg';
import { privateEntry } from '../zhiban-local/persistent-snapshot';
import { executionEvidence, pg18Reference, pg18Origin } from '../zhiban-local/pg-version';
const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
async function main() {
  const [mode, baseline, output] = process.argv.slice(2);
  assert.ok(['capture', 'compare'].includes(mode) && baseline && output);
  const m = JSON.parse(await readFile('docs/v2/evidence/zhiban-pg18-demo-local.json', 'utf8'));
  assert.equal(m.postgresMajor, 18);
  assert.equal(m.stateRoot, process.env.ZHIBAN_LOCAL_STATE);
  assert.equal(m.origin, pg18Origin);
  assert.equal(m.status, 'RUNNING_LOCAL_PERSISTENT');
  assert.match(m.root, /^\/tmp\/zhiban-trial-content-[a-zA-Z0-9]+$/);
  assert.equal(m.accountsPath, join(m.root, 'accounts.json'));
  await privateEntry(m.accountsPath);
  const accountBytes = await readFile(m.accountsPath),
    accounts = JSON.parse(accountBytes.toString());
  const facts: Record<string, unknown> = { accounts: hash(accountBytes) };
  for (const database of [
    'zhiban_trial_content_disposable',
    'zhiban_trial_content_native',
    'zhiban_trial_lesson_native',
  ]) {
    const p = new Pool({
      host: join(m.root, 'socket'),
      port: 56517,
      user: 'postgres',
      database,
      max: 1,
      connectionTimeoutMillis: 1000,
    });
    try {
      const target = (
        await p.query(
          "SELECT current_setting('server_version_num') AS version,current_setting('data_directory') AS dir,current_setting('listen_addresses') AS tcp",
        )
      ).rows[0];
      assert.match(target.version, /^18\d{4}$/);
      assert.equal(target.dir, join(m.root, 'data'));
      assert.equal(target.tcp, '');
      const tables = (
        await p.query(
          "SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema','zhiban_identity') ORDER BY 1,2",
        )
      ).rows;
      const rows: Record<string, unknown> = {};
      for (const t of tables) {
        assert.match(t.schemaname, /^[a-zA-Z0-9_]+$/);
        assert.match(t.tablename, /^[a-zA-Z0-9_]+$/);
        const data = (
          await p.query(
            `SELECT to_jsonb(t)::text AS v FROM "${t.schemaname}"."${t.tablename}" t ORDER BY 1`,
          )
        ).rows;
        rows[t.schemaname + '.' + t.tablename] = {
          count: data.length,
          hash: hash(JSON.stringify(data)),
        };
      }
      facts[database] = rows;
    } finally {
      await p.end();
    }
  }
  if (mode === 'capture')
    await writeFile(baseline, JSON.stringify(facts), { mode: 0o600, flag: 'wx' });
  else {
    await privateEntry(baseline);
    assert.deepEqual(facts, JSON.parse(await readFile(baseline, 'utf8')));
  }
  const ca = await readFile(join(m.stateRoot, 'tls/development-ca.crt'));
  const call = (url: string, body?: unknown, cookie?: string) =>
    new Promise<{ status: number; cookie: string }>((resolve, reject) => {
      const r = request(
        m.origin + url,
        {
          ca,
          method: body ? 'POST' : 'GET',
          headers: {
            'x-zhiban-request': 'identity-v1',
            ...(body ? { 'content-type': 'application/json', origin: m.origin } : {}),
            ...(cookie ? { cookie } : {}),
          },
        },
        (res) => {
          res.resume();
          res.once('end', () =>
            resolve({
              status: res.statusCode!,
              cookie: res.headers['set-cookie']?.[0]?.split(';')[0] ?? '',
            }),
          );
        },
      );
      r.once('error', reject);
      r.setTimeout(10000, () => r.destroy(Error('HTTPS timeout')));
      r.end(body ? JSON.stringify(body) : undefined);
    });
  const roles: string[] = [];
  for (const role of ['ADMIN', 'TEACHER', 'STUDENT']) {
    const a = accounts.accounts.find(
      (a: { role: string; userId: string; password: string }) => a.role === role,
    );
    assert.ok(a);
    const l = await call('/api/zhiban/identity/login', { userId: a.userId, password: a.password });
    assert.equal(l.status, 200);
    assert.ok(l.cookie);
    assert.equal((await call('/api/zhiban/identity/spaces', undefined, l.cookie)).status, 200);
    assert.equal(
      (await call('/zhiban?space=' + m.trial.tenantId, undefined, l.cookie)).status,
      200,
    );
    roles.push(role);
  }
  await writeFile(
    output,
    JSON.stringify(
      {
        status: 'PASS',
        ...executionEvidence(),
        referenceSha256: (await pg18Reference()).manifestSha256,
        scope:
          mode === 'compare'
            ? 'PG18_PHYSICAL_RESTORE_SAME_BUSINESS_NATIVE_ROWS_AND_ACCOUNTS'
            : 'PG18_FRESH_INSTALL_BASELINE',
        roles,
        verifiedPrivateCa: true,
        providerCalls: false,
        identityEphemeraCompared: false,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  console.log('PASS PG18 ' + mode + ': three roles, private CA, three-database row fingerprints');
}
void main().catch(() => {
  console.error('PG18 readback rejected; private diagnostics retained');
  process.exitCode = 1;
});
