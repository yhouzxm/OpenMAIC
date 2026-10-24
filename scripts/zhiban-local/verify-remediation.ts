import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
import { loadRemediation } from './remediation';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  businessPool: import('pg').Pool;
};
type Result = { id: string; revision: string; submissionId: string; state: string };
type Detail = {
  record: Record<string, unknown>;
  tasks: {
    id: string;
    activity_id: string;
    activity_version: number;
    baseline: Record<string, unknown>;
    current: Record<string, unknown>;
    report: Record<string, unknown> | null;
  }[];
  rows: { action: string; value: string; snapshot: Record<string, unknown>[] }[];
};
export async function verifyRemediation(input: Input) {
  const {
      admin,
      businessPool,
      browser,
      http,
      tenant: t,
      origin,
      trial,
      actors: [teacher, student, outsider, foreign, manager, peer],
      record,
    } = input,
    o = trial.offeringId;
  const url = `/api/zhiban/remediation/${t}/offerings/${o}`,
    learning = `/api/zhiban/learning/${t}/offerings/${o}`,
    assessment = `/api/zhiban/assessment/${t}/offerings/${o}`,
    cases = `/api/zhiban/analytics/${t}/offerings/${o}/followup-cases`;
  const ok = async (path: string, a: typeof teacher, command: unknown, key = v7()) => {
    const r = await http(path, a, command, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Result;
  };
  const get = async (id: string, a = teacher) => {
    const r = await http(url + '?mode=' + (a === teacher ? 'TEACHER' : 'STUDENT') + '&id=' + id, a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Detail;
  };
  const activity = async (title: string) => {
    const a = await ok(learning, teacher, {
      type: 'CREATE_ACTIVITY',
      title,
      prompt: '请提交观察依据。',
      deadlineAt: null,
      allowResubmit: true,
      maxAttempts: 3,
    });
    await ok(learning, teacher, { type: 'PUBLISH_ACTIVITY', id: a.id, revision: a.revision });
    return a;
  };
  const source = await activity('补救来源：安全巡检'),
    target = await activity('补救任务：观察依据'),
    second = await activity('补救任务：复核说明');
  const attempt = await ok(learning, student, {
    type: 'START_ATTEMPT',
    id: target.id,
    expectedVersion: '1',
  });
  const submission = await ok(learning, student, {
    type: 'SUBMIT',
    id: attempt.id,
    revision: attempt.revision,
    answer: '初次观察依据不足。',
  });
  const grade = await ok(assessment, teacher, {
    type: 'SAVE_GRADE',
    submissionId: submission.submissionId,
    revision: null,
    score: '50',
    maxScore: '100',
    feedback: '依据尚不完整。',
  });
  await ok(assessment, teacher, {
    type: 'PUBLISH_GRADE',
    submissionId: submission.submissionId,
    revision: grade.revision,
  });
  const createCase = (a: typeof student) =>
    ok(cases, teacher, {
      type: 'CREATE_CASE',
      activityId: source.id,
      version: 1,
      membershipId: a.member,
      body: 'PRIVATE_CASE_NOTE_NOT_A_PLAN_GOAL',
    });
  const c = await createCase(student),
    pc = await createCase(peer);
  const command = {
    type: 'ASSIGN_PLAN',
    caseId: c.id,
    revision: c.revision,
    title: '观察与复核补救计划',
    goal: '补全观察依据，再说明复核步骤；遇到困难可逐项反馈。',
    dueAt: null,
    tasks: [
      { activityId: target.id, version: 1 },
      { activityId: second.id, version: 1 },
    ],
  };
  assert.equal((await http(url, teacher, { ...command, actorId: student.member })).status, 400);
  assert.equal(
    (await http(url, teacher, { ...command, tasks: [{ activityId: target.id, version: 2 }] }))
      .status,
    409,
  );
  assert.equal((await http(url, teacher, { ...command, dueAt: 1 })).status, 400);
  for (const a of [student, peer, outsider, foreign, manager])
    assert.notEqual((await http(url + '?mode=TEACHER', a)).status, 200);
  assert.equal((await http(url + '?mode=STUDENT')).status, 401);
  assert.equal((await http(url, teacher, command, 'POST', { 'x-zhiban-csrf': 'bad' })).status, 403);
  const context = async (a: typeof teacher) => {
    const ctx = await browser.newContext();
    await ctx.addCookies([
      {
        name: a.cookie!.split('=')[0],
        value: a.cookie!.split('=').slice(1).join('='),
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
    return ctx;
  };
  const tc = await context(teacher),
    sc = await context(student),
    tp = await tc.newPage(),
    sp = await sc.newPage();
  const teacherUrl = `${origin}/zhiban/teacher/courses/${trial.courseId}/analytics?space=${t}&offering=${o}#followup-case-${c.id}`;
  await tp.goto(teacherUrl);
  await tp.getByRole('link', { name: '制定／查看补救计划', exact: true }).click();
  await expect(tp.getByRole('heading', { name: '制定补救计划', exact: true })).toBeVisible();
  await tp.getByLabel('补救计划标题', { exact: true }).fill(command.title);
  await tp.getByLabel('学生可见补救目标与要求', { exact: true }).fill(command.goal);
  await tp.getByLabel('选择补救活动：补救任务：观察依据', { exact: true }).check();
  await tp.getByLabel('选择补救活动：补救任务：复核说明', { exact: true }).check();
  const assignedRequest = tp.waitForRequest(
    (r) => new URL(r.url()).pathname === url && r.method() === 'POST',
  );
  const assignedResponse = tp.waitForResponse(
    (r) => new URL(r.url()).pathname === url && r.request().method() === 'POST',
  );
  await tp.getByRole('button', { name: '发布补救计划', exact: true }).click();
  const req = await assignedRequest,
    res = await assignedResponse;
  assert.equal(res.status(), 200);
  const plan = (await res.json()) as Result;
  await expect(tp.getByRole('heading', { name: command.title, exact: true })).toBeVisible();
  const key = req.headers()['x-zhiban-command'],
    sent = req.postDataJSON();
  const [a, b] = await Promise.all([ok(url, teacher, sent, key), ok(url, teacher, sent, key)]);
  assert.equal(a.id, b.id);
  assert.equal(a.id, plan.id);
  assert.equal((await http(url, teacher, command)).status, 409);
  assert.equal(
    (await http(url, teacher, { ...sent, goal: '改变目标' }, 'POST', { 'x-zhiban-command': key }))
      .status,
    409,
  );
  let detail = await get(plan.id);
  assert.equal(detail.tasks.length, 2);
  const task = detail.tasks.find((t) => t.activity_id === target.id)!;
  assert.equal(Number(task.baseline.scorePoints), 5000);
  assert.equal(task.baseline.submissionId, submission.submissionId);
  await tp.screenshot({ path: 'docs/v2/evidence/remediation/teacher-plan.png' });
  const studentUrl = `${origin}/zhiban/student/courses/${trial.courseId}?space=${t}&offering=${o}`;
  await sp.goto(studentUrl);
  await sp.getByRole('link', { name: '补救任务', exact: true }).click();
  await sp.getByRole('button', { name: '查看任务与效果', exact: true }).click();
  await expect(sp.getByRole('heading', { name: command.title, exact: true })).toBeVisible();
  assert.equal(JSON.stringify(await get(plan.id, student)).includes('PRIVATE_CASE_NOTE'), false);
  const sr = (await get(plan.id, student)).record;
  for (const f of ['case_id', 'enrollment_id', 'membership_id', 'case_revision'])
    assert.equal(Object.hasOwn(sr, f), false);
  assert.equal((await http(url + '?mode=STUDENT&id=' + plan.id, peer)).status, 404);
  assert.equal(
    (
      await http(url, peer, {
        type: 'REPORT_TASK',
        id: plan.id,
        revision: '1',
        taskId: task.id,
        status: 'READY_FOR_REVIEW',
        body: '越权',
      })
    ).status,
    404,
  );
  await sp.getByLabel('反馈的补救任务', { exact: true }).selectOption(task.id);
  await sp.getByLabel('任务反馈状态', { exact: true }).selectOption('NEEDS_HELP');
  await sp.getByLabel('学生任务反馈', { exact: true }).fill('需要老师说明怎样补充观察依据。');
  await sp.getByRole('button', { name: '发送任务反馈', exact: true }).click();
  await expect(sp.getByText('学生请求帮助 ·', { exact: false })).toBeVisible();
  detail = await get(plan.id);
  assert.equal(detail.record.state, 'ACTIVE');
  assert.equal(detail.record.revision, '2');
  assert.equal(Number(detail.tasks.find((t) => t.id === task.id)!.current.scorePoints), 5000);
  const nextAttempt = await ok(learning, student, {
      type: 'START_ATTEMPT',
      id: target.id,
      expectedVersion: '1',
    }),
    nextSubmission = await ok(learning, student, {
      type: 'SUBMIT',
      id: nextAttempt.id,
      revision: nextAttempt.revision,
      answer: '断电复核、逐项观察并说明异常及复测依据。',
    });
  const nextGrade = await ok(assessment, teacher, {
    type: 'SAVE_GRADE',
    submissionId: nextSubmission.submissionId,
    revision: null,
    score: '85',
    maxScore: '100',
    feedback: '观察与复核依据较完整。',
  });
  detail = await get(plan.id, student);
  assert.equal(
    detail.tasks.find((t) => t.id === task.id)!.current.publicationId,
    null,
    'draft grade must not appear',
  );
  await ok(assessment, teacher, {
    type: 'PUBLISH_GRADE',
    submissionId: nextSubmission.submissionId,
    revision: nextGrade.revision,
  });
  // Failed audit cannot leave a bumped revision or changed feedback.
  await admin.query('REVOKE INSERT ON zhiban_remediation.events FROM zhiban_academic_runtime');
  try {
    assert.equal(
      (
        await http(url, student, {
          type: 'REPORT_TASK',
          id: plan.id,
          revision: '2',
          taskId: task.id,
          status: 'READY_FOR_REVIEW',
          body: '已正式提交，申请复核。',
        })
      ).status,
      503,
    );
  } finally {
    await admin.query('GRANT INSERT ON zhiban_remediation.events TO zhiban_academic_runtime');
  }
  assert.equal((await get(plan.id)).record.revision, '2');
  assert.equal(await loadRemediation(businessPool), true);
  await sp.getByRole('button', { name: '刷新任务与效果', exact: true }).click();
  await sp.getByLabel('反馈的补救任务', { exact: true }).selectOption(task.id);
  await sp.getByLabel('任务反馈状态', { exact: true }).selectOption('READY_FOR_REVIEW');
  await sp
    .getByLabel('学生任务反馈', { exact: true })
    .fill('已在原活动正式提交观察依据，请老师复核。');
  await sp.getByRole('button', { name: '发送任务反馈', exact: true }).click();
  await expect(sp.getByText('学生自报待复核 ·', { exact: false })).toBeVisible();
  detail = await get(plan.id);
  const revision = String(detail.record.revision);
  const raced = await Promise.all([
    http(url, teacher, {
      type: 'REVIEW_PLAN',
      id: plan.id,
      revision,
      outcome: 'NEEDS_MORE',
      body: '先记录阶段评估。',
    }),
    http(url, student, {
      type: 'REPORT_TASK',
      id: plan.id,
      revision,
      taskId: task.id,
      status: 'READY_FOR_REVIEW',
      body: '请复核最新记录。',
    }),
  ]);
  assert.deepEqual(raced.map((x) => x.status).sort(), [200, 409]);
  await tp.getByRole('button', { name: '刷新任务与效果', exact: true }).click();
  await expect(tp.getByText('已发布得分率变化：+35 个百分点。', { exact: false })).toBeVisible();
  await tp.getByLabel('教师效果判断', { exact: true }).selectOption('NEEDS_MORE');
  await tp
    .getByLabel('学生可见评估说明', { exact: true })
    .fill('观察依据已改善，复核说明仍需继续完善。');
  await tp.getByRole('button', { name: '保存计划处理', exact: true }).click();
  await expect(
    tp.getByRole('heading', { name: '教师评估 · 继续补救', exact: true }).last(),
  ).toBeVisible();
  await tp.getByLabel('教师效果判断', { exact: true }).selectOption('ACHIEVED');
  await tp
    .getByLabel('学生可见评估说明', { exact: true })
    .fill('本轮目标已复核，教师结束该计划；原活动成绩以正式发布为准。');
  await tp.getByRole('button', { name: '保存计划处理', exact: true }).click();
  await expect(
    tp.getByRole('heading', { name: '教师评估 · 教师判定已达到本次目标', exact: true }),
  ).toBeVisible();
  detail = await get(plan.id);
  assert.equal(detail.record.state, 'CLOSED');
  assert.equal(Number(detail.tasks.find((t) => t.id === task.id)!.baseline.scorePoints), 5000);
  const review = detail.rows.find((e) => e.action === 'REVIEW_PLAN' && e.value === 'ACHIEVED')!;
  assert.equal(Number(review.snapshot.find((f) => f.taskId === task.id)!.scorePoints), 8500);
  assert.equal(detail.tasks.find((t) => t.id === task.id)!.current.attemptNo, 2);
  await tp.screenshot({ path: 'docs/v2/evidence/remediation/teacher-effect.png' });
  await sp.getByRole('button', { name: '刷新任务与效果', exact: true }).click();
  await expect(sp.getByRole('button', { name: '发送任务反馈', exact: true })).toHaveCount(0);
  await sp.screenshot({ path: 'docs/v2/evidence/remediation/student-review.png' });
  // New publication cannot rebind the stored task/baseline/review or silently launch another version.
  const targetRow = (
    await admin.query(
      'SELECT revision::text FROM zhiban_learning.activities WHERE tenant_id=$1 AND id=$2',
      [t, target.id],
    )
  ).rows[0];
  const edited = await ok(learning, teacher, {
    type: 'EDIT_ACTIVITY',
    id: target.id,
    revision: targetRow.revision,
    title: '补救任务：观察依据第二版',
    prompt: '更新要求。',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 3,
  });
  await ok(learning, teacher, {
    type: 'PUBLISH_ACTIVITY',
    id: target.id,
    revision: edited.revision,
  });
  detail = await get(plan.id);
  assert.equal(detail.tasks.find((t) => t.id === task.id)!.activity_version, 1);
  assert.equal(detail.tasks.find((t) => t.id === task.id)!.current.currentPublishedVersion, 2);
  assert.deepEqual(
    detail.rows.find((e) => e.action === 'REVIEW_PLAN' && e.value === 'ACHIEVED')!.snapshot,
    review.snapshot,
  );
  // A second recipient's independent plan exercises first-write concurrency and cancellation.
  const peerCommand = {
      ...command,
      caseId: pc.id,
      revision: pc.revision,
      tasks: [{ activityId: second.id, version: 1 }],
    },
    peerKey = v7();
  const [pp, pr] = await Promise.all([
    ok(url, teacher, peerCommand, peerKey),
    ok(url, teacher, peerCommand, peerKey),
  ]);
  assert.equal(pp.id, pr.id);
  const cancelled = await ok(url, teacher, {
    type: 'CANCEL_PLAN',
    id: pp.id,
    revision: pp.revision,
    body: '合成课堂取消安排，保留原任务和审计。',
  });
  assert.equal(cancelled.state, 'CANCELLED');
  await admin.query('UPDATE zhiban_identity.role_grants SET revoked_at=$2 WHERE grant_id=$1', [
    peer.grant,
    Date.now(),
  ]);
  assert.equal((await http(url, teacher, peerCommand)).status, 403);
  const enrollment = (
    await admin.query(
      "SELECT id,revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE'",
      [t, o, student.member],
    )
  ).rows[0];
  await ok(`/api/zhiban/management/${t}/commands`, manager, {
    type: 'WITHDRAW',
    id: enrollment.id,
    revision: enrollment.revision,
  });
  assert.equal((await http(url + '?mode=STUDENT&id=' + plan.id, student)).status, 403);
  assert.equal(
    (
      await http(url, student, {
        type: 'REPORT_TASK',
        id: plan.id,
        revision: String(detail.record.revision),
        taskId: task.id,
        status: 'NEEDS_HELP',
        body: '退班后禁止',
      })
    ).status,
    403,
  );
  assert.equal((await get(plan.id)).record.state, 'CLOSED');
  for (const table of ['tasks', 'events', 'commands']) {
    const acl = (
      await admin.query(
        "SELECT has_table_privilege('zhiban_academic_runtime',$1,'UPDATE') AS u,has_table_privilege('zhiban_academic_runtime',$1,'DELETE') AS d",
        ['zhiban_remediation.' + table],
      )
    ).rows[0];
    assert.deepEqual(acl, { u: false, d: false });
  }
  const raw = await businessPool.connect();
  try {
    await raw.query('BEGIN');
    await raw.query("SELECT set_config('app.tenant_id',$1,true)", [v7()]);
    assert.equal((await raw.query('SELECT id FROM zhiban_remediation.plans')).rows.length, 0);
  } finally {
    await raw.query('ROLLBACK');
    raw.release();
  }
  await sc.close();
  await tc.close();
  await writeFile(
    'docs/v2/evidence/remediation/journey.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        scope:
          'TEACHER_ASSIGN_MULTI_TASK_STUDENT_FEEDBACK_REAL_SUBMISSION_PUBLISHED_GRADE_TEACHER_EFFECT_REVIEW',
        sameKeyFirstWriteAndReplayOnce: true,
        oneActivePlanPerCase: true,
        selfReportDoesNotCompleteLearning: true,
        baselineScore: 50,
        currentPublishedScore: 85,
        reviewSnapshotImmutable: true,
        draftGradesExcluded: true,
        feedbackReviewRevisionRace: 'ONE_SUCCESS_ONE_CONFLICT',
        auditFailureRollsBack: true,
        recipientRoleRequired: true,
        withdrawDeniesStudentAndTeacherRetainsHistory: true,
        versionReplacementDoesNotRebind: true,
        immutableTaskAuditAcl: true,
        tenantRls: true,
        externalNotifications: false,
        nativeRuntimeEnabled: false,
      },
      null,
      2,
    ) + '\n',
  );
  record('P5 plan/tasks/public feedback and immutable formal-evidence review passed');
}
