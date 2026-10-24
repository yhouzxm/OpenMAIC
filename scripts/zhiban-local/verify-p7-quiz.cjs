/* eslint-disable @typescript-eslint/no-require-imports -- Real LOCAL trusted HTTPS + owned PG16 journey. */
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { chromium, expect } = require('@playwright/test'),
  { Pool } = require('pg');
async function main() {
  const m = JSON.parse(fs.readFileSync('docs/v2/evidence/zhiban-trial-content-demo-local.json'));
  assert.equal(m.evidenceOrigin, 'LOCAL');
  assert.equal(m.githubActions, false);
  assert.equal(m.port, 56517);
  assert.ok(m.root.startsWith('/tmp/zhiban-trial-content-'));
  assert.equal(m.origin, 'https://127.0.0.1:3461');
  const accounts = JSON.parse(fs.readFileSync(m.accountsPath)).accounts,
    tenant = m.trial.tenantId,
    offering = m.trial.offeringId;
  const base = `/api/zhiban/learning/${tenant}/offerings/${offering}`,
    url = base + '/quizzes';
  const db = new Pool({
      host: m.root + '/socket',
      port: m.port,
      user: 'postgres',
      database: 'zhiban_trial_content_disposable',
      max: 3,
    }),
    pg = Number((await db.query('SHOW server_version_num')).rows[0].server_version_num);
  assert.ok(pg >= 160000 && pg < 170000);
  const b = await chromium.launch({ headless: true, args: ['--no-sandbox'] }),
    contexts = [],
    errors = [],
    checks = [],
    ids = {};
  let t, t2, s, a;
  const concurrencyTokens = new Map();
  async function actor(role) {
    const c = await b.newContext();
    contexts.push(c);
    const p = await c.newPage(),
      account = accounts.find((a) => a.role === role);
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(m.origin + '/zhiban?space=' + tenant);
    await p.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(account.userId);
    await p.getByLabel('密码', { exact: true }).fill(account.password);
    await p.getByRole('button', { name: '登录并进入', exact: true }).click();
    await expect(p.getByRole('link', { name: '个人资料与账户', exact: true })).toBeVisible();
    return p;
  }
  async function api(p, path, body, key = crypto.randomUUID()) {
    return p.evaluate(
      async ({ path, body, key, supplied }) => {
        const headers = { 'x-zhiban-request': 'identity-v1' };
        if (body) {
          const r = supplied
            ? null
            : await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store' });
          if (r && !r.ok) throw Error('CSRF ' + r.status + ' ' + (await r.text()).slice(0, 300));
          headers['x-zhiban-csrf'] = supplied ?? (await r.json()).csrfToken;
          headers['content-type'] = 'application/json';
          headers['x-zhiban-command'] = key;
        }
        const r = await fetch(path, {
          method: body ? 'POST' : 'GET',
          headers,
          body: body ? JSON.stringify(body) : undefined,
          cache: 'no-store',
        });
        return { status: r.status, json: await r.json() };
      },
      { path, body, key, supplied: concurrencyTokens.get(p) },
    );
  }
  async function ok(p, path, body, key) {
    const r = await api(p, path, body, key);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json;
  }
  const businessPosts = [];
  try {
    t = await actor('TEACHER');
    s = await actor('STUDENT');
    for (const page of [t, s])
      page.on('request', (r) => {
        if (
          r.method() !== 'GET' &&
          r.url().includes('/api/zhiban/') &&
          !r.url().includes('/identity/')
        )
          businessPosts.push({ method: r.method(), path: new URL(r.url()).pathname });
      });
    const journey = JSON.parse(fs.readFileSync('docs/v2/evidence/quiz-ordering/journey.json'));
    assert.equal(journey.root, m.root);
    const course = (
      await db.query(
        'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
        [tenant, offering],
      )
    ).rows[0].course_id;
    for (const [role, page] of [
      ['teacher', t],
      ['student', s],
    ]) {
      await page.goto(
        m.origin +
          `/zhiban/${role}/courses/${course}/learning-center/${journey.ids.unit}?space=${tenant}&offering=${offering}`,
      );
      if (role === 'teacher')
        for (const name of ['添加判断题', '添加填空题', '添加匹配题', '添加排序题'])
          await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
      else {
        await page.getByRole('button', { name: '查看已提交尝试', exact: true }).click();
        await page.getByRole('button', { name: '查看本次提交与成绩', exact: true }).click();
        await expect(page.getByText('成绩版本 2：3.25 / 3.25', { exact: false })).toBeVisible();
        await expect(
          page.getByText('标准顺序：断电隔离 → 确认无电后检修', { exact: true }),
        ).toBeVisible();
      }
      const view = await ok(page, url + '?activity=' + journey.ids.quiz);
      assert.equal(view.mode, role.toUpperCase());
      checks.push({ role, course, entry: 'GET_PAGE_READY' });
    }
    assert.deepEqual(businessPosts, []);
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      'docs/v2/evidence/p7-handoff/quiz-bundle/entry-readonly.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          scope: 'READ_ONLY_HANDOFF_ENTRY_NOT_FUNCTIONAL_RESIGNOFF',
          root: m.root,
          checks,
          businessPosts,
          errors,
          identityLogins: true,
        },
        null,
        2,
      ) + '\n',
    );
    console.log('PASS P7 quiz handoff read-only entries');
  } finally {
    await b.close();
    await db.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
