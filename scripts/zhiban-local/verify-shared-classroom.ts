/** Directed PG16 checks for the new coordination slice, not a repeat of the full CI suite. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import { Pool } from 'pg';
import { lecturePng } from './verify-trial-content';
import { loadClassroom } from './classroom';
import type { prepareTrial } from './prepare-trial';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
};
export async function verifySharedClassroom(input: Input) {
  const { actors, http, tenant, trial, admin, browser, origin, record } = input;
  const [teacher, student, outsider, foreign, manager] = actors;
  const base = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}`;
  const url = base + '/classrooms',
    outline = base + '/outline',
    content = `/api/zhiban/content/${tenant}/offerings/${trial.offeringId}`;
  const send = async (command: unknown, a = teacher, key = randomUUID()) => {
    const r = await http(url, a, command, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as any;
  };
  const read = async (a = teacher) => {
    const r = await http(url, a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as any;
  };
  assert.equal((await http(url)).status, 401);
  for (const a of [outsider, foreign, manager]) assert.equal((await http(url, a)).status, 403);
  assert.equal(
    (await http(url, teacher, {}, 'POST', { 'x-zhiban-csrf': 'A'.repeat(43) })).status,
    403,
  );
  assert.equal(
    (
      await http(url, teacher, {
        type: 'CREATE_CLASSROOM',
        title: 'invalid',
        description: '',
        opensAt: 2,
        closesAt: 1,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await http(url, student, {
        type: 'CREATE_CLASSROOM',
        title: 'forbidden',
        description: '',
        opensAt: null,
        closesAt: null,
      })
    ).status,
    403,
  );
  record(
    'classroom HTTP rejects unauthenticated, wrong role, foreign tenant, bad CSRF and invalid time window',
  );
  const business = new Pool({
    host: admin.options.host,
    port: admin.options.port,
    database: admin.options.database,
    user: 'zhiban_academic_runtime',
  });
  try {
    assert.equal(await loadClassroom(business), true);
    assert.equal(
      (await business.query('SELECT count(*)::int AS n FROM zhiban_classroom.sessions')).rows[0].n,
      0,
    );
  } finally {
    await business.end();
  }
  // Real author UI prepares a text/PNG lecture, using the existing content authority.
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
    sp = await sc.newPage();
  const errors: string[] = [];
  for (const p of [tp, sp]) p.on('pageerror', (e) => errors.push(e.message));
  const course = (
    await admin.query(
      'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
      [tenant, trial.offeringId],
    )
  ).rows[0].course_id;
  const courseUrl = (role: string, section: string) =>
    `${origin}/zhiban/${role}/courses/${course}/${section}?space=${tenant}&offering=${trial.offeringId}`;
  try {
    await tp.goto(courseUrl('teacher', 'resources'));
    await tp.getByLabel('新内容标题', { exact: true }).fill('共享课堂：安全讲义');
    await tp.getByRole('button', { name: '新建内容', exact: true }).click();
    await expect(tp.getByRole('heading', { name: '内容草稿', exact: true })).toBeVisible();
    await tp.getByRole('button', { name: '添加文本框', exact: true }).click();
    await tp.getByLabel('正文 1', { exact: true }).fill('先断电检查，再确认防护装置。');
    await tp.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(tp.getByRole('button', { name: '发布保存版本', exact: true })).toBeEnabled();
    await tp
      .getByLabel('PNG 文件', { exact: true })
      .setInputFiles({ name: 'classroom.png', mimeType: 'image/png', buffer: lecturePng() });
    await tp.getByRole('button', { name: '上传 PNG', exact: true }).click();
    await expect(tp.getByRole('alert')).toContainText('PNG 已登记');
    await tp.getByRole('button', { name: '添加 PNG 到本页', exact: true }).click();
    await tp.getByRole('button', { name: '保存草稿', exact: true }).click();
    await expect(tp.getByRole('button', { name: '发布保存版本', exact: true })).toBeEnabled();
    await tp.getByRole('button', { name: '发布保存版本', exact: true }).click();
    await expect(tp.getByRole('button', { name: '撤回发布', exact: true })).toBeVisible();
    const lecture = ((await http(content, teacher)).json as any).resources.find(
      (r: any) => r.title === '共享课堂：安全讲义',
    );
    assert.ok(lecture);
    const activity = ((await http(base, teacher)).json as any).activities.find(
      (a: any) => a.status === 'PUBLISHED' && a.title.includes('安全巡检'),
    );
    const chapters = [
      {
        id: randomUUID(),
        title: '共享课堂演示',
        units: [
          { id: randomUUID(), kind: 'LECTURE', target: lecture.id, title: lecture.title },
          { id: randomUUID(), kind: 'ACTIVITY', target: activity.id, title: activity.title },
        ],
      },
    ];
    const o = (await http(outline, teacher)).json as any;
    assert.equal(
      (await http(outline, teacher, { type: 'SAVE_OUTLINE', revision: o.revision, chapters }))
        .status,
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
    const create = {
      type: 'CREATE_CLASSROOM',
      title: '故障验证课堂',
      description: '定向负向用例',
      opensAt: null,
      closesAt: null,
    };
    const key = randomUUID(),
      s = await send(create, teacher, key);
    assert.deepEqual(await send(create, teacher, key), s);
    assert.equal(
      (
        await http(url, teacher, { ...create, title: 'different' }, 'POST', {
          'x-zhiban-command': key,
        })
      ).status,
      409,
    );
    assert.equal((await read(student)).sessions.length, 0);
    const pub = await send({ type: 'PUBLISH_CLASSROOM', ...s });
    const lectureTarget = { kind: 'LECTURE', target: lecture.id, version: '1' };
    const dispatch = await send({
      type: 'DISPATCH_TASK',
      id: s.id,
      revision: pub.revision,
      ...lectureTarget,
    });
    assert.equal(
      (
        await http(url, teacher, {
          type: 'DISPATCH_TASK',
          id: s.id,
          revision: dispatch.revision,
          kind: 'ACTIVITY',
          target: v7(),
          version: '1',
        })
      ).status,
      409,
    );
    const enter = {
      type: 'ENTER_TASK',
      id: s.id,
      revision: dispatch.revision,
      dispatchId: dispatch.dispatchId,
    };
    const enterKey = randomUUID();
    await send(enter, student, enterKey);
    await send(enter, student, enterKey);
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM zhiban_classroom.entries WHERE tenant_id=$1 AND dispatch_id=$2',
          [tenant, dispatch.dispatchId],
        )
      ).rows[0].n,
      1,
    );
    const ended = await send({ type: 'END_TASK', id: s.id, revision: dispatch.revision });
    assert.equal(
      (await http(url, student, enter, 'POST', { 'x-zhiban-command': enterKey })).status,
      409,
    );
    assert.equal((await http(url, student, enter)).status, 409);
    const competing = await Promise.all([
      http(url, teacher, {
        type: 'DISPATCH_TASK',
        id: s.id,
        revision: ended.revision,
        ...lectureTarget,
      }),
      http(url, teacher, {
        type: 'DISPATCH_TASK',
        id: s.id,
        revision: ended.revision,
        ...lectureTarget,
      }),
    ]);
    assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
    const current = (await read()).sessions.find((x: any) => x.id === s.id),
      active = current.tasks.find((d: any) => d.state === 'ACTIVE');
    const race = await Promise.all([
      http(url, student, {
        type: 'ENTER_TASK',
        id: s.id,
        revision: current.revision,
        dispatchId: active.id,
      }),
      http(url, teacher, { type: 'END_CLASSROOM', id: s.id, revision: current.revision }),
    ]);
    assert.equal(race[1].status, 200);
    assert.ok([200, 409].includes(race[0].status));
    assert.equal(
      (
        await http(url, student, {
          type: 'ENTER_TASK',
          id: s.id,
          revision: current.revision,
          dispatchId: active.id,
        })
      ).status,
      409,
    );
    record(
      'classroom PG16: draft isolation, idempotency/digest conflict, duplicate entry, stale revision, concurrent dispatch and end/enter barrier pass',
    );
    // Future and expired windows are checked by server time.
    for (const window of [
      { opensAt: Date.now() + 3600000, closesAt: null },
      { opensAt: null, closesAt: Date.now() - 1 },
    ]) {
      const timed = await send({ ...create, ...window, title: '时间屏障' });
      const r = await http(url, teacher, { type: 'PUBLISH_CLASSROOM', ...timed });
      assert.equal(r.status, window.closesAt === null ? 200 : 409);
      assert.ok(!(await read(student)).sessions.some((x: any) => x.id === timed.id));
    }
    // Membership changes affect the next actual request; fixture rollback retains owned seed data.
    const enrollment = (
      await admin.query(
        "SELECT id FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE'",
        [tenant, trial.offeringId, student.member],
      )
    ).rows[0];
    await admin.query(
      "UPDATE zhiban_academic.enrollments SET status='WITHDRAWN',valid_until=$3 WHERE tenant_id=$1 AND id=$2",
      [tenant, enrollment.id, Date.now()],
    );
    try {
      assert.equal((await http(url, student)).status, 403);
    } finally {
      await admin.query(
        "UPDATE zhiban_academic.enrollments SET status='ACTIVE',valid_until=NULL WHERE tenant_id=$1 AND id=$2",
        [tenant, enrollment.id],
      );
    }
    const assignment = (
      await admin.query(
        'SELECT id FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
        [tenant, trial.offeringId, teacher.member],
      )
    ).rows[0];
    await admin.query(
      "UPDATE zhiban_academic.assignments SET status='ENDED',valid_until=$3 WHERE tenant_id=$1 AND id=$2",
      [tenant, assignment.id, Date.now()],
    );
    try {
      assert.equal((await http(url, teacher)).status, 403);
    } finally {
      await admin.query(
        "UPDATE zhiban_academic.assignments SET status='ACTIVE',valid_until=NULL WHERE tenant_id=$1 AND id=$2",
        [tenant, assignment.id],
      );
    }
    record(
      'classroom: future/expired windows, withdrawn Enrollment, ended teacher assignment and tenant RLS fail closed',
    );
    // Real teacher/student page journey; leave usable lecture and activity classrooms for manual UAT.
    await tp.goto(courseUrl('teacher', 'classrooms'));
    await tp.getByLabel('新课堂标题', { exact: true }).fill('课堂演示：讲义');
    await tp.getByLabel('课堂说明', { exact: true }).fill('文本与 PNG 共享讲义');
    await tp.getByRole('button', { name: '创建课堂草稿', exact: true }).click();
    const lectureCard = tp
      .locator('[data-classroom]')
      .filter({ has: tp.getByRole('heading', { name: '课堂演示：讲义', exact: true }) });
    await expect(lectureCard).toBeVisible();
    await lectureCard.getByRole('button', { name: '发布课堂', exact: true }).click();
    await expect(lectureCard.getByLabel('课堂 课堂演示：讲义 派发目标')).toBeVisible();
    await lectureCard
      .getByLabel('课堂 课堂演示：讲义 派发目标')
      .selectOption({ label: `讲义 · ${lecture.title} · v1` });
    await lectureCard.getByRole('button', { name: '派发所选任务', exact: true }).click();
    await expect(
      lectureCard.getByRole('heading', {
        name: `讲义 · ${lecture.title} · v1 · 当前任务`,
        exact: true,
      }),
    ).toBeVisible();
    await sp.goto(courseUrl('student', 'coursework'));
    const lc = sp
      .locator('[data-classroom]')
      .filter({ has: sp.getByRole('heading', { name: '课堂演示：讲义', exact: true }) });
    await lc.getByRole('button', { name: '进入课堂任务', exact: true }).click();
    await expect(sp.getByRole('heading', { name: '已发布预览', exact: true })).toBeVisible();
    await expect(sp.locator('.content-preview img')).toBeVisible();
    await expect(sp.getByRole('link', { name: '返回本次课堂', exact: true })).toBeVisible();
    await sp.getByRole('link', { name: '返回本次课堂', exact: true }).click();
    await expect(sp.getByRole('heading', { name: '课堂演示：讲义', exact: true })).toBeVisible();
    await tp.getByLabel('新课堂标题', { exact: true }).fill('课堂演示：作答');
    await tp.getByRole('button', { name: '创建课堂草稿', exact: true }).click();
    const ac = tp
      .locator('[data-classroom]')
      .filter({ has: tp.getByRole('heading', { name: '课堂演示：作答', exact: true }) });
    await ac.getByRole('button', { name: '发布课堂', exact: true }).click();
    await expect(ac.getByLabel('课堂 课堂演示：作答 派发目标')).toBeVisible();
    await ac
      .getByLabel('课堂 课堂演示：作答 派发目标')
      .selectOption({ label: `活动 · ${activity.title} · v1` });
    await ac.getByRole('button', { name: '派发所选任务', exact: true }).click();
    await expect(
      ac.getByRole('heading', { name: `活动 · ${activity.title} · v1 · 当前任务`, exact: true }),
    ).toBeVisible();
    await sp.getByRole('button', { name: '刷新课堂任务', exact: true }).click();
    const sac = sp
      .locator('[data-classroom]')
      .filter({ has: sp.getByRole('heading', { name: '课堂演示：作答', exact: true }) });
    await sac.getByRole('button', { name: '进入课堂任务', exact: true }).click();
    await expect(
      sp.locator('.learning-activity').getByRole('heading', { name: activity.title, exact: true }),
    ).toBeVisible();
    record(
      'classroom browser: teacher creates/publishes/dispatches text+PNG and activity; student enters correct lecture and returns with course context',
    );
    // START was committed with entry in the same transaction; submit through the original service.
    await expect(sp).toHaveURL(/#classroom-activity-/);
    await expect(sp.getByRole('link', { name: '返回本次课堂', exact: true })).toBeVisible();
    await expect(sp.getByRole('textbox', { name: '搜索活动', exact: true })).toHaveValue(
      activity.id,
    );
    const attempt = (
      await admin.query(
        'SELECT id,revision::text,activity_version FROM zhiban_learning.attempts WHERE tenant_id=$1 AND activity_id=$2 AND membership_id=$3 ORDER BY attempt_no DESC LIMIT 1',
        [tenant, activity.id, student.member],
      )
    ).rows[0];
    assert.equal(attempt.activity_version, 1);
    const submit = await http(base, student, {
      type: 'SUBMIT',
      id: attempt.id,
      revision: attempt.revision,
      answer: '先断电检查，再确认防护装置；复核后报告教师。',
    });
    assert.equal(submit.status, 200, JSON.stringify(submit.json));
    await tp.getByRole('button', { name: '刷新课堂任务', exact: true }).click();
    await expect(ac).toContainText('已提交 1 份');
    await tp.screenshot({
      path: 'docs/v2/evidence/zhiban-shared-classroom-teacher-local.png',
      fullPage: true,
    });
    const activeClass = (await read()).sessions.find((x: any) => x.title === '课堂演示：作答');
    const continued = await send(
      {
        type: 'ENTER_TASK',
        id: activeClass.id,
        revision: activeClass.revision,
        dispatchId: activeClass.tasks[0].id,
      },
      student,
    );
    assert.equal(continued.attemptId, attempt.id);
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM zhiban_learning.attempts WHERE tenant_id=$1 AND activity_id=$2 AND membership_id=$3',
          [tenant, activity.id, student.member],
        )
      ).rows[0].n,
      1,
    );
    const second = await send({ ...create, title: '第二课堂尝试绑定' });
    const secondPub = await send({ type: 'PUBLISH_CLASSROOM', ...second });
    const secondTask = await send({
      type: 'DISPATCH_TASK',
      id: second.id,
      revision: secondPub.revision,
      kind: 'ACTIVITY',
      target: activity.id,
      version: '1',
    });
    await send(
      {
        type: 'ENTER_TASK',
        id: second.id,
        revision: secondTask.revision,
        dispatchId: secondTask.dispatchId,
      },
      student,
    );
    const secondFacts = (await read()).sessions.find((x: any) => x.id === second.id).tasks[0]
      .participants[0];
    assert.equal(secondFacts.submissions, 0); // Earlier classroom submission must not backfill this classroom.
    const exact = (
      (await http(base + '/attempts?activity=' + activity.id + '&id=' + attempt.id, student))
        .json as any
    ).rows;
    assert.equal(exact.length, 1);
    assert.equal(exact[0].id, attempt.id);
    const peerStart = await http(base, actors[5], {
      type: 'START_ATTEMPT',
      id: activity.id,
      expectedVersion: '1',
    });
    assert.equal(peerStart.status, 200);
    assert.equal(
      (
        (
          await http(
            base + '/attempts?activity=' + activity.id + '&id=' + (peerStart.json as any).id,
            student,
          )
        ).json as any
      ).rows.length,
      0,
    );
    record(
      'classroom: new-key continuation retains first Attempt without consuming limits; a second classroom excludes earlier submissions',
    );
    const oldRevision = (await read()).sessions.find(
      (x: any) => x.title === '课堂演示：作答',
    ).revision;
    await ac.getByRole('button', { name: '结束课堂', exact: true }).click();
    await expect(ac).toContainText('已结束');
    const closed = (await read()).sessions.find((x: any) => x.title === '课堂演示：作答');
    assert.equal(
      (
        await http(url, student, {
          type: 'ENTER_TASK',
          id: closed.id,
          revision: oldRevision,
          dispatchId: closed.tasks[0].id,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=$2',
          [tenant, attempt.id],
        )
      ).rows[0].n,
      1,
    );
    record(
      'classroom journey: exact-version Attempt entry, original submit, teacher sees submission, end blocks entry and preserves answer/history',
    );
    // Exact content and activity version preconditions reject a silent upgrade.
    assert.equal(
      (
        await http(
          `${content}/resources/${lecture.id}/preview?source=published`,
          student,
          undefined,
          'GET',
          { 'x-zhiban-publication-version': '2' },
        )
      ).status,
      409,
    );
    assert.equal(
      (await http(base, student, { type: 'START_ATTEMPT', id: activity.id, expectedVersion: '2' }))
        .status,
      409,
    );
    assert.equal(
      (
        await http(url, teacher, {
          type: 'DISPATCH_TASK',
          id: closed.id,
          revision: closed.revision,
          ...lectureTarget,
        })
      ).status,
      409,
    );
    assert.deepEqual(errors, []);
    record(
      'classroom version guards reject mismatched lecture preview/Attempt and ended dispatch; no browser script errors',
    );
  } finally {
    await tc.close();
    await sc.close();
  }
}
