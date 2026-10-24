/** Actual LOCAL PG16/Identity/Native publication and browser journey. Measurements are explicitly learner reported. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { Pool, QueryResultRow } from 'pg';
import type { prepareTrial } from './prepare-trial';
import { interactiveExample } from '../../app/zhiban/local/interactive-client';
import { loadFlow } from './flow';
import { flowDigest, type FlowStep } from '../../lib/zhiban/domain/flow/model';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  businessPool: Pool;
};
export async function verifyFlow(input: Input) {
  const { admin, businessPool, browser, http, actors, tenant: t, origin, trial, record } = input;
  const [teacher, student, outsider, foreign, manager, peer] = actors;
  const o = trial.offeringId,
    learning = `/api/zhiban/learning/${t}/offerings/${o}`,
    classrooms = learning + '/classrooms',
    flow = `/api/zhiban/flow/${t}/offerings/${o}`,
    content = `/api/zhiban/content/${t}/offerings/${o}`,
    assessment = `/api/zhiban/assessment/${t}/offerings/${o}`;
  const send = async (path: string, a: typeof student, c: unknown, key = v7()) => {
    const r = await http(path, a, c, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify({ command: c, response: r.json }));
    return r.json as QueryResultRow;
  };
  const read = async (path: string, a = teacher) => {
    const r = await http(path, a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as QueryResultRow;
  };
  const resource = await send(content, teacher, {
    type: 'CREATE_INTERACTIVE',
    title: '教案：电路观察',
    html: interactiveExample,
  });
  const resources = async () => (await read(content)).resources as QueryResultRow[];
  await send(content, teacher, {
    type: 'PUBLISH_CONTENT',
    id: resource.id,
    revision: (await resources()).find((r) => r.id === resource.id)!.revision,
  });
  const publication = (await resources()).find((r) => r.id === resource.id)!.publication.id;
  const activities: QueryResultRow[] = [];
  for (const title of ['教案：预习解释', '教案：实验报告']) {
    const a = await send(learning, teacher, {
      type: 'CREATE_ACTIVITY',
      title,
      prompt: '解释观察、记录测量、说明依据。',
      deadlineAt: null,
      allowResubmit: true,
      maxAttempts: 3,
    });
    await send(learning, teacher, { type: 'PUBLISH_ACTIVITY', id: a.id, revision: a.revision });
    activities.push(a);
  }
  const quiz = await send(learning + '/quizzes', teacher, {
    type: 'CREATE_QUIZ',
    title: '教案：课堂测验',
    mode: 'ASSESSED',
    content: {
      type: 'quiz',
      questions: [
        {
          id: 'q1',
          type: 'single',
          question: '电阻不变时电压增大，电流怎样变化？',
          options: [
            { value: 'A', label: '增大' },
            { value: 'B', label: '减小' },
          ],
          answer: ['A'],
          analysis: 'I=U/R',
          points: 1,
        },
      ],
    },
    deadlineAt: null,
    allowResubmit: false,
    maxAttempts: 1,
  });
  await send(learning + '/quizzes', teacher, {
    type: 'PUBLISH_QUIZ',
    id: quiz.id,
    revision: quiz.revision,
  });
  const outline = await read(learning + '/outline');
  await send(learning + '/outline', teacher, {
    type: 'SAVE_OUTLINE',
    revision: outline.revision,
    chapters: [
      {
        id: v7(),
        title: '完整教案与实验',
        units: [
          { id: v7(), kind: 'LECTURE', target: resource.id, title: '原生互动' },
          { id: v7(), kind: 'ACTIVITY', target: activities[0].id, title: '预习' },
          { id: v7(), kind: 'ACTIVITY', target: activities[1].id, title: '实验' },
          { id: v7(), kind: 'ACTIVITY', target: quiz.id, title: '测验' },
        ],
      },
    ],
  });
  await send(learning + '/outline', teacher, {
    type: 'PUBLISH_OUTLINE',
    revision: String(BigInt(outline.revision) + BigInt(1)),
  });
  const makeClassroom = async (title: string) => {
    const s = await send(classrooms, teacher, {
      type: 'CREATE_CLASSROOM',
      title,
      description: 'LOCAL完整教案：固定发布、手动实验及原评分。',
      opensAt: null,
      closesAt: null,
    });
    return {
      ...s,
      ...(await send(classrooms, teacher, {
        type: 'PUBLISH_CLASSROOM',
        id: s.id,
        revision: s.revision,
      })),
    };
  };
  const classroom = await makeClassroom('课堂与实验完整旅程');
  const spec = {
    instructions: '保持安全电压，记录电压和电流；此处数据为学生手动输入。',
    parameters: [{ key: 'voltage', label: '电压', unit: 'V', min: 0, max: 24, initial: 6 }],
    measurements: [{ key: 'current', label: '电流', unit: 'A', min: 0, max: 5, initial: 0 }],
    conclusionPrompt: '说明测量结果、依据与误差。',
  };
  const steps: FlowStep[] = [
    {
      id: v7(),
      title: '观察电路',
      kind: 'LECTURE',
      target: resource.id,
      version: '1',
      interactiveId: null,
      publicationId: publication,
      requires: [],
      lab: null,
    },
    {
      id: v7(),
      title: '预习解释',
      kind: 'ACTIVITY',
      target: activities[0].id,
      version: '1',
      interactiveId: null,
      publicationId: null,
      requires: [],
      lab: null,
    },
    {
      id: v7(),
      title: '安全电压测量实验',
      kind: 'LAB',
      target: activities[1].id,
      version: '1',
      interactiveId: resource.id,
      publicationId: publication,
      requires: [],
      lab: spec,
    },
    {
      id: v7(),
      title: '课堂测验',
      kind: 'ACTIVITY',
      target: quiz.id,
      version: '1',
      interactiveId: null,
      publicationId: null,
      requires: [],
      lab: null,
    },
  ];
  steps[2].requires = [{ stepId: steps[1].id, kind: 'GRADE_AT_LEAST', percent: 60 }];
  steps[3].requires = [{ stepId: steps[2].id, kind: 'SUBMITTED', percent: null }];
  const planCommand = { type: 'SAVE_PLAN', classroomId: classroom.id, revision: '0', steps };
  for (const a of [student, manager, outsider, foreign])
    assert.equal((await http(flow, a, planCommand)).status, 403);
  assert.equal((await http(flow, teacher, { ...planCommand, nativeCompletion: true })).status, 400);
  await send(flow, teacher, planCommand);
  const tc = await browser.newContext(),
    sc = await browser.newContext();
  for (const [ctx, a] of [
    [tc, teacher],
    [sc, student],
  ] as const)
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
  const tp = await tc.newPage(),
    sp = await sc.newPage(),
    errors: string[] = [];
  tp.on('pageerror', (e) => errors.push(e.message));
  sp.on('pageerror', (e) => errors.push(e.message));
  const pageUrl = (role: string) =>
    `${origin}/zhiban/${role}/courses/${trial.courseId}/classroom-plan?space=${t}&offering=${o}`;
  const state = () => read(flow + '?classroom=' + classroom.id);
  const session = async () =>
    (await read(classrooms)).sessions.find(
      (s: QueryResultRow) => s.id === classroom.id,
    ) as QueryResultRow;
  const recordFact = (s: string) => record('FLOW: ' + s);
  try {
    await tp.goto(pageUrl('teacher') + '#classroom-' + classroom.id);
    await expect(tp.getByRole('heading', { name: '教案、课堂环节与实验' })).toBeVisible();
    await tp.getByRole('button', { name: '编辑环节', exact: true }).first().click();
    await tp.getByLabel('环节标题', { exact: true }).fill('电路观察与预测');
    await tp.getByRole('button', { name: '加入或更新环节', exact: true }).click();
    await tp.getByRole('button', { name: '保存教案草稿', exact: true }).click();
    await expect(tp.getByText('教案草稿已保存，尚未发布。', { exact: true })).toBeVisible();
    await tp.getByRole('button', { name: '发布教案固定版本', exact: true }).click();
    await expect(tp.getByRole('button', { name: '按教案开始课堂', exact: true })).toBeVisible();
    await tp.getByRole('button', { name: '按教案开始课堂', exact: true }).click();
    await expect(tp.getByText(/课堂流程：进行中/)).toBeVisible();
    const studentPlan = await read(flow + '?classroom=' + classroom.id, student);
    assert.equal(studentPlan.plan.draft, undefined);
    let v = await state();
    assert.equal(v.steps[0].title, '电路观察与预测');
    assert.equal(v.run.step_index, 0);
    assert.equal(v.nativeRuntimeEnabled, false);
    recordFact(
      'teacher browser edits, saves, publishes a fixed plan and starts its first native interactive scene',
    );
    assert.equal(
      (
        await http(flow, teacher, {
          type: 'FINISH_FLOW',
          classroomId: classroom.id,
          revision: v.run.revision,
          reason: '',
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await http(classrooms, teacher, {
          type: 'DISPATCH_TASK',
          id: classroom.id,
          revision: (await session()).revision,
          kind: 'ACTIVITY',
          target: activities[0].id,
          version: '1',
        })
      ).status,
      409,
    );
    await sp.goto(pageUrl('student') + '#classroom-' + classroom.id);
    await expect(sp.locator('#flow[aria-busy="false"]')).toBeVisible();
    await sp.getByRole('button', { name: '进入／继续本环节', exact: true }).click();
    await sp.waitForURL(/\/resources\/.*\/player\?publication=/);
    await expect(sp.locator('iframe')).toBeVisible();
    const first = v.dispatches[0].dispatch_id;
    const pause = await send(flow, teacher, {
      type: 'PAUSE_FLOW',
      classroomId: classroom.id,
      revision: v.run.revision,
      reason: '',
    });
    assert.equal(
      (
        await http(classrooms, student, {
          type: 'ENTER_TASK',
          id: classroom.id,
          revision: (await session()).revision,
          dispatchId: first,
        })
      ).status,
      409,
    );
    await send(flow, teacher, {
      type: 'RESUME_FLOW',
      classroomId: classroom.id,
      revision: pause.revision,
      reason: '',
    });
    v = await state();
    const enterLecture = {
      type: 'ENTER_TASK',
      id: classroom.id,
      revision: (await session()).revision,
      dispatchId: first,
    };
    await send(classrooms, student, enterLecture);
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) AS n FROM zhiban_classroom.entries WHERE tenant_id=$1 AND dispatch_id=$2 AND membership_id=$3',
            [t, first, student.member],
          )
        ).rows[0].n,
      ),
      1,
    );
    const next = {
        type: 'NEXT_STEP',
        classroomId: classroom.id,
        revision: v.run.revision,
        reason: '',
      },
      key = v7();
    const advanced = await send(flow, teacher, next, key);
    assert.deepEqual(await send(flow, teacher, next, key), advanced);
    v = await state();
    const activityDispatch = v.dispatches.find((d: QueryResultRow) => d.position === 1).dispatch_id;
    const attempt = await send(classrooms, student, {
      type: 'ENTER_TASK',
      id: classroom.id,
      revision: (await session()).revision,
      dispatchId: activityDispatch,
    });
    const contenders = await Promise.all([
      http(flow, teacher, {
        type: 'NEXT_STEP',
        classroomId: classroom.id,
        revision: v.run.revision,
        reason: '',
      }),
      http(flow, teacher, {
        type: 'NEXT_STEP',
        classroomId: classroom.id,
        revision: v.run.revision,
        reason: '',
      }),
    ]);
    assert.deepEqual(contenders.map((r) => r.status).sort(), [200, 409]);
    v = await state();
    const labDispatch = v.dispatches.find((d: QueryResultRow) => d.position === 2).dispatch_id;
    const open = { type: 'OPEN_LAB', classroomId: classroom.id, dispatchId: labDispatch };
    assert.equal((await http(flow, student, open)).status, 409);
    const textSubmit = await send(learning, student, {
      type: 'SUBMIT',
      id: attempt.attemptId,
      revision: '1',
      answer: '电压升高时，在电阻不变条件下电流增大。',
    });
    const grade = await send(assessment, teacher, {
      type: 'SAVE_GRADE',
      submissionId: textSubmit.submissionId,
      revision: null,
      score: '70',
      maxScore: '100',
      feedback: '依据清楚。',
    });
    await send(assessment, teacher, {
      type: 'PUBLISH_GRADE',
      submissionId: textSubmit.submissionId,
      revision: grade.revision,
    });
    const enters = await Promise.all([send(flow, student, open), send(flow, student, open)]);
    assert.equal(enters[0].id, enters[1].id);
    assert.equal(enters[0].attemptId, enters[1].attemptId);
    const notebookId = enters[0].id;
    let n = (await read(flow + '?notebook=' + notebookId, student)).notebook;
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) AS n FROM zhiban_learning.attempts WHERE tenant_id=$1 AND activity_id=$2 AND membership_id=$3',
            [t, activities[1].id, student.member],
          )
        ).rows[0].n,
      ),
      1,
    );
    assert.equal(
      (
        await http(learning, student, {
          type: 'SUBMIT',
          id: n.attempt_id,
          revision: n.attempt_revision,
          answer: '跳过实验表格',
        })
      ).status,
      409,
    );
    assert.equal((await http(flow, peer)).status, 200);
    assert.equal((await http(flow + '?notebook=' + notebookId, peer)).status, 404);
    const rows = [{ values: { current: 0.3 }, note: '人工读取' }],
      save = {
        type: 'SAVE_LAB',
        id: notebookId,
        revision: n.revision,
        attemptRevision: n.attempt_revision,
        parameters: { voltage: 6 },
        rows,
        conclusion: '电压电流数据手动测量，说明仪表误差。',
      };
    assert.equal((await http(flow, student, { ...save, parameters: { voltage: 25 } })).status, 400);
    const saves = await Promise.all([
      http(flow, student, save),
      http(flow, student, { ...save, conclusion: '另一并发修改' }),
    ]);
    assert.deepEqual(saves.map((r) => r.status).sort(), [200, 409]);
    recordFact(
      'pause/resume keeps one entry; advancement and draft writes use CAS; grade prerequisite blocks new entry; repeated entry atomically retains one Attempt, joint binding and notebook',
    );
    await sp.goto(pageUrl('student') + '#notebook-' + notebookId);
    await expect(
      sp.getByRole('heading', { name: '安全电压测量实验', exact: true, level: 2 }),
    ).toBeVisible();
    await sp.getByLabel('实验参数 电压', { exact: true }).fill('12');
    await sp.getByLabel('第1行 电流', { exact: true }).fill('0.6');
    await sp
      .getByLabel('实验结论', { exact: true })
      .fill('在电阻不变时，12 V 对应手动记录的0.6 A，检查接线和仪表后确认。');
    await sp.getByRole('button', { name: '保存实验记录', exact: true }).click();
    await expect(sp.getByText('实验记录已保存。', { exact: true })).toBeVisible();
    await sp.reload();
    await expect(sp.getByLabel('实验参数 电压', { exact: true })).toHaveValue('12');
    sp.once('dialog', (d) => d.accept());
    await sp.getByRole('button', { name: '正式提交实验报告', exact: true }).click();
    await expect(sp.getByText('实验报告已正式提交，等待教师评分。', { exact: true })).toBeVisible();
    let detail = await read(flow + '?notebook=' + notebookId, student);
    n = detail.notebook;
    assert.equal(detail.reports.length, 1);
    const report = structuredClone(detail.reports[0]);
    assert.equal(report.parameters.voltage, 12);
    assert.equal(report.measurements[0].values.current, 0.6);
    assert.equal(
      report.source_digest,
      flowDigest({
        step: steps[2],
        values: {
          parameters: report.parameters,
          rows: report.measurements,
          conclusion: report.conclusion,
        },
      }),
    );
    const queue = await read(assessment + '/queue?limit=20');
    assert.equal(
      queue.rows.find((r: QueryResultRow) => r.id === n.submission_id)?.lab_notebook_id,
      notebookId,
    );
    const labGrade = await send(assessment, teacher, {
      type: 'SAVE_GRADE',
      submissionId: n.submission_id,
      revision: null,
      score: '85',
      maxScore: '100',
      feedback: '测量记录完整，结论有依据。',
    });
    await send(assessment, teacher, {
      type: 'PUBLISH_GRADE',
      submissionId: n.submission_id,
      revision: labGrade.revision,
    });
    await sp.reload();
    await expect(sp.getByText(/成绩 85.00\/100.00/)).toBeVisible();
    await tp.goto(
      `${origin}/zhiban/teacher/courses/${trial.courseId}/grades?space=${t}&offering=${o}`,
    );
    await tp.getByRole('button', { name: '待评分列表', exact: true }).click();
    await tp.getByLabel('评分状态', { exact: true }).selectOption('ALL');
    await tp.getByRole('button', { name: '查询评分', exact: true }).click();
    await expect(
      tp.getByRole('link', { name: '查看完整实验数据与版本', exact: true }).first(),
    ).toBeVisible();
    await tp.getByRole('link', { name: '查看完整实验数据与版本', exact: true }).first().click();
    await expect(
      tp.getByRole('heading', { name: '安全电压测量实验', exact: true, level: 2 }),
    ).toBeVisible();
    await expect(tp.getByLabel('实验参数 电压', { exact: true })).toBeDisabled();
    await sp.screenshot({ path: 'docs/v2/evidence/zhiban-flow-student-local.png', fullPage: true });
    await tp.screenshot({ path: 'docs/v2/evidence/zhiban-flow-teacher-local.png', fullPage: true });
    recordFact(
      'student browser records measurements, saves/reloads, submits; original teacher grade is published; grading queue links to immutable experimental evidence; student sees the published grade',
    );
    const resave = await send(flow, student, {
      type: 'SAVE_LAB',
      id: notebookId,
      revision: n.revision,
      attemptRevision: n.attempt_revision,
      parameters: { voltage: 6 },
      rows: [{ values: { current: 0.3 }, note: '复测' }],
      conclusion: '允许重交时新增复测，旧提交固定保存。',
    });
    assert.ok(resave.revision);
    detail = await read(flow + '?notebook=' + notebookId, student);
    assert.deepEqual(detail.reports[0], reportWithGrade(report, detail.reports[0]));
    await send(flow, student, {
      type: 'SUBMIT_LAB',
      id: notebookId,
      revision: detail.notebook.revision,
      attemptRevision: detail.notebook.attempt_revision,
      parameters: { voltage: 6 },
      rows: [{ values: { current: 0.3 }, note: '复测' }],
      conclusion: '允许重交时新增复测，旧提交固定保存。',
    });
    detail = await read(flow + '?notebook=' + notebookId, student);
    assert.equal(detail.reports.length, 2);
    assert.equal(detail.reports[1].parameters.voltage, 12);
    assert.equal(detail.reports[1].score_points, 8500);
    assert.equal(detail.reports[0].grade_version, null);
    v = await state();
    await send(flow, teacher, {
      type: 'NEXT_STEP',
      classroomId: classroom.id,
      revision: v.run.revision,
      reason: '',
    });
    v = await state();
    const quizDispatch = v.dispatches.find((d: QueryResultRow) => d.position === 3).dispatch_id;
    const quizAttempt = await send(classrooms, student, {
      type: 'ENTER_TASK',
      id: classroom.id,
      revision: (await session()).revision,
      dispatchId: quizDispatch,
    });
    await send(learning + '/quizzes', student, {
      type: 'SUBMIT_QUIZ',
      attemptId: quizAttempt.attemptId,
      revision: '1',
      answers: { q1: 'A' },
    });
    await send(flow, teacher, {
      type: 'FINISH_FLOW',
      classroomId: classroom.id,
      revision: v.run.revision,
      reason: '',
    });
    assert.equal((await http(flow, student, open)).status, 409);
    assert.equal((await read(flow + '?notebook=' + notebookId, student)).reports.length, 2);
    recordFact(
      'resubmission preserves original structured report and published grade; Quiz uses original Attempt/submit; flow end blocks new entry and retains history',
    );
    // Real transaction fault after original Attempt/joint/notebook creation must roll all of them back.
    const faultClass = await makeClassroom('事务回滚实验');
    const faultSteps = [{ ...steps[2], id: v7(), requires: [] }];
    await send(flow, teacher, {
      type: 'SAVE_PLAN',
      classroomId: faultClass.id,
      revision: '0',
      steps: faultSteps,
    });
    const fp = await send(flow, teacher, {
      type: 'PUBLISH_PLAN',
      classroomId: faultClass.id,
      revision: '1',
    });
    const fr = await send(flow, teacher, {
      type: 'START_FLOW',
      classroomId: faultClass.id,
      planVersion: fp.planVersion,
      classroomRevision: faultClass.revision,
    });
    const counts = async () =>
      (
        await admin.query(
          `SELECT (SELECT count(*)::int FROM zhiban_learning.attempts WHERE tenant_id=$1 AND membership_id=$2) attempts,(SELECT count(*)::int FROM zhiban_flow.notebooks WHERE tenant_id=$1 AND membership_id=$2) notebooks,(SELECT count(*)::int FROM zhiban_classroom.entries WHERE tenant_id=$1 AND membership_id=$2) entries,(SELECT count(*)::int FROM zhiban_content.attempt_runtime_bindings WHERE tenant_id=$1 AND learner_membership_id=$2) bindings`,
          [t, peer.member],
        )
      ).rows[0];
    const before = await counts();
    await admin.query('REVOKE INSERT ON zhiban_flow.events FROM zhiban_academic_runtime');
    try {
      assert.equal(
        (
          await http(flow, peer, {
            type: 'OPEN_LAB',
            classroomId: faultClass.id,
            dispatchId: fr.dispatchId,
          })
        ).status,
        503,
      );
    } finally {
      await admin.query('GRANT INSERT ON zhiban_flow.events TO zhiban_academic_runtime');
    }
    assert.deepEqual(await counts(), before);
    const opened = await send(flow, peer, {
      type: 'OPEN_LAB',
      classroomId: faultClass.id,
      dispatchId: fr.dispatchId,
    });
    assert.ok(opened.id);
    await send(flow, teacher, {
      type: 'CANCEL_FLOW',
      classroomId: faultClass.id,
      revision: fr.revision,
      reason: '结束故障验证',
    });
    assert.equal(await loadFlow(businessPool), true);
    await admin.query('GRANT UPDATE ON zhiban_flow.reports TO zhiban_academic_runtime');
    try {
      await assert.rejects(loadFlow(businessPool), /ACL|catalog/);
    } finally {
      await admin.query('REVOKE UPDATE ON zhiban_flow.reports FROM zhiban_academic_runtime');
    }
    assert.equal(await loadFlow(businessPool), true);
    const raw = await businessPool.query('SELECT count(*)::int n FROM zhiban_flow.notebooks');
    assert.equal(raw.rows[0].n, 0);
    assert.deepEqual(errors, []);
    recordFact(
      'late SQL failure rolls back Attempt/entry/runtime binding/notebook; immutable report ACL drift is rejected; RLS and foreign learner isolation hold',
    );
    await writeFile(
      'docs/v2/evidence/zhiban-flow-journey-local.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          at: new Date().toISOString(),
          scope:
            'FIXED_TEACHING_PLAN_NATIVE_PLAYBACK_LEARNER_REPORTED_EXPERIMENT_AND_ORIGINAL_GRADING_NOT_NATIVE_AUTOMATIC_COMPLETION',
          classroomId: classroom.id,
          notebookId,
          source: 'LEARNER_REPORTED',
          nativeRuntimeEnabled: false,
          reportDigest: flowDigest(detail.reports),
          browserErrors: errors,
        },
        null,
        2,
      ) + '\n',
    );
  } catch (error) {
    console.log('FLOW browser errors:', errors);
    console.log(
      'FLOW teacher page:',
      tp.url(),
      (await tp.locator('body').innerText()).slice(-2000),
    );
    console.log(
      'FLOW student page:',
      sp.url(),
      (await sp.locator('body').innerText()).slice(-2500),
    );
    throw error;
  } finally {
    await tc.close();
    await sc.close();
  }
}
function reportWithGrade(before: QueryResultRow, after: QueryResultRow) {
  const copy = { ...before };
  for (const k of ['grade_version', 'score_points', 'max_points', 'feedback', 'reason'])
    copy[k] = after[k];
  return copy;
}
