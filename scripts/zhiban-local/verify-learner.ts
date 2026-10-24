import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
import { loadLearner } from './learner';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  businessPool: import('pg').Pool;
};
interface Source extends Record<string, unknown> {
  kind: 'GRADE' | 'CONCEPT' | 'REMEDIATION';
  id: string;
  digest: string;
  snapshot: Record<string, unknown>;
  eligible: boolean;
}
interface Note extends Record<string, unknown> {
  id: string;
  revision: string;
  state: string;
  title: string;
  body: string;
  enrollment_id: string;
  content_revision: string;
}
interface Response {
  rows: Source[];
  next: string | null;
  id: string;
  revision: string;
  state: string;
  submissionId: string;
  record: Note;
  note: Note;
  enrollment: { id: string };
  evidence: {
    digest: string;
    fresh: boolean;
    citations: {
      kind: string;
      id: string;
      original: Record<string, unknown>;
      current: Record<string, unknown>;
      unchanged: boolean;
    }[];
  };
}
export async function verifyLearner(input: Input) {
  const {
      admin,
      businessPool,
      browser,
      http,
      origin,
      trial,
      tenant: t,
      actors: [teacher, student, outsider, foreign, manager, peer],
      record,
    } = input,
    o = trial.offeringId;
  const base = `/api/zhiban/learner/${t}/offerings/${o}`,
    learning = `/api/zhiban/learning/${t}/offerings/${o}`,
    assessment = `/api/zhiban/assessment/${t}/offerings/${o}`,
    concept = `/api/zhiban/concept/${t}/offerings/${o}`,
    remediation = `/api/zhiban/remediation/${t}/offerings/${o}`;
  const ok = async (path: string, actor: typeof teacher, c: unknown, key = v7()) => {
    const r = await http(path, actor, c, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Response;
  };
  const get = async (actor = teacher, q: Record<string, string> = {}) => {
    const r = await http(
      base + '?' + new URLSearchParams({ mode: actor === teacher ? 'TEACHER' : 'STUDENT', ...q }),
      actor,
    );
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Response;
  };
  const overview = await get(student);
  const enrollment = overview.enrollment.id;
  const ev = async (kind = 'ALL', q = '') =>
    get(teacher, { view: 'EVIDENCE', enrollment, kind, q });
  const note = async (id: string, actor = teacher) => get(actor, { view: 'NOTE', id });
  const dispute = async (id: string, actor = teacher) => get(actor, { view: 'DISPUTE', id });
  const ref = (s: Source) => ({ kind: s.kind, id: s.id, digest: s.digest });
  assert.equal(overview.rows.find((r) => r.kind === 'GRADE')?.count, 1);
  assert.equal((await get(teacher, { view: 'ROSTER' })).rows.length, 2);
  assert.equal(
    Number((await admin.query('SELECT count(*) FROM zhiban_learner.observations')).rows[0].count),
    0,
  );
  assert.equal((await http(base + '?mode=STUDENT&enrollment=' + enrollment, student)).status, 400);
  assert.equal((await http(base + '?mode=TEACHER&view=ROSTER')).status, 401);
  for (const actor of [student, peer, outsider, foreign, manager])
    assert.notEqual((await http(base + '?mode=TEACHER&view=ROSTER', actor)).status, 200);
  const a = await ok(learning, teacher, {
    type: 'CREATE_ACTIVITY',
    title: '画像证据旅程：测量与复核',
    prompt: '说明测量记录和验证步骤',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 3,
  });
  await ok(learning, teacher, { type: 'PUBLISH_ACTIVITY', id: a.id, revision: a.revision });
  const attempt = await ok(learning, student, {
      type: 'START_ATTEMPT',
      id: a.id,
      expectedVersion: '1',
    }),
    sub = await ok(learning, student, {
      type: 'SUBMIT',
      id: attempt.id,
      revision: attempt.revision,
      answer: 'ANSWER_MUST_NOT_ENTER_LEARNER_PROFILE：只给出推断。',
    }),
    grade = await ok(assessment, teacher, {
      type: 'SAVE_GRADE',
      submissionId: sub.submissionId,
      revision: null,
      score: '40',
      maxScore: '100',
      feedback: '评分草稿不能进入画像。',
    });
  assert.equal((await ev('GRADE', '画像证据旅程')).rows.length, 0);
  await ok(assessment, teacher, {
    type: 'PUBLISH_GRADE',
    submissionId: sub.submissionId,
    revision: grade.revision,
  });
  const gradeSource = (await ev('GRADE', '画像证据旅程')).rows[0];
  assert.ok(gradeSource);
  assert.equal(gradeSource.snapshot.scorePoints, 4000);
  const cp = await http(
    concept + '?mode=TEACHER&view=SOURCES&q=' + encodeURIComponent('画像证据旅程'),
    teacher,
  );
  assert.equal(cp.status, 200);
  const cs = (cp.json as { rows: Record<string, unknown>[] }).rows[0];
  const correction = await ok(concept, teacher, {
    type: 'CREATE_CORRECTION',
    publicationId: cs.publication_id,
    questionId: '',
    expectedDigest: cs.digest,
    concept: '观察事实和推断',
    explanation: '请区分这次测量观察和推断。',
    guidance: '列出记录后再验证。',
    privateNote: 'PRIVATE_CONCEPT_MUST_NOT_ENTER_PROFILE',
  });
  assert.equal((await ev('CONCEPT')).rows.length, 0, 'unpublished concept draft excluded');
  const cd = await http(concept + '?mode=TEACHER&view=DETAIL&id=' + correction.id, teacher);
  assert.equal(cd.status, 200);
  await ok(concept, teacher, {
    type: 'PUBLISH_CORRECTION',
    id: correction.id,
    revision: correction.revision,
    expectedDigest: (cd.json as { current: { digest: string } }).current.digest,
  });
  assert.equal((await ev('CONCEPT')).rows.length, 1);
  const pending = await ok(learning, teacher, {
    type: 'CREATE_ACTIVITY',
    title: '画像支持来源',
    prompt: '核查观察',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 2,
  });
  await ok(learning, teacher, {
    type: 'PUBLISH_ACTIVITY',
    id: pending.id,
    revision: pending.revision,
  });
  const follow = await ok(`/api/zhiban/analytics/${t}/offerings/${o}/followup-cases`, teacher, {
    type: 'CREATE_CASE',
    activityId: pending.id,
    version: 1,
    membershipId: student.member,
    body: 'PRIVATE_FOLLOWUP_MUST_NOT_ENTER_PROFILE',
  });
  const plan = await ok(remediation, teacher, {
    type: 'ASSIGN_PLAN',
    caseId: follow.id,
    revision: follow.revision,
    title: '画像支持：复核安排',
    goal: '逐项补全观察记录，再复核。',
    dueAt: null,
    tasks: [{ activityId: a.id, version: 1 }],
  });
  const pd = await http(remediation + '?mode=STUDENT&id=' + plan.id, student);
  assert.equal(pd.status, 200);
  const task = (pd.json as { tasks: { id: string }[] }).tasks[0];
  await ok(remediation, student, {
    type: 'REPORT_TASK',
    id: plan.id,
    revision: plan.revision,
    taskId: task.id,
    status: 'READY_FOR_REVIEW',
    body: 'SELF_REPORT_IS_NOT_FORMAL_PROOF',
  });
  const evidence = await ev();
  assert.ok(evidence.rows.some((r) => r.kind === 'REMEDIATION'));
  assert.equal(JSON.stringify(evidence).includes('PRIVATE_'), false);
  assert.equal(JSON.stringify(evidence).includes('SELF_REPORT_'), false);
  assert.equal(JSON.stringify(evidence).includes('ANSWER_MUST_'), false);
  const combined = await ok(base, teacher, {
    type: 'CREATE_OBSERVATION',
    enrollmentId: enrollment,
    title: '多来源教师观察草稿',
    body: '本次正式表现、教师概念判断与补救安排分别引用，不混成系统掌握。',
    confidence: 'LIMITED',
    evidence: ['GRADE', 'CONCEPT', 'REMEDIATION'].map((kind) =>
      ref(
        evidence.rows.find(
          (r) => r.kind === kind && (kind !== 'GRADE' || r.id === gradeSource.id),
        )!,
      ),
    ),
  });
  const tc = await browser.newContext();
  await tc.addCookies([
    {
      name: teacher.cookie!.split('=')[0],
      value: teacher.cookie!.split('=').slice(1).join('='),
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const page = await tc.newPage();
  await page.goto(`${origin}/zhiban/teacher/courses/${trial.courseId}?space=${t}&offering=${o}`);
  await page.getByRole('link', { name: '学习证据画像', exact: true }).click();
  await page.getByLabel('搜索本班学生', { exact: true }).fill(student.member);
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await page.getByRole('button', { name: '查看证据画像', exact: true }).click();
  await page.getByRole('button', { name: '来源证据', exact: true }).click();
  await page.getByLabel('证据类型', { exact: true }).selectOption('GRADE');
  await page.getByLabel('搜索来源或观察标题', { exact: true }).fill('画像证据旅程');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  await page.getByRole('button', { name: '引用撰写学习观察', exact: true }).click();
  await page.getByLabel('学习观察标题', { exact: true }).fill('本次复核依据仍需补充');
  await page
    .getByLabel('给学生的学习观察', { exact: true })
    .fill('这次正式记录的复核依据较少，建议先逐项列出测量记录。仅针对本次表现，不能代表整体能力。');
  await page.getByLabel('教师注明的证据充分程度', { exact: true }).selectOption('LIMITED');
  const reqP = page.waitForRequest(
      (r) => new URL(r.url()).pathname === base && r.method() === 'POST',
    ),
    resP = page.waitForResponse(
      (r) => new URL(r.url()).pathname === base && r.request().method() === 'POST',
    );
  await page.getByRole('button', { name: '保存画像草稿', exact: true }).click();
  const req = await reqP,
    res = await resP;
  assert.equal(res.status(), 200);
  const draft = (await res.json()) as Response;
  await expect(page.getByText('教师草稿 · 版本 1', { exact: true })).toBeVisible();
  const key = req.headers()['x-zhiban-command'];
  assert.equal((await ok(base, teacher, req.postDataJSON(), key)).id, draft.id);
  assert.equal(
    (
      await http(base, teacher, { ...req.postDataJSON(), title: '不同内容' }, 'POST', {
        'x-zhiban-command': key,
      })
    ).status,
    409,
  );
  assert.equal((await get(student, { view: 'NOTES' })).rows.length, 0);
  assert.equal((await http(base + '?mode=STUDENT&view=NOTE&id=' + draft.id, student)).status, 404);
  assert.equal(
    (await http(base, teacher, { ...req.postDataJSON(), dimensions: [100] })).status,
    400,
  );
  let n = await note(draft.id);
  const publish = {
      type: 'PUBLISH_OBSERVATION',
      id: draft.id,
      revision: n.record.revision,
      expectedDigest: n.evidence.digest,
    },
    publishKey = v7();
  assert.equal(
    (await http(base, teacher, publish, 'POST', { 'x-zhiban-csrf': 'bad' })).status,
    403,
  );
  await admin.query('REVOKE INSERT ON zhiban_learner.events FROM zhiban_academic_runtime');
  try {
    assert.equal(
      (await http(base, teacher, publish, 'POST', { 'x-zhiban-command': publishKey })).status,
      503,
    );
  } finally {
    await admin.query('GRANT INSERT ON zhiban_learner.events TO zhiban_academic_runtime');
  }
  assert.equal((await note(draft.id)).record.state, 'DRAFT');
  assert.equal(await loadLearner(businessPool), true);
  const publishReq = page.waitForRequest(
    (r) => new URL(r.url()).pathname === base && r.method() === 'POST',
  );
  await page.getByRole('button', { name: '发布学习观察给学生', exact: true }).click();
  const publishedCommand = await publishReq;
  const actualPublishKey = publishedCommand.headers()['x-zhiban-command'];
  await expect(page.getByText('已发布学习观察 · 版本 2', { exact: true })).toBeVisible();
  n = await note(draft.id, student);
  assert.equal(n.rows.length, 1);
  assert.equal(n.evidence.fresh, true);
  assert.equal((await http(base + '?mode=STUDENT&view=NOTE&id=' + draft.id, peer)).status, 404);
  const sc = await browser.newContext();
  await sc.addCookies([
    {
      name: student.cookie!.split('=')[0],
      value: student.cookie!.split('=').slice(1).join('='),
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ]);
  const sp = await sc.newPage();
  await sp.goto(
    `${origin}/zhiban/student/courses/${trial.courseId}/learning-profile?space=${t}&offering=${o}#note-${draft.id}`,
  );
  await sp
    .getByLabel('我认为需要纠正的问题', { exact: true })
    .fill('本次分数可能更正，请不要把旧成绩当成当前依据。');
  await sp
    .getByLabel('我希望如何纠正或补充', { exact: true })
    .fill('希望核对更正后的正式成绩，并修订这条观察。');
  const disputeRes = sp.waitForResponse(
    (r) => new URL(r.url()).pathname === base && r.request().method() === 'POST',
  );
  await sp.getByRole('button', { name: '提交本人纠错', exact: true }).click();
  const openedRes = await disputeRes;
  assert.equal(openedRes.status(), 200);
  const opened = (await openedRes.json()) as Response;
  await expect(sp.getByRole('heading', { name: '本人纠错详情', exact: true })).toBeVisible();
  assert.equal(
    (
      await http(base, student, {
        type: 'OPEN_DISPUTE',
        id: draft.id,
        revision: '2',
        body: '第二份重复请求',
        desired: '只保留一个待处理请求',
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await http(base, peer, {
        type: 'APPEND_DISPUTE',
        id: opened.id,
        revision: '1',
        body: '不属于本人',
        desired: '不可访问',
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await http(base, student, {
        type: 'RESOLVE_DISPUTE',
        id: opened.id,
        revision: '1',
        noteRevision: '2',
        outcome: 'WITHDRAW',
        response: '学生不能代教师处理',
      })
    ).status,
    403,
  );
  const gradeRev = (
    await admin.query(
      'SELECT revision::text FROM zhiban_assessment.grades WHERE tenant_id=$1 AND submission_id=$2',
      [t, sub.submissionId],
    )
  ).rows[0];
  await ok(assessment, teacher, {
    type: 'CORRECT_GRADE',
    submissionId: sub.submissionId,
    revision: gradeRev.revision,
    score: '80',
    maxScore: '100',
    feedback: '正式复核后更正。',
    reason: '本地画像来源变化验证。',
  });
  const combinedChanged = await note(combined.id);
  assert.equal(combinedChanged.evidence.fresh, false);
  assert.equal(
    (
      await http(base, teacher, {
        type: 'PUBLISH_OBSERVATION',
        id: combined.id,
        revision: combinedChanged.record.revision,
        expectedDigest: combinedChanged.evidence.digest,
      })
    ).status,
    409,
  );
  n = await note(draft.id);
  assert.equal(n.evidence.fresh, false);
  assert.equal(n.evidence.citations[0].original.scorePoints, 4000);
  assert.equal(n.evidence.citations[0].unchanged, false);
  let d = await dispute(opened.id);
  assert.equal(
    (
      await http(base, teacher, {
        type: 'RESOLVE_DISPUTE',
        id: opened.id,
        revision: d.record.revision,
        noteRevision: d.note.revision,
        outcome: 'KEEP',
        expectedDigest: d.evidence.digest,
        response: '已经变化的引用不能保留为当前依据。',
      })
    ).status,
    409,
  );
  const newGrade = (await ev('GRADE', '画像证据旅程')).rows[0],
    replacement = {
      title: '本次正式表现已复核更正',
      body: '正式成绩已更正为80分；这条观察改为关注后续复核步骤，原40分只保留在旧依据历史中。',
      confidence: 'SUPPORTED',
      evidence: [ref(newGrade)],
    };
  const revise = {
    type: 'RESOLVE_DISPUTE',
    id: opened.id,
    revision: d.record.revision,
    noteRevision: d.note.revision,
    outcome: 'REVISE',
    response: '采纳本人纠错，核对正式更正并修订公开观察。',
    replacement,
  };
  // Cross-context failure cut: observation revision and citations cannot outlive a failed dispute audit.
  await admin.query('REVOKE INSERT ON zhiban_learner.dispute_events FROM zhiban_academic_runtime');
  try {
    assert.equal((await http(base, teacher, revise)).status, 503);
  } finally {
    await admin.query('GRANT INSERT ON zhiban_learner.dispute_events TO zhiban_academic_runtime');
  }
  assert.equal((await note(draft.id)).record.revision, '2');
  assert.equal((await dispute(opened.id)).record.state, 'OPEN');
  assert.equal(
    Number(
      (
        await admin.query(
          'SELECT count(*) FROM zhiban_learner.citations WHERE tenant_id=$1 AND note_id=$2 AND revision>1',
          [t, draft.id],
        )
      ).rows[0].count,
    ),
    0,
  );
  assert.equal(await loadLearner(businessPool), true);
  // Student supplement and teacher resolution compare the same request revision.
  const raced = await Promise.all([
    http(base, student, {
      type: 'APPEND_DISPUTE',
      id: opened.id,
      revision: d.record.revision,
      body: '补充：请以正式更正发布为准。',
      desired: '保存原说明和修订历史。',
    }),
    http(base, teacher, revise),
  ]);
  assert.deepEqual(raced.map((r) => r.status).sort(), [200, 409]);
  d = await dispute(opened.id);
  if (d.record.state === 'OPEN')
    await ok(base, teacher, {
      ...revise,
      revision: d.record.revision,
      noteRevision: d.note.revision,
    });
  d = await dispute(opened.id, student);
  assert.equal(d.record.state, 'RESOLVED');
  assert.equal(d.note.title, replacement.title);
  assert.equal(d.evidence.fresh, true);
  assert.equal(JSON.stringify(d).includes('PRIVATE_'), false);
  assert.equal(JSON.stringify(d).includes('ANSWER_MUST_'), false);
  await sp.getByRole('button', { name: '刷新纠错与当前观察', exact: true }).click();
  await expect(sp.getByText(/已处理 · 请求版本/)).toBeVisible();
  await expect(sp.getByText(replacement.body, { exact: true })).toBeVisible();
  await sp.screenshot({ path: 'docs/v2/evidence/learner/student-corrected.png' });
  // Another request may be kept with an explicit current-evidence explanation, then withdrawn outside and acknowledged.
  n = await note(draft.id, student);
  const second = await ok(base, student, {
    type: 'OPEN_DISPUTE',
    id: draft.id,
    revision: n.record.revision,
    body: '希望补充观察范围。',
    desired: '确认仅针对本次记录。',
  });
  d = await dispute(second.id);
  await ok(base, teacher, {
    type: 'RESOLVE_DISPUTE',
    id: second.id,
    revision: d.record.revision,
    noteRevision: d.note.revision,
    outcome: 'KEEP',
    expectedDigest: d.evidence.digest,
    response: '该观察仅针对这次正式记录，不作整体能力判断，保留当前文字。',
  });
  const third = await ok(base, student, {
    type: 'OPEN_DISPUTE',
    id: draft.id,
    revision: d.note.revision,
    body: '再次请求撤回该观察。',
    desired: '不继续作为当前学习判断。',
  });
  n = await note(draft.id);
  await ok(base, teacher, {
    type: 'WITHDRAW_OBSERVATION',
    id: draft.id,
    revision: n.record.revision,
    body: '教师先行撤回观察，待确认本人请求。',
  });
  d = await dispute(third.id);
  await ok(base, teacher, {
    type: 'RESOLVE_DISPUTE',
    id: third.id,
    revision: d.record.revision,
    noteRevision: d.note.revision,
    outcome: 'WITHDRAW',
    response: '确认该观察已撤回，本人纠错处理结束。',
  });
  await page.goto(
    `${origin}/zhiban/teacher/courses/${trial.courseId}/learning-profile?space=${t}&offering=${o}#dispute-${third.id}`,
  );
  await expect(page.getByText('已撤回学习观察 · 版本 4', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'docs/v2/evidence/learner/teacher-withdrawn.png' });
  // Public revisions also require the receiver's current STUDENT role, not just an Enrollment fact.
  const peerEn = (
    await admin.query(
      "SELECT id FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE'",
      [t, o, peer.member],
    )
  ).rows[0].id;
  const peerAttempt = await ok(learning, peer, {
      type: 'START_ATTEMPT',
      id: a.id,
      expectedVersion: '1',
    }),
    peerSub = await ok(learning, peer, {
      type: 'SUBMIT',
      id: peerAttempt.id,
      revision: peerAttempt.revision,
      answer: '合成授权反向验证',
    }),
    peerGrade = await ok(assessment, teacher, {
      type: 'SAVE_GRADE',
      submissionId: peerSub.submissionId,
      revision: null,
      score: '10',
      maxScore: '100',
      feedback: '合成证据',
    });
  await ok(assessment, teacher, {
    type: 'PUBLISH_GRADE',
    submissionId: peerSub.submissionId,
    revision: peerGrade.revision,
  });
  const peerEv = await get(teacher, { view: 'EVIDENCE', enrollment: peerEn, kind: 'GRADE' }),
    peerDraft = await ok(base, teacher, {
      type: 'CREATE_OBSERVATION',
      enrollmentId: peerEn,
      title: '受限发布',
      body: '仅本次正式记录',
      confidence: 'LIMITED',
      evidence: [ref(peerEv.rows[0])],
    });
  const pn = await note(peerDraft.id);
  await admin.query('UPDATE zhiban_identity.role_grants SET revoked_at=$2 WHERE grant_id=$1', [
    peer.grant,
    Date.now(),
  ]);
  assert.equal(
    (
      await http(base, teacher, {
        type: 'PUBLISH_OBSERVATION',
        id: peerDraft.id,
        revision: peerDraft.revision,
        expectedDigest: pn.evidence.digest,
      })
    ).status,
    403,
  );
  for (const table of ['citations', 'events', 'dispute_events', 'commands'])
    assert.deepEqual(
      (
        await admin.query(
          "SELECT has_table_privilege('zhiban_academic_runtime',$1,'UPDATE') AS u,has_table_privilege('zhiban_academic_runtime',$1,'DELETE') AS d",
          ['zhiban_learner.' + table],
        )
      ).rows[0],
      { u: false, d: false },
    );
  assert.equal(
    (
      await admin.query(
        "SELECT has_column_privilege('zhiban_academic_runtime','zhiban_learner.disputes','original_snapshot','UPDATE') AS allowed",
      )
    ).rows[0].allowed,
    false,
  );
  const raw = await businessPool.connect();
  try {
    await raw.query('BEGIN');
    await raw.query("SELECT set_config('app.tenant_id',$1,true)", [v7()]);
    assert.equal((await raw.query('SELECT id FROM zhiban_learner.observations')).rows.length, 0);
  } finally {
    await raw.query('ROLLBACK');
    raw.release();
  }
  const er = (
    await admin.query(
      'SELECT revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND id=$2',
      [t, enrollment],
    )
  ).rows[0];
  await ok(`/api/zhiban/management/${t}/commands`, manager, {
    type: 'WITHDRAW',
    id: enrollment,
    revision: er.revision,
  });
  assert.equal((await http(base + '?mode=STUDENT', student)).status, 403);
  assert.equal(
    (
      await http(base, teacher, publishedCommand.postDataJSON(), 'POST', {
        'x-zhiban-command': actualPublishKey,
      })
    ).status,
    403,
  );
  assert.equal((await note(draft.id)).record.state, 'WITHDRAWN');
  const assignment = (
    await admin.query(
      "SELECT id,revision::text FROM zhiban_academic.assignments WHERE tenant_id=$1 AND offering_id=$2 AND membership_id=$3 AND status='ACTIVE'",
      [t, o, teacher.member],
    )
  ).rows[0];
  await ok(`/api/zhiban/management/${t}/commands`, manager, {
    type: 'END_TEACHER',
    id: assignment.id,
    revision: assignment.revision,
  });
  assert.equal((await http(base + '?mode=TEACHER&view=NOTE&id=' + draft.id, teacher)).status, 403);
  assert.equal(
    (await http(base, teacher, req.postDataJSON(), 'POST', { 'x-zhiban-command': key })).status,
    403,
  );
  await sc.close();
  await tc.close();
  await writeFile(
    'docs/v2/evidence/learner/journey.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        scope: 'FORMAL_PROVENANCE_TEACHER_OBSERVATIONS_SELF_DISPUTES_AND_ATOMIC_REVIEW',
        dimensions: 'REVIEW',
        automaticAbilityScores: false,
        automaticMastery: false,
        draftAndPrivateEvidenceExcluded: true,
        selfReportsNotFormalEvidence: true,
        originalCitationImmutable: true,
        changedEvidenceRejectsKeep: true,
        studentPrivateDraftIsolation: true,
        otherStudentDenied: true,
        commandReplayBound: true,
        publishAuditRollback: true,
        disputeRevisionAndCitationRollback: true,
        studentSupplementTeacherResolutionRace: true,
        reviseKeepWithdrawAndAlreadyWithdrawnAck: true,
        recipientRoleAndEnrollmentRechecked: true,
        teacherRevocationRechecked: true,
        tenantRlsAndImmutableAcl: true,
      },
      null,
      2,
    ) + '\n',
  );
  record(
    'P5 evidence-backed learning observations, self disputes, atomic teacher review and dimensions REVIEW PASS',
  );
}
