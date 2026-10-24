/** LOCAL presentation metadata and affected browser flow; no Native Runtime completion or model call. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { Pool } from 'pg';
import { loadClassroom } from './classroom';
import type { prepareTrial } from './prepare-trial';
type Result = { id: string; revision: string; dispatchId: string; attemptId: string | null };
type Task = { id: string; page_count: number; current_page: number; presentation_revision: string };
type View = { sessions: { id: string; tasks: Task[] }[] };
type Resource = { id: string; revision: string };
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  resourceId: string;
};
export async function verifyPresentation(input: Input) {
  const { actors, http, tenant, trial, resourceId, admin, browser, origin, record } = input;
  const [teacher, student, outsider, , manager] = actors;
  const base = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}`;
  const classroom = base + '/classrooms',
    outline = base + '/outline',
    content = `/api/zhiban/content/${tenant}/offerings/${trial.offeringId}`;
  const send = async (body: unknown, a = teacher, key = randomUUID()) => {
    const r = await http(classroom, a, body, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Result;
  };
  const read = async (a = teacher) => {
    const r = await http(classroom, a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as View;
  };
  const o = (await http(outline, teacher)).json as { revision: string };
  const chapters = [
    {
      id: randomUUID(),
      title: 'P4 讲义同步',
      units: [{ id: randomUUID(), kind: 'LECTURE', target: resourceId, title: '定向讲义' }],
    },
  ];
  assert.equal(
    (await http(outline, teacher, { type: 'SAVE_OUTLINE', revision: o.revision, chapters })).status,
    200,
  );
  assert.equal(
    (
      await http(outline, teacher, {
        type: 'PUBLISH_OUTLINE',
        revision: String(BigInt(o.revision) + BigInt(1)),
      })
    ).status,
    200,
  );
  let s = await send({
    type: 'CREATE_CLASSROOM',
    title: 'P4 同步课堂',
    description: '只同步讲义页码，不计完成与成绩',
    opensAt: null,
    closesAt: null,
  });
  s = await send({ type: 'PUBLISH_CLASSROOM', ...s });
  let dispatched = await send({
    type: 'DISPATCH_TASK',
    id: s.id,
    revision: s.revision,
    kind: 'LECTURE',
    target: resourceId,
    version: '1',
  });
  let task = (await read()).sessions
    .find((x) => x.id === s.id)!
    .tasks.find((x) => x.id === dispatched.dispatchId)!;
  assert.equal(task.page_count, 2);
  assert.equal(task.current_page, 1);
  const command = (page: number) => ({
    type: 'PRESENT_LECTURE_PAGE',
    id: s.id,
    revision: dispatched.revision,
    dispatchId: task.id,
    presentationRevision: task.presentation_revision,
    page,
  });
  const move = async (page: number) => {
    const result = await send(command(page));
    task = (await read()).sessions.find((x) => x.id === s.id)!.tasks.find((x) => x.id === task.id)!;
    return result;
  };
  for (const a of [student, outsider, manager])
    assert.equal((await http(classroom, a, command(2))).status, 403);
  assert.equal((await http(classroom, teacher, { ...command(2), page: 3 })).status, 400);
  const firstKey = randomUUID(),
    first = command(2),
    moved = await send(first, teacher, firstKey);
  assert.deepEqual(await send(first, teacher, firstKey), moved);
  assert.equal((await http(classroom, teacher, first)).status, 409);
  task = (await read()).sessions.find((x) => x.id === s.id)!.tasks.find((x) => x.id === task.id)!;
  assert.equal(task.current_page, 2);
  record(
    'P4: exact published page count, teacher-only presentation, idempotent retry and independent page revision CAS',
  );
  const connection = new Pool({
    host: admin.options.host,
    port: admin.options.port,
    database: admin.options.database,
    user: 'zhiban_academic_runtime',
  });
  try {
    assert.equal(await loadClassroom(connection), true);
    await admin.query(
      'GRANT UPDATE(target_id) ON zhiban_classroom.dispatches TO zhiban_academic_runtime',
    );
    await assert.rejects(() => loadClassroom(connection), /ACL/);
  } finally {
    await admin.query(
      'REVOKE UPDATE(target_id) ON zhiban_classroom.dispatches FROM zhiban_academic_runtime',
    );
    await connection.end();
  }
  await assert.rejects(
    () =>
      admin.query(
        'UPDATE zhiban_classroom.dispatches SET current_page=33 WHERE tenant_id=$1 AND id=$2',
        [tenant, task.id],
      ),
    (e: unknown) => (e as { code?: string }).code === '23514',
  );
  const entered = await send(
    { type: 'ENTER_TASK', id: s.id, revision: dispatched.revision, dispatchId: task.id },
    student,
  );
  assert.equal(entered.attemptId, null);
  const course = (
    await admin.query(
      'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
      [tenant, trial.offeringId],
    )
  ).rows[0].course_id;
  const ctx = await browser.newContext();
  await ctx.addCookies([
    {
      name: student.cookie!.split('=')[0],
      value: student.cookie!.split('=').slice(1).join('='),
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const url = `${origin}/zhiban/student/courses/${course}/resources?space=${tenant}&offering=${trial.offeringId}#classroom-resource-${resourceId}-1-${s.id}`;
  try {
    await page.goto(url);
    await expect(page.getByText('已跟随教师：第 2 页', { exact: true })).toBeVisible();
    await expect(page.getByText('第二页同步讲义', { exact: false }).last()).toBeVisible();
    await page.getByRole('button', { name: '第 1 页', exact: true }).click();
    await move(2);
    await expect(page.getByText('自主浏览；教师当前第 2 页', { exact: true })).toBeVisible();
    await expect(
      page.getByText('电压、电流与电阻：U = I × R。', { exact: false }).last(),
    ).toBeVisible();
    await page.getByRole('button', { name: '跟随教师翻页', exact: true }).click();
    await expect(page.getByText('已跟随教师：第 2 页', { exact: true })).toBeVisible();
    await ctx.setOffline(true);
    await move(1);
    await ctx.setOffline(false);
    await expect(page.getByText('已跟随教师：第 1 页', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await page.reload();
    await expect(page.getByText('已跟随教师：第 1 页', { exact: true })).toBeVisible();
    await page.screenshot({
      path: 'docs/v2/evidence/lesson-product/student-follow.png',
      fullPage: true,
    });
    const enrollment = (
      await admin.query(
        "UPDATE zhiban_academic.enrollments SET status='WITHDRAWN',valid_until=(extract(epoch FROM clock_timestamp())*1000)::bigint,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 RETURNING id",
        [tenant, trial.offeringId, student.member],
      )
    ).rows[0];
    try {
      await expect(
        page.getByText('课堂授权或发布状态已变化，请返回课堂重新检查。', { exact: true }),
      ).toBeVisible({ timeout: 15000 });
      await expect(page.getByRole('heading', { name: '已发布预览', exact: true })).toHaveCount(0);
    } finally {
      await admin.query(
        "UPDATE zhiban_academic.enrollments SET status='ACTIVE',valid_until=NULL,revision=revision+1 WHERE tenant_id=$1 AND id=$2",
        [tenant, enrollment.id],
      );
    }
    assert.deepEqual(errors, []);
  } finally {
    await ctx.setOffline(false);
    await ctx.close();
  }
  record(
    'P4 browser: pinned publication follow/manual mode, offline and refresh recovery; Enrollment revocation clears the viewer',
  );
  const before = task.presentation_revision;
  const concurrent = await Promise.all([
    http(classroom, teacher, { ...command(1), presentationRevision: before }),
    http(classroom, teacher, { ...command(2), presentationRevision: before }),
  ]);
  assert.deepEqual(concurrent.map((x) => x.status).sort(), [200, 409]);
  task = (await read()).sessions.find((x) => x.id === s.id)!.tasks.find((x) => x.id === task.id)!;
  const endedAssignment = (
    await admin.query(
      "UPDATE zhiban_academic.assignments SET status='ENDED',valid_until=(extract(epoch FROM clock_timestamp())*1000)::bigint,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 RETURNING id",
      [tenant, trial.offeringId, teacher.member],
    )
  ).rows[0];
  try {
    assert.equal((await http(classroom, teacher, command(1))).status, 403);
  } finally {
    await admin.query(
      "UPDATE zhiban_academic.assignments SET status='ACTIVE',valid_until=NULL,revision=revision+1 WHERE tenant_id=$1 AND id=$2",
      [tenant, endedAssignment.id],
    );
  }
  let resource = ((await http(content, teacher)).json as { resources: Resource[] }).resources.find(
    (x) => x.id === resourceId,
  );
  assert.equal(
    (
      await http(content, teacher, {
        type: 'WITHDRAW_CONTENT',
        id: resourceId,
        revision: resource!.revision,
      })
    ).status,
    200,
  );
  assert.equal((await http(classroom, teacher, command(1))).status, 409);
  resource = ((await http(content, teacher)).json as { resources: Resource[] }).resources.find(
    (x) => x.id === resourceId,
  );
  assert.equal(
    (
      await http(content, teacher, {
        type: 'PUBLISH_CONTENT',
        id: resourceId,
        revision: resource!.revision,
      })
    ).status,
    200,
  );
  // The old dispatch never silently follows a newly published version.
  assert.equal((await http(classroom, teacher, command(1))).status, 409);
  dispatched = await send({
    type: 'DISPATCH_TASK',
    id: s.id,
    revision: dispatched.revision,
    kind: 'LECTURE',
    target: resourceId,
    version: '2',
  });
  task = (await read()).sessions
    .find((x) => x.id === s.id)!
    .tasks.find((x) => x.id === dispatched.dispatchId)!;
  const lastKey = randomUUID(),
    last = command(2);
  await send(last, teacher, lastKey);
  await send({ type: 'END_TASK', id: s.id, revision: dispatched.revision });
  assert.equal(
    (await http(classroom, teacher, last, 'POST', { 'x-zhiban-command': lastKey })).status,
    409,
  );
  const lectureAttempts = (
    await admin.query(
      'SELECT count(*)::int AS n FROM zhiban_learning.attempts WHERE tenant_id=$1 AND activity_id=$2',
      [tenant, resourceId],
    )
  ).rows[0].n;
  assert.equal(lectureAttempts, 0);
  record(
    'P4: concurrent positions serialize; revoked teacher, withdrawn/replaced publication and ended dispatch reject; no Attempt or completion facts created',
  );
  await writeFile(
    'docs/v2/evidence/lesson-product/presentation-journey.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        scope: 'CLASSROOM_LECTURE_PRESENTATION_NOT_NATIVE_RUNTIME',
        modelCalls: false,
        completionEvidence: false,
        checks: 4,
      },
      null,
      2,
    ) + '\n',
  );
}
