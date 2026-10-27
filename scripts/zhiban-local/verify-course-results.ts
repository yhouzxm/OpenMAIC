/** Real LOCAL PG16/Identity/native Quiz/formal submission/grade journey. No external model fixture claims. */
/* eslint-disable @typescript-eslint/no-explicit-any -- malformed native envelopes are intentional */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { makeDocument, makeSlideScene } from '../../tests/agent-runtime/_stage-fixtures';
import { autonomousProject } from '../../tests/zhiban/classroom-ai/pbl-fixtures';
import type { verifyClassroomAi } from './verify-classroom-ai';
export async function verifyCourseResults(input: Parameters<typeof verifyClassroomAi>[0]) {
  const { http, actors, tenant, trial, browser, origin, native, admin, record } = input,
    [teacher, student, outsider, foreign, manager] = actors;
  const o = trial.offeringId,
    author = `/api/zhiban/authoring/${tenant}/offerings/${o}`,
    content = `/api/zhiban/content/${tenant}/offerings/${o}`,
    learning = `/api/zhiban/learning/${tenant}/offerings/${o}`,
    assessment = `/api/zhiban/assessment/${tenant}/offerings/${o}`,
    base = `/api/zhiban/course-results/${tenant}/offerings/${o}`;
  const ok = async (
    path: string,
    body?: unknown,
    actor = teacher,
    method?: string,
    extra?: Record<string, string>,
  ) => {
    const r = await http(path, actor, body, method, extra);
    assert.ok(
      r.status >= 200 && r.status < 300,
      JSON.stringify({ path, status: r.status, body: r.json }),
    );
    return r.json as any;
  };
  const stage = (await ok(author + '/native/api/stages', { name: '可信课堂成果：电流' })).stage.id;
  const slide = makeSlideScene('result-slide', stage, 0, '电流与证据');
  if (slide.content.type === 'slide')
    slide.content.canvas.elements = [
      {
        id: 'evidence-text',
        type: 'text',
        left: 30,
        top: 30,
        width: 800,
        height: 200,
        rotate: 0,
        defaultFontName: 'Arial',
        defaultColor: '#111827',
        content: '<p>电流单位是安培。只凭聊天不能判定正式完成。</p>',
      },
    ];
  const quiz = {
    ...makeSlideScene('result-quiz', stage, 1, '课堂自测成果'),
    type: 'quiz',
    content: {
      type: 'quiz',
      questions: [
        {
          id: 'current-unit',
          type: 'single',
          question: '电流的单位是什么？',
          options: [
            { value: 'A', label: '安培' },
            { value: 'B', label: '伏特' },
          ],
          answer: 'A',
          points: 2,
        },
      ],
    },
  };
  const pbl = {
    ...makeSlideScene('result-pbl', stage, 2, '节能项目成果'),
    type: 'pbl',
    content: { type: 'pbl', projectV2: autonomousProject() },
  };
  await ok(
    author + '/native/api/stages/' + stage,
    makeDocument(stage, '可信课堂成果', [slide, quiz, pbl] as any),
    teacher,
    'PUT',
  );
  const preview = await ok(author + '/snapshot', { type: 'PREVIEW', stageId: stage }),
    adopt = await ok(author + '/snapshot', {
      type: 'ADOPT',
      stageId: stage,
      sourceDigest: preview.sourceDigest,
    });
  const row = (await ok(content)).resources.find((r: any) => r.id === adopt.id);
  await ok(content, { type: 'PUBLISH_CONTENT', id: adopt.id, revision: row.revision });
  const pub = (
    await ok(content + `/resources/${adopt.id}/preview?source=published`, undefined, student)
  ).publicationId;
  const classroom = `/api/zhiban/classroom-ai/${tenant}/offerings/${o}/resources/${adopt.id}/publications/${pub}`;
  await ok(classroom + '/policy', { enabled: true, revision: '0' });
  await ok(classroom + '/pbl-policy', { enabled: true, revision: '0' });
  for (const actor of [outsider, foreign, manager])
    assert.equal((await http(base, actor)).status, 403);
  const create = async (title: string) => {
    const a = await ok(learning, {
      type: 'CREATE_ACTIVITY',
      title,
      prompt: '完成固定场景后，核验成果并说明依据。',
      deadlineAt: null,
      allowResubmit: true,
      maxAttempts: 4,
    });
    await ok(learning, { type: 'PUBLISH_ACTIVITY', id: a.id, revision: a.revision });
    return a.id;
  };
  const activity = await create('原生自测正式成果'),
    oldActivity = await create('先开始后配置的历史作答'),
    pblActivity = await create('PBL正式成果');
  const old = await ok(learning, { type: 'START_ATTEMPT', id: oldActivity }, student);
  let state = await ok(base);
  const choice = state.choices.find((c: any) => c.resourceId === adopt.id);
  assert.ok(choice);
  const spec = {
    resourceId: adopt.id,
    publicationId: pub,
    sceneId: quiz.id,
    kind: 'QUIZ',
    sourceDigest: choice.sourceDigest,
  };
  const competingTask = {
    type: 'SET_TASK',
    activityId: activity,
    activityVersion: 1,
    revision: '0',
    enabled: true,
    spec,
  };
  const taskRace = await Promise.all([
    http(base, teacher, competingTask),
    http(base, teacher, competingTask),
  ]);
  assert.deepEqual(taskRace.map((r) => r.status).sort(), [200, 409]);
  await ok(base, {
    type: 'SET_TASK',
    activityId: oldActivity,
    activityVersion: 1,
    revision: '0',
    enabled: true,
    spec,
  });
  await ok(base, {
    type: 'SET_TASK',
    activityId: pblActivity,
    activityVersion: 1,
    revision: '0',
    enabled: true,
    spec: { ...spec, sceneId: pbl.id, kind: 'PBL' },
  });
  assert.equal(
    (
      await http(base, student, {
        type: 'SET_TASK',
        activityId: activity,
        activityVersion: 1,
        revision: '1',
        enabled: false,
        spec,
      })
    ).status,
    403,
  );
  await ok(
    learning,
    {
      type: 'SUBMIT',
      id: old.id,
      revision: old.revision,
      answer: '配置前已经开始的作答仍可提交。',
    },
    student,
  );
  const startBody = { type: 'START', activityId: activity, activityVersion: 1 },
    command = randomUUID();
  const begin = await ok(base, startBody, student, 'POST', { 'x-zhiban-command': command });
  assert.equal(
    (await ok(base, startBody, student, 'POST', { 'x-zhiban-command': command })).id,
    begin.id,
  );
  assert.equal(
    (
      await http(learning, student, {
        type: 'SUBMIT',
        id: begin.id,
        revision: begin.revision,
        answer: '伪造普通提交绕过成果要求',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await http(base, student, {
        type: 'CAPTURE',
        attemptId: begin.id,
        reflection: '我已完成',
        score: 100,
        completed: true,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await http(base, student, {
        type: 'CAPTURE',
        attemptId: begin.id,
        reflection: '没有新原生自测记录',
      })
    ).status,
    409,
  );
  const pblBegin = await ok(
    base,
    { type: 'START', activityId: pblActivity, activityVersion: 1 },
    student,
  );
  assert.equal(
    (
      await http(base, student, {
        type: 'CAPTURE',
        attemptId: pblBegin.id,
        reflection: '不能以客户端状态当成PBL完成',
      })
    ).status,
    409,
  );
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const cookie = student.cookie!.split(';')[0],
    eq = cookie.indexOf('=');
  await context.addCookies([
    {
      name: cookie.slice(0, eq),
      value: cookie.slice(eq + 1),
      url: origin,
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await context.newPage(),
    errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(
    origin +
      `/zhiban/native-classroom?tenant=${tenant}&offering=${o}&resource=${adopt.id}&publication=${pub}&scene=${quiz.id}&resultAttempt=${begin.id}`,
  );
  await page.getByRole('button', { name: '开始答题', exact: true }).click({ timeout: 30000 });
  await page.getByText('安培', { exact: true }).click();
  await page.getByRole('button', { name: '提交答案', exact: true }).click();
  await expect(page.getByRole('button', { name: '重新答题', exact: true })).toBeVisible({
    timeout: 30000,
  });
  await page.goto(
    origin + `/zhiban/course-results?tenant=${tenant}&offering=${o}&attempt=${begin.id}`,
  );
  await page
    .getByLabel('本人反思')
    .fill('我根据固定课件选择安培，服务端重新计算客观题；这不是正式成绩。');
  await page.getByRole('button', { name: '从服务端核验并保存成果', exact: true }).click();
  await expect(page.getByRole('heading', { name: '提交预览', exact: true })).toBeVisible();
  state = await ok(base, undefined, student);
  const proof = state.proofs.find((p: any) => p.attempt_id === begin.id);
  assert.ok(proof);
  assert.equal(proof.payload.execution.practiceScore, 2);
  assert.equal(proof.payload.execution.formalGrade, null);
  assert.equal((await ok(base)).proofs.length, 0, 'teacher cannot read unsubmitted private proof');
  await page.getByLabel('我已核对成果及本人反思，确认提交到正式活动').check();
  await page.getByRole('button', { name: '确认提交成果', exact: true }).click();
  await expect(page.getByText('成绩尚未发布', { exact: true }).first()).toBeVisible();
  state = await ok(base, undefined, student);
  const submitted = state.submissions.find(
    (s: any) => s.result.classroomEvidence.proofId === proof.id,
  );
  assert.ok(submitted);
  const revision = state.attempts.find((a: any) => a.id === begin.id).revision;
  const replayKey = randomUUID(),
    resubmit = { type: 'SUBMIT', attemptId: begin.id, revision, proofId: proof.id };
  const [again, replay] = await Promise.all([
    ok(base, resubmit, student, 'POST', { 'x-zhiban-command': replayKey }),
    ok(base, resubmit, student, 'POST', { 'x-zhiban-command': replayKey }),
  ]);
  assert.equal(again.submissionId, replay.submissionId);
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=$2',
        [tenant, begin.id],
      )
    ).rows[0].n,
    2,
    'concurrent same-command resubmission creates exactly one new formal fact',
  );
  // Inject a failure in the original submission event insert. Both submission and provenance must roll back.
  await admin.query(
    `CREATE FUNCTION public.local_course_result_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='SUBMISSION_RECORDED' THEN RAISE EXCEPTION 'LOCAL_RESULT_FAULT'; END IF; RETURN NEW; END $$`,
  );
  await admin.query(
    'CREATE TRIGGER local_course_result_fault BEFORE INSERT ON zhiban_learning.events FOR EACH ROW EXECUTE FUNCTION public.local_course_result_fault()',
  );
  const beforeCount = (
    await admin.query(
      'SELECT count(*)::int AS n FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=$2',
      [tenant, begin.id],
    )
  ).rows[0].n;
  try {
    assert.equal(
      (await http(base, student, { ...resubmit, revision: again.revision })).status,
      503,
    );
  } finally {
    await admin.query('DROP TRIGGER local_course_result_fault ON zhiban_learning.events');
    await admin.query('DROP FUNCTION public.local_course_result_fault()');
  }
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=$2',
        [tenant, begin.id],
      )
    ).rows[0].n,
    beforeCount,
  );
  const grade = await ok(assessment, {
    type: 'SAVE_GRADE',
    submissionId: again.submissionId,
    revision: null,
    score: '90',
    maxScore: '100',
    feedback: '已依据固定答卷与来源核验，由教师发布。',
  });
  await ok(assessment, {
    type: 'PUBLISH_GRADE',
    submissionId: again.submissionId,
    revision: grade.revision,
  });
  state = await ok(base, undefined, student);
  assert.equal(
    state.submissions.find((s: any) => s.submission_id === again.submissionId).score_points,
    9000,
  );
  const shared = await ok(base, {
    type: 'SHARE',
    resourceId: adopt.id,
    publicationId: pub,
    title: '全班课堂小结',
    summary: '安培是电流单位；自测证据不直接作为正式成绩。',
    includeWhiteboard: true,
  });
  assert.ok((await ok(base, undefined, student)).shared.some((s: any) => s.id === shared.id));
  await ok(base, { type: 'RETRACT_SHARED', sharedId: shared.id });
  assert.ok(!(await ok(base, undefined, student)).shared.some((s: any) => s.id === shared.id));
  await page.reload();
  await expect(page.getByText('已发布成绩 90/100', { exact: false }).first()).toBeVisible();
  await page.screenshot({
    path: 'docs/v2/evidence/zhiban-course-results-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({
    path: 'docs/v2/evidence/zhiban-course-results-mobile.png',
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await context.close();
  await assert.rejects(
    native.query('UPDATE zhiban_course_result_proofs SET digest=$1 WHERE id=$2', [
      'f'.repeat(64),
      proof.id,
    ]),
    /immutable/,
  );
  // Freeze existing captured proof while source is withdrawn: no new capture, but existing formal history stays readable.
  const currentResource = (await ok(content)).resources.find((r: any) => r.id === adopt.id);
  await ok(content, { type: 'WITHDRAW_CONTENT', id: adopt.id, revision: currentResource.revision });
  assert.ok((await ok(base, undefined, student)).submissions.length >= 2);
  assert.equal(
    (
      await http(base, student, {
        type: 'CAPTURE',
        attemptId: begin.id,
        reflection: '撤回后不能产生新成果',
      })
    ).status >= 400,
    true,
  );
  const otherStudent = actors[5];
  if (otherStudent) {
    const otherView = await http(base, otherStudent);
    if (otherView.status === 200) {
      assert.ok(!(otherView.json as any).proofs.some((p: any) => p.id === proof.id));
      assert.ok(
        !(otherView.json as any).submissions.some(
          (s: any) => s.submission_id === again.submissionId,
        ),
      );
    } else assert.equal(otherView.status, 403);
    assert.equal(
      (
        await http(base, otherStudent, {
          type: 'SUBMIT',
          attemptId: begin.id,
          revision: again.revision,
          proofId: proof.id,
        })
      ).status >= 400,
      true,
    );
  }
  await admin.query(
    "UPDATE zhiban_academic.enrollments SET status='WITHDRAWN',valid_until=$1,revision=revision+1 WHERE tenant_id=$2 AND offering_id=$3 AND membership_id=$4",
    [Date.now(), tenant, o, student.member],
  );
  assert.equal((await http(base, student)).status, 403);
  await admin.query(
    "UPDATE zhiban_academic.assignments SET status='ENDED',valid_until=$1,revision=revision+1 WHERE tenant_id=$2 AND offering_id=$3 AND membership_id=$4",
    [Date.now(), tenant, o, teacher.member],
  );
  assert.equal((await http(base, teacher)).status, 403);
  await writeFile(
    'docs/v2/evidence/zhiban-course-results-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS_REAL_NATIVE_QUIZ_TO_FORMAL_SUBMISSION_AND_MANUAL_GRADE',
        at: new Date().toISOString(),
        externalModelCalls: 0,
        checks: [
          'original attempts, fixed native Quiz UI and server regrading',
          'new-task bypass refused, pre-existing attempt unchanged',
          'private proofs hidden from teacher until formal submission',
          'submit/retry/resubmit provenance atomic with original Learning facts',
          'concurrent task CAS has one winner; concurrent same-command submit creates one fact',
          'injected event failure rolls back formal submission',
          'original manual grade publication and student result',
          'shared classroom note publish/retract',
          'immutable proof and source withdrawal history',
          'responsive desktop/mobile',
        ],
        boundaries: [
          'PBL terminal filter tested without claiming synthetic model success',
          'real instrument and legacy Native maintenance remain isolated',
        ],
      },
      null,
      2,
    ) + '\n',
  );
  record(
    'LOCAL trusted native Quiz -> evidence -> formal submit/resubmit -> teacher grade -> learner history PASS; no external models',
  );
}
