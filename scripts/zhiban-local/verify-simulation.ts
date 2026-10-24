/** Real PG16 / original Identity and grade publication. Server-calculated simulation only. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { Pool, QueryResultRow } from 'pg';
import type { prepareTrial } from './prepare-trial';
import {
  simulationModels,
  executeSimulation,
  SIMULATION_SOURCE,
} from '../../lib/zhiban/domain/flow/simulation';
import { flowDigest, type FlowStep } from '../../lib/zhiban/domain/flow/model';
import { loadFlow } from './flow';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  businessPool: Pool;
};
export async function verifySimulation(input: Input) {
  const { admin, businessPool, browser, http, actors, tenant: t, origin, trial, record } = input;
  const [teacher, student, outsider, foreign, manager, peer] = actors;
  const o = trial.offeringId,
    learning = `/api/zhiban/learning/${t}/offerings/${o}`,
    classrooms = learning + '/classrooms',
    flow = `/api/zhiban/flow/${t}/offerings/${o}`,
    assessment = `/api/zhiban/assessment/${t}/offerings/${o}`;
  const dir = 'docs/v2/evidence/simulation';
  await mkdir(dir, { recursive: true });
  const send = async (path: string, actor: typeof teacher, command: unknown, key = v7()) => {
    const r = await http(path, actor, command, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify({ command, response: r.json }));
    return r.json as QueryResultRow;
  };
  const read = async (path: string, actor = teacher) => {
    const r = await http(path, actor);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as QueryResultRow;
  };
  const activities = [] as QueryResultRow[];
  for (const title of ['直流模拟报告', 'RC充电模拟报告']) {
    const a = await send(learning, teacher, {
      type: 'CREATE_ACTIVITY',
      title,
      prompt: '比较固定模型的模拟结果并解释适用范围；不是设备实测。',
      deadlineAt: null,
      allowResubmit: true,
      maxAttempts: 3,
    });
    await send(learning, teacher, { type: 'PUBLISH_ACTIVITY', id: a.id, revision: a.revision });
    activities.push(a);
  }
  const outline = await read(learning + '/outline');
  await send(learning + '/outline', teacher, {
    type: 'SAVE_OUTLINE',
    revision: outline.revision,
    chapters: [
      {
        id: v7(),
        title: '服务端计算模拟',
        units: activities.map((a) => ({
          id: v7(),
          kind: 'ACTIVITY',
          target: a.id,
          title: a.title ?? '模拟报告',
        })),
      },
    ],
  });
  await send(learning + '/outline', teacher, {
    type: 'PUBLISH_OUTLINE',
    revision: String(BigInt(outline.revision) + BigInt(1)),
  });
  const classroom = await send(classrooms, teacher, {
    type: 'CREATE_CLASSROOM',
    title: '服务端模拟实验课堂',
    description: '理想模型计算，不是设备采集',
    opensAt: null,
    closesAt: null,
  });
  await send(classrooms, teacher, {
    type: 'PUBLISH_CLASSROOM',
    id: classroom.id,
    revision: classroom.revision,
  });
  const steps: FlowStep[] = simulationModels.map((m, i) => ({
    id: v7(),
    title: m.title + '模拟实验',
    kind: 'LAB',
    target: activities[i].id,
    version: '1',
    interactiveId: null,
    publicationId: null,
    requires: [],
    lab: {
      instructions: m.formula,
      parameters: structuredClone(m.parameters),
      measurements: structuredClone(m.measurements),
      conclusionPrompt: '解释参数、计算结果及理想模型限制',
      execution: { source: SIMULATION_SOURCE, model: m.id },
    },
  }));
  const savePlan = { type: 'SAVE_PLAN', classroomId: classroom.id, revision: '0', steps };
  for (const a of [student, outsider, foreign, manager])
    assert.equal((await http(flow, a, savePlan)).status, 403);
  await send(flow, teacher, savePlan);
  const state = () => read(flow + '?classroom=' + classroom.id);
  const tc = await browser.newContext(),
    sc = await browser.newContext();
  for (const [ctx, actor] of [
    [tc, teacher],
    [sc, student],
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
  const tp = await tc.newPage(),
    sp = await sc.newPage(),
    errors: string[] = [];
  for (const p of [tp, sp]) p.on('pageerror', (e) => errors.push(e.message));
  const url = (role: string) =>
    `${origin}/zhiban/${role}/courses/${trial.courseId}/classroom-plan?space=${t}&offering=${o}`;
  try {
    await tp.goto(url('teacher') + '#classroom-' + classroom.id);
    await tp.getByRole('button', { name: '编辑环节', exact: true }).first().click();
    await tp.getByLabel('实验数据来源', { exact: true }).selectOption('RC_CHARGE_V1');
    await tp.getByLabel('实验数据来源', { exact: true }).selectOption('DC_OHM_V1');
    await tp.getByRole('button', { name: '加入或更新环节', exact: true }).click();
    await tp.getByRole('button', { name: '保存教案草稿', exact: true }).click();
    await expect(tp.getByText('教案草稿已保存，尚未发布。', { exact: true })).toBeVisible();
    await tp.getByRole('button', { name: '发布教案固定版本', exact: true }).click();
    await tp.getByRole('button', { name: '按教案开始课堂', exact: true }).click();
    await expect(tp.getByRole('button', { name: '派发下一环节', exact: true })).toBeVisible();
    let v = await state();
    const opened = await send(flow, student, {
      type: 'OPEN_LAB',
      classroomId: classroom.id,
      dispatchId: v.dispatches[0].dispatch_id,
    });
    const notebook = () => read(flow + '?notebook=' + opened.id, student);
    let n = (await notebook()).notebook;
    const runCommand = (n: QueryResultRow, voltage = 12) => ({
      type: 'RUN_SIMULATION',
      id: opened.id,
      revision: n.revision,
      attemptRevision: n.attempt_revision,
      parameters: { voltage, resistance: 6 },
      conclusion: '理想线性电阻模型；不是物理仪器测量。',
    });
    for (const a of [teacher, outsider, foreign, manager])
      assert.equal((await http(flow, a, runCommand(n))).status, 403);
    assert.equal((await http(flow + '?notebook=' + opened.id, peer)).status, 404);
    assert.equal((await http(flow, peer, runCommand(n))).status, 404);
    assert.equal(
      (await http(flow, student, { ...runCommand(n), result: { current: 999 } })).status,
      400,
    );
    assert.equal(
      (await http(flow, student, { ...runCommand(n), parameters: { voltage: 12, resistance: 0 } }))
        .status,
      400,
    );
    await sp.goto(url('student') + '#notebook-' + opened.id);
    await sp.getByLabel('实验结论', { exact: true }).fill('理想线性电阻模型；不是物理仪器测量。');
    await sp.getByRole('button', { name: '运行模拟并保存结果', exact: true }).click();
    await expect(
      sp.getByText('模拟结果已由服务器计算并保存；请比较各次结果、填写结论后正式提交。', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(sp.getByLabel('第1行 电流', { exact: true })).toHaveValue('2');
    await expect(sp.getByLabel('第1行 电流', { exact: true })).toBeDisabled();
    await expect(sp.getByLabel('第1行 功率', { exact: true })).toHaveValue('24');
    await expect(sp.getByLabel('实验结论', { exact: true })).toHaveValue(
      '理想线性电阻模型；不是物理仪器测量。',
    );
    await sp.getByLabel('实验参数 电源电压', { exact: true }).fill('18');
    await sp.getByRole('button', { name: '运行模拟并保存结果', exact: true }).click();
    await expect(sp.getByLabel('第2行 电流', { exact: true })).toHaveValue('3');
    await sp.reload();
    await expect(sp.getByLabel('第2行 功率', { exact: true })).toHaveValue('54');
    await expect(sp.getByRole('img', { name: '已保存模拟结果对比', exact: true })).toBeVisible();
    let data = await notebook();
    n = data.notebook;
    assert.equal(data.source, SIMULATION_SOURCE);
    assert.equal(data.simulationRuns.length, 2);
    const source = createHash('sha256')
      .update(await readFile('lib/zhiban/domain/flow/simulation.ts'))
      .digest('hex');
    for (const r of data.simulationRuns) {
      const actual = executeSimulation(r.model_id, r.parameters, source);
      assert.deepEqual(r.result, actual.values);
      assert.equal(r.output_sha256, actual.outputSha256);
      assert.equal(r.executor_source_sha256, source);
    }
    const fake = {
      type: 'SUBMIT_LAB',
      id: n.id,
      revision: n.revision,
      attemptRevision: n.attempt_revision,
      parameters: n.parameters,
      rows: [{ values: { current: 999, power: 1 }, note: '伪造' }],
      conclusion: '不能伪造来源',
    };
    assert.equal((await http(flow, student, fake)).status, 400);
    assert.equal(
      (
        await http(learning, student, {
          type: 'SUBMIT',
          id: n.attempt_id,
          revision: n.attempt_revision,
          answer: '绕过实验结构',
        })
      ).status,
      409,
    );
    const key = v7(),
      command = runCommand(n, 24),
      one = await send(flow, student, command, key);
    assert.deepEqual(await send(flow, student, command, key), one);
    data = await notebook();
    n = data.notebook;
    assert.equal(data.simulationRuns.length, 3);
    const contenders = await Promise.all([
      http(flow, student, runCommand(n, 12)),
      http(flow, student, runCommand(n, 18)),
    ]);
    assert.deepEqual(contenders.map((r) => r.status).sort(), [200, 409]);
    data = await notebook();
    n = data.notebook;
    assert.equal(data.simulationRuns.length, 4);
    const beforeFailure = flowDigest(data.notebook),
      count = data.simulationRuns.length;
    await admin.query(
      "CREATE FUNCTION zhiban_flow.fail_simulation_test() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='RUN_SIMULATION' THEN RAISE EXCEPTION 'test late audit failure'; END IF; RETURN NEW; END$$; CREATE TRIGGER fail_simulation_test BEFORE INSERT ON zhiban_flow.events FOR EACH ROW EXECUTE FUNCTION zhiban_flow.fail_simulation_test()",
    );
    try {
      assert.equal((await http(flow, student, runCommand(n, 30))).status, 503);
    } finally {
      await admin.query(
        'DROP TRIGGER fail_simulation_test ON zhiban_flow.events; DROP FUNCTION zhiban_flow.fail_simulation_test()',
      );
    }
    data = await notebook();
    assert.equal(data.simulationRuns.length, count);
    assert.equal(flowDigest(data.notebook), beforeFailure);
    const pause = await send(flow, teacher, {
      type: 'PAUSE_FLOW',
      classroomId: classroom.id,
      revision: (await state()).run.revision,
      reason: '',
    });
    assert.equal((await http(flow, student, runCommand(n, 30))).status, 409);
    await sp.reload();
    await expect(
      sp.getByRole('button', { name: '运行模拟并保存结果', exact: true }),
    ).toBeDisabled();
    await send(flow, teacher, {
      type: 'RESUME_FLOW',
      classroomId: classroom.id,
      revision: pause.revision,
      reason: '',
    });
    await sp.reload();
    await sp
      .getByLabel('实验结论', { exact: true })
      .fill('电阻不变时，模拟电流随电压增加。模型不含温升与仪表误差，不能替代真实测量。');
    sp.once('dialog', (d) => void d.accept());
    await sp.getByRole('button', { name: '正式提交实验报告', exact: true }).click();
    await expect(sp.getByText('实验报告已正式提交，等待教师评分。', { exact: true })).toBeVisible();
    data = await notebook();
    n = data.notebook;
    const originalReport = data.reports[0];
    assert.equal(originalReport.simulationRunIds.length, 4);
    assert.equal(
      Number(
        (
          await admin.query(
            'SELECT count(*) AS n FROM zhiban_flow.simulation_report_runs WHERE tenant_id=$1 AND submission_id=$2',
            [t, n.submission_id],
          )
        ).rows[0].n,
      ),
      4,
    );
    const grade = await send(assessment, teacher, {
      type: 'SAVE_GRADE',
      submissionId: n.submission_id,
      revision: null,
      score: '90',
      maxScore: '100',
      feedback: '模拟来源清晰，结论解释了模型限制。',
    });
    await send(assessment, teacher, {
      type: 'PUBLISH_GRADE',
      submissionId: n.submission_id,
      revision: grade.revision,
    });
    await sp.reload();
    await expect(sp.getByText(/成绩 90.00\/100.00/)).toBeVisible();
    await tp.goto(url('teacher') + '#notebook-' + opened.id);
    await expect(tp.getByLabel('第1行 电流', { exact: true })).toBeDisabled();
    await tp.getByText('模拟来源与每次输入', { exact: true }).click();
    await expect(tp.getByText(/输入：/).first()).toBeVisible();
    await sp.screenshot({ path: dir + '/student.png', fullPage: true });
    await tp.screenshot({ path: dir + '/teacher.png', fullPage: true });
    n = (await notebook()).notebook;
    await send(flow, student, runCommand(n, 36));
    data = await notebook();
    assert.equal(data.reports[0].source_digest, originalReport.source_digest);
    assert.equal(data.reports[0].simulationRunIds.length, 4);
    assert.equal(data.simulationRuns.length, 5);
    // The next model reuses the same report and formal grading workflow, not a separate engine.
    v = await state();
    await send(flow, teacher, {
      type: 'NEXT_STEP',
      classroomId: classroom.id,
      revision: v.run.revision,
      reason: '',
    });
    v = await state();
    const rc = await send(flow, student, {
      type: 'OPEN_LAB',
      classroomId: classroom.id,
      dispatchId: v.dispatches[1].dispatch_id,
    });
    const rn = (await read(flow + '?notebook=' + rc.id, student)).notebook;
    await send(flow, student, {
      type: 'RUN_SIMULATION',
      id: rc.id,
      revision: rn.revision,
      attemptRevision: rn.attempt_revision,
      parameters: { voltage: 12, resistance: 1000, capacitance: 1000, time: Math.log(2) },
      conclusion: '一个时间常数以内已充至一半电压。',
    });
    const result = await read(flow + '?notebook=' + rc.id, student);
    assert.equal(result.simulationRuns[0].result.capacitor_voltage, 6);
    assert.equal(
      (await http(flow, student, runCommand((await notebook()).notebook, 48))).status,
      409,
    );
    assert.equal(await loadFlow(businessPool), true);
    await admin.query(
      'GRANT UPDATE(result) ON zhiban_flow.simulation_runs TO zhiban_academic_runtime',
    );
    try {
      await assert.rejects(() => loadFlow(businessPool), /catalog\/ACL/);
    } finally {
      await admin.query(
        'REVOKE UPDATE(result) ON zhiban_flow.simulation_runs FROM zhiban_academic_runtime',
      );
    }
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE zhiban_academic_runtime');
      await assert.rejects(
        () =>
          client.query("UPDATE zhiban_flow.simulation_runs SET result='{}' WHERE tenant_id=$1", [
            t,
          ]),
        (e: unknown) => (e as { code: string }).code === '42501',
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    assert.deepEqual(errors, []);
    const proof = {
      evidenceOrigin: 'LOCAL',
      githubActions: false,
      status: 'PASS',
      scope: 'FIXED_SERVER_CALCULATED_DC_RC_MODELS_ORIGINAL_REPORT_AND_TEACHER_GRADING',
      checks: [
        'teacher model selection / immutable publish',
        'real DC and RC textbook results / actual executor source hash',
        'student run / refresh / immutable outputs / conclusion retained',
        'replay and concurrent CAS / late audit rollback',
        'wrong member / tenant / role / forged output / raw submission refused',
        'pause and step-switch refuse new execution',
        'fixed report references preserve older inputs/results after later runs',
        'teacher evidence read and original grade publish / learner result',
        'append-only grants and exact expected profile drift rejection',
      ],
      classroomId: classroom.id,
      notebookId: opened.id,
      rcNotebookId: rc.id,
      physicalMeasurements: false,
      nativeMaintenanceExecuted: false,
      automaticGradePublished: false,
    };
    await writeFile(dir + '/journey.json', JSON.stringify(proof, null, 2) + '\n');
    record(
      'SIMULATION: fixed server DC/RC calculation provenance, original lab submission and teacher result; authorization/CAS/replay/rollback/immutable history barriers',
    );
  } finally {
    await tc.close();
    await sc.close();
  }
}
