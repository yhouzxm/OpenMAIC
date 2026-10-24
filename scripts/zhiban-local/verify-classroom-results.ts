import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
};
type Result = {
  id: string;
  revision: string;
  dispatchId: string;
  attemptId: string;
  submissionId: string;
};
type Row = {
  id: string;
  entered: number;
  submitted: number;
  published: number;
  own: null | {
    attemptId: string;
    submissionVersion: number;
    score: number | null;
    gradeVersion: number | null;
  };
};
export async function verifyClassroomResults(input: Input) {
  const {
    http,
    actors: [teacher, student, outsider, foreign, manager, peer],
    tenant,
    trial,
    browser,
    origin,
    admin,
    record,
  } = input;
  const base = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}`,
    url = base + '/classrooms',
    results = base + '/classroom-results';
  const assessment = `/api/zhiban/assessment/${tenant}/offerings/${trial.offeringId}`;
  const send = async (path: string, actor: typeof student, command: unknown) => {
    const r = await http(path, actor, command, 'POST', { 'x-zhiban-command': v7() });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Result;
  };
  const read = async (actor: typeof student, page = 0) => {
    const r = await http(results + '?page=' + page, actor);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as { rows: Row[]; hasMore: boolean };
  };
  const activity = await send(base, teacher, {
    type: 'CREATE_ACTIVITY',
    title: '历史课堂作答',
    prompt: '记录课堂观察。',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 3,
  });
  await send(base, teacher, {
    type: 'PUBLISH_ACTIVITY',
    id: activity.id,
    revision: activity.revision,
  });
  const outline = (await http(base + '/outline', teacher)).json as Result;
  await send(base + '/outline', teacher, {
    type: 'SAVE_OUTLINE',
    revision: outline.revision,
    chapters: [
      {
        id: v7(),
        title: '课堂结果',
        units: [{ id: v7(), kind: 'ACTIVITY', target: activity.id, title: '历史课堂作答' }],
      },
    ],
  });
  await send(base + '/outline', teacher, {
    type: 'PUBLISH_OUTLINE',
    revision: String(BigInt(outline.revision) + BigInt(1)),
  });
  let session = await send(url, teacher, {
    type: 'CREATE_CLASSROOM',
    title: '课堂历史演示',
    description: '本地真实事实投影',
    opensAt: null,
    closesAt: null,
  });
  session = {
    ...session,
    ...(await send(url, teacher, {
      type: 'PUBLISH_CLASSROOM',
      id: session.id,
      revision: session.revision,
    })),
  };
  const dispatch = await send(url, teacher, {
    type: 'DISPATCH_TASK',
    id: session.id,
    revision: session.revision,
    kind: 'ACTIVITY',
    target: activity.id,
    version: '1',
  });
  session.revision = dispatch.revision;
  const enter = {
    type: 'ENTER_TASK',
    id: session.id,
    revision: session.revision,
    dispatchId: dispatch.dispatchId,
  };
  const entry = await send(url, student, enter);
  await send(url, peer, enter);
  const mine = async () => (await read(student)).rows.find((r) => r.id === dispatch.dispatchId)!;
  const summary = async () => (await read(teacher)).rows.find((r) => r.id === dispatch.dispatchId)!;
  assert.deepEqual([(await summary()).entered, (await summary()).submitted], [2, 0]);
  let attempt = (
    await http(base + '/attempts?activity=' + activity.id + '&id=' + entry.attemptId, student)
  ).json as {
    rows: Result[];
  };
  let submission = await send(base, student, {
    type: 'SUBMIT',
    id: entry.attemptId,
    revision: attempt.rows[0].revision,
    answer: '首次观察结果。',
  });
  const grade = await send(assessment, teacher, {
    type: 'SAVE_GRADE',
    submissionId: submission.submissionId,
    revision: null,
    score: '80',
    maxScore: '100',
    feedback: '未发布私密反馈',
  });
  assert.equal((await mine()).own!.score, null);
  const published = await send(assessment, teacher, {
    type: 'PUBLISH_GRADE',
    submissionId: submission.submissionId,
    revision: grade.revision,
  });
  assert.equal((await mine()).own!.score, 8000);
  await send(assessment, teacher, {
    type: 'CORRECT_GRADE',
    submissionId: submission.submissionId,
    revision: published.revision,
    score: '90',
    maxScore: '100',
    feedback: '更正后发布',
    reason: '复核',
  });
  assert.equal((await mine()).own!.score, 9000);
  assert.equal((await mine()).own!.gradeVersion, 2);
  assert.equal((await summary()).published, 1);
  attempt = (
    await http(base + '/attempts?activity=' + activity.id + '&id=' + entry.attemptId, student)
  ).json as {
    rows: Result[];
  };
  submission = await send(base, student, {
    type: 'SUBMIT',
    id: entry.attemptId,
    revision: attempt.rows[0].revision,
    answer: '重交后的观察结果。',
  });
  assert.equal((await mine()).own!.score, null);
  assert.equal((await mine()).own!.submissionVersion, 2);
  assert.deepEqual(
    [(await summary()).entered, (await summary()).submitted, (await summary()).published],
    [2, 1, 0],
  );
  await send(url, teacher, { type: 'END_CLASSROOM', id: session.id, revision: session.revision });
  assert.equal((await mine()).own!.attemptId, entry.attemptId);
  assert.equal((await read(peer)).rows[0].own!.attemptId === entry.attemptId, false);
  for (const a of [outsider, foreign, manager]) assert.equal((await http(results, a)).status, 403);
  for (const q of ['member=' + peer.member, 'page=-1', 'page=01', 'page=10000', 'page=0&page=1'])
    assert.equal((await http(results + '?' + q, student)).status, 400);
  assert.equal((await http(results, teacher, {}, 'POST')).status, 405);
  assert.equal(JSON.stringify(await read(student)).includes('未发布私密反馈'), false);
  // More than one page of real dispatches, no synthetic result or score insertion.
  for (let i = 0; i < 21; i++) {
    let s = await send(url, teacher, {
      type: 'CREATE_CLASSROOM',
      title: '分页课堂 ' + i,
      description: '',
      opensAt: null,
      closesAt: null,
    });
    s = {
      ...s,
      ...(await send(url, teacher, { type: 'PUBLISH_CLASSROOM', id: s.id, revision: s.revision })),
    };
    await send(url, teacher, {
      type: 'DISPATCH_TASK',
      id: s.id,
      revision: s.revision,
      kind: 'ACTIVITY',
      target: activity.id,
      version: '1',
    });
  }
  const first = await read(teacher),
    second = await read(teacher, 1);
  assert.equal(first.rows.length, 20);
  assert.equal(first.hasMore, true);
  assert.equal(second.rows.length, 2);
  assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.rows, ...second.rows].map((r) => r.id)).size, 22);
  const before = (
    await admin.query(
      'SELECT count(*)::int AS n FROM zhiban_learning.attempts WHERE tenant_id=$1',
      [tenant],
    )
  ).rows[0].n;
  for (const [actor, role] of [
    [teacher, 'teacher'],
    [student, 'student'],
  ] as const) {
    const ctx = await browser.newContext();
    await ctx.addCookies([
      {
        name: actor.cookie!.split('=')[0],
        value: actor.cookie!.split('=').slice(1).join('='),
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
    const page = await ctx.newPage();
    await page.goto(
      `${origin}/zhiban/${role}/courses/${trial.courseId}/${role === 'teacher' ? 'classrooms' : 'coursework'}?space=${tenant}&offering=${trial.offeringId}`,
    );
    const region = page.getByRole('region', {
      name: role === 'teacher' ? '课堂结果汇总' : '我的课堂历史',
    });
    await expect(
      region.getByRole('heading', {
        name: role === 'teacher' ? '课堂结果汇总' : '我的课堂历史',
        exact: true,
      }),
    ).toBeVisible();
    if (role === 'teacher') {
      await region.getByRole('button', { name: '下一页课堂记录', exact: true }).click();
      await expect(region).toContainText('课堂记录第 2 页');
      await expect(region).toContainText('已进入 2 人 · 已提交 1 人 · 最新提交成绩已发布 0 人');
    } else {
      await expect(region).toContainText('已结束');
      await expect(region).toContainText('已提交第 2 版');
      await region.getByRole('link', { name: '回看本次作答与成绩', exact: true }).click();
      await expect(
        page.getByText('当前只显示本课堂首次绑定的尝试', { exact: false }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: '开始新一次尝试', exact: true })).toHaveCount(
        0,
      );
      assert.ok(page.url().includes('classroomAttempt=' + entry.attemptId));
    }
    await page.screenshot({ path: `docs/v2/evidence/classroom-results/${role}.png` });
    await ctx.close();
  }
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_learning.attempts WHERE tenant_id=$1',
        [tenant],
      )
    ).rows[0].n,
    before,
  );
  await writeFile(
    'docs/v2/evidence/classroom-results/journey.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        paginationTasks: 22,
        exactAttempt: entry.attemptId,
        latestSubmissionVersion: 2,
        publishedGradeAfterResubmit: null,
        historicalReadCreatesAttempt: false,
        source: 'REAL_GUARDED_LOCAL_COMMANDS',
      },
      null,
      2,
    ) + '\n',
  );
  record(
    'Classroom results: per-entry latest submission/publication, correction and resubmit privacy, ended own-history exact Attempt, 22-task pagination and role/query boundaries PASS',
  );
}
