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
    errors = [];
  let t;
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
  const ai = `/api/zhiban/content/${tenant}/offerings/${offering}/ai?kind=quiz`;
  try {
    t = await actor('TEACHER');
    const cap = await ok(t, ai);
    assert.equal(cap.capability.ready, true);
    const course = (
      await db.query(
        'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
        [tenant, offering],
      )
    ).rows[0].course_id;
    await t.goto(
      m.origin + `/zhiban/teacher/courses/${course}/agents?space=${tenant}&offering=${offering}`,
    );
    const panel = t.getByRole('region', { name: '教师 AI 备课' });
    await t.getByLabel('生成内容类型', { exact: true }).waitFor();
    await expect(panel).not.toHaveAttribute('aria-busy', 'true');
    const mode = t.waitForResponse(
      (r) => r.url().endsWith('/ai?kind=quiz') && r.request().method() === 'GET',
    );
    await t.getByLabel('生成内容类型', { exact: true }).selectOption('quiz');
    await mode;
    await t
      .getByLabel('备课要求', { exact: true })
      .fill(
        '只生成1个quiz场景的电气安全基础测验，共3题：2道单选和1道多选。每题1分，包含正确选项value与简短解析。不要讲义，不要其他场景。',
      );
    const response = t.waitForResponse(
      (r) => r.url().endsWith('/ai?kind=quiz') && r.request().method() === 'POST',
    );
    await t.getByRole('button', { name: '生成测验草稿', exact: true }).click();
    const result = await response;
    assert.equal(result.status(), 200, await result.text());
    const runId = (await result.json()).run.id;
    fs.mkdirSync('docs/v2/evidence/ai-quiz', { recursive: true });
    let confirmed = false,
      run;
    const started = Date.now();
    while (Date.now() - started < 300000) {
      run = (await ok(t, ai)).runs.find((r) => r.id === runId);
      assert.ok(run);
      fs.writeFileSync(
        m.root + '/ai-quiz-progress.json',
        JSON.stringify({
          runId,
          state: run.state,
          outline: run.outline?.outlines?.map((o) => ({ id: o.id, type: o.type, title: o.title })),
          error: run.error,
          elapsedMs: Date.now() - started,
        }),
        { mode: 0o600 },
      );
      if (run.state === 'completed') break;
      if (run.state === 'paused' || run.state === 'ended')
        throw Error('Native run stopped ' + JSON.stringify(run.error));
      if (run.state === 'awaiting_outline_confirmation' && !confirmed) {
        assert.ok(
          run.outline.outlines.every((o) => o.type === 'quiz'),
          'Native outline is not quiz-only',
        );
        await t.getByRole('button', { name: '刷新生成任务', exact: true }).click();
        await t.getByRole('button', { name: '确认大纲并生成正文', exact: true }).click();
        confirmed = true;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    assert.equal(run.state, 'completed');
    const preview = await ok(t, ai, { type: 'PREVIEW', runId });
    fs.writeFileSync(
      m.root + '/ai-quiz-source.json',
      JSON.stringify({
        runId,
        sourceHash: preview.sourceHash,
        content: preview.content,
        title: preview.title,
        course,
      }),
      { mode: 0o600 },
    );
    fs.writeFileSync(
      'docs/v2/evidence/ai-quiz/generation.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          realModel: true,
          mock: false,
          runId,
          root: m.root,
          models: cap.capability.models,
          questionCount: preview.content.questions.length,
          questionTypes: preview.content.questions.map((q) => q.type),
          sourceHash: preview.sourceHash,
          elapsedMs: Date.now() - started,
        },
        null,
        2,
      ) + '\n',
    );
    console.log('PASS real native Quiz generation', runId, preview.content.questions.length);
  } finally {
    await b.close();
    await db.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
