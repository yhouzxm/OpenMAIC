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
    grade = `/api/zhiban/assessment/${tenant}/offerings/${offering}`,
    url = grade + '/finalgrades';
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
  let lock, t, t2, s, a, member, course, enrollmentToRestore;
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
  async function preview() {
    return (await ok(t, url + '?member=' + member)).preview;
  }
  async function submit(activity) {
    const attempt = await ok(s, base, { type: 'START_ATTEMPT', id: activity });
    const sub = await ok(s, base, {
      type: 'SUBMIT',
      id: attempt.id,
      revision: attempt.revision,
      answer: '总评规则真实本地作答',
    });
    return { attempt, ...sub };
  }
  async function mark(sub, score, max = '100') {
    let g = await ok(t, grade, {
      type: 'SAVE_GRADE',
      submissionId: sub.submissionId,
      revision: null,
      score,
      maxScore: max,
      feedback: '按正式标准评分',
    });
    g = await ok(t, grade, {
      type: 'PUBLISH_GRADE',
      submissionId: sub.submissionId,
      revision: g.revision,
    });
    return g;
  }
  async function queued(n) {
    const end = Date.now() + 5000;
    while (Date.now() < end) {
      const count = Number(
        (
          await db.query(
            'SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0',
          )
        ).rows[0].count,
      );
      if (count >= n) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw Error('Expected queued writes ' + n);
  }
  async function serialize(one, two) {
    concurrencyTokens.set(t, (await ok(t, '/api/zhiban/identity/csrf')).csrfToken);
    concurrencyTokens.set(t2, (await ok(t2, '/api/zhiban/identity/csrf')).csrfToken);
    lock = await db.connect();
    await lock.query('BEGIN');
    await lock.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `progress:${tenant}:${offering}`,
    ]);
    const jobs = [];
    let failed;
    try {
      jobs.push(one());
      jobs[0].catch(() => {});
      await queued(1);
      jobs.push(two());
      jobs[1].catch(() => {});
      await queued(2);
    } catch (e) {
      failed = e;
    } finally {
      await lock.query('COMMIT');
      lock.release();
      lock = null;
    }
    const settled = await Promise.allSettled(jobs);
    concurrencyTokens.clear();
    if (failed) throw failed;
    const rejected = settled.find((r) => r.status === 'rejected');
    if (rejected) throw rejected.reason;
    return settled.map((r) => r.value);
  }
  try {
    t = await actor('TEACHER');
    s = await actor('STUDENT');
    a = await actor('ADMIN');
    t2 = await actor('TEACHER');
    await t.goto(m.origin + '/zhiban/teacher/courses?space=' + tenant);
    const entry = t.getByRole('link', { name: '进入课程工作区', exact: true });
    await expect(entry).toHaveCount(1);
    course = /\/courses\/([0-9a-f-]+)\?/.exec(await entry.getAttribute('href'))[1];
    for (const name of ['A', 'B']) {
      const created = await ok(t, base, {
        type: 'CREATE_ACTIVITY',
        title: '总评验证 · ' + name,
        prompt: '权重总评与申诉本地验证',
        deadlineAt: null,
        allowResubmit: true,
        maxAttempts: 5,
      });
      ids[name] = created.id;
      await ok(t, base, { type: 'PUBLISH_ACTIVITY', id: created.id, revision: created.revision });
    }
    const subA = await submit(ids.A);
    member = (
      await db.query(
        'SELECT membership_id FROM zhiban_learning.attempts WHERE tenant_id=$1 AND id=$2',
        [tenant, subA.attempt.id],
      )
    ).rows[0].membership_id;
    let ga = await mark(subA, '80');
    const teacherUrl =
        m.origin + `/zhiban/teacher/courses/${course}/grades?space=${tenant}&offering=${offering}`,
      studentUrl =
        m.origin + `/zhiban/student/courses/${course}/grades?space=${tenant}&offering=${offering}`;
    await t.goto(teacherUrl);
    const root = t.locator('#final-grades');
    await expect(
      root.getByRole('heading', { name: '课程总评与成绩申诉', exact: true }),
    ).toBeVisible();
    await expect(root.getByRole('button', { name: '添加总评活动', exact: true })).toBeEnabled();
    const initial = await ok(t, url);
    if (initial.draft.length) {
      for (let i = initial.draft.length; i > 0; i--)
        await root.getByRole('button', { name: '移除权重 ' + i, exact: true }).click();
    }
    await root.getByRole('button', { name: '添加总评活动', exact: true }).click();
    await root.getByLabel('总评活动 1', { exact: true }).selectOption(ids.A);
    await root.getByLabel('权重百分比 1', { exact: true }).fill('60');
    await root.getByRole('button', { name: '添加总评活动', exact: true }).click();
    await root.getByLabel('总评活动 2', { exact: true }).selectOption(ids.B);
    await root.getByLabel('权重百分比 2', { exact: true }).fill('40');
    let response = t.waitForResponse(
      (r) => r.url() === m.origin + url && r.request().method() === 'POST',
    );
    response.catch(() => {});
    await root.getByRole('button', { name: '保存总评权重草稿', exact: true }).click();
    assert.equal((await response).status(), 200);
    const studentDraft = await ok(s, url);
    assert.ok(!Object.hasOwn(studentDraft, 'draft'));
    assert.ok(!Object.hasOwn(studentDraft, 'preview'));
    assert.equal(studentDraft.ruleVersion, initial.ruleVersion);
    await expect(root.getByRole('button', { name: '发布总评权重', exact: true })).toBeEnabled();
    response = t.waitForResponse(
      (r) => r.url() === m.origin + url && r.request().method() === 'POST',
    );
    response.catch(() => {});
    await root.getByRole('button', { name: '发布总评权重', exact: true }).click();
    assert.equal((await response).status(), 200);
    let p = await preview();
    assert.equal(p.ready, false);
    assert.equal(p.scorePoints, null);
    assert.equal(p.components.find((c) => c.activityId === ids.B).status, 'NOT_SUBMITTED');
    const invalid = {
      type: 'PUBLISH_TOTAL',
      memberId: member,
      sourceDigest: p.sourceDigest,
      previousId: p.latest?.id ?? null,
      reason: '缺分不记零',
    };
    assert.equal((await api(t, url, invalid)).status, 409);
    checks.push(
      'Teacher browser authors and explicitly publishes 60/40 fixed-version weights; draft is private/inert; missing grade remains incomplete and cannot publish or zero-fill',
    );
    const subB = await submit(ids.B),
      draftGrade = await ok(t, grade, {
        type: 'SAVE_GRADE',
        submissionId: subB.submissionId,
        revision: null,
        score: '10',
        maxScore: '20',
        feedback: '草稿不计总评',
      });
    assert.equal((await preview()).ready, false);
    await ok(t, grade, {
      type: 'PUBLISH_GRADE',
      submissionId: subB.submissionId,
      revision: draftGrade.revision,
    });
    p = await preview();
    assert.equal(p.scorePoints, 6800);
    const person = (
      await db.query(
        'SELECT display_name FROM zhiban_academic.people WHERE tenant_id=$1 AND membership_id=$2',
        [tenant, member],
      )
    ).rows[0].display_name;
    await expect(root.getByRole('button', { name: '总评 · ' + person, exact: true })).toBeEnabled();
    await root.getByRole('button', { name: '总评 · ' + person, exact: true }).click();
    await expect(
      root.getByRole('heading', { name: '总评预览：68 / 100', exact: true }),
    ).toBeVisible();
    await root.getByLabel('总评发布说明', { exact: true }).fill('按已发布60/40权重首次发布');
    response = t.waitForResponse(
      (r) => r.url() === m.origin + url && r.request().method() === 'POST',
    );
    response.catch(() => {});
    await root.getByRole('button', { name: '发布该学生总评', exact: true }).click();
    const publishedResponse = await response;
    assert.equal(publishedResponse.status(), 200);
    const first = await publishedResponse.json(),
      request = publishedResponse.request();
    ids.first = first.id;
    await expect(root.getByRole('button', { name: '查看总评', exact: true })).toBeEnabled();
    assert.deepEqual(
      await ok(t, url, request.postDataJSON(), request.headers()['x-zhiban-command']),
      first,
    );
    assert.equal(
      (
        await api(
          t,
          url,
          { ...request.postDataJSON(), reason: '不同payload' },
          request.headers()['x-zhiban-command'],
        )
      ).status,
      409,
    );
    checks.push(
      'Official immutable grades normalize by their own maxima to 68/100; teacher publishes through real UI; command replay is exact and changed payload rejects',
    );
    await s.goto(studentUrl);
    const studentRoot = s.locator('#final-grades');
    await expect(
      studentRoot.getByRole('heading', {
        name: `总评第 ${first.version} 版：68 / 100`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(studentRoot.getByText('总评预览', { exact: false })).toHaveCount(0);
    await studentRoot
      .getByLabel(`申诉理由 · 总评第 ${first.version} 版`, { exact: true })
      .fill('请复核第一项的评分依据及总评权重。');
    response = s.waitForResponse(
      (r) => r.url() === m.origin + url && r.request().method() === 'POST',
    );
    response.catch(() => {});
    await studentRoot
      .getByRole('button', { name: `提交申诉 · 总评第 ${first.version} 版`, exact: true })
      .click();
    assert.equal((await response).status(), 200);
    const appeal = (await ok(s, url + '?view=APPEALS')).rows.find(
      (r) => r.publication_id === first.id,
    );
    ids.appeal = appeal.id;
    assert.ok(appeal);
    assert.equal(
      (await api(s, url, { type: 'OPEN_APPEAL', publicationId: first.id, body: '重复申诉' }))
        .status,
      409,
    );
    await s.screenshot({
      path: 'docs/v2/evidence/final-grades/student-total-appeal.png',
      fullPage: true,
    });
    checks.push(
      'Student sees own published snapshot and component weights only, submits one appeal per publication through UI; duplicate appeal rejects',
    );
    for (const who of [s, a])
      assert.equal(
        (await api(who, url, { type: 'PUBLISH_WEIGHTS', revision: (await ok(t, url)).revision }))
          .status,
        403,
      );
    const other = (
      await db.query(
        'SELECT membership_id FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id<>$3 LIMIT 1',
        [tenant, offering, member],
      )
    ).rows[0].membership_id;
    assert.equal((await api(s, url + '?member=' + other)).status, 403);
    assert.equal(
      (await api(s, url, { type: 'OPEN_APPEAL', publicationId: ids.A, body: '伪造目标' })).status,
      404,
    );
    assert.equal(
      (
        await api(s, url, {
          type: 'OPEN_APPEAL',
          publicationId: first.id,
          body: '冒名',
          memberId: other,
        })
      ).status,
      400,
    );
    const anon = await b.newPage();
    await anon.goto(m.origin + '/zhiban');
    assert.equal((await api(anon, url)).status, 401);
    await anon.close();
    assert.equal(
      (await api(s, `/api/zhiban/assessment/${ids.A}/offerings/${offering}/finalgrades`)).status,
      403,
    );
    checks.push(
      'Student/admin weight writes, cross-member reads, forged appeal targets/identity, anonymous and foreign tenant requests reject',
    );
    const initialDigest = (await preview()).sourceDigest;
    ga = await ok(t, grade, {
      type: 'CORRECT_GRADE',
      submissionId: subA.submissionId,
      revision: ga.revision,
      score: '100',
      maxScore: '100',
      feedback: '复核为100分',
      reason: '依照评分标准复核',
    });
    const studentAfter = await ok(s, url);
    assert.equal(studentAfter.rows[0].score_points, 6800);
    assert.equal(studentAfter.needsRecalculation, true);
    assert.equal(
      (
        await api(t, url, {
          type: 'PUBLISH_TOTAL',
          memberId: member,
          sourceDigest: initialDigest,
          previousId: first.id,
          reason: '使用旧来源',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await api(t, url, {
          type: 'RESOLVE_APPEAL',
          id: appeal.id,
          memberId: member,
          revision: appeal.revision,
          decision: 'REPLACED',
          body: '尚未重发不能结案',
        })
      ).status,
      409,
    );
    p = await preview();
    assert.equal(p.scorePoints, 8000);
    const stalePublish = {
      type: 'PUBLISH_TOTAL',
      memberId: member,
      sourceDigest: p.sourceDigest,
      previousId: first.id,
      reason: '应拒绝并发旧来源',
    };
    let race = await serialize(
      () =>
        api(t, grade, {
          type: 'CORRECT_GRADE',
          submissionId: subA.submissionId,
          revision: ga.revision,
          score: '90',
          maxScore: '100',
          feedback: '并发验证',
          reason: '定向并发验证',
        }),
      () => api(t2, url, stalePublish),
    );
    assert.equal(race[0].status, 200);
    ga = race[0].json;
    assert.equal(race[1].status, 409);
    ga = await ok(t, grade, {
      type: 'CORRECT_GRADE',
      submissionId: subA.submissionId,
      revision: ga.revision,
      score: '100',
      maxScore: '100',
      feedback: '确认复核结果',
      reason: '恢复最终复核结果',
    });
    p = await preview();
    const secondBody = {
      type: 'PUBLISH_TOTAL',
      memberId: member,
      sourceDigest: p.sourceDigest,
      previousId: first.id,
      reason: '复核后重新发布总评',
    };
    race = await serialize(
      () => api(t, url, secondBody),
      () => api(t2, url, secondBody),
    );
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
    const second = race.find((r) => r.status === 200).json;
    ids.second = second.id;
    assert.equal(second.scorePoints, 8000);
    assert.equal(second.version, first.version + 1);
    checks.push(
      'Published 68 snapshot stays immutable after correction; stale-source publication and premature replacement reject; deterministic correction/publication race rejects and two publishers yield exactly one successor 80 snapshot',
    );
    await root.getByRole('button', { name: '查看成绩申诉', exact: true }).click();
    await root
      .getByLabel('申诉处理说明 · ' + appeal.id, { exact: true })
      .fill('已按原单项成绩更正流程复核，并重新发布80分总评；权重保持60/40。');
    response = t.waitForResponse(
      (r) => r.url() === m.origin + url && r.request().method() === 'POST',
    );
    response.catch(() => {});
    await root
      .getByLabel('申诉处理说明 · ' + appeal.id, { exact: true })
      .locator('..')
      .locator('..')
      .getByRole('button', { name: '关联已重发总评并结案', exact: true })
      .click();
    assert.equal((await response).status(), 200);
    await studentRoot.getByRole('button', { name: '查看成绩申诉', exact: true }).click();
    await expect(
      studentRoot
        .getByRole('heading', {
          name: `总评第 ${first.version} 版 · 68 / 100 · 已处理`,
          exact: true,
        })
        .locator('..')
        .getByText('处理说明：已按原单项成绩更正流程复核，并重新发布80分总评；权重保持60/40。', {
          exact: true,
        }),
    ).toBeVisible();
    await s.screenshot({
      path: 'docs/v2/evidence/final-grades/student-resolved.png',
      fullPage: true,
    });
    const resolved = (await ok(s, url + '?view=APPEALS')).rows.find((r) => r.id === appeal.id);
    assert.equal(resolved.state, 'RESOLVED');
    assert.equal(resolved.replacement_id, second.id);
    assert.equal(
      (
        await api(t, url, {
          type: 'RESOLVE_APPEAL',
          id: appeal.id,
          memberId: member,
          revision: '1',
          decision: 'EXPLAINED',
          body: '重复处理',
        })
      ).status,
      409,
    );
    checks.push(
      'Teacher UI closes appeal with immutable explanation and actual replacement total; student UI sees response; duplicate/stale decision rejects and appeal never edits original grade',
    );
    // Tenant RLS and immutable-column ACL are tested under the actual restricted runtime role.
    const c = await db.connect();
    try {
      await c.query('BEGIN');
      await c.query('SET LOCAL ROLE zhiban_academic_runtime');
      await c.query("SELECT set_config('app.tenant_id',$1,true)", [ids.A]);
      assert.equal((await c.query('SELECT id FROM zhiban_finalgrade.publications')).rowCount, 0);
      await c.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
      for (const sql of [
        'UPDATE zhiban_finalgrade.publications SET score_points=0',
        'DELETE FROM zhiban_finalgrade.publications',
        'UPDATE zhiban_finalgrade.rules SET items=items',
        'UPDATE zhiban_finalgrade.responses SET body=body',
      ]) {
        await c.query('SAVEPOINT denied');
        await assert.rejects(c.query(sql), (e) => e.code === '42501');
        await c.query('ROLLBACK TO SAVEPOINT denied');
      }
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
    checks.push(
      'Real PG16 runtime role cannot update/delete total snapshots, rule history or appeal responses; cross-tenant RLS returns no records',
    );
    const newer = await ok(s, base, {
      type: 'SUBMIT',
      id: subA.attempt.id,
      revision: (
        await db.query(
          'SELECT revision::text FROM zhiban_learning.attempts WHERE tenant_id=$1 AND id=$2',
          [tenant, subA.attempt.id],
        )
      ).rows[0].revision,
      answer: '重交不得继承原成绩或总评',
    });
    assert.ok(newer.submissionId);
    p = await preview();
    assert.equal(p.ready, false);
    assert.equal((await ok(s, url)).rows[0].score_points, 8000);
    assert.equal((await ok(s, url)).needsRecalculation, true);
    checks.push(
      'Resubmission drops eligibility without zero-fill or inherited grade, while both immutable total versions and resolved appeal remain readable',
    );
    const cfg = await ok(t, url),
      items = [
        { activityId: ids.A, version: 1, weightBps: 5000 },
        { activityId: ids.B, version: 1, weightBps: 5000 },
      ];
    await ok(t, url, { type: 'SAVE_WEIGHTS', revision: cfg.revision, items });
    const draftConfig = await ok(t, url);
    assert.equal((await ok(s, url)).ruleVersion, cfg.ruleVersion);
    await ok(t, url, { type: 'PUBLISH_WEIGHTS', revision: draftConfig.revision });
    assert.equal((await ok(s, url)).rows[0].rule_version, cfg.ruleVersion);
    checks.push(
      'Draft weight change stays private; newly published weights require fresh total publication and never rewrite old snapshot weight versions',
    );
    const beforeEdit = (
      await db.query(
        'SELECT revision::text FROM zhiban_learning.activities WHERE tenant_id=$1 AND id=$2',
        [tenant, ids.A],
      )
    ).rows[0];
    const edited = await ok(t, base, {
      type: 'EDIT_ACTIVITY',
      id: ids.A,
      revision: beforeEdit.revision,
      title: '总评验证 · A',
      prompt: '版本变化不继承原总评来源',
      deadlineAt: null,
      allowResubmit: true,
      maxAttempts: 5,
    });
    await ok(t, base, { type: 'PUBLISH_ACTIVITY', id: ids.A, revision: edited.revision });
    p = await preview();
    assert.equal(p.components.find((c) => c.activityId === ids.A).status, 'VERSION_UNAVAILABLE');
    assert.equal(
      (await api(t, url, { type: 'PUBLISH_WEIGHTS', revision: (await ok(t, url)).revision }))
        .status,
      409,
    );
    checks.push(
      'Activity version changes close pending total publication and reject stale pinned weight publication; history remains intact',
    );
    const practice = await ok(t, base + '/quizzes', {
      type: 'CREATE_QUIZ',
      title: '总评验证 · 练习不计总评',
      mode: 'PRACTICE',
      content: {
        type: 'quiz',
        questions: [
          {
            id: 'q1',
            type: 'single',
            question: '安全操作',
            options: [
              { value: 'A', label: '断电' },
              { value: 'B', label: '直接维护' },
            ],
            answer: ['A'],
            analysis: '先断电',
            points: 1,
          },
        ],
      },
      deadlineAt: null,
      allowResubmit: true,
      maxAttempts: 5,
    });
    await ok(t, base + '/quizzes', {
      type: 'PUBLISH_QUIZ',
      id: practice.id,
      revision: practice.revision,
    });
    const c0 = await ok(t, url);
    await ok(t, url, {
      type: 'SAVE_WEIGHTS',
      revision: c0.revision,
      items: [{ activityId: practice.id, version: 1, weightBps: 10000 }],
    });
    assert.equal(
      (await api(t, url, { type: 'PUBLISH_WEIGHTS', revision: (await ok(t, url)).revision }))
        .status,
      409,
    );
    await ok(t, url, {
      type: 'SAVE_WEIGHTS',
      revision: (await ok(t, url)).revision,
      items: [
        { activityId: ids.A, version: 2, weightBps: 6000 },
        { activityId: ids.B, version: 1, weightBps: 4000 },
      ],
    });
    await ok(t, url, { type: 'PUBLISH_WEIGHTS', revision: (await ok(t, url)).revision });
    checks.push(
      'Practice mode is excluded from total source choices and rejected on explicit weight publication; valid fixed-version draft is restored',
    );
    await t.goto(teacherUrl);
    await expect(root.getByLabel('权重百分比 1', { exact: true })).toBeVisible();
    await root.getByLabel('权重百分比 1', { exact: true }).fill('55');
    await root.getByLabel('权重百分比 2', { exact: true }).fill('45');
    const cas = await ok(t2, url);
    await ok(t2, url, {
      type: 'SAVE_WEIGHTS',
      revision: cas.revision,
      items: [
        { activityId: ids.A, version: 2, weightBps: 5000 },
        { activityId: ids.B, version: 1, weightBps: 5000 },
      ],
    });
    const conflictRevisions = [];
    for (let repeat = 0; repeat < 2; repeat++) {
      response = t.waitForResponse(
        (r) => r.url() === m.origin + url && r.request().method() === 'POST',
      );
      response.catch(() => {});
      await root.getByRole('button', { name: '保存总评权重草稿', exact: true }).click();
      const conflict = await response;
      assert.equal(conflict.status(), 409);
      conflictRevisions.push(conflict.request().postDataJSON().revision);
      await expect(
        root.getByRole('button', { name: '保存总评权重草稿', exact: true }),
      ).toBeEnabled();
      await expect(root.getByLabel('权重百分比 1', { exact: true })).toHaveValue('55');
    }
    assert.equal(conflictRevisions[0], conflictRevisions[1]);
    t.once('dialog', (d) => d.accept());
    await root.getByRole('button', { name: '刷新总评与申诉', exact: true }).click();
    await expect(root.getByLabel('权重百分比 1', { exact: true })).toHaveValue('50');
    await root.getByLabel('权重百分比 1', { exact: true }).fill('60');
    await root.getByLabel('权重百分比 2', { exact: true }).fill('40');
    response = t.waitForResponse(
      (r) => r.url() === m.origin + url && r.request().method() === 'POST',
    );
    response.catch(() => {});
    await root.getByRole('button', { name: '保存总评权重草稿', exact: true }).click();
    assert.equal((await response).status(), 200);
    await expect(root.getByRole('button', { name: '发布总评权重', exact: true })).toBeEnabled();
    response = t.waitForResponse(
      (r) => r.url() === m.origin + url && r.request().method() === 'POST',
    );
    response.catch(() => {});
    await root.getByRole('button', { name: '发布总评权重', exact: true }).click();
    assert.equal((await response).status(), 200);
    checks.push(
      'Two-session weight draft conflict preserves local input and old CAS revision; repeated save stays rejected until explicit discard/refresh, preventing silent overwrite of another teacher edit',
    );
    const assignment = (
      await db.query(
        "SELECT id,revision::text,membership_id FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND status='ACTIVE'",
        [tenant, offering],
      )
    ).rows[0];
    await ok(a, `/api/zhiban/academic/${tenant}`, {
      type: 'END_TEACHER',
      id: assignment.id,
      revision: assignment.revision,
    });
    assert.equal((await api(t, url)).status, 403);
    assert.equal(
      (
        await api(t, url, {
          type: 'PUBLISH_TOTAL',
          memberId: member,
          sourceDigest: '0'.repeat(64),
          previousId: second.id,
          reason: '已撤销任教不得发布',
        })
      ).status,
      403,
    );
    const ended = (
      await db.query(
        'SELECT revision::text FROM zhiban_academic.assignments WHERE tenant_id=$1 AND id=$2',
        [tenant, assignment.id],
      )
    ).rows[0];
    await ok(a, `/api/zhiban/academic/${tenant}`, {
      type: 'ASSIGN_TEACHER',
      offeringId: offering,
      membershipId: assignment.membership_id,
      revision: ended.revision,
    });
    assert.equal((await api(t, url)).status, 200);
    checks.push(
      'Original administrator assignment revoke blocks teacher total reads/writes; original restoration restores guarded access',
    );
    const enrollment = (
      await db.query(
        'SELECT id,revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
        [tenant, offering, member],
      )
    ).rows[0];
    enrollmentToRestore = enrollment.id;
    await ok(a, `/api/zhiban/academic/${tenant}`, {
      type: 'WITHDRAW',
      id: enrollment.id,
      revision: enrollment.revision,
    });
    assert.equal((await api(s, url)).status, 403);
    const withdrawn = (
      await db.query(
        'SELECT revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND id=$2',
        [tenant, enrollment.id],
      )
    ).rows[0];
    await ok(a, `/api/zhiban/academic/${tenant}`, {
      type: 'ENROLL',
      offeringId: offering,
      membershipId: member,
      revision: withdrawn.revision,
    });
    enrollmentToRestore = null;
    p = await preview();
    assert.equal(p.ready, false);
    assert.equal(p.components.find((c) => c.activityId === ids.B).status, 'NOT_SUBMITTED');
    assert.equal((await ok(s, url)).rows[0].score_points, 8000);
    assert.equal((await ok(s, url)).needsRecalculation, true);
    checks.push(
      'Administrator withdraw/re-enroll revokes course access then creates a fresh evidence window; old submission grades cannot satisfy current total, while published total history remains visible after rejoin',
    );
    const finalA = await submit(ids.A),
      finalB = await submit(ids.B);
    await mark(finalA, '100');
    await mark(finalB, '10', '20');
    p = await preview();
    assert.equal(p.ready, true);
    assert.equal(p.scorePoints, 8000);
    const finalDemo = await ok(t, url, {
      type: 'PUBLISH_TOTAL',
      memberId: member,
      sourceDigest: p.sourceDigest,
      previousId: p.latest.id,
      reason: '演示恢复：当前选课窗口、当前活动版本和60/40正式权重',
    });
    ids.finalDemo = finalDemo.id;
    assert.equal((await ok(s, url)).needsRecalculation, false);
    await t.goto(teacherUrl);
    await expect(
      t.locator('#final-grades').getByRole('heading', { name: '教学班总评权重', exact: true }),
    ).toBeVisible();
    await t.screenshot({
      path: 'docs/v2/evidence/final-grades/teacher-weights.png',
      fullPage: true,
    });
    await s.goto(studentUrl);
    await expect(
      s
        .locator('#final-grades')
        .getByRole('heading', { name: `总评第 ${finalDemo.version} 版：80 / 100`, exact: true }),
    ).toBeVisible();
    await s.screenshot({
      path: 'docs/v2/evidence/final-grades/student-current-total.png',
      fullPage: true,
    });
    checks.push(
      'Current valid weights, enrollment window and official grades are restored through original commands; ready 80/100 demonstration total is explicitly published with immutable earlier snapshots preserved',
    );
    assert.deepEqual(errors, []);
    const count = Number(
      (
        await db.query(
          'SELECT count(*) FROM zhiban_finalgrade.publications WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND id=ANY($4::uuid[])',
          [tenant, offering, member, [first.id, second.id, finalDemo.id]],
        )
      ).rows[0].count,
    );
    assert.equal(count, 3);
    fs.writeFileSync(
      'docs/v2/evidence/final-grades/journey.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          root: m.root,
          origin: m.origin,
          tenant,
          offering,
          member,
          pgVersion: pg,
          checks,
          ids,
          errors,
          modelsInvoked: false,
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      'LOCAL final grades: PASS; weighted publication, immutable history, appeal closure and concurrent/negative boundaries verified',
    );
  } finally {
    if (lock) {
      await lock.query('ROLLBACK');
      lock.release();
    }
    if (enrollmentToRestore && a) {
      try {
        const e = (
          await db.query(
            'SELECT status,revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND id=$2',
            [tenant, enrollmentToRestore],
          )
        ).rows[0];
        if (e.status === 'WITHDRAWN')
          await ok(a, `/api/zhiban/academic/${tenant}`, {
            type: 'ENROLL',
            offeringId: offering,
            membershipId: member,
            revision: e.revision,
          });
      } catch (e) {
        console.error('Enrollment cleanup failed:', e.message);
        process.exitCode = 1;
      }
    }
    await Promise.all(contexts.map((c) => c.close()));
    await b.close();
    await db.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
