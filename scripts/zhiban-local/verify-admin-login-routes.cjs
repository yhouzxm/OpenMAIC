/* eslint-disable @typescript-eslint/no-require-imports -- Standalone LOCAL browser verifier. */
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { chromium, expect } = require('@playwright/test');
async function main() {
  const m = JSON.parse(fs.readFileSync('docs/v2/evidence/zhiban-trial-content-demo-local.json'));
  assert.equal(m.evidenceOrigin, 'LOCAL');
  assert.equal(m.githubActions, false);
  assert.equal(m.origin, 'https://127.0.0.1:3461');
  const accounts = JSON.parse(fs.readFileSync(m.accountsPath)).accounts,
    origin = m.origin,
    tenant = m.trial.tenantId;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }),
    checks = [];
  const login = async (p, role) => {
    const a = accounts.find((x) => x.role === role);
    await p.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(a.userId);
    await p.getByLabel('密码', { exact: true }).fill(a.password);
    await p.getByRole('button', { name: '登录并进入', exact: true }).click();
  };
  try {
    const c = await browser.newContext(),
      p = await c.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    try {
      await p.goto(origin + '/zhiban/admin/users?space=' + tenant);
      const go = p.getByRole('link', { name: '登录后继续访问', exact: true });
      await expect(go).toBeVisible();
      await expect(p.getByRole('heading', { name: '成员账户目录', exact: true })).toHaveCount(0);
      await go.click();
      await expect(p).toHaveURL(origin + '/zhiban/login?destination=admin-users&space=' + tenant);
      await p.reload();
      await expect(p.getByLabel('账号 ID 或 @登录标识', { exact: true })).toBeVisible();
      await login(p, 'ADMIN');
      await expect(p).toHaveURL(origin + '/zhiban/admin/accounts?tenant=' + tenant);
      await expect(p.getByRole('heading', { name: '成员账户目录', exact: true })).toBeVisible();
      await expect(
        p.getByRole('navigation', { name: '管理员教务导航', exact: true }),
      ).toBeVisible();
      await p.screenshot({
        path: 'docs/v2/evidence/admin-login-routes/admin-users.png',
        fullPage: true,
      });
      await p.getByRole('link', { name: '返回当前空间工作台', exact: true }).click();
      await expect(p).toHaveURL(origin + '/zhiban?space=' + tenant);
      await expect(
        p.getByRole('navigation', { name: '管理员教务导航', exact: true }),
      ).toBeVisible();
      for (const route of ['/zhiban/admin?tenant=' + tenant, '/zhiban/admin']) {
        await p.goto(origin + route);
        await expect(p).toHaveURL(origin + '/zhiban?space=' + tenant);
        await expect(
          p.getByRole('navigation', { name: '管理员教务导航', exact: true }),
        ).toBeVisible();
      }
      await p.goto(origin + '/zhiban/admin/users');
      await expect(p).toHaveURL(origin + '/zhiban/admin/accounts?tenant=' + tenant);
      await expect(p.getByRole('heading', { name: '成员账户目录', exact: true })).toBeVisible();
      await p.goto(origin + '/zhiban/login?tenant=' + tenant);
      await expect(p).toHaveURL(origin + '/zhiban?space=' + tenant);
      await expect(
        p.getByRole('navigation', { name: '管理员教务导航', exact: true }),
      ).toBeVisible();
      await p.goto(origin + '/zhiban/admin?space=00000000-0000-7000-8000-000000000001');
      await expect(
        p.getByText('当前空间不可访问，请从工作台核对成员状态。', { exact: true }),
      ).toBeVisible();
      for (const q of [
        '?space=bad',
        '?space=' + tenant + '&space=' + tenant,
        '?space=' + tenant + '&tenant=' + tenant,
        '?next=outside',
      ]) {
        await p.goto(origin + '/zhiban/admin/users' + q);
        await expect(
          p.getByText('管理员入口地址无效，请从工作台进入。', { exact: true }),
        ).toBeVisible();
      }
      for (const q of [
        '?destination=outside',
        '?next=outside',
        '?space=bad',
        '?space=' + tenant + '&space=' + tenant,
      ]) {
        await p.goto(origin + '/zhiban/login' + q);
        await expect(p.getByRole('heading', { name: '登录地址无效', exact: true })).toBeVisible();
        await expect(p.getByLabel('密码', { exact: true })).toHaveCount(0);
      }
      for (const route of [
        '/zhiban/admin/extra',
        '/zhiban/admin/users/extra',
        '/zhiban/login/extra',
      ])
        assert.equal((await p.goto(origin + route)).status(), 404);
      assert.deepEqual(errors, []);
      checks.push(
        'ADMIN: anonymous users bookmark -> fixed login target surviving reload -> real restricted directory; workspace return, bare admin/users, tenant alias and signed-in login; foreign space, malformed/duplicate/unknown contexts and extra paths refused',
      );
    } finally {
      await c.close();
    }
    for (const role of ['TEACHER', 'STUDENT']) {
      const c = await browser.newContext(),
        p = await c.newPage(),
        errors = [];
      p.on('pageerror', (e) => errors.push(e.message));
      try {
        await p.goto(origin + '/zhiban/admin?space=' + tenant);
        await p.getByRole('link', { name: '登录后继续访问', exact: true }).click();
        await login(p, role);
        await expect(
          p.getByText('当前空间不具备管理员权限，请返回本人工作台。', { exact: true }),
        ).toBeVisible();
        await p.goto(origin + '/zhiban/admin/users?tenant=' + tenant);
        await expect(
          p.getByText('当前空间不具备管理员权限，请返回本人工作台。', { exact: true }),
        ).toBeVisible();
        await expect(p.getByRole('heading', { name: '成员账户目录', exact: true })).toHaveCount(0);
        await p.goto(origin + '/zhiban/admin/accounts?tenant=' + tenant);
        await expect(
          p.getByText('当前身份没有管理员教务权限，请返回工作台。', { exact: true }),
        ).toBeVisible();
        await p.goto(origin + '/zhiban/login?space=' + tenant);
        await expect(p).toHaveURL(origin + '/zhiban?space=' + tenant);
        await expect(p.getByRole('link', { name: '个人资料与账户', exact: true })).toBeVisible();
        await expect(
          p.getByRole('navigation', { name: '管理员教务导航', exact: true }),
        ).toHaveCount(0);
        await p.screenshot({
          path: 'docs/v2/evidence/admin-login-routes/' + role.toLowerCase() + '.png',
          fullPage: true,
        });
        assert.deepEqual(errors, []);
        checks.push(
          role +
            ': real login via old admin bookmark does not grant admin; old users and canonical directory denied; signed-in old login returns own workspace with space',
        );
      } finally {
        await c.close();
      }
    }
  } finally {
    await browser.close();
  }
  const files = [
    'app/zhiban/local/client.js',
    'app/zhiban/local/admin-entry.html',
    'app/zhiban/local/admin-entry.js',
    'scripts/zhiban-local/request-target.ts',
    'scripts/zhiban-local/server.ts',
    'scripts/zhiban-local/verify-m6-catalog.mts',
    'scripts/zhiban-local/verify-admin-login-routes.cjs',
  ];
  fs.writeFileSync(
    'docs/v2/evidence/admin-login-routes/browser-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        at: new Date().toISOString(),
        scope: 'THREE_LEGACY_ADMIN_LOGIN_ENTRIES_AND_FIXED_POST_LOGIN_CONTEXT',
        root: require('node:path').dirname(m.accountsPath),
        tenant,
        checks,
        businessWrites: false,
        sourceHashes: Object.fromEntries(
          files.map((p) => [
            p,
            crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
          ]),
        ),
        excluded: [
          'No user create/delete/password reset/role mutation',
          'No multi-space fixture coverage; original session spaces API reused',
          'No full classroom/PG16/CI rerun',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ status: 'PASS', checks }));
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
