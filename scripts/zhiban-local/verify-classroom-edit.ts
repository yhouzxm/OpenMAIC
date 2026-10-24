/** LOCAL edit/window slice. Existing classroom/Content journeys retain their earlier evidence. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { Pool } from 'pg';
import { loadClassroom } from './classroom';
import type { prepareTrial } from './prepare-trial';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
};
export async function verifyClassroomEdit(input: Input) {
  const { admin, browser, actors, http, tenant, origin, record, trial } = input;
  const [teacher, student, outsider, foreign, manager] = actors;
  const learning = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}`,
    base = learning + '/classrooms';
  const read = async (a = teacher) => {
    const r = await http(base, a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as any;
  };
  const send = async (c: unknown, a = teacher, key = randomUUID()) => {
    const r = await http(base, a, c, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as any;
  };
  const create = {
    type: 'CREATE_CLASSROOM',
    title: '编辑验证草稿',
    description: '原说明',
    opensAt: null,
    closesAt: null,
  };
  const draft = await send(create);
  const edit = {
    type: 'EDIT_CLASSROOM',
    ...draft,
    title: '修订后的课堂',
    description: '修改说明',
    opensAt: Date.now() + 3600000,
    closesAt: Date.now() + 7200000,
  };
  const key = randomUUID(),
    saved = await send(edit, teacher, key);
  assert.deepEqual(await send(edit, teacher, key), saved);
  assert.equal(
    (
      await http(base, teacher, { ...edit, title: '异 payload' }, 'POST', {
        'x-zhiban-command': key,
      })
    ).status,
    409,
  );
  assert.equal((await http(base, teacher, edit)).status, 409);
  assert.equal((await read(student)).sessions.length, 0);
  for (const a of [student, outsider, foreign, manager])
    assert.equal((await http(base, a, { ...edit, revision: saved.revision })).status, 403);
  assert.equal((await http(base, undefined, edit)).status, 401);
  assert.equal(
    (await http(base, teacher, { ...edit, revision: saved.revision, closesAt: edit.opensAt }))
      .status,
    400,
  );
  const concurrent = await Promise.all([
    http(base, teacher, { ...edit, revision: saved.revision, title: '并发草稿 A' }),
    http(base, teacher, { type: 'PUBLISH_CLASSROOM', id: draft.id, revision: saved.revision }),
  ]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
  let row = (await read()).sessions.find((s: any) => s.id === draft.id);
  if (row.state === 'DRAFT')
    await send({ type: 'PUBLISH_CLASSROOM', id: row.id, revision: row.revision });
  row = (await read()).sessions.find((s: any) => s.id === draft.id);
  assert.equal((await http(base, teacher, { ...edit, revision: row.revision })).status, 409);
  const schedule = {
    type: 'RESCHEDULE_CLASSROOM',
    id: row.id,
    revision: row.revision,
    opensAt: null,
    closesAt: null,
  };
  let open = await send(schedule);
  assert.equal((await read(student)).sessions.length, 1);
  assert.equal(
    (await http(base, teacher, { ...schedule, revision: open.revision, title: '越权改已发布标题' }))
      .status,
    400,
  );
  for (const a of [student, outsider, foreign, manager])
    assert.equal((await http(base, a, { ...schedule, revision: open.revision })).status, 403);
  record(
    'classroom edit: teacher-only draft metadata, draft isolation, strict fields/time range, durable replay, stale revision and edit/publish contention pass',
  );
  // Dispatch an existing published activity; only the coordinator window changes.
  const activity = ((await http(learning, teacher)).json as any).activities.find(
    (a: any) => a.status === 'PUBLISHED' && a.title.includes('安全巡检'),
  );
  const outline = (await http(learning + '/outline', teacher)).json as any;
  const chapters = [
    {
      id: randomUUID(),
      title: '窗口调整验证',
      units: [{ id: randomUUID(), title: activity.title, kind: 'ACTIVITY', target: activity.id }],
    },
  ];
  assert.equal(
    (
      await http(learning + '/outline', teacher, {
        type: 'SAVE_OUTLINE',
        revision: outline.revision,
        chapters,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await http(learning + '/outline', teacher, {
        type: 'PUBLISH_OUTLINE',
        revision: String(BigInt(outline.revision) + BigInt(1)),
      })
    ).status,
    200,
  );
  let task = await send({
    type: 'DISPATCH_TASK',
    id: row.id,
    revision: open.revision,
    kind: 'ACTIVITY',
    target: activity.id,
    version: '1',
  });
  const enter = {
    type: 'ENTER_TASK',
    id: row.id,
    revision: task.revision,
    dispatchId: task.dispatchId,
  };
  const entered = await send(enter, student);
  const delayed = await send({
    ...schedule,
    revision: task.revision,
    opensAt: Date.now() + 3600000,
  });
  assert.ok(!(await read(student)).sessions.some((s: any) => s.id === row.id));
  assert.equal((await http(base, student, { ...enter, revision: delayed.revision })).status, 409);
  const attempt = (
    await admin.query(
      'SELECT revision::text FROM zhiban_learning.attempts WHERE tenant_id=$1 AND id=$2',
      [tenant, entered.attemptId],
    )
  ).rows[0];
  assert.equal(
    (
      await http(learning, student, {
        type: 'SAVE_DRAFT',
        id: entered.attemptId,
        revision: attempt.revision,
        answer: '窗口调整不改变已有作答规则',
      })
    ).status,
    200,
  );
  const restored = await send({ ...schedule, revision: delayed.revision });
  assert.equal(
    (await send({ ...enter, revision: restored.revision }, student)).attemptId,
    entered.attemptId,
  );
  const closeKey = randomUUID(),
    closing = { ...schedule, revision: restored.revision, closesAt: Date.now() - 1 };
  const closedWindow = await send(closing, teacher, closeKey);
  assert.deepEqual(await send(closing, teacher, closeKey), closedWindow);
  assert.equal(
    (await http(base, student, { ...enter, revision: closedWindow.revision })).status,
    409,
  );
  const reopened = await send({ ...schedule, revision: closedWindow.revision });
  const race = await Promise.all([
    http(base, student, { ...enter, revision: reopened.revision }),
    http(base, teacher, { ...schedule, revision: reopened.revision, closesAt: Date.now() - 1 }),
  ]);
  assert.equal(race[1].status, 200);
  assert.ok([200, 409].includes(race[0].status));
  row = (await read()).sessions.find((s: any) => s.id === row.id);
  assert.equal((await http(base, student, { ...enter, revision: row.revision })).status, 409);
  const ended = await send({ type: 'END_CLASSROOM', id: row.id, revision: row.revision });
  assert.equal((await http(base, teacher, { ...schedule, revision: ended.revision })).status, 409);
  assert.equal((await http(base, teacher, { ...edit, revision: ended.revision })).status, 409);
  assert.equal(
    (
      await admin.query(
        'SELECT count(*)::int AS n FROM zhiban_learning.attempts WHERE tenant_id=$1 AND activity_id=$2 AND membership_id=$3',
        [tenant, activity.id, student.member],
      )
    ).rows[0].n,
    1,
  );
  const audits = (
    await admin.query(
      "SELECT facts FROM zhiban_academic.audit_events WHERE tenant_id=$1 AND event_type IN ('CLASSROOM_EDIT_CLASSROOM','CLASSROOM_RESCHEDULE_CLASSROOM')",
      [tenant],
    )
  ).rows;
  assert.ok(audits.length >= 5);
  for (const a of audits) {
    assert.ok(a.facts.result.beforeWindow && a.facts.result.afterWindow);
    assert.ok(!JSON.stringify(a.facts).includes(edit.description));
  }
  record(
    'classroom schedule: delayed/closed windows reject new enters; restoring unended window retains Attempt; existing draft survives; close/enter barrier and ENDED terminal hold; before/after audit excludes description',
  );
  const pool = new Pool({
    host: admin.options.host,
    port: admin.options.port,
    database: admin.options.database,
    user: 'zhiban_academic_runtime',
  });
  try {
    assert.equal(await loadClassroom(pool), true);
    await admin.query(
      'REVOKE UPDATE(opens_at) ON zhiban_classroom.sessions FROM zhiban_academic_runtime',
    );
    try {
      await assert.rejects(loadClassroom(pool), /column ACL mismatch/);
    } finally {
      await admin.query(
        'GRANT UPDATE(opens_at) ON zhiban_classroom.sessions TO zhiban_academic_runtime',
      );
    }
    await admin.query('GRANT DELETE ON zhiban_classroom.sessions TO zhiban_academic_runtime');
    try {
      await assert.rejects(loadClassroom(pool), /ACL\/RLS mismatch/);
    } finally {
      await admin.query('REVOKE DELETE ON zhiban_classroom.sessions FROM zhiban_academic_runtime');
    }
    assert.equal(await loadClassroom(pool), true);
    record(
      'classroom edit loader rejects missing update column and excess DELETE; exact ACL restored before serving',
    );
  } finally {
    await pool.end();
  }
  // Actual page editing, persisted title/description, cancellation and window visibility.
  const tc = await browser.newContext({ timezoneId: 'Asia/Shanghai' }),
    sc = await browser.newContext({ timezoneId: 'Asia/Shanghai' });
  for (const [context, a] of [
    [tc, teacher],
    [sc, student],
  ] as const)
    await context.addCookies([
      {
        name: a.cookie!.split('=')[0],
        value: a.cookie!.split('=').slice(1).join('='),
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
  try {
    const tp = await tc.newPage(),
      sp = await sc.newPage(),
      errors: string[] = [];
    tp.on('pageerror', (e) => errors.push(e.message));
    sp.on('pageerror', (e) => errors.push(e.message));
    const course = (
      await admin.query(
        'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
        [tenant, trial.offeringId],
      )
    ).rows[0].course_id;
    const path = (role: string) =>
      `${origin}/zhiban/${role}/courses/${course}/${role === 'teacher' ? 'classrooms' : 'coursework'}?space=${tenant}&offering=${trial.offeringId}`;
    const demo = await send({ ...create, title: '页面编辑演示' });
    await tp.goto(path('teacher'));
    const card = () => tp.locator(`[data-classroom="${demo.id}"]`);
    await card().getByRole('button', { name: '编辑课堂草稿', exact: true }).click();
    await card().getByLabel('编辑课堂标题', { exact: true }).fill('已编辑：课堂时间演示');
    await card().getByLabel('编辑课堂说明', { exact: true }).fill('真实页面保存的草稿说明');
    await card().getByRole('button', { name: '保存课堂草稿', exact: true }).click();
    await expect(
      card().getByRole('heading', { name: '已编辑：课堂时间演示', exact: true }),
    ).toBeVisible();
    await tp.reload();
    await expect(card()).toContainText('真实页面保存的草稿说明');
    await card().getByRole('button', { name: '编辑课堂草稿', exact: true }).click();
    await card().getByLabel('编辑课堂标题', { exact: true }).fill('冲突后保留的本地输入');
    await tp.getByRole('link', { name: '课程概览', exact: true }).click();
    await expect(tp.getByRole('dialog', { name: '未保存课堂修改', exact: true })).toBeVisible();
    await tp.getByRole('button', { name: '取消离开，继续编辑课堂', exact: true }).click();
    await expect(card().getByLabel('编辑课堂标题', { exact: true })).toHaveValue(
      '冲突后保留的本地输入',
    );
    const current = (await read()).sessions.find((s: any) => s.id === demo.id);
    await send({
      type: 'EDIT_CLASSROOM',
      id: demo.id,
      revision: current.revision,
      title: '另一编辑器已更新',
      description: '真实页面保存的草稿说明',
      opensAt: null,
      closesAt: null,
    });
    await card().getByRole('button', { name: '保存课堂草稿', exact: true }).click();
    await expect(tp.locator('.basic-classrooms [role="status"]')).toContainText('课堂已变化');
    await expect(card().getByLabel('编辑课堂标题', { exact: true })).toHaveValue(
      '冲突后保留的本地输入',
    );
    await card().getByRole('button', { name: '取消编辑并放弃修改', exact: true }).click();
    await expect(card().getByLabel('编辑课堂标题', { exact: true })).toHaveCount(0);
    await tp.getByRole('button', { name: '刷新课堂任务', exact: true }).click();
    await expect(
      card().getByRole('heading', { name: '另一编辑器已更新', exact: true }),
    ).toBeVisible();
    await card().getByRole('button', { name: '编辑课堂草稿', exact: true }).click();
    await card().getByLabel('编辑课堂标题', { exact: true }).fill('已编辑：课堂时间演示');
    await card().getByRole('button', { name: '保存课堂草稿', exact: true }).click();
    await expect(
      card().getByRole('heading', { name: '已编辑：课堂时间演示', exact: true }),
    ).toBeVisible();

    await card().getByRole('button', { name: '编辑课堂草稿', exact: true }).click();
    await card().getByLabel('编辑课堂标题', { exact: true }).fill('取消的修改');
    await card().getByRole('button', { name: '取消编辑并放弃修改', exact: true }).click();
    await expect(
      card().getByRole('heading', { name: '已编辑：课堂时间演示', exact: true }),
    ).toBeVisible();
    await card().getByRole('button', { name: '发布课堂', exact: true }).click();
    await card().getByRole('button', { name: '调整开放时间', exact: true }).click();
    await card()
      .getByLabel('编辑开放时间（北京时间，可选）', { exact: true })
      .fill('2099-01-01T09:00');
    await card().getByRole('button', { name: '保存开放时间', exact: true }).click();
    await expect(card()).toContainText('2099');
    await sp.goto(path('student'));
    await expect(sp.locator('.basic-classrooms [role="status"]')).toHaveText('已同步课堂任务。');
    await expect(sp.locator('[data-classroom]')).toHaveCount(0);
    await card().getByRole('button', { name: '调整开放时间', exact: true }).click();
    await card().getByLabel('编辑开放时间（北京时间，可选）', { exact: true }).fill('');
    await card().getByRole('button', { name: '保存开放时间', exact: true }).click();
    await expect(card().getByRole('button', { name: '调整开放时间', exact: true })).toBeVisible();
    await sp.getByRole('button', { name: '刷新课堂任务', exact: true }).click();
    await expect(
      sp.getByRole('heading', { name: '已编辑：课堂时间演示', exact: true }),
    ).toBeVisible();
    await tp.screenshot({
      path: 'docs/v2/evidence/zhiban-classroom-edit-teacher-local.png',
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    record(
      'classroom edit browser: teacher edits draft and reloads, cancel and conflict preserve input, navigation cancellation keeps form, Beijing-time schedule hides/shows student entry; no page errors',
    );
  } finally {
    await tc.close();
    await sc.close();
  }
}
