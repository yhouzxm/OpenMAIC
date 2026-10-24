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
  let ended = false;
  const manage = `/api/zhiban/management/${tenant}`;
  async function relation() {
    return (await ok(a, manage + '/assignments?offering=' + offering + '&state=ALL&limit=50'))
      .rows[0];
  }
  async function restore() {
    const r = await relation();
    await ok(a, manage + '/commands', {
      type: 'ASSIGN_TEACHER',
      offeringId: offering,
      membershipId: r.membership_id,
      revision: r.revision,
    });
    ended = false;
  }
  const read = (id, p = t) => ok(p, url + '?activity=' + id);
  const save = (v, overrides = {}) =>
    ok(t, url, {
      type: 'EDIT_QUIZ',
      id: v.activityId,
      revision: v.revision,
      title: v.title,
      content: v.content,
      deadlineAt: v.deadlineAt === null ? null : Number(v.deadlineAt),
      allowResubmit: v.allowResubmit,
      maxAttempts: v.maxAttempts,
      ...overrides,
    });
  async function arrange(activity, title, publish = true) {
    const o = await ok(t, base + '/outline');
    if (!o.chapters.length)
      o.chapters.push({ id: crypto.randomUUID(), title: '测验复用课堂', units: [] });
    for (const c of o.chapters) c.units = c.units.filter((u) => u.title !== '判断题备课');
    const unit = crypto.randomUUID();
    o.chapters[0].units.push({ id: unit, title, kind: 'ACTIVITY', target: activity });
    const r = await ok(t, base + '/outline', {
      type: 'SAVE_OUTLINE',
      revision: o.revision,
      chapters: o.chapters,
    });
    if (publish) await ok(t, base + '/outline', { type: 'PUBLISH_OUTLINE', revision: r.revision });
    return unit;
  }
  try {
    t = await actor('TEACHER');
    s = await actor('STUDENT');
    a = await actor('ADMIN');
    t2 = await actor('TEACHER');
    const course = (
      await db.query(
        'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
        [tenant, offering],
      )
    ).rows[0].course_id;
    const route = (role, unit) =>
      m.origin +
      `/zhiban/${role}/courses/${course}/learning-center/${unit}?space=${tenant}&offering=${offering}`;
    const created = await ok(t, url, {
      type: 'CREATE_QUIZ',
      title: '判断与复用教学演示',
      mode: 'ASSESSED',
      content: {
        type: 'quiz',
        questions: [
          {
            id: 'seed',
            type: 'single',
            question: '课堂初始题',
            options: [
              { value: 'A', label: '正确' },
              { value: 'B', label: '错误' },
            ],
            answer: ['A'],
            points: 1,
          },
        ],
      },
      deadlineAt: Date.now() + 86400000,
      allowResubmit: true,
      maxAttempts: 4,
    });
    ids.source = created.id;
    await ok(t, url, { type: 'PUBLISH_QUIZ', id: created.id, revision: created.revision });
    const unit = await arrange(created.id, '判断题备课');
    await t.goto(route('teacher', unit));
    await t.getByTestId('quiz-question').first().locator('button[aria-label]').last().click();
    await t.getByRole('button', { name: '添加判断题', exact: true }).click();
    const card = t.getByTestId('quiz-question').first();
    await card.locator('button').nth(1).click();
    await card.locator('textarea').first().fill('维护设备应先断电。');
    // Correct-key buttons expose aria-pressed, independent of translated text.
    await card.locator('button[aria-pressed]').first().click();
    await t.getByText('复制当前草稿中的题目', { exact: true }).click();
    await t.getByRole('button', { name: /复制第1题/ }).click();
    await expect(t.getByTestId('quiz-question')).toHaveCount(2);
    await expect(
      t.getByRole('button', { name: '复制已保存草稿为新测验', exact: true }),
    ).toBeDisabled();
    await t.getByRole('button', { name: '保存测验草稿', exact: true }).click();
    await expect(t.locator('.quiz-product').getByRole('status')).toContainText('操作已确认');
    let v = await read(created.id);
    assert.equal(v.content.questions.length, 2);
    assert.notEqual(v.content.questions[0].id, v.content.questions[1].id);
    assert.deepEqual(v.content.questions[0].answer, ['A']);
    await t.getByRole('button', { name: '发布测验', exact: true }).click();
    await expect(t.getByText('已发布版本 2；', { exact: false })).toBeVisible();
    v = await read(created.id);
    const pin = {
      type: 'COPY_QUIZ',
      sourceId: created.id,
      sourceRevision: v.revision,
      sourceVersion: '2',
    };
    for (const p of [s, a]) assert.equal((await api(p, url, pin)).status, 403);
    assert.equal((await api(t, url, { ...pin, content: v.content })).status, 400);
    const before = Number(
      (
        await db.query('SELECT count(*) FROM zhiban_learning.activities WHERE tenant_id=$1', [
          tenant,
        ])
      ).rows[0].count,
    );
    assert.equal(
      (await api(t, url, { ...pin, sourceId: '00000000-0000-7000-8000-000000000001' })).status,
      404,
    );
    assert.equal((await api(t, url, { ...pin, sourceVersion: '99' })).status, 404);
    assert.equal(
      Number(
        (
          await db.query('SELECT count(*) FROM zhiban_learning.activities WHERE tenant_id=$1', [
            tenant,
          ])
        ).rows[0].count,
      ),
      before,
    );
    // UI chooses an exact published source; opens its new independent draft.
    const copiedResponse = t.waitForResponse(
      (r) => r.url().endsWith('/quizzes') && r.request().method() === 'POST',
    );
    await t.getByRole('button', { name: '复制已发布版本为新测验', exact: true }).click();
    await expect(t.getByLabel('测验标题')).toHaveValue('判断与复用教学演示（副本）');
    await expect(t.getByText('已发布版本 0；', { exact: false })).toBeVisible();
    ids.copy = (await (await copiedResponse).json()).id;
    let copy = await read(ids.copy);
    assert.equal(copy.status, 'DRAFT');
    assert.equal(copy.deadlineAt, null);
    assert.equal(copy.allowResubmit, false);
    assert.equal(copy.maxAttempts, 1);
    assert.equal(copy.quizMode, 'ASSESSED');
    assert.ok(
      copy.content.questions.every((q) => !v.content.questions.some((old) => old.id === q.id)),
    );
    assert.equal((await api(s, url + '?activity=' + ids.copy)).status, 404);
    const key = crypto.randomUUID();
    const pair = await Promise.all([ok(t, url, pin, key), ok(t2, url, pin, key)]);
    assert.equal(pair[0].id, pair[1].id);
    const draftPin = { ...pin, sourceVersion: null };
    const draftCopy = await ok(t, url, draftPin);
    assert.ok(draftCopy.source.hash);
    const edited = structuredClone(v.content);
    edited.questions[0].question = '源草稿更新，不应改变旧发布版';
    await save(v, { content: edited });
    assert.equal((await api(t, url, pin)).status, 409);
    assert.equal((await ok(t, url, pin, key)).id, pair[0].id);
    v = await read(created.id);
    assert.equal((await read(ids.copy)).content.questions[0].question, '维护设备应先断电。');
    const fromOld = await ok(t, url, { ...pin, sourceRevision: v.revision });
    assert.equal((await read(fromOld.id)).content.questions[0].question, '维护设备应先断电。');
    const r = await relation();
    await ok(a, manage + '/commands', { type: 'END_TEACHER', id: r.id, revision: r.revision });
    ended = true;
    assert.equal((await api(t, url, { ...pin, sourceRevision: v.revision })).status, 403);
    assert.equal((await api(t, url, pin, key)).status, 403);
    await restore();
    // Edit and publish the independent copy via the product surface.
    await t.getByLabel('测验标题').fill('判断题独立副本正式测验');
    await t.getByRole('button', { name: '保存测验草稿', exact: true }).click();
    await expect(t.locator('.quiz-product').getByRole('status')).toContainText('操作已确认');
    await t.getByRole('button', { name: '发布测验', exact: true }).click();
    await expect(t.getByText('已发布版本 1；', { exact: false })).toBeVisible();
    const copyUnit = await arrange(ids.copy, '独立判断题测验');
    await s.goto(route('student', copyUnit));
    s.once('dialog', (d) => d.accept());
    await s.getByRole('button', { name: '开始新一次尝试', exact: true }).click();
    await s.getByRole('radio').nth(0).check();
    await s.getByRole('radio').nth(2).check();
    await s.getByRole('button', { name: '提交答案', exact: true }).click();
    await s.getByRole('button', { name: '确认提交测验', exact: true }).click();
    await expect(s.locator('.quiz-product').getByRole('status')).toContainText('提交成功');
    const sub = (
      await db.query(
        'SELECT s.id FROM zhiban_learning.submissions s JOIN zhiban_learning.attempts a ON a.tenant_id=s.tenant_id AND a.id=s.attempt_id WHERE a.tenant_id=$1 AND a.activity_id=$2',
        [tenant, ids.copy],
      )
    ).rows[0].id;
    ids.submission = sub;
    const projection = await ok(s, base + '/quiz-submissions?submission=' + sub);
    assert.equal(projection.review, undefined);
    await t.goto(
      m.origin +
        `/zhiban/teacher/courses/${course}/grades?space=${tenant}&offering=${offering}#queue`,
    );
    await t
      .locator('.grading-rows article')
      .filter({ hasText: '判断题独立副本正式测验' })
      .getByRole('button', { name: '打开评分', exact: true })
      .click();
    await t.getByRole('button', { name: '确认分项并保存评分', exact: true }).click();
    await t.getByRole('button', { name: '发布成绩', exact: true }).click();
    await expect(t.getByText('成绩版本 1：2.00 / 2.00', { exact: false })).toBeVisible();
    const published = await ok(s, base + '/quiz-submissions?submission=' + sub);
    assert.equal(published.publications[0].score_points, 200);
    await s.reload();
    await s.getByRole('button', { name: '查看已提交尝试', exact: true }).click();
    await s.getByRole('button', { name: '查看本次提交与成绩', exact: true }).click();
    await expect(s.getByText('成绩版本 1：2.00 / 2.00', { exact: false })).toBeVisible();
    assert.deepEqual(errors, []);
    checks.push(
      'Browser: judgment template, explicit key, question duplication, unsaved guard, save/publish, published quiz copy opens independent DRAFT, student submit, teacher publish and student result',
    );
    checks.push(
      'PG16: source revision/version pins, reset rules, new IDs, immutable old version, independent content, same-key concurrent replay, student/admin and revoked teacher denial, rollback on missing source/version',
    );
    fs.mkdirSync('docs/v2/evidence/quiz-reuse', { recursive: true });
    fs.writeFileSync(
      'docs/v2/evidence/quiz-reuse/journey.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          pg16: pg,
          root: m.root,
          ids,
          checks,
          at: new Date().toISOString(),
        },
        null,
        2,
      ) + '\n',
    );
    console.log('PASS', checks);
  } finally {
    if (ended) await restore();
    await b.close();
    await db.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
