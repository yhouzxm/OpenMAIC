/** LOCAL disposable PG16 authorization/concurrency and native UI; no mocked model claims. */
/* eslint-disable @typescript-eslint/no-explicit-any -- malformed wire inputs are intentional */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { makeDocument, makeSlideScene } from '../../tests/agent-runtime/_stage-fixtures';
import { autonomousProject } from '../../tests/zhiban/classroom-ai/pbl-fixtures';
import type { verifyClassroomAi } from './verify-classroom-ai';
type Input = Parameters<typeof verifyClassroomAi>[0];
export async function verifyNativePbl(input: Input) {
  const { http, actors, tenant, trial, native, browser, origin, admin, record } = input;
  const [teacher, student, outsider, , manager] = actors;
  const author = `/api/zhiban/authoring/${tenant}/offerings/${trial.offeringId}`,
    content = `/api/zhiban/content/${tenant}/offerings/${trial.offeringId}`;
  const ok = async (
    path: string,
    payload?: unknown,
    actor = teacher,
    extra: Record<string, string> = {},
  ) => {
    const result = await http(
      path,
      actor,
      payload,
      payload ? (path.includes('/native/api/persistence/documents/') ? 'PUT' : 'POST') : 'GET',
      extra,
    );
    assert.ok(
      result.status >= 200 && result.status < 300,
      JSON.stringify({ path, response: result.json }),
    );
    return result.json as any;
  };
  const counts = async () =>
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_learning.attempts WHERE tenant_id=$1',
        [tenant],
      )
    ).rows[0].n;
  const before = await counts();
  const stage = (await ok(author + '/native/api/stages', { name: '自主PBL与情境演练' })).stage.id;
  const scenes = [false, true].map((scenario, i) => ({
    ...makeSlideScene('pbl-' + i, stage, i, scenario ? '维修沟通演练' : '教室节能方案'),
    type: 'pbl',
    content: { type: 'pbl', projectV2: autonomousProject(scenario) },
  }));
  await ok(
    author + '/native/api/persistence/documents/' + stage,
    makeDocument(stage, '原生自主PBL', scenes as any),
  );
  const preview = await ok(author + '/snapshot', { type: 'PREVIEW', stageId: stage });
  const adopted = await ok(author + '/snapshot', {
    type: 'ADOPT',
    stageId: stage,
    sourceDigest: preview.sourceDigest,
  });
  const row = (await ok(content)).resources.find((r: any) => r.id === adopted.id);
  await ok(content, { type: 'PUBLISH_CONTENT', id: row.id, revision: row.revision });
  const publication = (
    await ok(content + `/resources/${row.id}/preview?source=published`, undefined, student)
  ).publicationId;
  const base = `/api/zhiban/classroom-ai/${tenant}/offerings/${trial.offeringId}/resources/${row.id}/publications/${publication}`,
    api = base + '/native/api/pbl/v2';
  const boot = await ok(base, undefined, student);
  assert.equal(boot.pblEnabled, false);
  assert.equal(boot.hasPbl, true);
  await ok(base + '/policy', { enabled: true, revision: '0' });
  assert.equal((await http(api + '/state?scene=pbl-0', student)).status, 403);
  for (const actor of [student, outsider, manager])
    assert.equal(
      (await http(base + '/pbl-policy', actor, { enabled: true, revision: '0' })).status,
      403,
    );
  await ok(base + '/pbl-policy', { enabled: true, revision: '0' });
  assert.equal(
    (await http(base + '/pbl-policy', teacher, { enabled: false, revision: '0' })).status,
    409,
  );
  let state = await ok(api + '/state?scene=pbl-0', undefined, student);
  const write = async (project: any, revision = state.revision, actor = student) =>
    ok(api + '/state', { project }, actor, { 'x-zhiban-pbl-revision': revision });
  const forged = structuredClone(state.project);
  forged.title = 'INJECTION';
  forged.status = 'completed';
  forged.roles[0].name = 'FORGED';
  forged.evaluations = [{ id: 'fake', kind: 'final', score: 100 }];
  forged.pendingTaskCompletion = { microtaskId: 'task-1' };
  state = await write(forged);
  assert.equal(state.project.title, '教室节能方案');
  assert.equal(state.project.status, 'active');
  assert.equal(state.project.evaluations.length, 0);
  assert.equal(state.project.pendingTaskCompletion, undefined);
  assert.equal(
    (
      await http(api + '/state', student, { project: state.project }, 'POST', {
        'x-zhiban-pbl-revision': '0',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await http(
        api + '/task/update',
        student,
        { project: state.project, action: 'complete_pending_task' },
        'POST',
        { 'x-zhiban-pbl-revision': state.revision },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await http(api + '/evaluate', student, { project: state.project, kind: 'final' }, 'POST', {
        'x-zhiban-pbl-revision': state.revision,
      })
    ).status,
    409,
  );
  const text = structuredClone(state.project);
  text.uiPhase = 'workspace';
  text.threads[0].messages.push({
    id: 'learner-note',
    roleType: 'user',
    content: '我先整理观察依据。',
    microtaskId: 'task-1',
    ts: '',
  });
  text.submissions.push({
    id: 'local-work',
    microtaskId: 'task-1',
    kind: 'text',
    content: '10×20W×2h=400Wh=0.4kWh。题设估算；实际需核对开灯时长并记录用电表。',
    createdAt: '',
  });
  state = await write(text);
  assert.equal(state.project.submissions.length, 1);
  assert.equal((await ok(api + '/state?scene=pbl-0')).project.submissions.length, 0);
  assert.equal((await http(api + '/state?scene=pbl-0', outsider)).status, 403);
  const held = await native.connect(),
    lock = 'pbl-run:' + boot.owner + ':' + boot.stageId + ':pbl-0';
  try {
    await held.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [lock]);
    assert.equal(
      (
        await http(api + '/state', student, { project: state.project }, 'POST', {
          'x-zhiban-pbl-revision': state.revision,
        })
      ).status,
      409,
    );
  } finally {
    await held.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]);
    held.release();
  }
  const pblPolicy = await native.connect();
  try {
    await pblPolicy.query('BEGIN');
    await pblPolicy.query(
      'SELECT 1 FROM zhiban_published_pbl_policy WHERE tenant_id=$1 AND offering_id=$2 AND resource_id=$3 AND publication_id=$4 FOR SHARE',
      [tenant, trial.offeringId, row.id, publication],
    );
    let ended = false;
    const change = ok(base + '/pbl-policy', { enabled: false, revision: '1' }).then((v) => {
      ended = true;
      return v;
    });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(ended, false);
    await pblPolicy.query('COMMIT');
    await change;
  } finally {
    await pblPolicy.query('ROLLBACK');
    pblPolicy.release();
  }
  assert.equal((await http(api + '/state?scene=pbl-0', student)).status, 403);
  await ok(base + '/pbl-policy', { enabled: true, revision: '2' });
  assert.equal(
    (await ok(api + '/state?scene=pbl-0', undefined, student)).project.submissions.length,
    1,
  );
  const scenario = await ok(api + '/state?scene=pbl-1', undefined, student);
  const entered = await ok(
    api + '/task/update',
    { project: scenario.project, action: 'enter_scenario' },
    student,
    { 'x-zhiban-pbl-revision': scenario.revision },
  );
  assert.equal((entered.data ?? entered).project.milestones[1].status, 'active');
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: student.cookie!.split('=')[0],
      value: student.cookie!.split('=').slice(1).join('='),
      url: origin,
      secure: true,
      httpOnly: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await context.newPage();
  const url =
    origin +
    `/zhiban/native-classroom?tenant=${tenant}&offering=${trial.offeringId}&resource=${row.id}&publication=${publication}`;
  await page.goto(url);
  await expect(page.getByRole('status').filter({ hasText: '本人独立练习' })).toBeVisible({
    timeout: 30000,
  });
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  }
  await page.screenshot({ path: 'docs/v2/evidence/zhiban-native-pbl-local.png' });
  await page.reload();
  await expect(page.getByRole('status').filter({ hasText: '本人独立练习' })).toBeVisible({
    timeout: 30000,
  });
  await context.close();
  const manage = async (command: unknown) =>
    ok(`/api/zhiban/management/${tenant}/commands`, command, manager, {
      'x-zhiban-command': randomUUID(),
    });
  const enrollment = (
    await admin.query(
      'SELECT id,revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
      [tenant, trial.offeringId, student.member],
    )
  ).rows[0];
  await manage({ type: 'WITHDRAW', id: enrollment.id, revision: enrollment.revision });
  assert.equal((await http(api + '/state?scene=pbl-0', student)).status, 403);
  const withdrawn = (
    await admin.query('SELECT revision::text FROM zhiban_academic.enrollments WHERE id=$1', [
      enrollment.id,
    ])
  ).rows[0];
  await manage({
    type: 'ENROLL',
    offeringId: trial.offeringId,
    membershipId: student.member,
    revision: withdrawn.revision,
  });
  assert.equal(
    (await ok(api + '/state?scene=pbl-0', undefined, student)).project.submissions.length,
    1,
  );
  const assignment = (
    await admin.query(
      'SELECT id,revision::text FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
      [tenant, trial.offeringId, teacher.member],
    )
  ).rows[0];
  await manage({ type: 'END_TEACHER', id: assignment.id, revision: assignment.revision });
  assert.equal(
    (await http(base + '/pbl-policy', teacher, { enabled: false, revision: '3' })).status,
    403,
  );
  const ended = (
    await admin.query('SELECT revision::text FROM zhiban_academic.assignments WHERE id=$1', [
      assignment.id,
    ])
  ).rows[0];
  await manage({
    type: 'ASSIGN_TEACHER',
    offeringId: trial.offeringId,
    membershipId: teacher.member,
    revision: ended.revision,
  });
  const current = (await ok(content)).resources.find((r: any) => r.id === row.id);
  await ok(content, { type: 'WITHDRAW_CONTENT', id: row.id, revision: current.revision });
  assert.ok((await http(api + '/state?scene=pbl-0', student)).status >= 400);

  const invalid = await native.query(
    "SELECT 1 FROM information_schema.role_table_grants WHERE table_name LIKE 'zhiban_published_pbl_%' AND grantee='PUBLIC'",
  );
  assert.equal(invalid.rowCount, 0);
  await assert.rejects(native.query('DELETE FROM zhiban_published_pbl_events'));
  assert.equal(await counts(), before);
  record(
    '原生自主PBL：固定来源、独立开关、本人持久状态、忽略伪造评价、CAS/守锁/停用屏障、情境进入与三尺寸页面；未调用模型、不写正式成绩',
  );
}
