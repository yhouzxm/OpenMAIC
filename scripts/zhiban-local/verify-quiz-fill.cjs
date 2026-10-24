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
  const read = (id, p = t) => ok(p, url + '?activity=' + id);
  const getSub = (id, p = t) => ok(p, base + '/quiz-submissions?submission=' + id);
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
      title: '填空题教学演示',
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
      outline.chapters.push({ id: crypto.randomUUID(), title: '填空题课堂', units: [] });
    const unit = crypto.randomUUID();
    outline.chapters[0].units.push({
      id: unit,
      title: '填空题讲练',
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
    await t.getByRole('button', { name: '添加填空题', exact: true }).click();
    await t.locator('textarea[aria-label^="填空题干-"]').fill('请依次填写数据库名称与版本。');
    const f = await t.locator('textarea[aria-label^="填空题干-"]').getAttribute('aria-label');
    const qid = f.replace('填空题干-', '');
    ids.question = qid;
    await t.getByLabel('空提示-' + qid + '-0', { exact: true }).fill('数据库');
    await t.getByLabel('空分值-' + qid + '-0', { exact: true }).fill('1.25');
    await t.getByLabel('可接受答案-' + qid + '-0', { exact: true }).fill('PG\nPostgreSQL');
    await t.getByRole('button', { name: '添加空位', exact: true }).click();
    await t.getByLabel('空提示-' + qid + '-1', { exact: true }).fill('版本');
    await t.getByLabel('空分值-' + qid + '-1', { exact: true }).fill('2');
    await t.getByLabel('可接受答案-' + qid + '-1', { exact: true }).fill('16');
    await t.getByRole('button', { name: '保存测验草稿', exact: true }).click();
    await expect(t.locator('.quiz-product').getByRole('status')).toContainText('操作已确认');
    await t.getByRole('button', { name: '发布测验', exact: true }).click();
    await expect(t.getByText('已发布版本 2；', { exact: false })).toBeVisible();
    let v = await read(created.id);
    assert.equal(v.content.questions[0].points, 3.25);
    const pin = {
      type: 'COPY_QUIZ',
      sourceId: created.id,
      sourceRevision: v.revision,
      sourceVersion: '2',
    };
    const copied = await ok(t, url, pin);
    ids.copy = copied.id;
    assert.deepEqual(
      (await read(copied.id)).content.questions[0].blanks,
      v.content.questions[0].blanks,
    );
    const studentView = await read(created.id, s);
    for (const secret of ['accepted', 'PostgreSQL', 'analysis'])
      assert.ok(!JSON.stringify(studentView).includes(secret));
    for (const p of [s, a])
      assert.equal(
        (
          await api(p, url, {
            type: 'EDIT_QUIZ',
            id: created.id,
            revision: v.revision,
            title: v.title,
            content: v.content,
            deadlineAt: null,
            allowResubmit: false,
            maxAttempts: 2,
          })
        ).status,
        403,
      );
    await s.goto(route('student', unit));
    s.once('dialog', (d) => d.accept());
    await s.getByRole('button', { name: '开始新一次尝试', exact: true }).click();
    await s.getByLabel('第1题第1空', { exact: true }).fill(' PG ');
    await s.getByLabel('第1题第2空', { exact: true }).fill('016');
    await s.getByRole('button', { name: '保存答案', exact: true }).click();
    await expect(s.locator('.quiz-product').getByRole('status')).toContainText('操作已确认');
    await s.reload();
    await s.getByRole('button', { name: '继续未完成作答', exact: true }).click();
    await expect(s.getByLabel('第1题第1空', { exact: true })).toHaveValue(' PG ');
    const attempt = (await read(created.id, s)).latestAttempt;
    ids.attempt = attempt.id;
    let attemptView = await ok(s, url + '?attempt=' + attempt.id);
    assert.equal(attemptView.version, 2);
    const invalid = {
      type: 'SUBMIT_QUIZ',
      attemptId: attempt.id,
      revision: attemptView.attempt.revision,
      answers: { [qid]: ['PG'] },
    };
    assert.equal((await api(s, url, invalid)).status, 400);
    assert.equal(
      (await api(s, url, { ...invalid, answers: { [qid]: ['PG', '16'] }, score: 100 })).status,
      400,
    );
    // Concurrent draft CAS: one winner; no silent answer-key overwrite.
    const changed = structuredClone(v.content);
    changed.questions[0].blanks[1].accepted = ['16', '016'];
    const command = {
      type: 'EDIT_QUIZ',
      id: created.id,
      revision: v.revision,
      title: v.title,
      content: changed,
      deadlineAt: null,
      allowResubmit: false,
      maxAttempts: 2,
    };
    const race = await Promise.all([api(t, url, command), api(t2, url, command)]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    v = await read(created.id);
    await ok(t, url, { type: 'PUBLISH_QUIZ', id: created.id, revision: v.revision });
    assert.equal((await ok(s, url + '?attempt=' + attempt.id)).version, 2);
    await s.getByRole('button', { name: '提交答案', exact: true }).click();
    const response = s.waitForResponse(
      (r) => r.url().endsWith('/quizzes') && r.request().method() === 'POST',
    );
    await s.getByRole('button', { name: '确认提交测验', exact: true }).click();
    const submitted = await (await response).json();
    ids.submission = submitted.submissionId;
    await expect(s.locator('.quiz-product').getByRole('status')).toContainText('提交成功');
    let sv = await getSub(ids.submission, s);
    assert.equal(sv.version, 2);
    assert.equal(sv.review, undefined);
    const privateView = await getSub(ids.submission);
    assert.equal(privateView.evaluation.objectivePoints, 125);
    const invalidGrade = {
      type: 'SAVE_QUIZ_GRADE',
      submissionId: ids.submission,
      gradeRevision: null,
      manualMarks: { [qid]: '3.25' },
      feedback: '',
    };
    assert.equal(
      (await api(t, `/api/zhiban/assessment/${tenant}/offerings/${offering}`, invalidGrade)).status,
      400,
    );
    await t.goto(
      m.origin +
        `/zhiban/teacher/courses/${course}/grades?space=${tenant}&offering=${offering}#queue`,
    );
    await t
      .locator('.grading-rows article')
      .filter({ hasText: '填空题教学演示' })
      .getByRole('button', { name: '打开评分', exact: true })
      .click();
    await t.getByRole('button', { name: '确认分项并保存评分', exact: true }).click();
    await t.getByRole('button', { name: '发布成绩', exact: true }).click();
    await expect(t.getByText('成绩版本 1：1.25 / 3.25', { exact: false })).toBeVisible();
    const gradePath = `/api/zhiban/assessment/${tenant}/offerings/${offering}`;
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
      .fill('人工复核确认016为可接受版本表达');
    await t
      .getByLabel('公开更正理由', { exact: true })
      .fill('依据明确人工复核更正，不改旧卷答案键');
    await t.getByRole('button', { name: '更正并发布测验成绩', exact: true }).click();
    await expect(t.getByText('成绩版本 2：3.25 / 3.25', { exact: false })).toBeVisible();
    sv = await getSub(ids.submission, s);
    assert.equal(sv.publications[0].score_points, 325);
    assert.equal(sv.review, undefined);
    v = await read(created.id);
    await ok(t, url, { type: 'CLOSE_QUIZ_REVIEW', id: created.id, revision: v.revision });
    sv = await getSub(ids.submission, s);
    assert.deepEqual(sv.review.questions[0].blanks[1].accepted, ['16']);
    await s.reload();
    await s.getByRole('button', { name: '查看已提交尝试', exact: true }).click();
    await s.getByRole('button', { name: '查看本次提交与成绩', exact: true }).click();
    await expect(s.getByText('成绩版本 2：3.25 / 3.25', { exact: false })).toBeVisible();
    await expect(s.getByText('可接受答案：PG / PostgreSQL', { exact: true })).toBeVisible();
    const persisted = (
      await db.query(
        'SELECT version,algorithm FROM zhiban_learning.quiz_versions WHERE tenant_id=$1 AND activity_id=$2 ORDER BY version',
        [tenant, created.id],
      )
    ).rows;
    assert.deepEqual(
      persisted.map((x) => x.algorithm),
      ['zhiban-quiz-1', 'zhiban-quiz-fill-1', 'zhiban-quiz-fill-1'],
    );
    assert.equal(
      (
        await db.query(
          'SELECT algorithm FROM zhiban_learning.quiz_evaluations WHERE tenant_id=$1 AND submission_id=$2',
          [tenant, ids.submission],
        )
      ).rows[0].algorithm,
      'zhiban-quiz-fill-1',
    );
    assert.deepEqual(errors, []);
    checks.push(
      'Browser: two-blank editing/variants/points, publish, student draft reload, fixed-version submit, partial score, teacher publish/correction and student sealed review',
    );
    checks.push(
      'PG16: old/new algorithm identities, mixed legacy source, copied fill draft, public answer isolation, malformed arity/score forgery/manual score injection rejected, concurrent edit CAS, version-change isolation and required override reason',
    );
    fs.mkdirSync('docs/v2/evidence/quiz-fill', { recursive: true });
    fs.writeFileSync(
      'docs/v2/evidence/quiz-fill/journey.json',
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
