import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
import type { Observation } from '../../lib/zhiban/domain/risk/model';
import { loadRisk } from './risk';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  businessPool: import('pg').Pool;
};
type Result = { id: string; revision: string; submissionId: string; caseId: string | null };
type Detail = {
  record: Record<string, unknown>;
  current: Observation;
  rows: Record<string, unknown>[];
  next: string | null;
};
export async function verifyRisk(input: Input) {
  const {
      admin,
      businessPool,
      browser,
      http,
      origin,
      trial,
      tenant: t,
      actors: [teacher, student, outsider, foreign, manager, peer],
      record,
    } = input,
    o = trial.offeringId;
  const url = `/api/zhiban/risk/${t}/offerings/${o}`,
    learning = `/api/zhiban/learning/${t}/offerings/${o}`,
    assessment = `/api/zhiban/assessment/${t}/offerings/${o}`;
  const ok = async (path: string, a: typeof teacher, c: unknown, key = v7()) => {
    const r = await http(path, a, c, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Result;
  };
  const read = async (query: Record<string, string> = {}) => {
    const r = await http(url + '?' + new URLSearchParams(query), teacher);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as {
      rows: Record<string, unknown>[];
      next: string | null;
      current?: Observation;
    };
  };
  const detail = async (id: string) => (await read({ view: 'DETAIL', id })) as unknown as Detail;
  const review = (h: Observation, decision = 'SUPPORT') => ({
    type: 'REVIEW_SIGNAL',
    ruleCode: h.ruleCode,
    ruleRevision: h.ruleRevision,
    enrollmentId: h.enrollmentId,
    anchorId: h.anchorId,
    anchorVersion: h.anchorVersion,
    sourceKey: h.sourceKey,
    expectedDigest: h.digest,
    decision,
    body: 'PRIVATE_REVIEW_TEACHERS_ONLY',
  });
  const rules = await read({ view: 'RULES' });
  assert.equal(rules.rows.length, 3);
  assert.ok(rules.rows.every((r) => r.enabled === false && r.revision === '0'));
  assert.equal((await read()).rows.length, 0);
  const activity = async (title: string, deadlineAt: number | null = null) => {
    const a = await ok(learning, teacher, {
      type: 'CREATE_ACTIVITY',
      title,
      prompt: '请说明观察与复核依据。',
      deadlineAt,
      allowResubmit: true,
      maxAttempts: 3,
    });
    await ok(learning, teacher, { type: 'PUBLISH_ACTIVITY', id: a.id, revision: a.revision });
    return a;
  };
  const a = await activity('规则旅程：观察依据'),
    attempt = await ok(learning, student, {
      type: 'START_ATTEMPT',
      id: a.id,
      expectedVersion: '1',
    }),
    submission = await ok(learning, student, {
      type: 'SUBMIT',
      id: attempt.id,
      revision: attempt.revision,
      answer: '只记录了部分观察依据。',
    }),
    grade = await ok(assessment, teacher, {
      type: 'SAVE_GRADE',
      submissionId: submission.submissionId,
      revision: null,
      score: '40',
      maxScore: '100',
      feedback: '正式发布前的评分草稿。',
    });
  const _overdue = await activity('规则旅程：逾期任务', Date.now() + 1500);
  const practice = await ok(learning + '/quizzes', teacher, {
    type: 'CREATE_QUIZ',
    title: '规则旅程：练习不列入',
    mode: 'PRACTICE',
    content: {
      type: 'quiz',
      questions: [
        {
          id: 'q1',
          type: 'single',
          question: '请选择',
          options: [
            { value: 'A', label: '一' },
            { value: 'B', label: '二' },
          ],
          answer: ['A'],
          points: 1,
        },
      ],
    },
    deadlineAt: Date.now() + 1500,
    allowResubmit: true,
    maxAttempts: 3,
  });
  await ok(learning + '/quizzes', teacher, {
    type: 'PUBLISH_QUIZ',
    id: practice.id,
    revision: practice.revision,
  });
  for (const actor of [student, peer, outsider, foreign, manager]) {
    assert.notEqual((await http(url + '?view=RULES', actor)).status, 200);
    assert.notEqual(
      (
        await http(url, actor, {
          type: 'SAVE_RULE',
          ruleCode: 'LOW_SCORE',
          revision: '0',
          enabled: true,
          threshold: 60,
        })
      ).status,
      200,
    );
  }
  assert.equal((await http(url + '?view=QUEUE')).status, 401);
  assert.equal(
    (
      await http(
        url,
        teacher,
        { type: 'SAVE_RULE', ruleCode: 'LOW_SCORE', revision: '0', enabled: true, threshold: 60 },
        'POST',
        { 'x-zhiban-csrf': 'bad' },
      )
    ).status,
    403,
  );
  const tc = await browser.newContext();
  await tc.addCookies([
    {
      name: teacher.cookie!.split('=')[0],
      value: teacher.cookie!.split('=').slice(1).join('='),
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await tc.newPage();
  await page.goto(`${origin}/zhiban/teacher/courses/${trial.courseId}?space=${t}&offering=${o}`);
  await page.getByRole('link', { name: '风险规则与审阅', exact: true }).click();
  await page.getByRole('button', { name: '规则设置', exact: true }).click();
  await page.getByLabel('启用规则：正式发布得分率低于阈值', { exact: true }).check();
  await page.getByLabel('规则阈值：正式发布得分率低于阈值（百分比）', { exact: true }).fill('60');
  await page.getByRole('button', { name: '保存规则：正式发布得分率低于阈值', exact: true }).click();
  await expect(page.getByText('当前版本 1 · 已启用', { exact: true })).toBeVisible();
  assert.equal((await read({ code: 'LOW_SCORE' })).rows.length, 0, 'draft score excluded');
  await ok(assessment, teacher, {
    type: 'PUBLISH_GRADE',
    submissionId: submission.submissionId,
    revision: grade.revision,
  });
  const hits = await read({ code: 'LOW_SCORE' });
  assert.equal(hits.rows.length, 1);
  const hit = hits.rows[0] as unknown as Observation;
  assert.equal(hit.facts.scorePoints, 4000);
  assert.equal(
    Number((await admin.query('SELECT count(*) FROM zhiban_risk.reviews')).rows[0].count),
    0,
    'GET never creates a review',
  );
  await page.getByRole('button', { name: '规则命中待审', exact: true }).click();
  await page.getByRole('button', { name: '审阅命中', exact: true }).click();
  await page
    .getByLabel('教师私有审阅说明', { exact: true })
    .fill('PRIVATE_REVIEW_TEACHERS_ONLY：请先核查观察依据，不能直接推断学生能力。');
  const reqP = page.waitForRequest(
      (r) => new URL(r.url()).pathname === url && r.method() === 'POST',
    ),
    resP = page.waitForResponse(
      (r) => new URL(r.url()).pathname === url && r.request().method() === 'POST',
    );
  await page.getByRole('button', { name: '保存首次审阅', exact: true }).click();
  const req = await reqP,
    res = await resP;
  assert.equal(res.status(), 200);
  const reviewed = (await res.json()) as Result;
  await expect(page.getByRole('heading', { name: '教师审阅详情', exact: true })).toBeVisible();
  const key = req.headers()['x-zhiban-command'],
    cmd = req.postDataJSON();
  const [r1, r2] = await Promise.all([ok(url, teacher, cmd, key), ok(url, teacher, cmd, key)]);
  assert.equal(r1.id, r2.id);
  assert.equal(r1.id, reviewed.id);
  assert.equal((await http(url, teacher, review(hit))).status, 409);
  assert.equal((await read({ code: 'LOW_SCORE' })).rows.length, 0);
  assert.equal(
    (await http(url, teacher, { ...cmd, body: '换内容' }, 'POST', { 'x-zhiban-command': key }))
      .status,
    409,
  );
  let current = await detail(reviewed.id);
  assert.equal(current.record.case_id, null);
  // A failure in the risk audit must roll back the newly created case and its case event too.
  await admin.query('REVOKE INSERT ON zhiban_risk.events FROM zhiban_academic_runtime');
  try {
    assert.equal(
      (
        await http(url, teacher, {
          type: 'LINK_FOLLOWUP',
          id: reviewed.id,
          revision: '1',
          expectedDigest: current.current.digest,
          body: '不得留下半份跟进。',
        })
      ).status,
      503,
    );
  } finally {
    await admin.query('GRANT INSERT ON zhiban_risk.events TO zhiban_academic_runtime');
  }
  assert.equal((await detail(reviewed.id)).record.revision, '1');
  assert.equal(
    Number(
      (
        await admin.query(
          'SELECT count(*) FROM zhiban_followup.cases WHERE tenant_id=$1 AND enrollment_id=$2 AND activity_id=$3',
          [t, hit.enrollmentId, a.id],
        )
      ).rows[0].count,
    ),
    0,
  );
  assert.equal(await loadRisk(businessPool), true);
  await page.getByLabel('审阅处理动作', { exact: true }).selectOption('LINK_FOLLOWUP');
  await page
    .getByLabel('教师私有处理说明', { exact: true })
    .fill('经教师核查，登记观察依据支持跟进；该说明只在教师侧保留。');
  await page.getByRole('button', { name: '保存审阅处理', exact: true }).click();
  await expect(
    page.getByRole('link', { name: '查看跟进／提醒与补救计划', exact: true }),
  ).toBeVisible();
  current = await detail(reviewed.id);
  const caseId = String(current.record.case_id);
  assert.ok(caseId && caseId !== 'null');
  assert.equal(
    Number(
      (
        await admin.query(
          'SELECT count(*) FROM zhiban_followup.events WHERE tenant_id=$1 AND case_id=$2',
          [t, caseId],
        )
      ).rows[0].count,
    ),
    1,
  );
  await page.getByRole('link', { name: '查看跟进／提醒与补救计划', exact: true }).click();
  await page.getByRole('link', { name: '制定／查看补救计划', exact: true }).click();
  await expect(page.getByLabel('补救计划标题', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/v2/evidence/risk/support-handoff.png' });
  const plan = await ok(`/api/zhiban/remediation/${t}/offerings/${o}`, teacher, {
    type: 'ASSIGN_PLAN',
    caseId,
    revision: '1',
    title: '规则旅程：教师明确支持安排',
    goal: '请补充观察依据；这是教师明确发布的公共目标，不含私有风险判断。',
    dueAt: Date.now() + 1200,
    tasks: [{ activityId: a.id, version: 1 }],
  });
  const studentPlans = await http(
    `/api/zhiban/remediation/${t}/offerings/${o}?mode=STUDENT&id=${plan.id}`,
    student,
  );
  assert.equal(studentPlans.status, 200);
  assert.equal(JSON.stringify(studentPlans.json).includes('PRIVATE_REVIEW'), false);
  assert.equal((await http(url + '?view=DETAIL&id=' + reviewed.id, student)).status, 403);
  // Formal correction invalidates stale support commands; the initial 40-point evidence remains immutable.
  const rev = (
    await admin.query(
      'SELECT revision::text FROM zhiban_assessment.grades WHERE tenant_id=$1 AND submission_id=$2',
      [t, submission.submissionId],
    )
  ).rows[0].revision;
  await ok(assessment, teacher, {
    type: 'CORRECT_GRADE',
    submissionId: submission.submissionId,
    revision: rev,
    score: '60',
    maxScore: '100',
    feedback: '更正为阈值边界。',
    reason: '本地边界验证，保留正式更正记录。',
  });
  assert.equal(
    (await read({ code: 'LOW_SCORE', decision: 'ALL' })).rows.length,
    0,
    'exactly60 is not below60',
  );
  assert.equal(
    (
      await http(url, teacher, {
        type: 'AMEND_REVIEW',
        id: reviewed.id,
        revision: String(current.record.revision),
        decision: 'SUPPORT',
        expectedDigest: current.current.digest,
        body: '过期依据不得继续支持',
      })
    ).status,
    409,
  );
  current = await detail(reviewed.id);
  assert.equal(current.current.matched, false);
  assert.equal((current.record.evidence as Observation).facts.scorePoints, 4000);
  assert.equal(current.current.facts.scorePoints, 6000);
  await page.goto(
    `${origin}/zhiban/teacher/courses/${trial.courseId}/risk?space=${t}&offering=${o}#review-${reviewed.id}`,
  );
  await page.getByLabel('修订后的审阅判断', { exact: true }).selectOption('RESOLVED');
  await page
    .getByLabel('教师私有处理说明', { exact: true })
    .fill('正式更正已达到本规则阈值，教师结束本次审阅；不改变原成绩。');
  await page.getByRole('button', { name: '保存审阅处理', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: '修订判断 · 解除／结束审阅', exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: 'docs/v2/evidence/risk/resolved.png' });
  current = await detail(reviewed.id);
  const amend = {
    type: 'AMEND_REVIEW',
    id: reviewed.id,
    revision: String(current.record.revision),
    expectedDigest: current.current.digest,
    body: '并发修订必须比较预期版本。',
  };
  const raced = await Promise.all([
    http(url, teacher, { ...amend, decision: 'NO_ACTION' }),
    http(url, teacher, { ...amend, decision: 'RESOLVED' }),
  ]);
  assert.deepEqual(raced.map((r) => r.status).sort(), [200, 409]);
  for (let i = 0; i < 18; i++) {
    current = await detail(reviewed.id);
    await ok(url, teacher, {
      type: 'AMEND_REVIEW',
      id: reviewed.id,
      revision: String(current.record.revision),
      expectedDigest: current.current.digest,
      decision: 'RESOLVED',
      body: '追加教师核查记录 ' + i + '，不改写旧说明。',
    });
  }
  current = await detail(reviewed.id);
  assert.ok(current.next);
  const older = await read({ view: 'DETAIL', id: reviewed.id, cursor: current.next! });
  assert.ok(older.rows.length > 0);
  assert.equal((await http(url + '?view=HISTORY&cursor=' + current.next, teacher)).status, 400);
  const rv = (
    await admin.query(
      'SELECT revision::text FROM zhiban_assessment.grades WHERE tenant_id=$1 AND submission_id=$2',
      [t, submission.submissionId],
    )
  ).rows[0].revision;
  await ok(assessment, teacher, {
    type: 'CORRECT_GRADE',
    submissionId: submission.submissionId,
    revision: rv,
    score: '50',
    maxScore: '100',
    feedback: '新的独立事实。',
    reason: '验证新正式发布重新进入待审阅。',
  });
  const newer = (await read({ code: 'LOW_SCORE' })).rows[0] as unknown as Observation;
  assert.ok(newer && newer.sourceKey !== hit.sourceKey);
  await ok(url, teacher, review(newer, 'NO_ACTION'));
  await ok(url, teacher, {
    type: 'SAVE_RULE',
    ruleCode: 'OVERDUE',
    revision: '0',
    enabled: true,
    threshold: 0,
  });
  await ok(url, teacher, {
    type: 'SAVE_RULE',
    ruleCode: 'PLAN_OVERDUE',
    revision: '0',
    enabled: true,
    threshold: 0,
  });
  const until = Date.now() + 2500;
  while (Date.now() < until && (await read({ code: 'PLAN_OVERDUE' })).rows.length === 0)
    await new Promise((r) => setTimeout(r, 50));
  assert.equal((await read({ code: 'OVERDUE', q: '规则旅程：逾期任务' })).rows.length, 2);
  assert.equal((await read({ code: 'OVERDUE', q: '练习不列入' })).rows.length, 0);
  assert.equal((await read({ code: 'PLAN_OVERDUE' })).rows.length, 1);
  const saving = {
    type: 'SAVE_RULE',
    ruleCode: 'LOW_SCORE',
    revision: '1',
    enabled: true,
    threshold: 60,
  };
  const race = await Promise.all([http(url, teacher, saving), http(url, teacher, saving)]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  await ok(url, teacher, {
    type: 'SAVE_RULE',
    ruleCode: 'LOW_SCORE',
    revision: '2',
    enabled: false,
    threshold: 60,
  });
  assert.equal((await read({ code: 'LOW_SCORE', decision: 'ALL' })).rows.length, 0);
  assert.equal((await detail(reviewed.id)).current.currentRuleEnabled, false);
  // Current Enrollment and offering isolation are checked on every queue read.
  const enrollment = (
    await admin.query(
      'SELECT revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND id=$2',
      [t, hit.enrollmentId],
    )
  ).rows[0];
  await ok(`/api/zhiban/management/${t}/commands`, manager, {
    type: 'WITHDRAW',
    id: hit.enrollmentId,
    revision: enrollment.revision,
  });
  assert.equal((await read({ code: 'PLAN_OVERDUE' })).rows.length, 0);
  assert.equal((await detail(reviewed.id)).current.eligible, false);
  for (const table of ['rule_versions', 'events', 'commands']) {
    const acl = (
      await admin.query(
        "SELECT has_table_privilege('zhiban_academic_runtime',$1,'UPDATE') AS u,has_table_privilege('zhiban_academic_runtime',$1,'DELETE') AS d",
        ['zhiban_risk.' + table],
      )
    ).rows[0];
    assert.deepEqual(acl, { u: false, d: false });
  }
  assert.equal(
    (
      await admin.query(
        "SELECT has_column_privilege('zhiban_academic_runtime','zhiban_risk.reviews','evidence','UPDATE') AS allowed",
      )
    ).rows[0].allowed,
    false,
  );
  const raw = await businessPool.connect();
  try {
    await raw.query('BEGIN');
    await raw.query("SELECT set_config('app.tenant_id',$1,true)", [v7()]);
    assert.equal((await raw.query('SELECT id FROM zhiban_risk.reviews')).rows.length, 0);
  } finally {
    await raw.query('ROLLBACK');
    raw.release();
  }
  const assignment = (
    await admin.query(
      "SELECT id,revision::text FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE'",
      [t, o, teacher.member],
    )
  ).rows[0];
  await ok(`/api/zhiban/management/${t}/commands`, manager, {
    type: 'END_TEACHER',
    id: assignment.id,
    revision: assignment.revision,
  });
  assert.equal((await http(url + '?view=HISTORY', teacher)).status, 403);
  assert.equal(
    (
      await http(url, teacher, {
        type: 'SAVE_RULE',
        ruleCode: 'OVERDUE',
        revision: '1',
        enabled: false,
        threshold: 0,
      })
    ).status,
    403,
  );
  await tc.close();
  await writeFile(
    'docs/v2/evidence/risk/journey.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        scope: 'OPT_IN_EXPLAINABLE_SIGNALS_PRIVATE_HUMAN_REVIEW_EXPLICIT_FOLLOWUP_REMEDIATION',
        defaultsDisabled: true,
        draftGradesExcluded: true,
        scoreBoundary: '40_BELOW60_60_NOT_BELOW60_NEW50_NEW_PENDING',
        sameKeyReplayOnce: true,
        differentKeyDuplicateSuppressed: true,
        sourceChangeRejectsStaleSupport: true,
        immutableOriginalEvidence: true,
        crossContextAuditRollback: true,
        privateReviewNotExposedToStudent: true,
        formalPracticeExcluded: true,
        overdueAndPlanGrace: 'ZERO_HOUR_REAL_CLOCK_NO_BACKDATED_ROWS',
        configurationRevisionRace: true,
        reviewRevisionRace: true,
        historyCursorBound: true,
        withdrawAndTeacherRevocation: true,
        tenantRlsAndImmutableAcl: true,
        automaticStudentLabels: false,
        automaticNotification: false,
        nativeRuntimeEnabled: false,
      },
      null,
      2,
    ) + '\n',
  );
  record(
    'P5 opt-in explainable signals, private teacher review, stale evidence and explicit support journey PASS',
  );
}
