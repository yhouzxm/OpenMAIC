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
  const base = `/api/zhiban/learning/${tenant}/offerings/${offering}`;
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
    checks = [];
  let t, s;
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
    for (const p of [t, s])
      p.on('request', (r) => {
        if (
          r.method() !== 'GET' &&
          r.url().includes('/api/zhiban/') &&
          !r.url().includes('/identity/')
        )
          businessPosts.push({ method: r.method(), path: new URL(r.url()).pathname });
      });
    const journey = JSON.parse(fs.readFileSync('docs/v2/evidence/quiz-ai-advice/journey.json'));
    assert.equal(journey.root, m.root);
    const course = (
      await db.query(
        'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
        [tenant, offering],
      )
    ).rows[0].course_id;
    await t.goto(
      m.origin + `/zhiban/teacher/courses/${course}/agents?space=${tenant}&offering=${offering}`,
    );
    await expect(t.getByRole('region', { name: '教师 AI 备课' })).not.toHaveAttribute(
      'aria-busy',
      'true',
    );
    await t.getByLabel('生成内容类型', { exact: true }).selectOption('quiz');
    await expect(t.getByRole('button', { name: '生成测验草稿', exact: true })).toBeVisible();
    const ai = await ok(t, `/api/zhiban/content/${tenant}/offerings/${offering}/ai?kind=quiz`);
    assert.ok(Array.isArray(ai.runs));
    checks.push({
      role: 'TEACHER',
      entry: 'AI Quiz generation mode and authorized GET; no model call',
      configuredModelReady: ai.capability.ready,
    });
    const path = base + '/quiz-submissions?submission=' + journey.ids.submission;
    const teacher = await ok(t, path),
      student = await ok(s, path);
    assert.equal(teacher.aiAdvice.length, 3);
    assert.ok(teacher.aiAdvice.some((a) => a.status === 'ACCEPTED'));
    assert.ok(teacher.aiAdvice.some((a) => a.status === 'REJECTED'));
    assert.equal(student.aiAdvice, undefined);
    assert.equal(student.publications.length, 1);
    checks.push({
      role: 'TEACHER',
      entry:
        'GET persisted suggestion/decision history and formal publication; no suggestion generation or decision',
    });
    await s.goto(
      m.origin +
        `/zhiban/student/courses/${course}/learning-center/${journey.ids.unit}?space=${tenant}&offering=${offering}`,
    );
    await s.getByRole('button', { name: '查看已提交尝试', exact: true }).click();
    await s.getByRole('button', { name: '查看本次提交与成绩', exact: true }).click();
    const pub = student.publications[0];
    await expect(
      s.getByText(
        `成绩版本 ${pub.version}：${(pub.score_points / 100).toFixed(2)} / ${(pub.max_points / 100).toFixed(2)}`,
        { exact: false },
      ),
    ).toBeVisible();
    checks.push({
      role: 'STUDENT',
      entry: 'GET course result page and formal grade, no private advice',
    });
    assert.deepEqual(businessPosts, []);
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      'docs/v2/evidence/p7-handoff/ai-quiz-bundle/entry-readonly.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          scope: 'READ_ONLY_P7_ENTRIES_NOT_NEW_FUNCTIONAL_SIGNOFF',
          root: m.root,
          pid: m.pid,
          checks,
          businessPosts,
          errors,
          identityLogins: true,
        },
        null,
        2,
      ) + '\n',
    );
    console.log('PASS P7 AI quiz read-only entries');
  } finally {
    await b.close();
    await db.end();
  }
}
main().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
