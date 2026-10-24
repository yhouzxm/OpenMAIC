/** LOCAL real HTTPS sessions, browser journey and owned PG16 failure/concurrency cuts. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { v7 } from 'uuid';
import { writeFile } from 'node:fs/promises';
import type { Pool } from 'pg';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
import { loadDiscussion } from './discussion';
// JSON views are checked at each assertion; client fields never authorize an actor.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type View = Record<string, any>;
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  runtime: Pool;
};
export async function verifyDiscussion(input: Input) {
  const { admin, runtime, actors, http, tenant, origin, browser, trial, record } = input;
  const [teacher, student, outsider, foreign, manager] = actors;
  const gradeCounts = async () =>
    (
      await admin.query(`SELECT
    (SELECT count(*)::text FROM zhiban_learning.attempts) AS attempts,
    (SELECT count(*)::text FROM zhiban_learning.submissions) AS submissions,
    (SELECT count(*)::text FROM zhiban_learning.events) AS events,
    (SELECT count(*)::text FROM zhiban_assessment.grades) AS grades`)
    ).rows[0];
  const originalGradeCounts = await gradeCounts();

  const base = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}/discussions`;
  const call = (command: unknown, actor = teacher, key = randomUUID(), path = base) =>
    http(path, actor, command, 'POST', { 'x-zhiban-command': key });
  const send = async (command: unknown, actor = teacher, key = randomUUID(), path = base) => {
    const r = await call(command, actor, key, path);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as View;
  };
  const read = async (path = '', actor = student) => {
    const r = await http(base + path, actor);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as View;
  };
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  let topicId = '',
    postId = '';
  const errors: string[] = [];
  try {
    for (const [context, actor] of [
      [contexts[0], teacher],
      [contexts[1], student],
    ] as const)
      await context.addCookies([
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
      sp = await contexts[1].newPage();
    for (const p of [tp, sp]) p.on('pageerror', (e) => errors.push(e.message));
    const route = (role: string, section = 'discussions') =>
      `${origin}/zhiban/${role}/courses/${trial.courseId}/${section}?space=${tenant}&offering=${trial.offeringId}`;
    await tp.goto(route('teacher'));
    await tp.getByLabel('主题标题', { exact: true }).fill('安全维护：为什么先隔离再验电？');
    await tp.getByLabel('主题说明', { exact: true }).fill('结合本章讲义交流维护顺序；请说明理由。');
    await tp.getByRole('button', { name: '保存主题草稿', exact: true }).click();
    await expect(tp.getByRole('button', { name: '开放讨论', exact: true })).toBeEnabled();
    assert.equal((await read()).rows.length, 0);
    const teacherTopics = await read('', teacher);
    topicId = teacherTopics.rows[0].id;
    assert.equal((await http(base + `/${topicId}/posts`, student)).status, 404);
    await tp.getByRole('button', { name: '开放讨论', exact: true }).click();
    await expect(tp.getByRole('button', { name: '关闭讨论', exact: true })).toBeEnabled();
    await sp.goto(route('student'));
    await sp
      .getByRole('button', { name: '打开主题 安全维护：为什么先隔离再验电？', exact: true })
      .click();
    await sp
      .getByLabel('讨论内容', { exact: true })
      .fill('先隔离防止误送电，再验电确认无电，最后开始维护。');
    // SPA leave cancellation keeps unsent text; server state is unchanged until send.
    sp.once('dialog', (d) => void d.dismiss());
    await sp.getByRole('link', { name: '目录', exact: true }).click();
    await expect(sp.getByLabel('讨论内容', { exact: true })).toHaveValue(
      '先隔离防止误送电，再验电确认无电，最后开始维护。',
    );
    await sp.getByRole('button', { name: '发送发言', exact: true }).click();
    await expect(sp.getByLabel('讨论内容', { exact: true })).toHaveValue('');
    await expect(
      sp.getByText('先隔离防止误送电，再验电确认无电，最后开始维护。', { exact: true }),
    ).toBeVisible();
    postId = (await read(`/${topicId}/posts`)).rows[0].id;
    await tp.getByRole('button', { name: '读取最新讨论状态', exact: true }).click();
    await tp
      .getByRole('button', { name: '回复 陈同学', exact: true })
      .waitFor({ state: 'visible' });
    await tp.getByRole('button', { name: '回复 陈同学', exact: true }).click();
    await tp
      .getByLabel('讨论内容', { exact: true })
      .fill('还要在验电前后确认仪表正常，这样才能排除仪表失效。');
    await tp.getByRole('button', { name: '发送发言', exact: true }).click();
    await expect(
      tp.getByText('还要在验电前后确认仪表正常，这样才能排除仪表失效。', { exact: true }),
    ).toBeVisible();
    const studentCard = tp
      .locator('article[data-post-id]')
      .filter({ hasText: '先隔离防止误送电，再验电确认无电，最后开始维护。' });
    await studentCard.getByLabel('管理原因', { exact: true }).fill('课堂演示隐藏，待复核后恢复。');
    await studentCard.getByRole('button', { name: '隐藏发言', exact: true }).click();
    await expect(studentCard.getByRole('button', { name: '恢复发言', exact: true })).toBeEnabled();
    await sp.getByRole('button', { name: '读取最新讨论状态', exact: true }).click();
    await expect(sp.getByText('此发言已由教师隐藏。', { exact: true })).toBeVisible();
    await expect(
      sp.getByText('先隔离防止误送电，再验电确认无电，最后开始维护。', { exact: true }),
    ).toHaveCount(0);
    const hidden = await read(`/${topicId}/posts`);
    assert.equal(hidden.rows[0].body, null);
    assert.equal(hidden.rows[0].author_name, null);
    assert.equal(JSON.stringify(hidden).includes('课堂演示隐藏'), false);
    assert.equal((await http(base + `/${topicId}/events`, student)).status, 403);
    await studentCard.getByLabel('管理原因', { exact: true }).fill('课堂复核完成，恢复公开。');
    await studentCard.getByRole('button', { name: '恢复发言', exact: true }).click();
    await expect(studentCard.getByRole('button', { name: '隐藏发言', exact: true })).toBeEnabled();
    await tp.getByRole('button', { name: '查看管理记录', exact: true }).click();
    await expect(tp.getByRole('region', { name: '讨论管理记录', exact: true })).toContainText(
      '课堂复核完成，恢复公开。',
    );
    await sp.getByRole('button', { name: '读取最新讨论状态', exact: true }).click();
    await sp.getByRole('button', { name: '回复 周老师', exact: true }).click();
    await sp.getByLabel('讨论内容', { exact: true }).fill('明白了，还需要确认验电仪表本身有效。');
    await sp.getByRole('button', { name: '发送发言', exact: true }).click();
    await expect(
      sp.getByText('明白了，还需要确认验电仪表本身有效。', { exact: true }),
    ).toBeVisible();
    await tp.getByRole('button', { name: '关闭讨论', exact: true }).click();
    await expect(tp.getByRole('button', { name: '重新开放讨论', exact: true })).toBeEnabled();
    await sp.getByRole('button', { name: '读取最新讨论状态', exact: true }).click();
    await expect(sp.getByText('当前主题只读，不能发送或回复。', { exact: true })).toBeVisible();
    await expect(sp.getByLabel('讨论内容', { exact: true })).toHaveCount(0);
    assert.equal(
      (await call({ type: 'POST_MESSAGE', topicId, parentId: null, body: '关闭后发言' }, student))
        .status,
      409,
    );
    await tp.getByRole('button', { name: '重新开放讨论', exact: true }).click();
    await expect(tp.getByRole('button', { name: '关闭讨论', exact: true })).toBeEnabled();
    await sp.getByRole('button', { name: '读取最新讨论状态', exact: true }).click();
    await expect(sp.getByLabel('讨论内容', { exact: true })).toBeEnabled();
    await sp.getByRole('link', { name: '目录', exact: true }).click();
    await sp.getByRole('link', { name: '课程讨论', exact: true }).click();
    await sp
      .getByRole('button', { name: '打开主题 安全维护：为什么先隔离再验电？', exact: true })
      .click();
    await expect(
      sp.getByText('明白了，还需要确认验电仪表本身有效。', { exact: true }),
    ).toBeVisible();
    await sp.screenshot({
      path: 'docs/v2/evidence/zhiban-discussion-student-local.png',
      fullPage: true,
    });
    await tp.screenshot({
      path: 'docs/v2/evidence/zhiban-discussion-teacher-local.png',
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    record(
      'DISCUSSION UI: teacher draft/open; student post/leave-cancel; teacher reply/hide/restore with audit; student replies; close read-only/reopen; course return context',
    );
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
  assert.equal(
    (
      await http(
        base,
        student,
        { type: 'POST_MESSAGE', topicId, parentId: null, body: 'CSRF denied' },
        'POST',
        { 'x-zhiban-csrf': '' },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await http(
        base,
        student,
        { type: 'POST_MESSAGE', topicId, parentId: null, body: 'Origin denied' },
        'POST',
        { Origin: 'https://invalid.example' },
      )
    ).status,
    403,
  );
  const latest = async () => (await read(`/${topicId}/posts`, teacher)).topic as View;
  const post = (body: string, parentId: string | null = null) => ({
    type: 'POST_MESSAGE',
    topicId,
    parentId,
    body,
  });
  for (const a of [outsider, foreign, actors[5]]) {
    assert.ok([403, 404].includes((await http(base, a)).status));
    assert.ok([403, 404].includes((await call(post('拒绝越权'), a)).status));
  }
  assert.equal(
    (await call({ type: 'CREATE_TOPIC', title: '拒绝学生创建', description: '' }, student)).status,
    403,
  );
  assert.equal(
    (
      await call(
        { type: 'POST_MESSAGE', topicId, parentId: null, body: '伪造', authorId: teacher.member },
        student,
      )
    ).status,
    400,
  );
  assert.equal(
    (await call({ type: 'HIDE_POST', topicId, id: postId, revision: '3', reason: '越权' }, student))
      .status,
    403,
  );
  const other = await send({ type: 'CREATE_TOPIC', title: '隔离验证主题', description: '' });
  await send({
    type: 'EDIT_TOPIC',
    id: other.id,
    revision: other.revision,
    title: '隔离验证主题：已编辑',
    description: '草稿可编辑',
  });
  assert.equal((await call({ type: 'OPEN_TOPIC', id: other.id, revision: '1' })).status, 409);
  await send({ type: 'OPEN_TOPIC', id: other.id, revision: '2' });
  assert.equal(
    (
      await call(
        { type: 'POST_MESSAGE', topicId: other.id, parentId: postId, body: '跨主题父帖' },
        student,
      )
    ).status,
    404,
  );
  const unknownOffering = base.replace(trial.offeringId, v7());
  assert.equal((await call(post('跨班'), student, randomUUID(), unknownOffering)).status, 403);
  await send({ type: 'ARCHIVE_TOPIC', id: other.id, revision: '3' });
  assert.equal((await http(base + `/${other.id}/posts`, student)).status, 404);
  assert.equal((await call({ type: 'OPEN_TOPIC', id: other.id, revision: '4' })).status, 409);
  record(
    'DISCUSSION authorization: no admin proxy/student management; tenant/offering/parent isolation, draft/archive secrecy and stale revision barriers',
  );

  // Both callers queue on the same parent row; closing/hiding goes first deterministically.
  async function queued(
    first: () => ReturnType<typeof call>,
    second: () => ReturnType<typeof call>,
  ) {
    const lock = await admin.connect();
    let one: ReturnType<typeof call> | undefined, two: ReturnType<typeof call> | undefined;
    try {
      await lock.query('BEGIN');
      await lock.query(
        'SELECT id FROM zhiban_discussion.topics WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR UPDATE',
        [tenant, trial.offeringId, topicId],
      );
      const wait = async (count: number) => {
        const until = Date.now() + 2200;
        while (Date.now() < until) {
          const n = Number(
            (
              await admin.query(
                "SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT * FROM zhiban_discussion.topics%FOR UPDATE'",
              )
            ).rows[0].n,
          );
          if (n >= count) return;
          await new Promise((r) => setTimeout(r, 15));
        }
        throw Error('Expected parent-lock waiter missing');
      };
      one = first();
      await wait(1);
      two = second();
      await wait(2);
      await lock.query('COMMIT');
      return await Promise.all([one, two]);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      if (one && two) await Promise.allSettled([one, two]);
    }
  }
  let topic = await latest();
  const closed = await queued(
    () => call({ type: 'CLOSE_TOPIC', id: topicId, revision: topic.revision }),
    () => call(post('并发关闭后不得写入'), student),
  );
  assert.deepEqual(
    closed.map((r) => r.status),
    [200, 409],
  );
  topic = await latest();
  await send({ type: 'OPEN_TOPIC', id: topicId, revision: topic.revision });
  const messages = await read(`/${topicId}/posts`, teacher);
  let firstPost = messages.rows.find((r: View) => r.id === postId);
  const hidden = await queued(
    () =>
      call({
        type: 'HIDE_POST',
        topicId,
        id: postId,
        revision: firstPost.revision,
        reason: '并发隐藏验证',
      }),
    () => call(post('并发隐藏后不得回复', postId), student),
  );
  assert.deepEqual(
    hidden.map((r) => r.status),
    [200, 404],
  );
  firstPost = (await read(`/${topicId}/posts`, teacher)).rows.find((r: View) => r.id === postId);
  await send({
    type: 'RESTORE_POST',
    topicId,
    id: postId,
    revision: firstPost.revision,
    reason: '并发验证结束恢复',
  });
  record(
    'DISCUSSION concurrency: close-before-post and hide-before-reply serialize on the topic; losing writes rejected',
  );

  const key = randomUUID(),
    command = post('故障切点后按同命令安全恢复');
  await admin.query(
    "CREATE FUNCTION public.local_discussion_cut() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.event_type='POST_MESSAGE' THEN RAISE EXCEPTION 'LOCAL_DISCUSSION_CUT'; END IF; RETURN NEW; END $$; CREATE TRIGGER local_discussion_cut BEFORE INSERT ON zhiban_discussion.commands FOR EACH ROW EXECUTE FUNCTION public.local_discussion_cut()",
  );
  const count = async () =>
    Number(
      (
        await admin.query(
          'SELECT count(*) AS n FROM zhiban_discussion.posts WHERE tenant_id=$1 AND offering_id=$2 AND topic_id=$3',
          [tenant, trial.offeringId, topicId],
        )
      ).rows[0].n,
    );
  const before = await count();
  try {
    assert.equal((await call(command, student, key)).status, 503);
    assert.equal(await count(), before);
  } finally {
    await admin.query(
      'DROP TRIGGER local_discussion_cut ON zhiban_discussion.commands; DROP FUNCTION public.local_discussion_cut()',
    );
  }
  const committed = await send(command, student, key);
  assert.equal((await send(command, student, key)).id, committed.id);
  assert.equal(await count(), before + 1);
  assert.equal((await call(post('同号不同内容'), student, key)).status, 409);
  assert.equal((await call(command, teacher, key)).status, 409);
  // A moderation failure cannot leave the post hidden without its audit reason.
  firstPost = (await read(`/${topicId}/posts`, teacher)).rows.find((r: View) => r.id === postId);
  await admin.query(
    "CREATE FUNCTION public.local_moderation_cut() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'LOCAL_MODERATION_CUT'; END $$; CREATE TRIGGER local_moderation_cut BEFORE INSERT ON zhiban_discussion.moderation_events FOR EACH ROW EXECUTE FUNCTION public.local_moderation_cut()",
  );
  try {
    assert.equal(
      (
        await call({
          type: 'HIDE_POST',
          topicId,
          id: postId,
          revision: firstPost.revision,
          reason: '故障验证',
        })
      ).status,
      503,
    );
  } finally {
    await admin.query(
      'DROP TRIGGER local_moderation_cut ON zhiban_discussion.moderation_events; DROP FUNCTION public.local_moderation_cut()',
    );
  }
  assert.equal(
    (await read(`/${topicId}/posts`)).rows.find((r: View) => r.id === postId).state,
    'VISIBLE',
  );
  record(
    'DISCUSSION atomicity: failed post/audit and moderation roll back; same-key retry/replay creates one post; changed actor/payload refused',
  );

  for (let i = 0; i < 11; i++) await send(post('分页发言 ' + i), student);
  const page1 = await read(`/${topicId}/posts?limit=10`);
  assert.equal(page1.rows.length, 10);
  assert.ok(page1.nextCursor);
  const page2 = await read(`/${topicId}/posts?limit=10&cursor=${page1.nextCursor}`);
  assert.equal(
    page2.rows.some((r: View) => page1.rows.some((p: View) => p.id === r.id)),
    false,
  );
  assert.equal(
    (await http(base + `/${topicId}/posts?limit=10&cursor=${page1.nextCursor}`, teacher)).status,
    400,
  );
  assert.equal(
    (await http(base + `/${other.id}/posts?limit=10&cursor=${page1.nextCursor}`, teacher)).status,
    400,
  );
  const tampered = page1.nextCursor.slice(0, -2) + 'AA';
  assert.equal(
    (await http(base + `/${topicId}/posts?limit=10&cursor=${tampered}`, student)).status,
    400,
  );
  for (let i = 0; i < 10; i++)
    await send({ type: 'CREATE_TOPIC', title: '分页草稿 ' + i, description: '' });
  const topics1 = await read('?limit=10', teacher);
  assert.equal(topics1.rows.length, 10);
  assert.ok(topics1.nextCursor);
  const topics2 = await read('?limit=10&cursor=' + topics1.nextCursor, teacher);
  assert.equal(
    topics2.rows.some((r: View) => topics1.rows.some((p: View) => p.id === r.id)),
    false,
  );
  // Hide diagnostic drafts from the teacher's default list only by archiving, keeping history intact.
  for (const d of [...topics1.rows, ...topics2.rows].filter((r: View) => r.state === 'DRAFT'))
    await send({ type: 'ARCHIVE_TOPIC', id: d.id, revision: d.revision });
  const pagingContext = await browser.newContext();
  try {
    await pagingContext.addCookies([
      {
        name: student.cookie!.split('=')[0],
        value: student.cookie!.split('=').slice(1).join('='),
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
    const page = await pagingContext.newPage();
    await page.goto(
      `${origin}/zhiban/student/courses/${trial.courseId}/discussions?space=${tenant}&offering=${trial.offeringId}`,
    );
    await page.getByLabel('讨论每页条数', { exact: true }).selectOption('10');
    await page
      .getByRole('button', { name: '打开主题 安全维护：为什么先隔离再验电？', exact: true })
      .click();
    const messages = page.getByRole('region', { name: '主题发言', exact: true });
    await expect(messages.locator('article')).toHaveCount(10);
    const firstIds = await messages
      .locator('article')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-post-id')));
    await page.getByRole('button', { name: '下一页发言', exact: true }).click();
    await expect(page.getByRole('navigation', { name: '发言分页', exact: true })).toContainText(
      '第 2 页',
    );
    const nextIds = await messages
      .locator('article')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-post-id')));
    assert.ok(nextIds.length > 0 && nextIds.every((id) => !firstIds.includes(id)));
  } finally {
    await pagingContext.close();
  }
  const manage = (c: unknown) =>
    send(c, manager, randomUUID(), `/api/zhiban/management/${tenant}/commands`);
  let offering = (
    await admin.query('SELECT * FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2', [
      tenant,
      trial.offeringId,
    ])
  ).rows[0];
  await manage({
    type: 'ENROLL',
    offeringId: trial.offeringId,
    membershipId: actors[6].member,
    revision: null,
  });
  const historical = await send(post('退课成员留下的公开记录'), actors[6]);
  const enrollment = (
    await admin.query(
      'SELECT id,revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
      [tenant, trial.offeringId, actors[6].member],
    )
  ).rows[0];
  await manage({ type: 'WITHDRAW', id: enrollment.id, revision: enrollment.revision });
  assert.equal((await http(base, actors[6])).status, 403);
  assert.equal((await call(post('退课后写入'), actors[6])).status, 403);
  assert.ok(
    (await read(`/${topicId}/posts?limit=50`)).rows.some((r: View) => r.id === historical.id),
  );
  const assignment = (
    await admin.query(
      'SELECT id,revision::text FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3',
      [tenant, trial.offeringId, teacher.member],
    )
  ).rows[0];
  await manage({ type: 'END_TEACHER', id: assignment.id, revision: assignment.revision });
  try {
    assert.equal((await http(base, teacher)).status, 403);
    assert.equal((await call(post('任教结束后写入'))).status, 403);
  } finally {
    const ended = (
      await admin.query(
        'SELECT revision::text FROM zhiban_academic.assignments WHERE tenant_id=$1 AND id=$2',
        [tenant, assignment.id],
      )
    ).rows[0];
    await manage({
      type: 'ASSIGN_TEACHER',
      offeringId: trial.offeringId,
      membershipId: teacher.member,
      revision: ended.revision,
    });
  }
  offering = (
    await admin.query('SELECT * FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2', [
      tenant,
      trial.offeringId,
    ])
  ).rows[0];
  await manage({
    type: 'UPDATE_OFFERING',
    id: offering.id,
    revision: String(offering.revision),
    name: offering.name,
    capacity: offering.capacity,
    status: 'CLOSED',
  });
  try {
    assert.equal((await read()).writable, false);
    assert.equal((await call(post('班级关闭后写入'), student)).status, 409);
  } finally {
    offering = (
      await admin.query('SELECT * FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2', [
        tenant,
        trial.offeringId,
      ])
    ).rows[0];
    await manage({
      type: 'UPDATE_OFFERING',
      id: offering.id,
      revision: String(offering.revision),
      name: offering.name,
      capacity: offering.capacity,
      status: 'OPEN',
    });
  }
  const conn = await runtime.connect();
  try {
    for (const sql of [
      "UPDATE zhiban_discussion.posts SET body='forbidden'",
      'DELETE FROM zhiban_discussion.posts',
      "UPDATE zhiban_discussion.commands SET result='{}'",
      'DELETE FROM zhiban_discussion.moderation_events',
    ]) {
      await conn.query('BEGIN');
      await conn.query("SELECT set_config('app.tenant_id',$1,true)", [tenant]);
      await assert.rejects(conn.query(sql), /permission denied/i);
      await conn.query('ROLLBACK');
    }
  } finally {
    await conn.query('ROLLBACK');
    conn.release();
  }
  assert.equal(await loadDiscussion(runtime), true);
  await admin.query('GRANT UPDATE(body) ON zhiban_discussion.posts TO zhiban_academic_runtime');
  try {
    await assert.rejects(loadDiscussion(runtime), /rejected/);
  } finally {
    await admin.query(
      'REVOKE UPDATE(body) ON zhiban_discussion.posts FROM zhiban_academic_runtime',
    );
  }
  assert.equal(await loadDiscussion(runtime), true);
  assert.deepEqual(await gradeCounts(), originalGradeCounts);
  record(
    'DISCUSSION paging/revocation/ACL: signed cursors, withdrawal and assignment removal, closed offering read-only, immutable content/audit and widened ACL rejection',
  );
  await writeFile(
    'docs/v2/evidence/zhiban-discussion-journey-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        scope: 'OWNED_PG16_DISCUSSION_PRODUCT',
        origin,
        tenant,
        offeringId: trial.offeringId,
        courseId: trial.courseId,
        topicId,
        postId,
        status: 'PASS',
        browserErrors: errors,
        gates: 'Native Runtime/AI and discussion grades/completion remain closed',
      },
      null,
      2,
    ) + '\n',
  );
}
