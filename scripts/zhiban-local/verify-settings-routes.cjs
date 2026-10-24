/* eslint-disable @typescript-eslint/no-require-imports -- Local Node browser verifier. */
/** Affected UI only, existing owned LOCAL runtime; no fixture or business writes. */
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium, expect } = require('@playwright/test');
async function main() {
  const meta = JSON.parse(fs.readFileSync('docs/v2/evidence/zhiban-trial-content-demo-local.json'));
  assert.equal(meta.evidenceOrigin, 'LOCAL');
  assert.equal(meta.githubActions, false);
  const accounts = JSON.parse(fs.readFileSync(meta.accountsPath)).accounts;
  const tenant = meta.trial.tenantId,
    origin = meta.origin;
  assert.equal(origin, 'https://127.0.0.1:3461');
  const checks = [],
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const canonical = origin + '/zhiban/profile?tenant=' + tenant;
  try {
    const anonymous = await browser.newContext(),
      anon = await anonymous.newPage();
    try {
      await anon.goto(origin + '/zhiban/student/settings');
      await expect(
        anon.getByRole('link', { name: '返回工作台登录或选择空间', exact: true }),
      ).toBeVisible();
      await expect(anon.getByLabel('显示名', { exact: true })).toHaveCount(0);
      await anon.goto(origin + '/zhiban/teacher/profile?tenant=' + tenant);
      await expect(
        anon.getByText('登录已失效，请返回工作台重新登录。', { exact: true }),
      ).toBeVisible();
      await expect(
        anon.getByRole('link', { name: '返回当前空间工作台', exact: true }),
      ).toHaveAttribute('href', '/zhiban?space=' + tenant);
      checks.push(
        'Both anonymous legacy settings entries reveal no profile and provide login/workspace recovery with explicit space retained',
      );
    } finally {
      await anonymous.close();
    }
    for (const role of ['STUDENT', 'TEACHER']) {
      const context = await browser.newContext(),
        page = await context.newPage(),
        a = accounts.find((x) => x.role === role);
      const alias = role === 'STUDENT' ? '/zhiban/student/settings' : '/zhiban/teacher/profile';
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      try {
        await page.goto(origin + '/zhiban?space=' + tenant);
        await page.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(a.userId);
        await page.getByLabel('密码', { exact: true }).fill(a.password);
        await page.getByRole('button', { name: '登录并进入', exact: true }).click();
        const link = page.getByRole('link', { name: '个人资料与账户', exact: true });
        await expect(link).toHaveAttribute('href', alias + '?tenant=' + tenant);
        await link.click();
        await expect(page).toHaveURL(canonical);
        await expect(page.getByLabel('显示名', { exact: true })).toBeVisible();
        await expect(page.getByText('UserId 登录账号：' + a.userId, { exact: true })).toBeVisible();
        await page.getByRole('link', { name: '管理本人登录标识', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: '本人登录标识', exact: true }),
        ).toBeVisible();
        await page.getByRole('link', { name: '返回个人资料与账户', exact: true }).click();
        await expect(page).toHaveURL(canonical);
        const input = page.getByLabel('显示名', { exact: true }),
          original = await input.inputValue();
        await input.fill('未保存离开保护验证');
        page.once('dialog', (d) => d.dismiss());
        await page.getByRole('link', { name: '返回当前空间工作台', exact: true }).click();
        await expect(page).toHaveURL(canonical);
        await expect(input).toHaveValue('未保存离开保护验证');
        await input.fill(original);
        await page.getByRole('link', { name: '返回当前空间工作台', exact: true }).click();
        await expect(page).toHaveURL(origin + '/zhiban?space=' + tenant);
        await page.goto(origin + alias); // old bookmark, no context
        await expect(page).toHaveURL(canonical);
        await expect(page.getByLabel('显示名', { exact: true })).toBeVisible();
        await page.goto(origin + alias + '?space=' + tenant);
        await expect(page).toHaveURL(canonical);
        await page.reload();
        await expect(page.getByLabel('显示名', { exact: true })).toBeVisible();
        for (const query of [
          '?tenant=bad',
          '?tenant=' + tenant + '&tenant=' + tenant,
          '?tenant=' + tenant + '&space=' + tenant,
          '?next=external',
        ]) {
          await page.goto(origin + alias + query);
          await expect(
            page.getByText('空间地址无效，请从工作台进入。', { exact: true }),
          ).toBeVisible();
          await expect(page.getByLabel('显示名', { exact: true })).toHaveCount(0);
        }
        await page.goto(origin + alias + '?tenant=00000000-0000-7000-8000-000000000001');
        await expect(
          page.getByText('当前无权访问本空间资料或成员目录。', { exact: true }),
        ).toBeVisible();
        await expect(page.getByLabel('显示名', { exact: true })).toHaveCount(0);
        for (const unsupported of [
          '/zhiban/student/profile/extra',
          '/zhiban/teacher/profiles/extra',
          alias + '/extra',
        ]) {
          const r = await page.goto(origin + unsupported);
          assert.equal(r.status(), 404);
        }
        await page.goto(canonical);
        await expect(page.getByLabel('显示名', { exact: true })).toBeVisible();
        await page.screenshot({
          path: 'docs/v2/evidence/settings-routes/' + role.toLowerCase() + '.png',
          fullPage: true,
        });
        assert.deepEqual(errors, []);
        checks.push(
          role +
            ': role navigation -> exact alias -> canonical own profile; @identifier return and workspace retain tenant; cancel dirty leave keeps text; bare bookmark/space alias/reload; malformed/duplicate/unknown context and foreign tenant denied; unsupported extra path segments remain 404',
        );
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  const sourceFiles = [
    'app/zhiban/local/profile.js',
    'app/zhiban/local/client.js',
    'app/zhiban/local/login-identifiers.js',
    'scripts/zhiban-local/request-target.ts',
    'scripts/zhiban-local/verify-m6-catalog.mts',
    'scripts/zhiban-local/server.ts',
    'scripts/zhiban-local/verify-settings-routes.cjs',
  ];
  const result = {
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    status: 'PASS',
    scope: 'TWO_LEGACY_PERSONAL_SETTINGS_ROUTES_AND_RETURN_CONTEXT_ONLY',
    at: new Date().toISOString(),
    origin,
    root: require('node:path').dirname(meta.accountsPath),
    tenant,
    checks,
    businessWrites: false,
    sourceHashes: Object.fromEntries(
      sourceFiles.map((p) => [
        p,
        crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
      ]),
    ),
    excluded: [
      'No password/alias/profile/avatar mutation',
      'No new PG16 authorization or migration gate',
      'Multi-space selector implemented but not covered by current single-space real fixtures',
      'No full classroom/CI',
    ],
  };
  fs.writeFileSync(
    'docs/v2/evidence/settings-routes/browser-local.json',
    JSON.stringify(result, null, 2) + '\n',
  );
  console.log(JSON.stringify({ status: result.status, checks }));
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
