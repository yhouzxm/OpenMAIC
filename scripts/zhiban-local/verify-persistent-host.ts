/** Read-only product checks plus real Identity login; no generated data and no model calls. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:https';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { chromium } from '@playwright/test';
import { trustedDevelopmentCa } from './config';
import { inspectSnapshot, snapshotHome, privateEntry } from './persistent-snapshot';
import { join } from 'node:path';
async function main() {
  const m = JSON.parse(
    await readFile('docs/v2/evidence/zhiban-trial-content-demo-local.json', 'utf8'),
  );
  assert.equal(m.status, 'RUNNING_LOCAL_PERSISTENT');
  assert.equal(m.origin, 'https://127.0.0.1:3461');
  await privateEntry(m.accountsPath);
  const accountsBytes = await readFile(m.accountsPath);
  const accounts = JSON.parse(accountsBytes.toString());
  const ca = await trustedDevelopmentCa();
  const get = (path: string, cookie?: string, body?: unknown) =>
    new Promise<{ status: number; cookie: string; bytes: Buffer }>((done, reject) => {
      const r = request(
        m.origin + path,
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
      r.setTimeout(10000, () => r.destroy(Error('timeout')));
      r.end(body ? JSON.stringify(body) : undefined);
    });
  const checks: string[] = [];
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    for (const a of accounts.accounts.slice(0, 3)) {
      const login = await get('/api/zhiban/identity/login', undefined, {
        userId: a.userId,
        password: a.password,
      });
      assert.equal(login.status, 200);
      assert.equal((await get('/zhiban?space=' + m.trial.tenantId, login.cookie)).status, 200);
      checks.push('Existing ' + a.role + ' account login and workspace remain available');
    }
    const page = await browser.newPage();
    await page.goto(m.origin + '/zhiban');
    assert.ok(await page.getByLabel('账号 ID 或 @登录标识').count());
    checks.push('Trusted HTTPS browser login page renders');
    await page.close();
  } finally {
    await browser.close();
  }
  const counts: Record<string, unknown> = {};
  for (const db of [
    'zhiban_trial_content_disposable',
    'zhiban_trial_content_native',
    'zhiban_trial_lesson_native',
  ]) {
    const p = new Pool({
      host: join(m.root, 'socket'),
      port: 56517,
      user: 'postgres',
      database: db,
      max: 1,
    });
    try {
      const tables = (
        await p.query(
          "SELECT schemaname,tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY 1,2",
        )
      ).rows;
      const rowCounts: Record<string, number> = {};
      for (const t of tables) {
        assert.match(t.schemaname, /^[a-zA-Z0-9_]+$/);
        assert.match(t.tablename, /^[a-zA-Z0-9_]+$/);
        if (t.schemaname === 'zhiban_identity') continue;
        rowCounts[t.schemaname + '.' + t.tablename] = Number(
          (await p.query(`SELECT count(*) AS n FROM "${t.schemaname}"."${t.tablename}"`)).rows[0].n,
        );
      }
      counts[db] = rowCounts;
    } finally {
      await p.end();
    }
  }
  const pointer = JSON.parse(await readFile(join(snapshotHome, 'latest.json'), 'utf8'));
  await inspectSnapshot(pointer.path, pointer.manifestHash);
  await assert.rejects(inspectSnapshot(pointer.path, '0'.repeat(64)), /hash/);
  await assert.rejects(inspectSnapshot('/tmp/not-owned'), /location/);
  checks.push('Snapshot hash tamper and foreign path rejected');
  const evidence = {
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    status: 'PASS',
    at: new Date().toISOString(),
    accountsHash: createHash('sha256').update(accountsBytes).digest('hex'),
    root: m.root,
    sourceHashes: m.sourceHashes,
    checks,
    counts,
    scope: 'PERSISTENT_THREE_DATABASE_RESTORE_LOGIN_AND_WORKSPACE_NOT_FULL_CLASSROOM',
  };
  const suffix = process.argv.includes('--recovered')
    ? 'recovered'
    : process.argv.includes('--second')
      ? 'second'
      : 'first';
  if (suffix === 'second' || suffix === 'recovered') {
    const before = JSON.parse(
      await readFile('docs/v2/evidence/zhiban-persistent-first-local.json', 'utf8'),
    );
    assert.equal(evidence.accountsHash, before.accountsHash);
    if (suffix === 'second') assert.deepEqual(evidence.counts, before.counts);
    else {
      const stable = (v: Record<string, Record<string, number>>) =>
        Object.fromEntries(
          Object.entries(v).map(([db, tables]) => [
            db,
            Object.fromEntries(
              Object.entries(tables).filter(([name]) => !name.startsWith('zhiban_tutor.')),
            ),
          ]),
        );
      assert.deepEqual(
        stable(evidence.counts as Record<string, Record<string, number>>),
        stable(before.counts),
      );
      const p = new Pool({
        host: join(m.root, 'socket'),
        port: 56517,
        user: 'postgres',
        database: m.database,
        max: 1,
      });
      try {
        const peer = JSON.parse(await readFile('docs/v2/evidence/zhiban-peer-local.json', 'utf8'));
        const rows = (
          await p.query(
            "SELECT answer FROM zhiban_tutor.turns WHERE session_id=$1 AND state='COMPLETED'",
            [peer.sessionId],
          )
        ).rows;
        assert.ok(
          rows.some((r) => createHash('sha256').update(r.answer).digest('hex') === peer.answerHash),
        );
      } finally {
        await p.end();
      }
      checks.push(
        'Forced HTTPS process exit, owned PG stop/checkpoint/restart retains pre-existing classroom tables and actual companion answer',
      );
    }
    checks.push(
      suffix === 'second'
        ? 'Stop/save/restart retains exact account file and all business/native table row counts'
        : 'Crash recovery retains account file, unchanged classroom/native row counts and separately verified companion answer',
    );
  }
  await writeFile(
    `docs/v2/evidence/zhiban-persistent-${suffix}-local.json`,
    JSON.stringify(evidence, null, 2) + '\n',
  );
  console.log('PASS', checks);
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
