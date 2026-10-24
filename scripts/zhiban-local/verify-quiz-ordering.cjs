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
  const demoTitle = '排序题教学演示-' + crypto.randomUUID().slice(0, 6);
  const read = (id, p = t) => ok(p, url + '?activity=' + id);
  const getSub = (id, p = t) => ok(p, base + '/quiz-submissions?submission=' + id);
  const edit = (v, content, allowResubmit = false) => ({
    type: 'EDIT_QUIZ',
    id: v.activityId,
    revision: v.revision,
    title: v.title,
    content,
    deadlineAt: null,
    allowResubmit,
    maxAttempts: 2,
  });
  const gradePath = `/api/zhiban/assessment/${tenant}/offerings/${offering}`;
  async function reorder(page, desired) {
    const list = page.getByRole('list', { name: '第1题当前排序', exact: true });
    for (let i = 0; i < desired.length; i++) {
      let current = await list
        .locator('li')
        .evaluateAll((nodes) => nodes.map((n) => n.dataset.itemId));
      let index = current.indexOf(desired[i]);
      assert.ok(index >= 0);
      while (index > i) {
        await page.getByRole('button', { name: `第1题第${index + 1}项上移`, exact: true }).click();
        index--;
      }
    }
    assert.deepEqual(
      await list.locator('li').evaluateAll((nodes) => nodes.map((n) => n.dataset.itemId)),
      desired,
    );
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
      title: demoTitle,
      mode: 'ASSESSED',
      content: {
        type: 'quiz',
        questions: [
          {
            id: 'seed',
            type: 'single',
            question: '初始判断题',
            options: [
              { value: 'A', label: '正确' },
              { value: 'B', label: '错误' },
            ],
            answer: ['A'],
            points: 1,
          },
        ],
      },
      deadlineAt: null,
      allowResubmit: false,
      maxAttempts: 2,
    });
    ids.quiz = created.id;
    await ok(t, url, { type: 'PUBLISH_QUIZ', id: created.id, revision: created.revision });
    const outline = await ok(t, base + '/outline');
    if (!outline.chapters.length)
      outline.chapters.push({ id: crypto.randomUUID(), title: '排序题课堂', units: [] });
    const unit = crypto.randomUUID();
    ids.unit = unit;
    outline.chapters[0].units.push({
      id: unit,
      title: demoTitle,
      kind: 'ACTIVITY',
      target: created.id,
    });
    const arranged = await ok(t, base + '/outline', {
      type: 'SAVE_OUTLINE',
      revision: outline.revision,
      chapters: outline.chapters,
    });
    await ok(t, base + '/outline', { type: 'PUBLISH_OUTLINE', revision: arranged.revision });
    await t.goto(route('teacher', unit));
    await t.getByTestId('quiz-question').first().locator('button[aria-label]').last().click();
    await t.getByRole('button', { name: '添加排序题', exact: true }).click();
    const field = t.locator('textarea[aria-label^="排序题干-"]');
    await field.fill('将安全检修步骤按先后顺序排列。');
    const qid = (await field.getAttribute('aria-label')).replace('排序题干-', '');
    ids.question = qid;
    await t.getByLabel(`排序项目-${qid}-0`, { exact: true }).fill('断电隔离');
    await t.getByLabel(`排序项目-${qid}-1`, { exact: true }).fill('确认无电后检修');
    await t.getByLabel(`排序分值-${qid}`, { exact: true }).fill('3.25');
    await t.getByRole('button', { name: '添加排序项目', exact: true }).click();
    await t.getByLabel(`排序项目-${qid}-2`, { exact: true }).fill('临时项目');
    await t.getByRole('button', { name: '确认标准顺序', exact: true }).click();
    await t.getByRole('button', { name: '删除项目3', exact: true }).click();
    await expect(
      t.getByText('尚未配置标准顺序；请调整或确认，之后才可发布。', { exact: true }),
    ).toBeVisible();
    await t.getByRole('button', { name: '保存测验草稿', exact: true }).click();
    await expect(t.locator('.quiz-product').getByRole('status')).toContainText('操作已确认');
    let v = await read(created.id);
    assert.equal(
      (await api(t, url, { type: 'PUBLISH_QUIZ', id: created.id, revision: v.revision })).status,
      400,
    );
    await t.getByRole('button', { name: '标准顺序第1项下移', exact: true }).click();
    await t.getByRole('button', { name: '标准顺序第2项上移', exact: true }).click();
    await t.getByRole('button', { name: '确认标准顺序', exact: true }).click();
    await t.getByRole('button', { name: '保存测验草稿', exact: true }).click();
    await expect(t.locator('.quiz-product').getByRole('status')).toContainText('操作已确认');
    await t.getByRole('button', { name: '发布测验', exact: true }).click();
    await expect(t.getByText('已发布版本 2；', { exact: false })).toBeVisible();
    v = await read(created.id);
    const key = v.content.questions[0].ordering.correctOrder;
    const wrong = [...key].reverse();
    const copied = await ok(t, url, {
      type: 'COPY_QUIZ',
      sourceId: created.id,
      sourceRevision: v.revision,
      sourceVersion: '2',
    });
    ids.copy = copied.id;
    assert.deepEqual(
      (await read(copied.id)).content.questions[0].ordering,
      v.content.questions[0].ordering,
    );
    for (const secret of ['correctOrder', 'analysis'])
      assert.ok(!JSON.stringify(await read(created.id, s)).includes(secret));
    for (const p of [s, a]) assert.equal((await api(p, url, edit(v, v.content))).status, 403);
    await s.goto(route('student', unit));
    s.once('dialog', (d) => d.accept());
    await s.getByRole('button', { name: '开始新一次尝试', exact: true }).click();
    await expect(s.getByText('本题排序尚未确认', { exact: true })).toBeVisible();
    // Save an unconfirmed draft; it must survive reload but still count as unanswered.
    await s.getByRole('button', { name: '第1题第1项下移', exact: true }).click();
    await reorder(s, wrong);
    await s.getByRole('button', { name: '保存答案', exact: true }).click();
    await expect(s.locator('.quiz-product').getByRole('status')).toContainText('操作已确认');
    await s.reload();
    await s.getByRole('button', { name: '继续未完成作答', exact: true }).click();
    await expect(
      s.getByRole('list', { name: '第1题当前排序', exact: true }).locator('li'),
    ).toHaveCount(wrong.length);
    assert.deepEqual(
      await s
        .getByRole('list', { name: '第1题当前排序', exact: true })
        .locator('li')
        .evaluateAll((nodes) => nodes.map((n) => n.dataset.itemId)),
      wrong,
    );
    await expect(s.getByText('本题排序尚未确认', { exact: true })).toBeVisible();
    await s.getByRole('button', { name: '提交答案', exact: true }).click();
    await expect(s.getByRole('dialog', { name: '确认提交测验' })).toContainText('未答 1 题');
    await s.getByRole('button', { name: '继续检查答案', exact: true }).click();
    await s.getByRole('button', { name: '确认当前排序', exact: true }).click();
    await expect(s.getByText('本题排序已确认', { exact: true })).toBeVisible();
    // Moving a confirmed order invalidates confirmation; confirm again after restoring it.
    await s.getByRole('button', { name: '第1题第1项下移', exact: true }).click();
    await expect(s.getByText('本题排序尚未确认', { exact: true })).toBeVisible();
    await reorder(s, wrong);
    await s.getByRole('button', { name: '确认当前排序', exact: true }).click();
    const attempt = (await read(created.id, s)).latestAttempt;
    ids.attempt = attempt.id;
    const av = await ok(s, url + '?attempt=' + attempt.id);
    const command = {
      type: 'SUBMIT_QUIZ',
      attemptId: attempt.id,
      revision: av.attempt.revision,
      answers: { [qid]: { order: wrong, confirmed: true } },
    };
    for (const order of [[key[0]], [key[0], key[0]], [key[0], 'foreign']])
      assert.equal(
        (await api(s, url, { ...command, answers: { [qid]: { order, confirmed: true } } })).status,
        400,
      );
    assert.equal((await api(s, url, { ...command, score: 100 })).status, 400);
    assert.equal((await api(s, url, { ...command, answers: { [qid]: wrong } })).status, 400);
    const updated = structuredClone(v.content);
    updated.questions[0].ordering.correctOrder = wrong;
    updated.questions[0].ordering.items.reverse();
    const race = await Promise.all([api(t, url, edit(v, updated)), api(t2, url, edit(v, updated))]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    v = await read(created.id);
    await ok(t, url, { type: 'PUBLISH_QUIZ', id: created.id, revision: v.revision });
    const oldView = await ok(s, url + '?attempt=' + attempt.id);
    assert.equal(oldView.version, 2);
    await s.getByRole('button', { name: '提交答案', exact: true }).click();
    const response = s.waitForResponse(
      (r) => r.url().endsWith('/quizzes') && r.request().method() === 'POST',
    );
    await s.getByRole('button', { name: '确认提交测验', exact: true }).click();
    ids.submission = (await (await response).json()).submissionId;
    await expect(s.locator('.quiz-product').getByRole('status')).toContainText('提交成功');
    assert.equal((await getSub(ids.submission)).evaluation.objectivePoints, 0);
    assert.equal((await getSub(ids.submission, s)).review, undefined);
    assert.equal(
      (
        await api(t, gradePath, {
          type: 'SAVE_QUIZ_GRADE',
          submissionId: ids.submission,
          gradeRevision: null,
          manualMarks: { [qid]: '3.25' },
          feedback: '',
        })
      ).status,
      400,
    );
    await t.goto(
      m.origin +
        `/zhiban/teacher/courses/${course}/grades?space=${tenant}&offering=${offering}#queue`,
    );
    await t
      .locator('.grading-rows article')
      .filter({ has: t.getByRole('heading', { name: demoTitle, exact: true }) })
      .getByRole('button', { name: '打开评分', exact: true })
      .click();
    await t.getByRole('button', { name: '确认分项并保存评分', exact: true }).click();
    await t.getByRole('button', { name: '发布成绩', exact: true }).click();
    await expect(t.getByText('成绩版本 1：0.00 / 3.25', { exact: false })).toBeVisible();
    const gv = await getSub(ids.submission);
    assert.equal(
      (
        await api(t, gradePath, {
          type: 'CORRECT_QUIZ_GRADE',
          submissionId: ids.submission,
          revision: gv.grade.revision,
          marks: { [qid]: '3.25' },
          overrides: {},
          feedback: '',
          reason: '重新核定',
        })
      ).status,
      400,
    );
    await t.getByLabel('评分-' + qid, { exact: true }).fill('3.25');
    await t
      .getByPlaceholder('覆盖客观分的公开原因', { exact: true })
      .fill('课堂要求存在歧义，教师复核按公开标准调整得分');
    await t
      .getByLabel('公开更正理由', { exact: true })
      .fill('教师显式更正；不将新版答案自动回算旧提交');
    await t.getByRole('button', { name: '更正并发布测验成绩', exact: true }).click();
    await expect(t.getByText('成绩版本 2：3.25 / 3.25', { exact: false })).toBeVisible();
    assert.equal((await getSub(ids.submission, s)).review, undefined);
    v = await read(created.id);
    await ok(t, url, { type: 'CLOSE_QUIZ_REVIEW', id: created.id, revision: v.revision });
    const review = await getSub(ids.submission, s);
    assert.deepEqual(review.review.questions[0].ordering.correctOrder, key);
    await s.reload();
    await s.getByRole('button', { name: '查看已提交尝试', exact: true }).click();
    await s.getByRole('button', { name: '查看本次提交与成绩', exact: true }).click();
    await expect(s.getByText('成绩版本 2：3.25 / 3.25', { exact: false })).toBeVisible();
    await expect(s.getByText('标准顺序：断电隔离 → 确认无电后检修', { exact: true })).toBeVisible();
    // Actual PG16 proof: even a correct candidate scores zero until explicitly confirmed.
    let cv = await read(copied.id);
    await ok(t, url, edit(cv, cv.content, true));
    cv = await read(copied.id);
    await ok(t, url, { type: 'PUBLISH_QUIZ', id: copied.id, revision: cv.revision });
    const ca = await ok(s, url, {
      type: 'START_QUIZ_ATTEMPT',
      activityId: copied.id,
      expectedVersion: '1',
    });
    const cq = cv.content.questions[0].id;
    const pending = await ok(s, url, {
      type: 'SUBMIT_QUIZ',
      attemptId: ca.id,
      revision: ca.revision,
      answers: { [cq]: { order: key, confirmed: false } },
    });
    assert.equal((await getSub(pending.submissionId)).evaluation.objectivePoints, 0);
    const current = await ok(s, url + '?attempt=' + ca.id);
    const confirmed = {
      type: 'SUBMIT_QUIZ',
      attemptId: ca.id,
      revision: current.attempt.revision,
      answers: { [cq]: { order: key, confirmed: true } },
    };
    const retryKey = crypto.randomUUID();
    const full = await ok(s, url, confirmed, retryKey);
    assert.equal((await getSub(full.submissionId)).evaluation.objectivePoints, 325);
    assert.equal((await ok(s, url, confirmed, retryKey)).submissionId, full.submissionId);
    assert.equal((await getSub(pending.submissionId)).evaluation.objectivePoints, 0);
    const versions = (
      await db.query(
        'SELECT algorithm FROM zhiban_learning.quiz_versions WHERE tenant_id=$1 AND activity_id=$2 ORDER BY version',
        [tenant, created.id],
      )
    ).rows;
    assert.deepEqual(
      versions.map((v) => v.algorithm),
      ['zhiban-quiz-1', 'zhiban-quiz-order-1', 'zhiban-quiz-order-1'],
    );
    assert.deepEqual(errors, []);
    checks.push(
      'Browser: ordering authoring/key confirmation, item removal clears key, student moves/save/reload/unanswered confirmation and invalidation, teacher publish/correct and sealed student history',
    );
    checks.push(
      'PG16: fixed-version isolation, malformed permutation and score injection rejection, answer-key isolation, concurrent edit CAS, copy independence, unconfirmed correct candidate zero / confirmed full score, immutable prior result and idempotent replay',
    );
    fs.mkdirSync('docs/v2/evidence/quiz-ordering', { recursive: true });
    fs.writeFileSync(
      'docs/v2/evidence/quiz-ordering/journey.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          at: new Date().toISOString(),
          root: m.root,
          pg16: pg,
          ids,
          checks,
        },
        null,
        2,
      ) + '\n',
    );
    console.log('PASS', checks);
  } finally {
    await b.close();
    await db.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
