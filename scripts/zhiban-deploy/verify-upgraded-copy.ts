/** LOCAL migrated-copy recovery: exact stable rows, original accounts and actual HTTPS role logins. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { request } from 'node:https';
import { Pool } from 'pg';
import { chromium } from '@playwright/test';
import { trustedDevelopmentCa } from '../zhiban-local/config';
import { privateEntry } from '../zhiban-local/persistent-snapshot';
const hash = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
async function main() {
  const [action, state, baseline, out] = process.argv.slice(2);
  assert.ok(['capture', 'compare'].includes(action) && state && baseline && out);
  await privateEntry(state, true);
  const upgrade = JSON.parse(await readFile(join(state, 'UPGRADE.json'), 'utf8'));
  const m = JSON.parse(
    await readFile('docs/v2/evidence/zhiban-trial-content-demo-local.json', 'utf8'),
  );
  assert.equal(m.status, 'RUNNING_LOCAL_PERSISTENT');
  assert.equal(m.root, upgrade.workingRoot);
  assert.equal(m.contentInstallation.provider.storage, '0.38.1');
  assert.equal(m.origin, 'https://127.0.0.1:3461');
  const accountsBytes = await readFile(m.accountsPath),
    accounts = JSON.parse(accountsBytes.toString());
  assert.equal(hash(accountsBytes), upgrade.accountsSha256);
  const facts: Record<string, unknown> = { accountsSha256: hash(accountsBytes) };
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
      connectionTimeoutMillis: 3000,
    });
    try {
      const rows: Record<string, unknown> = {};
      const tables = (
        await p.query(
          "SELECT schemaname,tablename FROM pg_tables WHERE schemaname !~ '^pg_' AND schemaname NOT IN ('information_schema','zhiban_identity') ORDER BY 1,2",
        )
      ).rows;
      for (const t of tables) {
        const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
        const data = (
          await p.query(
            `SELECT row_to_json(t)::text AS v FROM ${q(t.schemaname)}.${q(t.tablename)} t ORDER BY 1`,
          )
        ).rows;
        rows[t.schemaname + '.' + t.tablename] = {
          count: data.length,
          sha256: hash(JSON.stringify(data)),
        };
      }
      facts[database] = rows;
    } finally {
      await p.end();
    }
  }
  if (action === 'capture')
    await writeFile(baseline, JSON.stringify(facts), { mode: 0o600, flag: 'wx' });
  else {
    await privateEntry(baseline);
    assert.deepEqual(facts, JSON.parse(await readFile(baseline, 'utf8')));
  }
  const ca = await trustedDevelopmentCa();
  const call = (url: string, body?: unknown, cookie?: string) =>
    new Promise<{ status: number; cookie: string; bytes: Buffer }>((done, reject) => {
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
          const chunks: Buffer[] = [];
          res.on('data', (b) => chunks.push(b));
          res.on('end', () =>
            done({
              status: res.statusCode!,
              cookie: res.headers['set-cookie']?.[0]?.split(';')[0] ?? '',
              bytes: Buffer.concat(chunks),
            }),
          );
        },
      );
      r.on('error', reject);
      r.setTimeout(10000, () => r.destroy(Error('Readback timeout')));
      r.end(body ? JSON.stringify(body) : undefined);
    });
  const roles: string[] = [];
  let historicalPublicationsRead = 0;
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
    roles.push(a.role);
    if (a.role === 'TEACHER' || a.role === 'STUDENT') {
      const base = `/api/zhiban/content/${m.trial.tenantId}/offerings/${m.trial.offeringId}`;
      const listing = await call(base, undefined, login.cookie);
      assert.equal(listing.status, 200);
      const resources = JSON.parse(listing.bytes.toString())
        .resources.filter((r: { publication?: unknown }) => r.publication)
        .slice(0, 2);
      assert.ok(resources.length > 0, 'Existing course has no readable historical publication');
      for (const resource of resources) {
        const preview = await call(
          `${base}/resources/${resource.id}/preview?source=published`,
          undefined,
          login.cookie,
        );
        assert.equal(preview.status, 200, 'Historical publication no longer reads');
        assert.equal(JSON.parse(preview.bytes.toString()).publicationId, resource.publication.id);
        historicalPublicationsRead++;
      }
    }
  }
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(m.origin + '/zhiban');
    assert.equal(await page.getByLabel('账号 ID 或 @登录标识').count(), 1);
    await page.close();
  } finally {
    await browser.close();
  }
  const result = {
    status: 'PASS',
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    action,
    sourceSnapshotManifestSha256: upgrade.sourceManifestSha256,
    accountsSha256: hash(accountsBytes),
    dataSha256: hash(JSON.stringify(facts)),
    roles,
    scope:
      'MIGRATED_COPY_THREE_DATABASE_STABLE_ROW_HASHES_AND_REAL_LOGIN_WORKSPACE_NOT_FULL_CLASSROOM',
    realModelCalled: false,
    historicalPublicationsRead,
  };
  await writeFile(out, JSON.stringify(result, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify(result));
}
void main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
