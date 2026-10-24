import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
import { interactiveExample } from '../../app/zhiban/local/interactive-client';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
};
type Evidence = {
  binding: { id: string; attemptId: string; publicationId: string; boundAt: number };
  events: { type: string; submissionVersion: number }[];
  attemptStatus: string;
  currentPublication: boolean;
  completion: null;
  score: null;
};
export async function verifyAttemptRuntime(input: Input) {
  const { admin, browser, actors, http, tenant, origin, trial, record } = input;
  const [teacher, student, outsider, , manager, peer] = actors;
  const base = `/api/zhiban/content/${tenant}/offerings/${trial.offeringId}`,
    learning = `/api/zhiban/learning/${tenant}/offerings/${trial.offeringId}`;
  const send = async (url: string, actor: typeof student, cmd: unknown) => {
    const r = await http(url, actor, cmd);
    assert.equal(r.status, 200, `${(cmd as { type: string }).type}: ${JSON.stringify(r.json)}`);
    return r.json as { id: string; revision: string; version: number };
  };
  const resources = async () =>
    (
      (await http(base, teacher)).json as {
        resources: { id: string; revision: string; publication: { id: string } }[];
      }
    ).resources;
  const created = await send(base, teacher, {
    type: 'CREATE_INTERACTIVE',
    title: '可信作答关联互动',
    html: interactiveExample,
  });
  await send(base, teacher, {
    type: 'PUBLISH_CONTENT',
    id: created.id,
    revision: (await resources()).find((r) => r.id === created.id)!.revision,
  });
  let resource = (await resources()).find((r) => r.id === created.id)!;
  const publication = resource.publication.id,
    rb = base + `/resources/${resource.id}`;
  const activity = await send(learning, teacher, {
    type: 'CREATE_ACTIVITY',
    title: '互动后的解释作答',
    prompt: '解释电压与电流关系。',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 3,
  });
  await send(learning, teacher, {
    type: 'PUBLISH_ACTIVITY',
    id: activity.id,
    revision: activity.revision,
  });
  const attempt = await send(learning, student, { type: 'START_ATTEMPT', id: activity.id });
  const other = await send(learning, peer, { type: 'START_ATTEMPT', id: activity.id });
  const bind = { type: 'BIND_ATTEMPT', attemptId: attempt.id, publicationId: publication };
  for (const a of [teacher, manager, outsider])
    assert.notEqual((await http(rb + '/runtime', a, bind)).status, 200);
  assert.equal((await http(rb + '/runtime', undefined, bind)).status, 401);
  assert.equal((await http(rb + '/runtime', peer, bind)).status, 403);
  assert.equal((await http(rb + '/runtime', student, { ...bind, attemptId: v7() })).status, 403);
  assert.equal(
    (await http(rb + '/runtime', student, { ...bind, attemptId: other.id })).status,
    403,
  );
  assert.equal(
    (await http(rb + '/runtime', student, { ...bind, publicationId: v7() })).status,
    409,
  );
  assert.equal(
    (await http(rb + '/runtime', student, { ...bind, score: 100, completed: true })).status,
    400,
  );
  assert.equal(
    (
      await http(rb + '/runtime', student, {
        type: 'RUNTIME_COMPLETED',
        attemptId: attempt.id,
        publicationId: publication,
      })
    ).status,
    400,
  );
  assert.equal(
    (await http(rb + '/runtime', student, bind, 'POST', { 'x-zhiban-csrf': '' })).status,
    403,
  );
  const results = await Promise.all([
    http(rb + '/runtime', student, bind),
    http(rb + '/runtime', student, bind),
  ]);
  results.forEach((r) => assert.equal(r.status, 200, JSON.stringify(r.json)));
  const evidence = results[0].json as Evidence;
  assert.deepEqual(results[1].json, evidence);
  assert.equal(evidence.binding.attemptId, attempt.id);
  assert.equal(evidence.binding.publicationId, publication);
  assert.deepEqual(
    evidence.events.map((e) => e.type),
    ['ATTEMPT_STARTED'],
  );
  assert.equal(evidence.completion, null);
  assert.equal(evidence.score, null);
  for (const a of [teacher, student])
    assert.equal((await http(rb + '/runtime?attempt=' + attempt.id, a)).status, 200);
  for (const a of [peer, manager, outsider])
    assert.equal((await http(rb + '/runtime?attempt=' + attempt.id, a)).status, 403);
  const [counts] = (
    await admin.query(
      'SELECT (SELECT count(*) FROM zhiban_content.attempt_runtime_bindings WHERE tenant_id=$1 AND attempt_id=$2) AS bindings,(SELECT count(*) FROM zhiban_learning.events WHERE tenant_id=$1 AND attempt_id=$2) AS events',
      [tenant, attempt.id],
    )
  ).rows;
  assert.equal(counts.bindings, '1');
  assert.equal(counts.events, '1');
  const course = (
    await admin.query(
      'SELECT course_id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
      [tenant, trial.offeringId],
    )
  ).rows[0].course_id;
  const sc = await browser.newContext(),
    tc = await browser.newContext();
  for (const [ctx, a] of [
    [sc, student],
    [tc, teacher],
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
  const sp = await sc.newPage(),
    tp = await tc.newPage();
  try {
    await sp.goto(origin + rb + '/player?publication=' + publication);
    await sp.getByText('作答关联与可信记录', { exact: true }).click();
    await sp.getByLabel('关联课程活动', { exact: true }).selectOption(activity.id);
    await sp.getByRole('button', { name: '开始／续接作答并关联', exact: true }).click();
    await expect(sp.getByRole('region', { name: '可信运行记录' })).toContainText('作答开始');
    const resumed = (
      await admin.query(
        'SELECT count(*) FROM zhiban_learning.attempts WHERE tenant_id=$1 AND activity_id=$2 AND membership_id=$3',
        [tenant, activity.id, student.member],
      )
    ).rows[0].count;
    assert.equal(resumed, '1');
    // Child postMessage does not have an ingestion handler, even with real IDs.
    await sp
      .frameLocator('iframe')
      .locator('body')
      .evaluate((_, payload) => parent.postMessage(payload, '*'), {
        type: 'RUNTIME_COMPLETED',
        attemptId: attempt.id,
        score: 100,
      });
    await expect(sp.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
    const submitted = await send(learning, student, {
      type: 'SUBMIT',
      id: attempt.id,
      revision: attempt.revision,
      answer: '电阻不变时，电流随电压成正比。',
    });
    await sp.getByRole('button', { name: '读取可信记录', exact: true }).click();
    await expect(sp.getByRole('region', { name: '可信运行记录' })).toContainText(
      '提交已记录 · 第 1 版',
    );
    const saved = (await http(rb + '/runtime?attempt=' + attempt.id, student)).json as Evidence;
    assert.equal(saved.attemptStatus, 'SUBMITTED');
    assert.equal(saved.score, null);
    assert.equal(saved.completion, null);
    await send(learning, student, {
      type: 'SUBMIT',
      id: attempt.id,
      revision: submitted.revision,
      answer: '补充：I=U/R。',
    });
    const resubmitted = (await http(rb + '/runtime?attempt=' + attempt.id, teacher))
      .json as Evidence;
    assert.deepEqual(
      resubmitted.events.map((e) => e.type),
      ['ATTEMPT_STARTED', 'SUBMISSION_RECORDED', 'SUBMISSION_RECORDED'],
    );
    assert.deepEqual(
      resubmitted.events
        .filter((e) => e.type === 'SUBMISSION_RECORDED')
        .map((e) => e.submissionVersion),
      [1, 2],
    );
    await tp.goto(origin + rb + '/player?publication=' + publication);
    await tp.getByText('作答关联与可信记录', { exact: true }).click();
    await tp.getByLabel('关联课程活动', { exact: true }).selectOption(activity.id);
    await tp.getByLabel('关联作答尝试', { exact: true }).selectOption(attempt.id);
    await tp.getByRole('button', { name: '读取可信记录', exact: true }).click();
    await expect(tp.getByRole('region', { name: '可信运行记录' })).toContainText(
      '提交已记录 · 第 2 版',
    );
    await tp.screenshot({ path: 'docs/v2/evidence/attempt-runtime/teacher.png' });
    await sp.getByRole('button', { name: '读取可信记录', exact: true }).click();
    await sp.screenshot({ path: 'docs/v2/evidence/attempt-runtime/student.png' });

    const quiz = await send(learning + '/quizzes', teacher, {
      type: 'CREATE_QUIZ',
      title: '互动关联测验',
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
    await sp.getByLabel('关联课程活动', { exact: true }).selectOption('');
    // Reload obtains the newly published Quiz; use the same visible host controls.
    await sp.reload();
    await sp.getByText('作答关联与可信记录', { exact: true }).click();
    await sp.getByLabel('关联课程活动', { exact: true }).selectOption(quiz.id);
    await sp.getByRole('button', { name: '开始／续接作答并关联', exact: true }).click();
    await expect(sp.getByRole('region', { name: '可信运行记录' })).toContainText('互动关联测验');
    const quizAttempt = (
      await admin.query(
        'SELECT id,revision::text FROM zhiban_learning.attempts WHERE tenant_id=$1 AND activity_id=$2 AND membership_id=$3',
        [tenant, quiz.id, student.member],
      )
    ).rows[0];
    await send(learning + '/quizzes', student, {
      type: 'SUBMIT_QUIZ',
      attemptId: quizAttempt.id,
      revision: quizAttempt.revision,
      answers: { q1: 'A' },
    });
    const quizFacts = (await http(rb + '/runtime?attempt=' + quizAttempt.id, student))
      .json as Evidence;
    assert.deepEqual(
      quizFacts.events.map((e) => e.type),
      ['ATTEMPT_STARTED', 'SUBMISSION_RECORDED'],
    );
    assert.equal(quizFacts.score, null);
    assert.ok(!JSON.stringify(quizFacts).includes('analysis'));
    assert.ok(!JSON.stringify(quizFacts).includes('answers'));

    assert.equal(
      (
        await http(learning + '/quizzes', student, {
          type: 'START_QUIZ_ATTEMPT',
          activityId: quiz.id,
          expectedVersion: '1',
        })
      ).status,
      409,
    );
    // Return to the original Attempt to check authorization changes on the mounted host.
    await sp.getByLabel('关联课程活动', { exact: true }).selectOption(activity.id);
    await sp.getByLabel('关联作答尝试', { exact: true }).selectOption(attempt.id);
    // New binding to an already-submitted attempt is rejected. Existing replay is safe.
    assert.equal((await http(rb + '/runtime', student, bind)).status, 200);
    assert.equal(
      (await http(rb + '/runtime', student, { ...bind, attemptId: other.id })).status,
      403,
    );

    const another = await send(base, teacher, {
      type: 'CREATE_INTERACTIVE',
      title: '禁止事后关联',
      html: interactiveExample,
    });
    const anotherDraft = (await resources()).find((r) => r.id === another.id)!;
    await send(base, teacher, {
      type: 'PUBLISH_CONTENT',
      id: another.id,
      revision: anotherDraft.revision,
    });
    const anotherPub = (await resources()).find((r) => r.id === another.id)!;
    assert.equal(
      (
        await http(base + '/resources/' + another.id + '/runtime', student, {
          ...bind,
          publicationId: anotherPub.publication.id,
        })
      ).status,
      409,
    );
    // Eligibility revoke is checked on every read and write, without deleting history.
    await admin.query(
      "UPDATE zhiban_academic.enrollments SET status='WITHDRAWN',revision=revision+1,valid_until=$4 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE'",
      [tenant, trial.offeringId, student.member, Date.now()],
    );
    assert.equal((await http(rb + '/runtime?attempt=' + attempt.id, student)).status, 403);
    assert.equal((await http(rb + '/runtime', student, bind)).status, 403);
    await expect(sp.locator('iframe')).toHaveCount(0, { timeout: 12000 });
    assert.equal((await http(rb + '/runtime?attempt=' + attempt.id, teacher)).status, 200);
    // Restore ONLY this disposable synthetic row for the remaining version checks.
    await admin.query(
      "UPDATE zhiban_academic.enrollments SET status='ACTIVE',revision=revision+1,valid_until=NULL WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3",
      [tenant, trial.offeringId, student.member],
    );
    resource = (await resources()).find((r) => r.id === created.id)!;
    await send(base, teacher, {
      type: 'PUBLISH_CONTENT',
      id: resource.id,
      revision: resource.revision,
    });
    const replaced = (await resources()).find((r) => r.id === created.id)!;
    assert.notEqual(replaced.publication.id, publication);
    assert.equal(
      (await http(rb + '/runtime', student, { ...bind, publicationId: replaced.publication.id }))
        .status,
      409,
    );

    const nextAttempt = await send(learning, student, {
      type: 'START_ATTEMPT',
      id: activity.id,
      expectedVersion: '1',
    });
    assert.notEqual(nextAttempt.id, attempt.id);
    assert.equal(
      (
        await http(rb + '/runtime', student, {
          ...bind,
          attemptId: nextAttempt.id,
          publicationId: replaced.publication.id,
        })
      ).status,
      200,
    );
    const historical = (await http(rb + '/runtime?attempt=' + attempt.id, student))
      .json as Evidence;
    assert.equal(historical.binding.publicationId, publication);
    assert.equal(historical.currentPublication, false);
    await send(base, teacher, {
      type: 'WITHDRAW_CONTENT',
      id: replaced.id,
      revision: replaced.revision,
    });
    assert.equal(
      (
        await http(rb + '/runtime', student, {
          ...bind,
          attemptId: other.id,
          publicationId: replaced.publication.id,
        })
      ).status,
      409,
    );
    assert.equal((await http(rb + '/runtime?attempt=' + attempt.id, student)).status, 200);
    await sp.goto(origin + rb + '/records');
    await sp.getByLabel('关联课程活动', { exact: true }).selectOption(activity.id);
    await sp.getByLabel('关联作答尝试', { exact: true }).selectOption(attempt.id);
    await sp.getByRole('button', { name: '读取可信记录', exact: true }).click();
    await expect(sp.getByRole('region', { name: '可信运行记录' })).toContainText('历史发布版本');
    await expect(sp.locator('iframe')).toHaveCount(0);
    await expect(sp.getByRole('button', { name: '关联所选尝试', exact: true })).toHaveCount(0);
    await sp.screenshot({ path: 'docs/v2/evidence/attempt-runtime/history.png' });

    await admin.query(
      "UPDATE zhiban_academic.assignments SET status='ENDED',valid_until=$4,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3",
      [tenant, trial.offeringId, teacher.member, Date.now()],
    );
    assert.equal((await http(rb + '/runtime?attempt=' + attempt.id, teacher)).status, 403);
    await admin.query(
      "UPDATE zhiban_academic.assignments SET status='ACTIVE',valid_until=NULL,revision=revision+1 WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3",
      [tenant, trial.offeringId, teacher.member],
    );
    // Composite FK rejects a mixed learner even for a privileged fixture writer.
    const checker = await admin.connect();
    try {
      await checker.query('BEGIN');
      await assert.rejects(
        checker.query(
          'UPDATE zhiban_content.attempt_runtime_bindings SET learner_membership_id=$2 WHERE tenant_id=$1 AND attempt_id=$3',
          [tenant, peer.member, attempt.id],
        ),
        (e: unknown) => (e as { code: string }).code === '23503',
      );
    } finally {
      await checker.query('ROLLBACK');
      checker.release();
    }
    await writeFile(
      'docs/v2/evidence/attempt-runtime/journey.json',
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          status: 'PASS',
          resource: created.id,
          activity: activity.id,
          attempt: attempt.id,
          binding: evidence.binding,
          studentCourse: `${origin}/zhiban/student/courses/${course}/coursework?space=${tenant}&offering=${trial.offeringId}`,
          facts: resubmitted.events,
          completion: null,
          score: null,
          nativeRuntimeEnabled: false,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    await sc.close();
    await tc.close();
  }
  // Database ACL: the Bridge login cannot directly mutate bindings, events or Attempts.
  const privileges = (
    await admin.query(
      "SELECT has_table_privilege('zhiban_bridge_runtime','zhiban_content.attempt_runtime_bindings','INSERT,UPDATE,DELETE') AS bindings,has_table_privilege('zhiban_bridge_runtime','zhiban_learning.events','INSERT,UPDATE,DELETE') AS events,has_table_privilege('zhiban_bridge_runtime','zhiban_learning.attempts','INSERT,UPDATE,DELETE') AS attempts",
    )
  ).rows[0];
  assert.deepEqual(privileges, { bindings: false, events: false, attempts: false });
  record(
    'Attempt Runtime: real composite Attempt/Enrollment/publication binding; concurrent replay, teacher/student source facts, submission/resubmission and browser journey',
  );
  record(
    'Attempt Runtime: owner/role/anonymous/unknown ID/version/closed payload negatives; revoke unmount, immutable generation replacement/withdrawal history and restricted SQL ACL; child messages never complete or grade',
  );
}
