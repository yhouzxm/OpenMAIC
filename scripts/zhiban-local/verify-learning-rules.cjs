/* eslint-disable @typescript-eslint/no-require-imports -- Real LOCAL PG16/API/browser validation. */
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto');
const { chromium, expect } = require('@playwright/test');
const { Pool } = require('pg');
async function main() {
  const meta = JSON.parse(fs.readFileSync('docs/v2/evidence/zhiban-trial-content-demo-local.json'));
  assert.equal(meta.evidenceOrigin, 'LOCAL');
  assert.equal(meta.githubActions, false);
  assert.ok(meta.root.startsWith('/tmp/zhiban-trial-content-'));
  assert.equal(meta.port, 56517);
  assert.equal(meta.origin, 'https://127.0.0.1:3461');
  const accounts = JSON.parse(fs.readFileSync(meta.accountsPath)).accounts;
  const tenant = meta.trial.tenantId,
    offering = meta.trial.offeringId,
    base = `/api/zhiban/learning/${tenant}/offerings/${offering}`,
    outline = base + '/outline',
    classBase = base + '/classrooms',
    grade = `/api/zhiban/assessment/${tenant}/offerings/${offering}`;
  const db = new Pool({
    host: meta.root + '/socket',
    port: meta.port,
    user: 'postgres',
    database: 'zhiban_trial_content_disposable',
    max: 3,
  });
  const version = (await db.query('SHOW server_version_num')).rows[0].server_version_num;
  assert.ok(Number(version) >= 160000 && Number(version) < 170000);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] }),
    contexts = [],
    checks = [],
    errors = [];
  let original, t, s, a, course, classroom, lock;
  const labels = {
    A: '先修验证 · 正式成绩',
    B: '先修验证 · 后续作答',
    C: '先修验证 · 已有作答',
    D: '先修验证 · 课堂进入',
    Q: '先修验证 · 正式测验',
  };
  const ids = {},
    results = {};
  async function actor(role) {
    const c = await browser.newContext();
    contexts.push(c);
    const p = await c.newPage(),
      account = accounts.find((a) => a.role === role);
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(meta.origin + '/zhiban?space=' + tenant);
    await p.getByLabel('账号 ID 或 @登录标识', { exact: true }).fill(account.userId);
    await p.getByLabel('密码', { exact: true }).fill(account.password);
    await p.getByRole('button', { name: '登录并进入', exact: true }).click();
    await expect(p.getByRole('link', { name: '个人资料与账户', exact: true })).toBeVisible();
    return p;
  }
  async function api(p, url, body, key = crypto.randomUUID()) {
    return p.evaluate(
      async ({ url, body, key }) => {
        const headers = { 'x-zhiban-request': 'identity-v1' };
        if (body) {
          const r = await fetch('/api/zhiban/identity/csrf', { headers, cache: 'no-store' });
          if (!r.ok) throw Error('CSRF');
          headers['x-zhiban-csrf'] = (await r.json()).csrfToken;
          headers['content-type'] = 'application/json';
          headers['x-zhiban-command'] = key;
        }
        const r = await fetch(url, {
          method: body ? 'POST' : 'GET',
          headers,
          body: body ? JSON.stringify(body) : undefined,
          cache: 'no-store',
        });
        return { status: r.status, json: await r.json() };
      },
      { url, body, key },
    );
  }
  async function ok(p, url, body, key) {
    const r = await api(p, url, body, key);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json;
  }
  async function blocked(p, url, body) {
    const r = await api(p, url, body);
    assert.equal(r.status, 409, JSON.stringify(r.json));
    assert.equal(r.json.error.code, 'PROGRESS_BLOCKED');
    return r;
  }
  async function snapshot() {
    return (await ok(s, outline)).progress;
  }
  async function save(chapters) {
    const v = await ok(t, outline);
    return ok(t, outline, { type: 'SAVE_OUTLINE', revision: v.revision, chapters });
  }
  async function publish() {
    const v = await ok(t, outline);
    return ok(t, outline, { type: 'PUBLISH_OUTLINE', revision: v.revision });
  }
  async function row(id) {
    const r = await db.query(
      'SELECT revision::text,status FROM zhiban_learning.attempts WHERE tenant_id=$1 AND id=$2',
      [tenant, id],
    );
    return r.rows[0];
  }
  async function submit(id, text) {
    return ok(s, base, { type: 'SUBMIT', id, revision: (await row(id)).revision, answer: text });
  }
  async function waitQueued(count) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const n = Number(
        (
          await db.query(
            "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND NOT granted AND database=(SELECT oid FROM pg_database WHERE datname=current_database())",
          )
        ).rows[0].count,
      );
      if (n >= count) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw Error('Progress lock did not queue ' + count + ' writes');
  }
  async function serialize(first, second) {
    lock = await db.connect();
    await lock.query('BEGIN');
    await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `progress:${tenant}:${offering}`,
    ]);
    const one = first();
    await waitQueued(1);
    const two = second();
    await waitQueued(2);
    await lock.query('COMMIT');
    lock.release();
    lock = null;
    return Promise.all([one, two]);
  }
  try {
    t = await actor('TEACHER');
    s = await actor('STUDENT');
    a = await actor('ADMIN');
    await t.goto(meta.origin + '/zhiban/teacher/courses?space=' + tenant);
    const entry = t.getByRole('link', { name: '进入课程工作区', exact: true });
    await expect(entry).toHaveCount(1);
    course = /\/courses\/([0-9a-f-]+)\?/.exec(await entry.getAttribute('href'))[1];
    original = structuredClone((await ok(t, outline)).chapters).filter(
      (c) => c.title !== '本地验证 · 学习规则',
    );
    await save(original);
    await publish();
    for (const prior of (await ok(t, classBase)).sessions.filter(
      (x) => x.title === '本地先修规则验证课堂' && x.state === 'PUBLISHED',
    ))
      await ok(t, classBase, { type: 'END_CLASSROOM', id: prior.id, revision: prior.revision });
    assert.equal((await snapshot()).configured, false, 'baseline must remain free learning');
    for (const name of ['A', 'B', 'C', 'D']) {
      const r = await ok(t, base, {
        type: 'CREATE_ACTIVITY',
        title: labels[name],
        prompt: '本地先修规则定向验证',
        deadlineAt: null,
        allowResubmit: true,
        maxAttempts: 5,
      });
      ids[name] = r.id;
      await ok(t, base, { type: 'PUBLISH_ACTIVITY', id: r.id, revision: r.revision });
    }
    const quizContent = {
      type: 'quiz',
      questions: [
        {
          id: 'q1',
          type: 'single',
          question: '选择安全操作',
          options: [
            { value: 'A', label: '先断电' },
            { value: 'B', label: '直接维修' },
          ],
          answer: ['A'],
          analysis: '先断电',
          points: 1,
        },
      ],
    };
    const quiz = await ok(t, base + '/quizzes', {
      type: 'CREATE_QUIZ',
      title: labels.Q,
      mode: 'ASSESSED',
      content: quizContent,
      deadlineAt: null,
      allowResubmit: true,
      maxAttempts: 5,
    });
    ids.Q = quiz.id;
    await ok(t, base + '/quizzes', { type: 'PUBLISH_QUIZ', id: quiz.id, revision: quiz.revision });
    const chapter = {
      id: crypto.randomUUID(),
      title: '本地验证 · 学习规则',
      units: Object.entries(ids).map(([k, id]) => ({
        id: crypto.randomUUID(),
        kind: 'ACTIVITY',
        title: labels[k],
        target: id,
      })),
    };
    await save([...original, chapter]);
    await publish();
    const pre = await ok(s, base, { type: 'START_ATTEMPT', id: ids.C });
    results.existingAttempt = pre.id;
    classroom = await ok(t, classBase, {
      type: 'CREATE_CLASSROOM',
      title: '本地先修规则验证课堂',
      description: '只验证当前进度门禁及原子进入',
      opensAt: null,
      closesAt: null,
    });
    classroom = {
      ...classroom,
      ...(await ok(t, classBase, {
        type: 'PUBLISH_CLASSROOM',
        id: classroom.id,
        revision: classroom.revision,
      })),
    };
    let dispatch = await ok(t, classBase, {
      type: 'DISPATCH_TASK',
      id: classroom.id,
      revision: classroom.revision,
      kind: 'ACTIVITY',
      target: ids.C,
      version: '1',
    });
    classroom.revision = dispatch.revision;
    const priorEntry = await ok(s, classBase, {
      type: 'ENTER_TASK',
      id: classroom.id,
      revision: classroom.revision,
      dispatchId: dispatch.dispatchId,
    });
    assert.equal(priorEntry.attemptId, pre.id);
    const teacherUrl =
      meta.origin + `/zhiban/teacher/courses/${course}?space=${tenant}&offering=${offering}`;
    await t.goto(teacherUrl);
    await expect(t.getByRole('heading', { name: '章节与单元', exact: true })).toBeVisible();
    for (const k of ['A', 'B', 'C', 'D', 'Q']) {
      for (const details of await t.locator('details').all())
        await details.evaluate((n) => {
          n.open = true;
        });
      const enable = t.getByLabel('启用完成规则 · ' + labels[k], { exact: true });
      await expect(enable).toBeAttached();
      await enable.evaluate((n) => {
        n.closest('details').open = true;
      });
      await enable.check();
    }
    await t.getByLabel('完成依据 · ' + labels.A, { exact: true }).selectOption('PUBLISHED_GRADE');
    // Redraw closes disclosure widgets; open only the exact controls needed.
    for (const details of await t.locator('details').all())
      await details.evaluate((n) => {
        n.open = true;
      });
    await t.getByLabel('成绩百分比阈值 · ' + labels.A, { exact: true }).fill('60');
    for (const k of ['B', 'C', 'D', 'Q'])
      await t
        .getByLabel('先修活动（最多 8 项） · ' + labels[k], { exact: true })
        .selectOption([ids.A]);
    const savedResponse = t.waitForResponse(
      (r) => r.url().endsWith('/outline') && r.request().method() === 'POST',
    );
    await t.getByRole('button', { name: '保存目录草稿', exact: true }).click();
    assert.equal((await savedResponse).status(), 200);
    await expect(t.getByRole('button', { name: '发布已保存目录', exact: true })).toBeEnabled();
    assert.equal((await snapshot()).configured, false, 'draft cannot change access');
    const pubResponse = t.waitForResponse(
      (r) => r.url().endsWith('/outline') && r.request().method() === 'POST',
    );
    await t.getByRole('button', { name: '发布已保存目录', exact: true }).click();
    assert.equal((await pubResponse).status(), 200);
    checks.push(
      'Teacher browser configures official-grade threshold, required units and prerequisite graph; draft is inert until explicit offering outline publication',
    );
    let p = await snapshot();
    assert.equal(p.required, 5);
    assert.equal(p.satisfied, 0);
    assert.deepEqual(p.rows.find((r) => r.activityId === ids.B).blockedBy, [ids.A]);
    await blocked(s, base, { type: 'START_ATTEMPT', id: ids.B });
    await blocked(s, base + '/quizzes', {
      type: 'START_QUIZ_ATTEMPT',
      activityId: ids.Q,
      expectedVersion: '1',
    });
    assert.equal((await ok(s, base, { type: 'START_ATTEMPT', id: ids.C })).id, pre.id);
    await submit(pre.id, '规则发布前已开始的作答可以提交');
    const reenter = await ok(s, classBase, {
      type: 'ENTER_TASK',
      id: classroom.id,
      revision: classroom.revision,
      dispatchId: dispatch.dispatchId,
    });
    assert.equal(reenter.attemptId, pre.id);
    dispatch = await ok(t, classBase, {
      type: 'DISPATCH_TASK',
      id: classroom.id,
      revision: classroom.revision,
      kind: 'ACTIVITY',
      target: ids.D,
      version: '1',
    });
    classroom.revision = dispatch.revision;
    await blocked(s, classBase, {
      type: 'ENTER_TASK',
      id: classroom.id,
      revision: classroom.revision,
      dispatchId: dispatch.dispatchId,
    });
    assert.equal(
      Number(
        (
          await db.query(
            'SELECT count(*) FROM zhiban_classroom.entries WHERE tenant_id=$1 AND dispatch_id=$2',
            [tenant, dispatch.dispatchId],
          )
        ).rows[0].count,
      ),
      0,
    );
    checks.push(
      'New text Attempt, assessed Quiz Attempt and classroom entry fail closed with no entry residue; prior Attempt resumes/submits and prior classroom entry reopens',
    );
    const aa = await ok(s, base, { type: 'START_ATTEMPT', id: ids.A }),
      sub = await submit(aa.id, '教师配置明确要求已发布成绩');
    results.prerequisiteAttempt = aa.id;
    results.submission = sub.submissionId;
    let gradeResult = await ok(t, grade, {
      type: 'SAVE_GRADE',
      submissionId: sub.submissionId,
      revision: null,
      score: '90',
      maxScore: '100',
      feedback: '发布后生效',
    });
    assert.equal(
      (await snapshot()).rows.find((r) => r.activityId === ids.A).complete,
      false,
      'unpublished grade must not unlock',
    );
    gradeResult = await ok(t, grade, {
      type: 'PUBLISH_GRADE',
      submissionId: sub.submissionId,
      revision: gradeResult.revision,
    });
    p = await snapshot();
    assert.equal(p.rows.find((r) => r.activityId === ids.A).complete, true);
    assert.equal(p.satisfied, 2);
    const studentUrl =
      meta.origin + `/zhiban/student/courses/${course}?space=${tenant}&offering=${offering}`;
    await s.goto(studentUrl);
    await expect(s.getByText(new RegExp('必修活动完成 2 / 5'))).toBeVisible();
    await s.screenshot({
      path: 'docs/v2/evidence/learning-rules/student-progress.png',
      fullPage: true,
    });
    await s.goto(
      meta.origin +
        `/zhiban/student/courses/${course}/learning-center/${chapter.units.find((u) => u.target === ids.B).id}?space=${tenant}&offering=${offering}`,
    );
    await expect(s.getByRole('heading', { name: '课程学习中心', exact: true })).toBeVisible();
    await expect(s.getByText('必修活动完成 2 / 5', { exact: true })).toBeVisible();
    await s.screenshot({
      path: 'docs/v2/evidence/learning-rules/learning-center.png',
      fullPage: true,
    });
    const bb = await ok(s, base, { type: 'START_ATTEMPT', id: ids.B });
    await submit(bb.id, '正式成绩已达到阈值，后续任务可提交');
    const qAttempt = await ok(s, base + '/quizzes', {
      type: 'START_QUIZ_ATTEMPT',
      activityId: ids.Q,
      expectedVersion: '1',
    });
    assert.ok(qAttempt.id);
    const entryD = await ok(s, classBase, {
      type: 'ENTER_TASK',
      id: classroom.id,
      revision: classroom.revision,
      dispatchId: dispatch.dispatchId,
    });
    assert.ok(entryD.attemptId);
    checks.push(
      'Only immutable published grade meeting exact threshold unlocks; student sees own required count, text/Quiz/classroom then enter through original paths',
    );
    const corr = () =>
      api(t, grade, {
        type: 'CORRECT_GRADE',
        submissionId: sub.submissionId,
        revision: gradeResult.revision,
        score: '40',
        maxScore: '100',
        feedback: '更正后不达标',
        reason: '本地规则并发验证',
      });
    let race = await serialize(corr, () => api(s, base, { type: 'START_ATTEMPT', id: ids.B }));
    assert.equal(race[0].status, 200);
    gradeResult = race[0].json;
    assert.equal(race[1].status, 409);
    assert.equal(race[1].json.error.code, 'PROGRESS_BLOCKED');
    assert.equal((await snapshot()).rows.find((r) => r.activityId === ids.A).complete, false);
    await submit(pre.id, '更正后已有作答仍可重交');
    assert.equal(
      (
        await ok(s, classBase, {
          type: 'ENTER_TASK',
          id: classroom.id,
          revision: classroom.revision,
          dispatchId: dispatch.dispatchId,
        })
      ).attemptId,
      entryD.attemptId,
    );
    race = await serialize(
      () =>
        api(t, grade, {
          type: 'CORRECT_GRADE',
          submissionId: sub.submissionId,
          revision: gradeResult.revision,
          score: '80',
          maxScore: '100',
          feedback: '复核达标',
          reason: '本地规则恢复验证',
        }),
      () => api(s, base, { type: 'START_ATTEMPT', id: ids.B }),
    );
    assert.equal(race[0].status, 200);
    gradeResult = race[0].json;
    assert.equal(race[1].status, 200);
    results.secondAttempt = race[1].json.id;
    checks.push(
      'PG16 lock queue proves correction-before-entry denies and positive correction-before-entry permits; no deadlock or stale eligibility; existing writes/history remain available',
    );
    const newer = await submit(aa.id, '重交不继承旧发布成绩');
    assert.notEqual(newer.submissionId, sub.submissionId);
    assert.equal((await snapshot()).rows.find((r) => r.activityId === ids.A).complete, false);
    assert.equal(
      (await ok(s, base, { type: 'START_ATTEMPT', id: ids.B })).id,
      results.secondAttempt,
    );
    const newDispatch = await ok(t, classBase, {
      type: 'DISPATCH_TASK',
      id: classroom.id,
      revision: classroom.revision,
      kind: 'ACTIVITY',
      target: ids.B,
      version: '1',
    });
    classroom.revision = newDispatch.revision;
    await blocked(s, classBase, {
      type: 'ENTER_TASK',
      id: classroom.id,
      revision: classroom.revision,
      dispatchId: newDispatch.dispatchId,
    });
    checks.push(
      'Newer submission loses inherited grade satisfaction; existing Attempt can resume, fresh classroom entry cannot bypass by reusing that Attempt',
    );
    const membership = (
      await db.query(
        'SELECT e.id,e.revision::text,e.membership_id FROM zhiban_academic.enrollments e JOIN zhiban_learning.attempts t ON t.tenant_id=e.tenant_id AND t.enrollment_id=e.id WHERE t.tenant_id=$1 AND t.id=$2',
        [tenant, pre.id],
      )
    ).rows[0];
    assert.equal((await snapshot()).rows.find((r) => r.activityId === ids.C).complete, true);
    await ok(a, `/api/zhiban/academic/${tenant}`, {
      type: 'WITHDRAW',
      id: membership.id,
      revision: membership.revision,
    });
    assert.equal((await api(s, outline)).status, 403);
    const withdrawn = (
      await db.query(
        'SELECT revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND id=$2',
        [tenant, membership.id],
      )
    ).rows[0];
    await ok(a, `/api/zhiban/academic/${tenant}`, {
      type: 'ENROLL',
      offeringId: offering,
      membershipId: membership.membership_id,
      revision: withdrawn.revision,
    });
    const rejoined = await snapshot();
    assert.equal(rejoined.rows.find((r) => r.activityId === ids.C).complete, false);
    assert.equal(rejoined.rows.find((r) => r.activityId === ids.C).submissionId, null);
    assert.ok((await ok(s, base)).attempts.some((r) => r.id === pre.id));
    checks.push(
      'Original administrator withdraw/re-enroll commands revoke access and reset evidence window without deleting own historical attempts; previous-window submissions cannot satisfy new enrollment progress',
    );
    const current = await ok(t, outline),
      cyc = structuredClone(current.chapters),
      own = cyc.find((c) => c.id === chapter.id);
    own.units.find((u) => u.target === ids.A).progress.requires = [ids.B];
    assert.equal(
      (await api(t, outline, { type: 'SAVE_OUTLINE', revision: current.revision, chapters: cyc }))
        .status,
      400,
    );
    for (const who of [s, a])
      assert.equal(
        (
          await api(who, outline, {
            type: 'SAVE_OUTLINE',
            revision: current.revision,
            chapters: current.chapters,
          })
        ).status,
        403,
      );
    const anon = await browser.newPage();
    await anon.goto(meta.origin + '/zhiban');
    assert.equal((await api(anon, outline)).status, 401);
    await anon.close();
    const foreign = await api(s, `/api/zhiban/learning/${ids.B}/offerings/${offering}/outline`);
    assert.ok([400, 403].includes(foreign.status));
    checks.push(
      'Cyclic graph, student/admin authoring, anonymous reads and foreign tenant are rejected without changing published rules',
    );
    const aRow = (
      await db.query(
        'SELECT revision::text FROM zhiban_learning.activities WHERE tenant_id=$1 AND id=$2',
        [tenant, ids.A],
      )
    ).rows[0];
    const edit = await ok(t, base, {
      type: 'EDIT_ACTIVITY',
      id: ids.A,
      revision: aRow.revision,
      title: labels.A,
      prompt: '已换版，规则须重新绑定',
      deadlineAt: null,
      allowResubmit: true,
      maxAttempts: 5,
    });
    await ok(t, base, { type: 'PUBLISH_ACTIVITY', id: ids.A, revision: edit.revision });
    assert.equal((await snapshot()).rows.find((r) => r.activityId === ids.A).stale, true);
    await blocked(s, base, { type: 'START_ATTEMPT', id: ids.A });
    const stalePub = await api(t, outline, { type: 'PUBLISH_OUTLINE', revision: current.revision });
    assert.equal(stalePub.status, 409);
    await t.goto(teacherUrl);
    for (const details of await t.locator('details').all())
      await details.evaluate((n) => {
        n.open = true;
      });
    await t.getByRole('button', { name: '绑定当前版本 · ' + labels.A, exact: true }).click();
    const rebindSave = t.waitForResponse(
      (r) => r.url().endsWith('/outline') && r.request().method() === 'POST',
    );
    await t.getByRole('button', { name: '保存目录草稿', exact: true }).click();
    assert.equal((await rebindSave).status(), 200);
    await expect(t.getByRole('button', { name: '发布已保存目录', exact: true })).toBeEnabled();
    await publish();
    assert.equal((await snapshot()).rows.find((r) => r.activityId === ids.A).stale, false);
    assert.equal((await snapshot()).rows.find((r) => r.activityId === ids.A).complete, false);
    checks.push(
      'Activity version change invalidates pinned rule; stale publication rejects; explicit teacher browser rebind + save + publish never inherits previous version evidence',
    );
    const nonRequired = structuredClone((await ok(t, outline)).chapters);
    for (const unit of nonRequired.flatMap((c) => c.units))
      if (unit.progress) unit.progress.required = false;
    await save(nonRequired);
    await publish();
    assert.equal((await snapshot()).required, 0);
    assert.equal((await snapshot()).satisfied, 0);
    checks.push(
      'Zero required denominator remains explicit with no manufactured 100 percent completion',
    );
    const practice = await ok(t, base + '/quizzes', {
      type: 'CREATE_QUIZ',
      title: '先修验证 · 练习不作完成依据',
      mode: 'PRACTICE',
      content: quizContent,
      deadlineAt: null,
      allowResubmit: true,
      maxAttempts: 5,
    });
    await ok(t, base + '/quizzes', {
      type: 'PUBLISH_QUIZ',
      id: practice.id,
      revision: practice.revision,
    });
    const withPractice = structuredClone((await ok(t, outline)).chapters);
    withPractice
      .find((c) => c.id === chapter.id)
      .units.push({
        id: crypto.randomUUID(),
        kind: 'ACTIVITY',
        target: practice.id,
        title: '练习',
        progress: { kind: 'SUBMITTED', version: 1, required: true, thresholdBps: 0, requires: [] },
      });
    await save(withPractice);
    assert.equal(
      (
        await api(t, outline, {
          type: 'PUBLISH_OUTLINE',
          revision: (await ok(t, outline)).revision,
        })
      ).status,
      409,
    );
    checks.push('Practice Quiz cannot be published as a trusted completion source');
    const audits = await db.query(
      "SELECT event_type,facts FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND event_type='LEARNING_START_ATTEMPT' AND facts#>>'{result,id}'=$2 AND facts#>>'{result,resumed}'='false'",
      [tenant, results.secondAttempt],
    );
    assert.equal(audits.rowCount, 1);
    assert.ok(audits.rows[0].facts.progressDecision.publicationNo > 0);
    assert.ok(
      audits.rows[0].facts.progressDecision.evaluated.some(
        (r) => r.activityId === ids.A && r.gradePublicationId,
      ),
    );
    checks.push(
      'Successful new Attempt audit binds published outline number and own immutable submission/grade references; rule publications keep immutable chapter snapshots',
    );
    assert.deepEqual(errors, []);
    await save(original);
    await publish();
    assert.equal((await snapshot()).configured, false);
    classroom = {
      ...classroom,
      ...(await ok(t, classBase, {
        type: 'END_CLASSROOM',
        id: classroom.id,
        revision: classroom.revision,
      })),
    };
    fs.writeFileSync(
      'docs/v2/evidence/learning-rules/journey.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          origin: meta.origin,
          root: meta.root,
          tenant,
          offering,
          serverVersion: version,
          checks,
          ids,
          results,
          restoredOriginalOutline: true,
          endedVerificationClassroom: true,
          realModelsInvoked: false,
          errors,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      'LOCAL learning rules: PASS',
      checks.length,
      'scenarios; original outline restored; verification classroom ended',
    );
  } finally {
    if (lock) {
      await lock.query('ROLLBACK');
      lock.release();
    }
    if (a && results.existingAttempt) {
      try {
        const r = (
          await db.query(
            'SELECT e.* FROM zhiban_academic.enrollments e JOIN zhiban_learning.attempts t ON t.tenant_id=e.tenant_id AND t.enrollment_id=e.id WHERE t.tenant_id=$1 AND t.id=$2',
            [tenant, results.existingAttempt],
          )
        ).rows[0];
        if (r?.status === 'WITHDRAWN')
          await ok(a, `/api/zhiban/academic/${tenant}`, {
            type: 'ENROLL',
            offeringId: offering,
            membershipId: r.membership_id,
            revision: r.revision,
          });
      } catch (e) {
        console.error('Enrollment cleanup failed:', e.message);
        process.exitCode = 1;
      }
    }
    if (original && t) {
      try {
        await save(original);
        await publish();
      } catch (e) {
        console.error('Outline cleanup failed:', e.message);
        process.exitCode = 1;
      }
    }
    if (classroom?.id && t) {
      try {
        const current = (await ok(t, classBase)).sessions.find((x) => x.id === classroom.id);
        if (current?.state === 'PUBLISHED')
          await ok(t, classBase, {
            type: 'END_CLASSROOM',
            id: current.id,
            revision: current.revision,
          });
      } catch (e) {
        console.error('Classroom cleanup failed:', e.message);
        process.exitCode = 1;
      }
    }
    await Promise.all(contexts.map((c) => c.close()));
    await browser.close();
    await db.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
