import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { Pool } from 'pg';
import type { prepareTrial } from './prepare-trial';
import { interactiveExample } from '../../app/zhiban/local/interactive-client';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  nativeAdmin: Pool;
};
type Result = {
  id: string;
  revision: string;
  dispatchId: string;
  attemptId: string;
  runtimeBindingId: string;
  jointPublicationId: string;
  submissionId: string;
};
type Task = {
  id: string;
  target_id: string;
  available: boolean;
  joint?: { resourceId: string; publicationId: string };
  participants: { submissions: number; published_grades: number }[];
};
type Session = { id: string; revision: string; state: string; tasks: Task[] };
export async function verifyJointClassroom(input: Input) {
  const { admin, browser, http, actors, tenant, origin, trial, record } = input;
  const [teacher, student, outsider, foreign, manager, peer] = actors;
  const content = `/api/zhiban/content/${tenant}/offerings/${trial.offeringId}`,
    learning = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}`,
    url = learning + '/classrooms';
  const send = async (path: string, actor: typeof student, command: unknown, key = v7()) => {
    const r = await http(path, actor, command, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, `${(command as { type: string }).type}: ${JSON.stringify(r.json)}`);
    return r.json as Result;
  };
  const resource = await send(content, teacher, {
    type: 'CREATE_INTERACTIVE',
    title: '联合互动：欧姆定律',
    html: interactiveExample,
  });
  const resources = async () =>
    (
      (await http(content, teacher)).json as {
        resources: { id: string; revision: string; publication: { id: string } }[];
      }
    ).resources;
  const currentResource = async () => (await resources()).find((r) => r.id === resource.id)!;
  await send(content, teacher, {
    type: 'PUBLISH_CONTENT',
    id: resource.id,
    revision: (await currentResource()).revision,
  });
  const publication = (await currentResource()).publication.id;
  const activity = await send(learning, teacher, {
    type: 'CREATE_ACTIVITY',
    title: '联合文字作答',
    prompt: '根据互动观察解释 U、I 的关系。',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 3,
  });
  await send(learning, teacher, {
    type: 'PUBLISH_ACTIVITY',
    id: activity.id,
    revision: activity.revision,
  });
  const quiz = await send(learning + '/quizzes', teacher, {
    type: 'CREATE_QUIZ',
    title: '联合测验作答',
    mode: 'ASSESSED',
    content: {
      type: 'quiz',
      questions: [
        {
          id: 'q1',
          type: 'single',
          question: '电阻不变，电压增大时电流？',
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
  const outline = (await http(learning + '/outline', teacher)).json as { revision: string };
  await send(learning + '/outline', teacher, {
    type: 'SAVE_OUTLINE',
    revision: outline.revision,
    chapters: [
      {
        id: v7(),
        title: '联合课堂',
        units: [
          { id: v7(), kind: 'LECTURE', target: resource.id, title: '互动观察' },
          { id: v7(), kind: 'ACTIVITY', target: activity.id, title: '文字解释' },
          { id: v7(), kind: 'ACTIVITY', target: quiz.id, title: '测验' },
        ],
      },
    ],
  });
  await send(learning + '/outline', teacher, {
    type: 'PUBLISH_OUTLINE',
    revision: String(BigInt(outline.revision) + BigInt(1)),
  });
  let session = await send(url, teacher, {
    type: 'CREATE_CLASSROOM',
    title: '联合课堂演示',
    description: '固定互动＋作答；仅服务端学习事实可信。',
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
  const dispatchCommand = () => ({
    type: 'DISPATCH_JOINT_TASK',
    id: session.id,
    revision: session.revision,
    activityId: activity.id,
    activityVersion: '1',
    interactiveId: resource.id,
    publicationId: publication,
  });
  for (const actor of [student, manager, outsider, foreign])
    assert.equal((await http(url, actor, dispatchCommand())).status, 403);
  assert.equal((await http(url, teacher, { ...dispatchCommand(), score: 100 })).status, 400);
  assert.equal(
    (await http(url, teacher, { ...dispatchCommand(), publicationId: v7() })).status,
    409,
  );
  const state = async () => {
    const r = await http(url, teacher);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return (r.json as { sessions: Session[] }).sessions.find((s) => s.id === session.id)!;
  };
  const course = trial.courseId,
    teacherUrl = `${origin}/zhiban/teacher/courses/${course}/classrooms?space=${tenant}&offering=${trial.offeringId}`,
    studentUrl = `${origin}/zhiban/student/courses/${course}/coursework?space=${tenant}&offering=${trial.offeringId}`;
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
    sp = await sc.newPage();
  const counts = async (member: string, target: string) =>
    (
      await admin.query(
        `SELECT
 (SELECT count(*)::int FROM zhiban_learning.attempts WHERE tenant_id=$1 AND membership_id=$2 AND activity_id=$3) AS attempts,
 (SELECT count(*)::int FROM zhiban_classroom.joint_entries e JOIN zhiban_learning.attempts a ON a.tenant_id=e.tenant_id AND a.id=e.attempt_id WHERE e.tenant_id=$1 AND e.membership_id=$2 AND a.activity_id=$3) AS entries,
 (SELECT count(*)::int FROM zhiban_content.attempt_runtime_bindings b JOIN zhiban_learning.attempts a ON a.tenant_id=b.tenant_id AND a.id=b.attempt_id WHERE b.tenant_id=$1 AND b.learner_membership_id=$2 AND a.activity_id=$3) AS bindings`,
        [tenant, member, target],
      )
    ).rows[0];
  try {
    await tp.goto(teacherUrl);
    const card = tp.locator(`[data-classroom="${session.id}"]`);
    await card
      .getByLabel('课堂 联合课堂演示 联合互动', { exact: true })
      .selectOption({ label: '联合互动：欧姆定律 · v1' });
    await card
      .getByLabel('课堂 联合课堂演示 联合作答', { exact: true })
      .selectOption({ label: '联合文字作答 · v1' });
    await card.getByRole('button', { name: '派发互动＋作答', exact: true }).click();
    await expect(
      card.getByRole('link', { name: '查看联合任务可信记录', exact: true }),
    ).toBeVisible();
    let snapshot = await state();
    session.revision = snapshot.revision;
    const task = snapshot.tasks.find((d) => d.joint)!;
    assert.equal(task.joint!.publicationId, publication);
    assert.deepEqual(await counts(student.member, activity.id), {
      attempts: 0,
      entries: 0,
      bindings: 0,
    });
    const enter = {
      type: 'ENTER_TASK',
      id: session.id,
      revision: session.revision,
      dispatchId: task.id,
    };
    const player = `/api/zhiban/content/${tenant}/offerings/${trial.offeringId}/resources/${resource.id}/player?publication=${publication}&dispatch=${task.id}`;
    assert.equal((await http(player, peer)).status, 403);
    const studentSnapshot = await http(url, student);
    await writeFile(
      'docs/v2/evidence/joint-classroom/student-before-entry.json',
      JSON.stringify(studentSnapshot.json, null, 2) + '\n',
    );
    assert.equal(studentSnapshot.status, 200);
    assert.equal(
      (studentSnapshot.json as { sessions: Session[] }).sessions.find((x) => x.id === session.id)
        ?.tasks[0]?.available,
      true,
    );
    await sp.goto(studentUrl);
    await sp
      .locator(`[data-classroom="${session.id}"]`)
      .getByRole('button', { name: '进入课堂任务', exact: true })
      .click();
    await expect(sp.getByRole('region', { name: '本次课堂可信记录' })).toContainText(
      '联合文字作答',
    );
    await expect(sp.getByLabel('关联课程活动', { exact: true })).toHaveCount(0);
    assert.deepEqual(await counts(student.member, activity.id), {
      attempts: 1,
      entries: 1,
      bindings: 1,
    });
    const replay = await send(url, student, enter),
      key = v7();
    const repeated = await Promise.all([
      send(url, student, enter, key),
      send(url, student, enter, key),
    ]);
    assert.ok(
      repeated.every(
        (r) => r.attemptId === replay.attemptId && r.runtimeBindingId === replay.runtimeBindingId,
      ),
    );
    assert.deepEqual(await counts(student.member, activity.id), {
      attempts: 1,
      entries: 1,
      bindings: 1,
    });
    await sp.getByRole('link', { name: '前往本次课堂作答', exact: true }).click();
    await expect(sp.getByLabel('尝试 1 作答', { exact: true })).toBeVisible();
    await sp
      .getByLabel('尝试 1 作答', { exact: true })
      .fill('电阻固定为 6Ω，电压增加时电流按 I=U/R 增加。');
    await sp.getByRole('button', { name: '最终提交', exact: true }).click();
    await expect(sp.getByText('操作已完成。', { exact: true })).toBeVisible();
    await expect(sp.getByText('当前只显示本课堂首次绑定的尝试', { exact: false })).toBeVisible();
    const submission = (
      await admin.query(
        'SELECT id FROM zhiban_learning.submissions WHERE tenant_id=$1 AND attempt_id=$2 ORDER BY version DESC LIMIT 1',
        [tenant, replay.attemptId],
      )
    ).rows[0];
    assert.ok(submission);
    await sp.getByRole('link', { name: '返回本次课堂互动', exact: true }).click();
    await expect(sp.getByRole('region', { name: '本次课堂可信记录' })).toContainText(
      '提交已记录 · 第 1 版',
    );
    await sp.screenshot({ path: 'docs/v2/evidence/joint-classroom/student.png' });
    const grade = await send(
      `/api/zhiban/assessment/${tenant}/offerings/${trial.offeringId}`,
      teacher,
      {
        type: 'SAVE_GRADE',
        submissionId: submission.id,
        revision: null,
        score: '90',
        maxScore: '100',
        feedback: '观察与公式一致。',
      },
    );
    await send(`/api/zhiban/assessment/${tenant}/offerings/${trial.offeringId}`, teacher, {
      type: 'PUBLISH_GRADE',
      submissionId: submission.id,
      revision: grade.revision,
    });
    const replayAfterSubmit = await send(url, student, enter);
    assert.equal(replayAfterSubmit.attemptId, replay.attemptId);
    snapshot = await state();
    const progress = snapshot.tasks.find((t) => t.id === task.id)!.participants[0];
    assert.equal(progress.submissions, 1);
    assert.equal(progress.published_grades, 1);
    await tp.getByRole('button', { name: '刷新课堂任务', exact: true }).click();
    await expect(card.getByText('已发布成绩 1 份', { exact: false })).toBeVisible();
    await tp.screenshot({ path: 'docs/v2/evidence/joint-classroom/teacher.png' });
    record(
      'Joint Text: teacher UI pair -> atomic entry -> exact Attempt submit -> return -> original grade publication',
    );
    // The second package path uses the native Quiz surface with the SAME exact-entry behavior.
    const quizDispatch = await send(url, teacher, { ...dispatchCommand(), activityId: quiz.id });
    session.revision = quizDispatch.revision;
    await sp.goto(studentUrl);
    await sp
      .locator(`[data-classroom="${session.id}"]`)
      .getByRole('button', { name: '进入课堂任务', exact: true })
      .click();
    await expect(sp.getByRole('region', { name: '本次课堂可信记录' })).toContainText(
      '联合测验作答',
    );
    await sp.getByRole('link', { name: '前往本次课堂作答', exact: true }).click();
    await expect(sp.getByRole('radio').first()).toBeVisible();
    await expect(sp.getByRole('button', { name: '开始新一次尝试', exact: true })).toHaveCount(0);
    await sp.getByRole('radio').first().check();
    await sp.getByRole('button', { name: '提交答案', exact: true }).click();
    await sp.getByRole('button', { name: '确认提交测验', exact: true }).click();
    await expect(sp.getByText('提交成功，收据：', { exact: false })).toBeVisible();
    await sp.getByRole('link', { name: '返回本次课堂互动', exact: true }).click();
    await expect(sp.getByRole('region', { name: '本次课堂可信记录' })).toContainText(
      '提交已记录 · 第 1 版',
    );
    assert.deepEqual(await counts(student.member, quiz.id), {
      attempts: 1,
      entries: 1,
      bindings: 1,
    });
    const quizEnter = {
      type: 'ENTER_TASK',
      id: session.id,
      revision: session.revision,
      dispatchId: quizDispatch.dispatchId,
    };
    record(
      'Joint Quiz: native surface consumes the exact classroom Attempt; submit and return preserve binding',
    );
    await sp.close();
    // Failure after Attempt start must roll back the entire business entry.
    await admin.query(
      'REVOKE EXECUTE ON FUNCTION zhiban_content.bind_joint_attempt(uuid,uuid,uuid,uuid,uuid) FROM zhiban_academic_runtime',
    );
    try {
      assert.equal((await http(url, peer, quizEnter)).status, 403);
      assert.deepEqual(await counts(peer.member, quiz.id), {
        attempts: 0,
        entries: 0,
        bindings: 0,
      });
    } finally {
      await admin.query(
        'GRANT EXECUTE ON FUNCTION zhiban_content.bind_joint_attempt(uuid,uuid,uuid,uuid,uuid) TO zhiban_academic_runtime',
      );
    }
    // Hold the classroom row, then start a first entry holding the public-content
    // SHARE lease. Concurrent replacement must wait, rather than splice generations.
    const lock = await admin.connect();
    let joining: Promise<Result> | undefined, replacing: Promise<Result> | undefined;
    try {
      await lock.query('BEGIN');
      await lock.query(
        'SELECT id FROM zhiban_classroom.sessions WHERE tenant_id=$1 AND id=$2 FOR UPDATE',
        [tenant, session.id],
      );
      joining = send(url, peer, quizEnter);
      void joining.catch(() => {});
      const waits = async (user: string, needle: string) => {
        const until = Date.now() + 10000;
        while (Date.now() < until) {
          if (
            (
              await admin.query(
                "SELECT 1 FROM pg_stat_activity WHERE usename=$1 AND wait_event_type='Lock' AND strpos(query,$2)>0",
                [user, needle],
              )
            ).rowCount
          )
            return;
          await new Promise((r) => setTimeout(r, 30));
        }
        throw Error('Expected guarded lock wait was not observed: ' + user);
      };
      await waits('zhiban_academic_runtime', 'zhiban_classroom.sessions');
      const r = await currentResource();
      replacing = send(content, teacher, {
        type: 'PUBLISH_CONTENT',
        id: resource.id,
        revision: r.revision,
      });
      void replacing.catch(() => {});
      await waits('zhiban_bridge_runtime', 'zhiban_content.resources');
      await lock.query('COMMIT');
      const entered = await joining;
      await replacing;
      assert.equal(entered.jointPublicationId, publication);
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
      if (joining) await joining;
      if (replacing) await replacing;
    }
    assert.deepEqual(await counts(peer.member, quiz.id), { attempts: 1, entries: 1, bindings: 1 });
    assert.equal((await http(url, student, quizEnter)).status, 409);
    assert.equal((await http(player, student)).status, 409);
    const replacement = (await currentResource()).publication.id;
    assert.notEqual(replacement, publication);
    const currentDispatch = await send(url, teacher, {
      ...dispatchCommand(),
      activityId: quiz.id,
      publicationId: replacement,
    });
    session.revision = currentDispatch.revision;
    const enterNew = {
      ...quizEnter,
      revision: session.revision,
      dispatchId: currentDispatch.dispatchId,
    };
    assert.equal((await http(url, student, enterNew)).status, 409); // maxAttempts=1, no phantom entry
    assert.deepEqual(await counts(student.member, quiz.id), {
      attempts: 1,
      entries: 1,
      bindings: 1,
    });
    const ended = await send(url, teacher, {
      type: 'END_CLASSROOM',
      id: session.id,
      revision: session.revision,
    });
    assert.equal((await http(url, peer, { ...enterNew, revision: ended.revision })).status, 409);
    // A historical read remains a course-authorized provenance read, not an entry.
    const runtime = await http(
      content + `/resources/${resource.id}/runtime?attempt=${replay.attemptId}`,
      student,
    );
    assert.equal(runtime.status, 200);
    assert.equal((runtime.json as { score: null }).score, null);
    const acl = (
      await admin.query(
        "SELECT has_table_privilege('zhiban_academic_runtime','zhiban_content.attempt_runtime_bindings','INSERT,UPDATE,DELETE') AS binding_write,has_table_privilege('zhiban_academic_runtime','zhiban_classroom.joint_entries','UPDATE,DELETE') AS rewrite,has_function_privilege('zhiban_bridge_runtime','zhiban_content.bind_joint_attempt(uuid,uuid,uuid,uuid,uuid)','EXECUTE') AS bridge_bind",
      )
    ).rows[0];
    assert.deepEqual(acl, { binding_write: false, rewrite: false, bridge_bind: false });
    // A real uncertain Native publication keeps the old current generation but
    // must still block NEW joint facts; restoring ACL never clears quarantine.
    let quarantineSession = await send(url, teacher, {
      type: 'CREATE_CLASSROOM',
      title: '隔离屏障验证',
      description: 'LOCAL',
      opensAt: null,
      closesAt: null,
    });
    quarantineSession = {
      ...quarantineSession,
      ...(await send(url, teacher, {
        type: 'PUBLISH_CLASSROOM',
        id: quarantineSession.id,
        revision: quarantineSession.revision,
      })),
    };
    const quarantineDispatch = await send(url, teacher, {
      ...dispatchCommand(),
      id: quarantineSession.id,
      revision: quarantineSession.revision,
      publicationId: replacement,
    });
    const beforeQuarantine = await counts(student.member, activity.id);
    await input.nativeAdmin.query(
      'REVOKE INSERT ON public.document_stages FROM zhiban_openmaic_runtime',
    );
    try {
      const r = await currentResource();
      const failed = await http(content, teacher, {
        type: 'PUBLISH_CONTENT',
        id: resource.id,
        revision: r.revision,
      });
      assert.equal(failed.status, 409);
      assert.equal((failed.json as { error: { code: string } }).error.code, 'OUTCOME_UNKNOWN');
    } finally {
      await input.nativeAdmin.query(
        'GRANT INSERT ON public.document_stages TO zhiban_openmaic_runtime',
      );
    }
    assert.equal(
      (
        await http(url, student, {
          type: 'ENTER_TASK',
          id: quarantineSession.id,
          revision: quarantineDispatch.revision,
          dispatchId: quarantineDispatch.dispatchId,
        })
      ).status,
      409,
    );
    assert.deepEqual(await counts(student.member, activity.id), beforeQuarantine);
    assert.ok(
      (
        await admin.query(
          "SELECT 1 FROM zhiban_content.operations WHERE tenant_id=$1 AND resource_id=$2 AND state='OUTCOME_UNKNOWN'",
          [tenant, resource.id],
        )
      ).rowCount,
    );
    await writeFile(
      'docs/v2/evidence/joint-classroom/journey.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          session: session.id,
          resource: resource.id,
          publication,
          activity: activity.id,
          quiz: quiz.id,
          attempt: replay.attemptId,
          binding: replay.runtimeBindingId,
          checks: [
            'teacher UI pairs published targets',
            'atomic first entry and exact Attempt continuation',
            'text submit and real teacher grade publication',
            'native Quiz submit with pinned Attempt',
            'post-start ACL failure rolls back all facts',
            'concurrent publication replacement respects held SHARE lease',
            'no retake on replay; limit/end/version denial',
            'historical facts preserved; restricted ACL',
          ],
          completionFromHtml: false,
          nativeRuntimeEnabled: false,
        },
        null,
        2,
      ) + '\n',
    );
  } catch (error) {
    await sp
      .screenshot({ path: 'docs/v2/evidence/joint-classroom/failure-student.png' })
      .catch(() => {});
    await writeFile(
      'docs/v2/evidence/joint-classroom/failure-student.txt',
      await sp
        .locator('body')
        .innerText()
        .catch(() => ''),
    );
    throw error;
  } finally {
    await tc.close();
    await sc.close();
  }
  record(
    'Joint classroom: teacher configured fixed interactive + Text/Quiz activity; atomic entry/Attempt/runtime binding, repeated entry, original submission and grade publication, exact-context return',
  );
  record(
    'Joint classroom: ACL failure after start rolls back all facts; concurrent replacement waits for guarded content lease; wrong actor/publication, limit, ended classroom and historical provenance boundaries',
  );
}
