/** LOCAL owned-PG16 course Quiz journey. No native Runtime or external model. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
// Test JSON is checked at each assertion; it never supplies authorization.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type View = Record<string, any>;
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
};
export async function verifyCourseQuiz(input: Input) {
  const { http, actors, tenant, trial, browser, origin, record, admin } = input;
  const [teacher, student, outsider, , manager] = actors;
  const base = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}`;
  const grade = `/api/zhiban/assessment/${tenant}/offerings/${trial.offeringId}`;
  const send = async (
    command: unknown,
    actor = teacher,
    path = base + '/quizzes',
    key = randomUUID(),
  ) => {
    const r = await http(path, actor, command, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as View;
  };
  const read = async (selector: string, actor = student) => {
    const r = await http(base + '/' + selector, actor);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as View;
  };
  const content = {
    type: 'quiz',
    questions: [
      {
        id: 'q1',
        type: 'single',
        question: '电源关闭后再维护？',
        options: [
          { value: 'A', label: '是' },
          { value: 'B', label: '否' },
        ],
        answer: ['A'],
        analysis: '先断电。',
        points: 2,
      },
      {
        id: 'q2',
        type: 'multiple',
        question: '维护前准备？',
        options: [
          { value: 'A', label: '断电' },
          { value: 'B', label: '直接触碰' },
          { value: 'C', label: '确认隔离' },
        ],
        answer: ['A', 'C'],
        analysis: '断电并确认隔离。',
        points: 3,
      },
      {
        id: 'q3',
        type: 'short_answer',
        question: '说明你的维护顺序。',
        commentPrompt: '检查顺序与安全措施。',
        points: 5,
      },
    ],
  };
  let quiz = await send({
    type: 'CREATE_QUIZ',
    title: '课程测验演示',
    mode: 'ASSESSED',
    content,
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 2,
  });
  assert.equal((await http(base + '/quizzes?activity=' + quiz.id, student)).status, 404);
  assert.equal((await http(base + '/quizzes?activity=' + quiz.id, manager)).status, 403);
  assert.equal((await http(base + '/quizzes?activity=' + quiz.id, outsider)).status, 403);
  quiz = {
    ...quiz,
    ...(await send({ type: 'PUBLISH_QUIZ', id: quiz.id, revision: quiz.revision })),
  };
  const visible = await read('quizzes?activity=' + quiz.id);
  assert.ok(!JSON.stringify(visible).includes('commentPrompt'));
  assert.ok(!JSON.stringify(visible).includes('先断电。'));
  assert.ok(!JSON.stringify(visible).includes('"answer"'));
  const attempt = await send(
    { type: 'START_QUIZ_ATTEMPT', activityId: quiz.id, expectedVersion: '1' },
    student,
  );
  const raced = await Promise.all([
    send({ type: 'START_QUIZ_ATTEMPT', activityId: quiz.id, expectedVersion: '1' }, student),
    send({ type: 'START_QUIZ_ATTEMPT', activityId: quiz.id, expectedVersion: '1' }, student),
  ]);
  assert.ok(raced.every((r) => r.id === attempt.id));
  const oldText = await http(
    base,
    student,
    { type: 'SUBMIT', id: attempt.id, revision: attempt.revision, answer: '伪装文字答案' },
    'POST',
    { 'x-zhiban-command': randomUUID() },
  );
  assert.equal(oldText.status, 409);
  const malformed = await http(
    base + '/quizzes',
    student,
    {
      type: 'SUBMIT_QUIZ',
      attemptId: attempt.id,
      revision: attempt.revision,
      answers: { q1: 'A', q2: ['A', 'A'] },
      score: 100,
    },
    'POST',
    { 'x-zhiban-command': randomUUID() },
  );
  assert.equal(malformed.status, 400);
  record(
    'QUIZ: unpublished/key projections, role/course isolation, text-command type barrier and concurrent resume preserve one Attempt',
  );
  const outline = await http(base + '/outline', teacher);
  assert.equal(outline.status, 200);
  const structure = outline.json as View;
  const unit = randomUUID();
  structure.chapters[0].units.push({
    id: unit,
    title: '课程测验演示',
    kind: 'ACTIVITY',
    target: quiz.id,
  });
  const arranged = await send(
    { type: 'SAVE_OUTLINE', revision: structure.revision, chapters: structure.chapters },
    teacher,
    base + '/outline',
  );
  await send({ type: 'PUBLISH_OUTLINE', revision: arranged.revision }, teacher, base + '/outline');
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    for (const [ctx, actor] of [
      [contexts[0], teacher],
      [contexts[1], student],
    ] as const)
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
    const tp = await contexts[0].newPage(),
      sp = await contexts[1].newPage(),
      errors: string[] = [];
    for (const p of [tp, sp]) p.on('pageerror', (e) => errors.push(e.message));
    const route = (role: string) =>
      `${origin}/zhiban/${role}/courses/${trial.courseId}/learning-center/${unit}?space=${tenant}&offering=${trial.offeringId}`;
    await tp.goto(route('teacher'));
    await expect(tp.getByLabel('测验标题')).toHaveValue('课程测验演示');
    await tp.getByLabel('测验标题').fill('安全维护测验');
    await tp.getByRole('button', { name: '保存测验草稿', exact: true }).click();
    await expect(tp.locator('.quiz-product').first().getByRole('status')).toContainText(
      '操作已确认',
    );
    await tp.getByRole('button', { name: '发布测验', exact: true }).click();
    await expect(tp.getByText('已发布版本 2；', { exact: false })).toBeVisible();
    const fixed = await read('quizzes?attempt=' + attempt.id);
    assert.equal(fixed.version, 1);
    assert.equal(fixed.title, '课程测验演示');
    await sp.goto(route('student'));
    await sp.getByRole('button', { name: '继续未完成作答', exact: true }).first().click();
    await expect(sp.getByRole('radio').first()).toBeVisible();
    await sp.getByRole('radio').first().check();
    await sp.getByRole('checkbox').nth(0).check();
    await sp.getByRole('checkbox').nth(2).check();
    await sp.getByPlaceholder('请输入答案', { exact: true }).fill('先断电、隔离，再检查和维护。');
    sp.once('dialog', (dialog) => void dialog.dismiss());
    await sp.getByRole('link', { name: '返回课程目录', exact: true }).click();
    await expect(sp).toHaveURL(route('student'));
    await expect(sp.getByPlaceholder('请输入答案', { exact: true })).toHaveValue(
      '先断电、隔离，再检查和维护。',
    );
    await sp.getByRole('button', { name: '保存答案', exact: true }).first().click();
    await expect(sp.locator('.quiz-product').first().getByRole('status')).toContainText(
      '操作已确认',
    );
    // Confirmed discard delegates to the course shell once, without a second native prompt.
    await sp.getByPlaceholder('请输入答案', { exact: true }).fill('这段未保存文字应被明确放弃');
    let dialogs = 0;
    const accept = (dialog: import('@playwright/test').Dialog) => {
      dialogs++;
      void dialog.accept();
    };
    sp.on('dialog', accept);
    await sp.getByRole('link', { name: '返回课程目录', exact: true }).click();
    await expect(sp).toHaveURL(
      `${origin}/zhiban/student/courses/${trial.courseId}?space=${tenant}&offering=${trial.offeringId}`,
    );
    sp.off('dialog', accept);
    assert.equal(dialogs, 1);
    await sp.goto(route('student'));
    await sp.reload();
    await sp.getByRole('button', { name: '继续未完成作答', exact: true }).first().click();
    await expect(sp.getByPlaceholder('请输入答案', { exact: true })).toHaveValue(
      '先断电、隔离，再检查和维护。',
    );
    await sp.getByRole('button', { name: '提交答案', exact: true }).first().click();
    await sp.getByRole('button', { name: '确认提交测验', exact: true }).click();
    await expect(sp.locator('.quiz-product').first().getByRole('status')).toContainText('提交成功');
    const submitted = await read('quizzes?attempt=' + attempt.id);
    const submission = submitted.latestSubmission.id;
    const hidden = await read('quiz-submissions?submission=' + submission);
    assert.equal(hidden.review, undefined);
    assert.equal(hidden.evaluation, undefined);
    assert.equal(
      (
        await http(
          grade,
          teacher,
          {
            type: 'SAVE_GRADE',
            submissionId: submission,
            revision: null,
            score: '10',
            maxScore: '10',
            feedback: '绕过分项',
          },
          'POST',
          { 'x-zhiban-command': randomUUID() },
        )
      ).status,
      409,
    );
    const gradeBefore = await http(grade, teacher);
    assert.equal(
      (gradeBefore.json as View).grades.some(
        (g: Record<string, unknown>) => g.submission_id === submission,
      ),
      false,
    );
    // Reach the actual original paged grading entry, which delegates Quiz submissions to the shared surface.
    await tp.goto(
      `${origin}/zhiban/teacher/courses/${trial.courseId}/grades?space=${tenant}&offering=${trial.offeringId}#queue`,
    );
    await tp
      .locator('.grading-rows article')
      .filter({ hasText: '课程测验演示' })
      .getByRole('button', { name: '打开评分', exact: true })
      .click();
    await expect(tp.getByRole('heading', { name: '测验评分 · 课程测验演示' })).toBeVisible();
    await tp.getByLabel('评分-q3', { exact: true }).fill('4');
    await tp.getByRole('button', { name: '确认分项并保存评分', exact: true }).click();
    await expect(tp.getByRole('button', { name: '发布成绩', exact: true })).toBeVisible();
    await tp.getByRole('button', { name: '发布成绩', exact: true }).click();
    await expect(tp.getByText('成绩版本 1：9.00 / 10.00', { exact: false })).toBeVisible();
    const published = await read('quiz-submissions?submission=' + submission);
    assert.equal(published.publications[0].score_points, 900);
    assert.equal(published.review, undefined);
    await tp.getByLabel('评分-q3', { exact: true }).fill('4.50');
    await tp.getByLabel('公开更正理由').fill('复核后补计完整的隔离说明');
    await tp.getByRole('button', { name: '更正并发布测验成绩', exact: true }).click();
    await expect(tp.getByText('成绩版本 2：9.50 / 10.00', { exact: false })).toBeVisible();
    quiz = await read('quizzes?activity=' + quiz.id, teacher);
    await send({ type: 'CLOSE_QUIZ_REVIEW', id: quiz.activityId, revision: quiz.revision });
    const released = await read('quiz-submissions?submission=' + submission);
    assert.equal(released.review.questions[0].answer[0], 'A');
    const blocked = await http(
      base + '/quizzes',
      student,
      {
        type: 'SAVE_QUIZ_DRAFT',
        attemptId: attempt.id,
        revision: submitted.attempt.revision,
        answers: { q1: 'B' },
      },
      'POST',
      { 'x-zhiban-command': randomUUID() },
    );
    assert.equal(blocked.status, 409);
    await sp.goto(route('student'));
    await sp.getByRole('button', { name: '查看已提交尝试', exact: true }).first().click();
    await sp.getByRole('button', { name: '查看本次提交与成绩', exact: true }).first().click();
    await expect(sp.getByText('成绩版本 1：9.00 / 10.00', { exact: false }).first()).toBeVisible();
    assert.deepEqual(errors, []);
    record(
      'QUIZ: shared teacher editor publishes v2; student fixed-v1 save/reload/submit; exact Submission 9/10 publication, reasoned 9.5/10 correction and sealed student history',
    );
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
  const practice = await send({
    type: 'CREATE_QUIZ',
    title: '不计成绩练习',
    mode: 'PRACTICE',
    content,
    deadlineAt: null,
    allowResubmit: false,
    maxAttempts: 1,
  });
  await send({ type: 'PUBLISH_QUIZ', id: practice.id, revision: practice.revision });
  const pa = await send(
    { type: 'START_QUIZ_ATTEMPT', activityId: practice.id, expectedVersion: '1' },
    student,
  );
  const ps = await send(
    {
      type: 'SUBMIT_QUIZ',
      attemptId: pa.id,
      revision: pa.revision,
      answers: { q1: 'A', q2: ['C', 'A'], q3: '练习' },
    },
    student,
  );
  assert.ok((await read('quiz-submissions?submission=' + ps.submissionId)).review);
  const queue = await http(grade + '/queue?state=ALL&limit=50', teacher);
  assert.equal(
    (queue.json as View).rows.some((r: Record<string, unknown>) => r.id === ps.submissionId),
    false,
  );
  const denied = await http(
    grade,
    teacher,
    {
      type: 'SAVE_QUIZ_GRADE',
      submissionId: ps.submissionId,
      gradeRevision: null,
      manualMarks: { q3: '5' },
      feedback: '',
    },
    'POST',
    { 'x-zhiban-command': randomUUID() },
  );
  assert.equal(denied.status, 409);
  // Inject a failure only into this owned disposable DB, after parent Submission insertion.
  const fault = await send({
    type: 'CREATE_QUIZ',
    title: '事务故障验证',
    mode: 'ASSESSED',
    content,
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 1,
  });
  await send({ type: 'PUBLISH_QUIZ', id: fault.id, revision: fault.revision });
  const fa = await send(
    { type: 'START_QUIZ_ATTEMPT', activityId: fault.id, expectedVersion: '1' },
    student,
  );
  const command = {
    type: 'SUBMIT_QUIZ',
    attemptId: fa.id,
    revision: fa.revision,
    answers: { q1: 'A', q2: ['A', 'C'], q3: '故障切点' },
  };
  const retryKey = randomUUID();
  await admin.query(
    "CREATE FUNCTION public.local_quiz_failure_cut() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_QUIZ_FAILURE_CUT'; END $$; CREATE TRIGGER local_quiz_failure_cut BEFORE INSERT ON zhiban_learning.quiz_evaluations FOR EACH ROW EXECUTE FUNCTION public.local_quiz_failure_cut()",
  );
  try {
    assert.equal(
      (await http(base + '/quizzes', student, command, 'POST', { 'x-zhiban-command': retryKey }))
        .status,
      503,
    );
  } finally {
    await admin.query(
      'DROP TRIGGER local_quiz_failure_cut ON zhiban_learning.quiz_evaluations; DROP FUNCTION public.local_quiz_failure_cut()',
    );
  }
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=$2',
        [tenant, fa.id],
      )
    ).rows[0].n,
    0,
  );
  const recovered = await send(command, student, base + '/quizzes', retryKey),
    replayed = await send(command, student, base + '/quizzes', retryKey);
  assert.equal(recovered.submissionId, replayed.submissionId);
  const unknown = await http(
    base + '/quizzes',
    student,
    { ...command, answers: { q1: 'B' } },
    'POST',
    { 'x-zhiban-command': retryKey },
  );
  assert.equal(unknown.status, 409);
  assert.equal(
    (
      await http(
        base + '/quizzes',
        student,
        { type: 'START_QUIZ_ATTEMPT', activityId: fault.id, expectedVersion: '1' },
        'POST',
        { 'x-zhiban-command': randomUUID() },
      )
    ).status,
    409,
  );
  const other = actors[5];
  const oldAttempt = await send(
    { type: 'START_QUIZ_ATTEMPT', activityId: fault.id, expectedVersion: '1' },
    other,
  );
  const enrollment = (
    await admin.query(
      "SELECT id,revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE'",
      [tenant, trial.offeringId, other.member],
    )
  ).rows[0];
  await send(
    { type: 'WITHDRAW', id: enrollment.id, revision: enrollment.revision },
    manager,
    `/api/zhiban/management/${tenant}/commands`,
  );
  assert.equal(
    (
      await http(
        base + '/quizzes',
        other,
        {
          type: 'SUBMIT_QUIZ',
          attemptId: oldAttempt.id,
          revision: oldAttempt.revision,
          answers: { q1: 'A' },
        },
        'POST',
        { 'x-zhiban-command': randomUUID() },
      )
    ).status,
    403,
  );
  record(
    'QUIZ: failure after parent insert rolls back fully; same-key retry/replay yields one Submission, changed payload and exhausted attempts rejected; real Enrollment withdrawal blocks submission',
  );
  const acl = await admin.query(
    "SELECT has_table_privilege('zhiban_academic_runtime','zhiban_learning.quiz_versions','UPDATE') AS mutable,has_table_privilege('zhiban_academic_runtime','zhiban_learning.quiz_submission_answers','DELETE') AS deletable",
  );
  assert.equal(acl.rows[0].mutable, false);
  assert.equal(acl.rows[0].deletable, false);
  record(
    'QUIZ: practice feedback excluded from grading queue and formal grading; append-only table ACL rejects mutation/deletion',
  );
}
