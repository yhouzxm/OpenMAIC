import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
import type { FollowupPage } from '../../lib/zhiban/application/analytics/followups';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
};
type Result = { id: string; revision: string; submissionId: string };
export async function verifyFollowups(input: Input) {
  const {
    admin,
    browser,
    http,
    actors: [teacher, student, outsider, foreign, manager, peer],
    tenant,
    origin,
    trial,
    record,
  } = input;
  const learning = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}`;
  const url = `/api/zhiban/analytics/${tenant}/offerings/${trial.offeringId}/followups`;
  const assessment = `/api/zhiban/assessment/${tenant}/offerings/${trial.offeringId}`;
  const send = async (path: string, actor: typeof teacher, command: unknown) => {
    const r = await http(path, actor, command, 'POST', { 'x-zhiban-command': v7() });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Result;
  };
  const read = async (filters: Record<string, string> = {}) => {
    const r = await http(url + '?' + new URLSearchParams({ q: 'P5：', ...filters }), teacher);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as FollowupPage;
  };
  const create = async (title: string, deadlineAt: number | null = null) => {
    const a = await send(learning, teacher, {
      type: 'CREATE_ACTIVITY',
      title: 'P5：' + title,
      prompt: '说明观察结果。',
      deadlineAt,
      allowResubmit: true,
      maxAttempts: 3,
    });
    await send(learning, teacher, { type: 'PUBLISH_ACTIVITY', id: a.id, revision: a.revision });
    return a;
  };
  const cutoff = Date.now() + 8000;
  const overdue = await create('逾期未交', cutoff);
  const started = await create('已开始未交', Date.now() + 86400000);
  await send(learning, student, { type: 'START_ATTEMPT', id: started.id });
  const waiting = await create('待发布成绩');
  const attempt = await send(learning, student, { type: 'START_ATTEMPT', id: waiting.id });
  let submission = await send(learning, student, {
    type: 'SUBMIT',
    id: attempt.id,
    revision: attempt.revision,
    answer: '首版观察结果。',
  });
  const grade = await send(assessment, teacher, {
    type: 'SAVE_GRADE',
    submissionId: submission.submissionId,
    revision: null,
    score: '88',
    maxScore: '100',
    feedback: 'P5不应返回的私密反馈',
  });
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, cutoff - Date.now() + 50)));
  let data = await read();
  assert.equal(data.summary.pending, 6);
  assert.equal(data.summary.overdue, 2);
  assert.equal(data.summary.inProgress, 1);
  assert.equal(data.summary.awaitingGrade, 1);
  assert.equal((await read({ state: 'OVERDUE' })).totalMatches, 2);
  assert.equal((await read({ state: 'NOT_STARTED' })).totalMatches, 4);
  assert.equal((await read({ state: 'IN_PROGRESS' })).totalMatches, 1);
  assert.equal((await read({ state: 'AWAITING_GRADE' })).totalMatches, 1);
  assert.ok((await read({ state: 'OVERDUE' })).rows.every((r) => r.activityId === overdue.id));
  const byMember = await read({ q: student.member });
  assert.ok(byMember.rows.every((row) => row.membershipId === student.member));
  assert.equal(
    byMember.rows.filter((row) => [overdue.id, started.id, waiting.id].includes(row.activityId))
      .length,
    3,
  );
  const serialized = JSON.stringify(data);
  for (const secret of [
    'P5不应返回的私密反馈',
    '首版观察结果。',
    'scorePoints',
    'draft',
    'password',
  ])
    assert.equal(serialized.includes(secret), false);
  const published = await send(assessment, teacher, {
    type: 'PUBLISH_GRADE',
    submissionId: submission.submissionId,
    revision: grade.revision,
  });
  assert.equal((await read()).summary.awaitingGrade, 0);
  await send(assessment, teacher, {
    type: 'CORRECT_GRADE',
    submissionId: submission.submissionId,
    revision: published.revision,
    score: '92',
    maxScore: '100',
    feedback: '更正',
    reason: '复核',
  });
  assert.equal((await read()).summary.pending, 5);
  const state = await http(
    learning + '/attempts?' + new URLSearchParams({ activity: waiting.id, id: attempt.id }),
    student,
  );
  assert.equal(state.status, 200);
  const a = (state.json as { rows: Result[] }).rows[0];
  submission = await send(learning, student, {
    type: 'SUBMIT',
    id: a.id,
    revision: a.revision,
    answer: '第二版观察结果。',
  });
  assert.equal((await read()).summary.awaitingGrade, 1);
  // A current republished version has its own evidence, not the old version's submission.
  const detail = await http(
    learning + '/activities?' + new URLSearchParams({ q: 'P5：待发布成绩' }),
    teacher,
  );
  assert.equal(detail.status, 200);
  const current = (detail.json as { rows: Result[] }).rows.find((r) => r.id === waiting.id)!;
  await send(learning, teacher, {
    type: 'PUBLISH_ACTIVITY',
    id: waiting.id,
    revision: current.revision,
  });
  data = await read();
  assert.equal(data.summary.awaitingGrade, 0);
  assert.ok(
    data.rows
      .filter((r) => r.activityId === waiting.id)
      .every((r) => r.version === 2 && r.attemptId === null),
  );
  // Build one current pending submission for the real teacher grading/back journey.
  const newAttempt = await send(learning, student, { type: 'START_ATTEMPT', id: waiting.id });
  submission = await send(learning, student, {
    type: 'SUBMIT',
    id: newAttempt.id,
    revision: newAttempt.revision,
    answer: '新版活动观察结果。',
  });
  for (let i = 0; i < 9; i++) await create('分页活动 ' + i);
  const hidden = await create('撤回活动');
  const hiddenRead = await http(
    learning + '/activities?' + new URLSearchParams({ q: 'P5：撤回活动' }),
    teacher,
  );
  assert.equal(hiddenRead.status, 200);
  await send(learning, teacher, {
    type: 'WITHDRAW_ACTIVITY',
    id: hidden.id,
    revision: (hiddenRead.json as { rows: Result[] }).rows[0].revision,
  });
  const practice = await send(learning + '/quizzes', teacher, {
    type: 'CREATE_QUIZ',
    title: 'P5：自主练习不列入',
    mode: 'PRACTICE',
    content: {
      type: 'quiz',
      questions: [
        {
          id: 'q1',
          type: 'single',
          question: '观察结果？',
          options: [
            { value: 'A', label: '选项一' },
            { value: 'B', label: '选项二' },
          ],
          answer: ['A'],
          analysis: '说明',
          points: 1,
        },
      ],
    },
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: null,
  });
  await send(learning + '/quizzes', teacher, {
    type: 'PUBLISH_QUIZ',
    id: practice.id,
    revision: practice.revision,
  });
  const first = await read(),
    second = await read({ cursor: first.next! });
  assert.equal(first.rows.length, 20);
  assert.ok(first.next);
  assert.equal(second.next, null);
  assert.equal(first.totalMatches, 24);
  assert.equal(
    new Set([...first.rows, ...second.rows].map((r) => r.activityId + ':' + r.membershipId)).size,
    24,
  );
  assert.ok(
    [...first.rows, ...second.rows].every(
      (r) => r.activityId !== hidden.id && r.activityId !== practice.id,
    ),
  );
  for (const actor of [student, peer, manager, outsider, foreign])
    assert.equal((await http(url, actor)).status, 403);
  assert.equal((await http(url)).status, 401);
  for (const suffix of [
    '?member=' + peer.member,
    '?state=HIGH_RISK',
    '?q=' + 'x'.repeat(121),
    '?limit=100',
    '?cursor=bad',
    '?state=OVERDUE&cursor=' + first.next,
    '?q=P5%EF%BC%9A&q=other',
  ])
    assert.equal((await http(url + suffix, teacher)).status, 400);
  assert.equal((await http(url, teacher, {}, 'POST')).status, 405);
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: teacher.cookie!.split('=')[0],
      value: teacher.cookie!.split('=').slice(1).join('='),
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await context.newPage();
  const teacherUrl = `${origin}/zhiban/teacher/courses/${trial.courseId}/analytics?space=${tenant}&offering=${trial.offeringId}#followups`;
  await page.goto(teacherUrl);
  await expect(page.getByRole('heading', { name: '教师待跟进名单', exact: true })).toBeVisible();
  const reportBounds = await page.locator('#analytics').boundingBox();
  assert.ok(
    reportBounds && reportBounds.width > 600 && reportBounds.x >= 240,
    'Report must occupy the course content column, not the sidebar',
  );
  await page.getByLabel('搜索待跟进学生或活动', { exact: true }).fill('P5：');
  await page.getByRole('button', { name: '查询待跟进名单', exact: true }).click();
  await expect(page.getByText('匹配 24 条 · 第 1 页 · 本页 20 条', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '下一页待跟进', exact: true }).click();
  await expect(page.getByText('匹配 24 条 · 第 2 页 · 本页 4 条', { exact: true })).toBeVisible();
  await page.getByLabel('跟进原因', { exact: true }).selectOption('AWAITING_GRADE');
  await page.getByRole('button', { name: '查询待跟进名单', exact: true }).click();
  await expect(page.getByRole('link', { name: '查看提交与评分', exact: true })).toHaveCount(1);
  await page.screenshot({ path: 'docs/v2/evidence/teacher-followups/teacher.png' });
  await page.getByRole('link', { name: '查看提交与评分', exact: true }).click();
  await expect(page.getByRole('link', { name: '返回待跟进名单', exact: true })).toBeVisible();
  await expect(page.getByText('P5：待发布成绩', { exact: false }).first()).toBeVisible();
  assert.ok(page.url().includes('#followup-grading-' + waiting.id + '-' + student.member));
  await page.getByRole('link', { name: '返回待跟进名单', exact: true }).click();
  await expect(page.getByRole('heading', { name: '教师待跟进名单', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '活动统计', exact: true }).click();
  await expect(page.getByRole('region', { name: '统计汇总', exact: true })).toBeVisible();
  await context.close();
  // Current roster and teacher authorization changes must affect subsequent reads immediately.
  const enrollment = (
    await admin.query(
      "SELECT id,revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE'",
      [tenant, trial.offeringId, peer.member],
    )
  ).rows[0];
  await send(`/api/zhiban/management/${tenant}/commands`, manager, {
    type: 'WITHDRAW',
    id: enrollment.id,
    revision: enrollment.revision,
  });
  assert.equal((await read({ q: peer.member })).totalMatches, 0);
  const assignment = (
    await admin.query(
      "SELECT id,revision::text FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE'",
      [tenant, trial.offeringId, teacher.member],
    )
  ).rows[0];
  await send(`/api/zhiban/management/${tenant}/commands`, manager, {
    type: 'END_TEACHER',
    id: assignment.id,
    revision: assignment.revision,
  });
  assert.equal((await http(url, teacher)).status, 403);
  await writeFile(
    'docs/v2/evidence/teacher-followups/journey.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        scope: 'CURRENT_ENROLLMENT_CURRENT_ASSESSED_VERSION_FACT_BASED_FOLLOWUPS',
        pendingBeforeWithdrawal: 24,
        pagination: 'KEYSET_ACTIVITY_MEMBER',
        gradeDraftNotExposed: true,
        resubmitReturnsToPending: true,
        republishUsesNewVersion: true,
        practiceAndWithdrawnExcluded: true,
        withdrawnMemberExcluded: true,
        revokedTeacherDenied: true,
        teacherGradingReturn: 'PASS',
        automaticNotification: false,
        automaticRiskInference: false,
      },
      null,
      2,
    ) + '\n',
  );
  record(
    'P5 teacher followups: current roster/version latest facts, overdue/start/submit, published correction/resubmit, keyset pagination, role/cursor/revocation boundaries and grading/back UI PASS',
  );
}
