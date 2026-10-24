import { X509Certificate } from 'node:crypto';
import { request } from 'node:https';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { Pool } from 'pg';
import {
  directory,
  origin,
  database,
  pgPort,
  digest,
  loadRuntime,
  privateFile,
  trustedDevelopmentCa,
} from './config';

async function main() {
  const runtime = await loadRuntime();
  const certificate = await privateFile('localhost.crt');
  const authority = await trustedDevelopmentCa();
  const { accounts } = JSON.parse((await privateFile('accounts.json')).toString());
  const passed: string[] = [];
  const record = (name: string) => {
    passed.push(name);
    console.log(`PASS ${name}`);
  };
  // Native HTTPS checks trust the pinned local CA, with normal hostname verification.
  async function http(
    path: string,
    options: { method?: string; headers?: Record<string, string | string[]>; body?: string } = {},
  ) {
    return new Promise<{
      status: number;
      headers: import('node:http').IncomingHttpHeaders;
      body: string;
    }>((resolveRequest, reject) => {
      const req = request(
        origin + path,
        {
          ca: authority,
          servername: '',
          method: options.method ?? 'GET',
          headers: { 'x-zhiban-request': 'identity-v1', ...options.headers },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('end', () =>
            resolveRequest({
              status: response.statusCode!,
              headers: response.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('Local HTTPS timeout')));
      req.end(options.body);
    });
  }
  assert.equal((await http('/api/zhiban/identity/me')).status, 401);
  record('unauthenticated identity denied');
  for (const path of [
    '/api/chat',
    '/api/agent',
    '/api/zhiban/control',
    '/api/zhiban/identity/password',
    '/api/zhiban/identity/tenants/nope/invitations',
    '/classroom',
    '/_next/static/anything',
    '/scripts/zhiban-local/setup.ts',
  ])
    assert.equal((await http(path)).status, 404);
  record('native/control/recovery/assets entrypoints closed');
  assert.equal((await http('/zhiban', { headers: { Host: 'attacker.invalid' } })).status, 403);
  record('foreign Host denied');
  assert.equal(
    (
      await http('/api/zhiban/identity/me', {
        headers: { 'x-zhiban-request': ['identity-v1', 'identity-v1'] },
      })
    ).status,
    400,
  );
  record('duplicate security header denied');
  assert.equal(
    (
      await http('/api/zhiban/identity/me', {
        headers: { 'x-zhiban-client-ip': 'bad, value', 'x-forwarded-for': 'bad, value' },
      })
    ).status,
    401,
  );
  record('client proxy facts overwritten');
  const loginBody = JSON.stringify({ userId: accounts[0].userId, password: accounts[0].password });
  assert.equal(
    (
      await http('/api/zhiban/identity/login', {
        method: 'POST',
        headers: { Origin: 'https://attacker.invalid', 'Content-Type': 'application/json' },
        body: loginBody,
      })
    ).status,
    403,
  );
  record('cross-origin login denied');
  const issued = await http('/api/zhiban/identity/login', {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: loginBody,
  });
  assert.equal(issued.status, 200);
  const setCookie = issued.headers['set-cookie']![0];
  assert.match(setCookie, /^__Host-zhiban_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  const cookie = setCookie.split(';')[0];
  const headers = { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie };
  assert.equal(
    (await http('/api/zhiban/identity/logout', { method: 'POST', headers, body: '{}' })).status,
    403,
  );
  record('logout without CSRF denied; cookie flags preserved');
  const csrf = JSON.parse(
    (await http('/api/zhiban/identity/csrf', { headers: { Cookie: cookie } })).body,
  ).csrfToken;
  assert.equal(
    (
      await http('/api/zhiban/identity/logout', {
        method: 'POST',
        headers: { ...headers, 'x-zhiban-csrf': csrf },
        body: '{}',
      })
    ).status,
    204,
  );
  assert.equal(
    (await http('/api/zhiban/identity/me', { headers: { Cookie: cookie } })).status,
    401,
  );
  record('revoked cookie replay denied');

  const cert = new X509Certificate(certificate);
  const spki = cert.publicKey.export({ type: 'spki', format: 'der' });
  const { createHash } = await import('node:crypto');
  const pin = createHash('sha256').update(spki).digest('base64');
  // Isolated test browser trusts only this generated key; no global TLS disabling or system trust changes.
  const browser = await chromium.launch({ args: [`--ignore-certificate-errors-spki-list=${pin}`] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(origin + '/zhiban');
    await expect(page.getByRole('heading', { name: '登录智伴' })).toBeVisible();
    await page.screenshot({ path: join(directory, 'login.png'), fullPage: true });
    await page.getByLabel('账号 ID').fill(accounts[0].userId);
    await page.getByLabel('密码').fill('wrong-local-password');
    await page.getByRole('button', { name: '登录并进入' }).click();
    await expect(page.getByRole('alert')).toContainText('账号或密码不正确');
    record('browser wrong password rejected');
    await page.getByLabel('密码').fill(accounts[0].password);
    await page.getByRole('button', { name: '登录并进入' }).click();
    await expect(page.getByRole('heading', { name: '你的工作台' })).toBeVisible();
    await expect(page.getByRole('button', { name: '本地学习空间', exact: false })).toBeVisible();
    record('browser real PG16 login + own spaces');
    await page.getByRole('button', { name: '本地学习空间', exact: false }).click();
    await expect(page.getByRole('heading', { name: '工作台已就绪' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: '本地学习空间', exact: true })).toBeVisible();
    record('workspace selection survives reload via fresh identity checks');
    await page.getByRole('button', { name: '本地共创空间', exact: false }).click();
    await expect(page.getByRole('heading', { name: '本地共创空间', exact: true })).toBeVisible();
    record('space switching');
    await page.screenshot({ path: join(directory, 'workspace.png'), fullPage: true });
    await page.goto(origin + '/zhiban?space=unauthorized');
    await expect(page.getByRole('alert')).toContainText('该空间当前不可访问');
    await expect(page.getByRole('heading', { name: '工作台已就绪' })).toHaveCount(0);
    record('untrusted space URL refused');
    const second = await context.newPage();
    await second.goto(origin + '/zhiban');
    await expect(second.getByRole('button', { name: '退出登录' })).toBeVisible();
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('heading', { name: '登录智伴' })).toBeVisible();
    await expect(second.getByRole('heading', { name: '登录智伴' })).toBeVisible();
    record('CSRF logout + cross-tab session invalidation');
    await second.close();
    await page.getByLabel('账号 ID').fill(accounts[1].userId);
    await page.getByLabel('密码').fill(accounts[1].password);
    await page.getByRole('button', { name: '登录并进入' }).click();
    await expect(page.getByRole('heading', { name: '你还没有加入空间' })).toBeVisible();
    record('no-membership empty state');
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page.getByRole('heading', { name: '登录智伴' })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('button', { name: '登录并进入' })).toBeVisible();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    record('mobile viewport has no horizontal overflow');
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    assert.deepEqual(errors, []);
    record('no browser credential storage or JavaScript errors');
  } finally {
    await context.close();
    await browser.close();
  }
  const control = new Pool({ connectionString: runtime.secrets.LOCAL_M1_CONTROL, max: 1 });
  try {
    const rows = (
      await control.query(
        'SELECT count(*)::integer AS count FROM zhiban_identity.system_admin_grants',
      )
    ).rows;
    assert.equal(rows[0].count, 0);
  } finally {
    await control.end();
  }
  record('synthetic users have no platform admin grants');
  const sourceFiles = [
    'package.json',
    'scripts/zhiban-local/config.ts',
    'scripts/zhiban-local/setup.ts',
    'scripts/zhiban-local/launch.ts',
    'scripts/zhiban-local/server.ts',
    'scripts/zhiban-local/verify.ts',
    'app/zhiban/local/index.html',
    'app/zhiban/local/client.js',
    'app/zhiban/local/style.css',
  ];
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (name) => [name, digest(await readFile(resolve(name), 'utf8'))]),
    ),
  );
  const evidence = {
    mode: 'LOCAL',
    scope: 'M1 synthetic development host/UI/API/PG16 only',
    time: new Date().toISOString(),
    head: execFileSync('git', ['rev-parse', 'HEAD']).toString().trim(),
    workingTree: 'UNCOMMITTED_CANDIDATE',
    sourceHashes,
    endpoint: { origin, database, pgPort },
    certificateHash: digest(certificate.toString()),
    passed,
    deferred: [
      'production OPS/approvals',
      'business permission/resource gates',
      'enabled Bridge',
      'Runtime/AI',
      'PHASE_1B_COMPLETE',
    ],
  };
  await writeFile(join(directory, 'verification.json'), JSON.stringify(evidence, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log(
    `LOCAL M1 ${passed.length} scenarios passed. Evidence: ${join(directory, 'verification.json')}`,
  );
}
void main().catch(() => {
  console.error(
    'LOCAL M1 verification failed; rerun the specific failing scenario. No signoff produced.',
  );
  process.exitCode = 1;
});
