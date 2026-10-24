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

  const gradePath = `/api/zhiban/assessment/${tenant}/offerings/${offering}`;
  const manage = `/api/zhiban/management/${tenant}`;
  const qid = 'safety',
    title = 'AI 简答评分建议 ' + Date.now();
  const view = (id, p = t) => ok(p, base + '/quiz-submissions?submission=' + id);
  let ended = false,
    member;
  async function relation() {
    return (await ok(a, manage + '/assignments?offering=' + offering + '&state=ALL&limit=50'))
      .rows[0];
  }
  async function restore() {
    const row = await relation();
    await ok(a, manage + '/commands', {
      type: 'ASSIGN_TEACHER',
      offeringId: offering,
      membershipId: member,
      revision: row.revision,
    });
    ended = false;
  }
  try {
    t = await actor('TEACHER');
    t2 = await actor('TEACHER');
    s = await actor('STUDENT');
    a = await actor('ADMIN');
    const created = await ok(t, url, {
      type: 'CREATE_QUIZ',
      title,
      mode: 'ASSESSED',
      content: {
        type: 'quiz',
        questions: [
          {
            id: qid,
            type: 'short_answer',
            question: '检修电气设备前应采取哪些安全措施？',
            commentPrompt: '断电隔离与验电各1分，不能带电检修。',
            points: 2,
          },
        ],
      },
      deadlineAt: null,
      allowResubmit: true,
      maxAttempts: 1,
    });
    ids.quiz = created.id;
    await ok(t, url, { type: 'PUBLISH_QUIZ', id: created.id, revision: created.revision });
    const quiz = await ok(s, url + '?activity=' + created.id);
    const attempt = await ok(s, url, {
      type: 'START_QUIZ_ATTEMPT',
      activityId: created.id,
      expectedVersion: String(quiz.version),
    });
    ids.attempt = attempt.id;
    const av = await ok(s, url + '?attempt=' + attempt.id);
    const submitted = await ok(s, url, {
      type: 'SUBMIT_QUIZ',
      attemptId: attempt.id,
      revision: av.attempt.revision,
      answers: { [qid]: '先断电，隔离电源并验电，确认无电后检修。' },
    });
    ids.submission = submitted.submissionId;
    const command = { type: 'SUGGEST_QUIZ_GRADE', submissionId: ids.submission };
    for (const p of [s, a]) assert.equal((await api(p, gradePath, command)).status, 403);
    assert.equal((await api(t, gradePath, { ...command, marks: { [qid]: '2' } })).status, 400);
    const course = (
      await db.query(
        'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
        [tenant, offering],
      )
    ).rows[0].course_id;
    const gradesUrl =
      m.origin +
      `/zhiban/teacher/courses/${course}/grades?space=${tenant}&offering=${offering}#queue`;
    async function open() {
      await t.goto(gradesUrl);
      await t
        .locator('.grading-rows article')
        .filter({ has: t.getByRole('heading', { name: title, exact: true }) })
        .getByRole('button', { name: '打开评分', exact: true })
        .click();
    }
    async function generate() {
      const response = t.waitForResponse(
        (r) =>
          r.request().method() === 'POST' &&
          r.url().endsWith(gradePath) &&
          r.request().postDataJSON()?.type === 'SUGGEST_QUIZ_GRADE',
        { timeout: 150000 },
      );
      await t.getByRole('button', { name: '生成简答评分建议', exact: true }).click();
      const r = await response;
      assert.equal(r.status(), 200, await r.text());
      const result = await r.json();
      await expect(t.getByRole('button', { name: '生成简答评分建议', exact: true })).toBeEnabled();
      return (await view(ids.submission)).aiAdvice.find((x) => x.id === result.id);
    }
    await open();
    const first = await generate();
    assert.ok(first.result.model.startsWith('glm:'));
    await t.getByRole('button', { name: '拒绝评分建议', exact: true }).click();
    await expect(
      t.getByText('模型：' + first.result.model + ' · 已拒绝', { exact: true }),
    ).toBeVisible();
    assert.equal((await view(ids.submission)).grade, null);
    const second = await generate();
    const v = await view(ids.submission);
    await ok(t2, gradePath, {
      type: 'SAVE_QUIZ_GRADE',
      submissionId: ids.submission,
      gradeRevision: v.grade?.revision ?? null,
      manualMarks: { [qid]: '1' },
      feedback: '教师独立评分',
    });
    assert.equal(
      (
        await api(t, gradePath, {
          type: 'ACCEPT_QUIZ_ADVICE',
          submissionId: ids.submission,
          suggestionId: second.id,
        })
      ).status,
      409,
    );
    await open();
    const third = await generate();
    ids.suggestion = third.id;
    assert.equal((await view(ids.submission, s)).aiAdvice, undefined);
    const row = await relation();
    member = row.membership_id;
    await ok(a, manage + '/commands', { type: 'END_TEACHER', id: row.id, revision: row.revision });
    ended = true;
    const accept = {
      type: 'ACCEPT_QUIZ_ADVICE',
      submissionId: ids.submission,
      suggestionId: third.id,
    };
    assert.equal((await api(t, gradePath, accept)).status, 403);
    await restore();
    const before = await view(ids.submission);
    await db.query(
      "CREATE FUNCTION public.local_ai_advice_cut() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL advice cut'; END $$",
    );
    await db.query(
      'CREATE TRIGGER local_ai_advice_cut BEFORE INSERT ON zhiban_assessment.quiz_grade_details FOR EACH ROW EXECUTE FUNCTION public.local_ai_advice_cut()',
    );
    try {
      assert.equal((await api(t, gradePath, accept)).status, 503);
      assert.equal((await view(ids.submission)).grade.revision, before.grade.revision);
    } finally {
      await db.query('DROP TRIGGER local_ai_advice_cut ON zhiban_assessment.quiz_grade_details');
      await db.query('DROP FUNCTION public.local_ai_advice_cut()');
    }
    // Two independent sessions race to accept; one save and decision receipt.
    const accepted = await Promise.all([ok(t, gradePath, accept), ok(t2, gradePath, accept)]);
    assert.deepEqual(accepted[0], accepted[1]);
    const current = await view(ids.submission);
    assert.equal(Number(current.grade.revision), Number(before.grade.revision) + 1);
    assert.equal(current.publications.length, 0);
    assert.equal(
      (
        await api(t, gradePath, {
          type: 'REJECT_QUIZ_ADVICE',
          submissionId: ids.submission,
          suggestionId: third.id,
        })
      ).status,
      409,
    );
    await open();
    await expect(
      t.getByText('模型：' + third.result.model + ' · 已采用', { exact: true }),
    ).toBeVisible();
    await t.getByRole('button', { name: '发布成绩', exact: true }).click();
    await expect.poll(async () => (await view(ids.submission, s)).publications.length).toBe(1);
    const student = await view(ids.submission, s);
    assert.equal(student.publications.length, 1);
    assert.equal(
      student.publications[0].score_points,
      Math.round(Number(third.result.marks[qid]) * 100),
    );
    assert.equal(student.aiAdvice, undefined);
    const audits = (
      await db.query(
        "SELECT event_type,count(*)::int AS n FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND event_type LIKE 'QUIZ_AI_%' AND (facts->'input'->>'submissionId'=$2 OR facts->>'submissionId'=$2) GROUP BY event_type",
        [tenant, ids.submission],
      )
    ).rows;
    assert.equal(audits.find((x) => x.event_type === 'QUIZ_AI_SUGGESTION').n, 3);
    assert.equal(audits.find((x) => x.event_type === 'QUIZ_AI_DECISION').n, 2);
    assert.deepEqual(errors, []);
    checks.push(
      'Real native glm advice x3; teacher rejects without grade write; stale grade revision conflicts; learner/admin and client marks rejected; committed revocation denies; injected grade INSERT failure rolls back; concurrent accept writes once; explicit teacher publishes original grade; student sees formal score only',
    );
    fs.mkdirSync('docs/v2/evidence/quiz-ai-advice', { recursive: true });
    fs.writeFileSync(
      'docs/v2/evidence/quiz-ai-advice/journey.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          realModel: true,
          mock: false,
          model: third.result.model,
          root: m.root,
          ids,
          checks,
          audits,
          browserErrors: errors,
        },
        null,
        2,
      ) + '\n',
    );
    console.log('PASS real Quiz AI advice journey', JSON.stringify(ids));
  } finally {
    if (ended) await restore();
    await b.close();
    await db.end();
  }
}
main().catch((e) => {
  console.error(e.stack);
  process.exitCode = 1;
});
