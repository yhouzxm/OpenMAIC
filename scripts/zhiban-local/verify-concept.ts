import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { prepareTrial } from './prepare-trial';
import { loadConcept } from './concept';
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  businessPool: import('pg').Pool;
};
interface Evidence extends Record<string, unknown> {
  publication_id: string;
  question_id: string;
  digest: string;
  correction_id: string | null;
  activity_id: string;
  activity_type: string;
  enrollment_id: string;
  item_points: number;
  item_max: number;
  fresh: boolean;
}
interface R {
  id: string;
  revision: string;
  submissionId: string;
  rows: Evidence[];
  record: { revision: string; concept: string; state: string; evidence: Evidence };
  current: Evidence;
  latestResponseRevision: string;
  state: string;
}
export async function verifyConcept(input: Input) {
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
  const base = `/api/zhiban/concept/${t}/offerings/${o}`,
    quiz = `/api/zhiban/learning/${t}/offerings/${o}/quizzes`,
    assessment = `/api/zhiban/assessment/${t}/offerings/${o}`;
  const ok = async (path: string, actor: typeof teacher, c: unknown, key = v7()) => {
    const r = await http(path, actor, c, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as R;
  };
  const read = async (actor = teacher, args: Record<string, string> = {}) => {
    const r = await http(
      base +
        '?' +
        new URLSearchParams({
          mode: actor === teacher ? 'TEACHER' : 'STUDENT',
          ...(args.view === 'SOURCES' ? { q: '概念证据旅程' } : {}),
          ...args,
        }),
      actor,
    );
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as R;
  };
  const detail = async (id: string, actor = teacher) => await read(actor, { view: 'DETAIL', id });
  const content = {
    type: 'quiz',
    questions: [
      {
        id: 'q1',
        type: 'single',
        question: '观察证据与推断有什么区别？',
        options: [
          { value: 'A', label: '先记录观察，再核验推断' },
          { value: 'B', label: '一次猜测就是结论' },
        ],
        answer: ['A'],
        analysis: 'SECRET_KEY_ANALYSIS_ONLY_AFTER_ORIGINAL_RELEASE',
        points: 10,
      },
      { id: 'q2', type: 'short_answer', question: '说明复核观察的方法。', points: 10 },
    ],
  };
  const createQuiz = async (mode = 'ASSESSED') => {
    const a = await ok(quiz, teacher, {
      type: 'CREATE_QUIZ',
      title: '概念证据旅程：观察与推断 ' + mode,
      mode,
      content,
      deadlineAt: null,
      allowResubmit: true,
      maxAttempts: 3,
    });
    await ok(quiz, teacher, { type: 'PUBLISH_QUIZ', id: a.id, revision: a.revision });
    const attempt = await ok(quiz, student, {
      type: 'START_QUIZ_ATTEMPT',
      activityId: a.id,
      expectedVersion: '1',
    });
    const s = await ok(quiz, student, {
      type: 'SUBMIT_QUIZ',
      attemptId: attempt.id,
      revision: String(attempt.revision),
      answers: { q1: 'B', q2: '直接把推测当事实。' },
    });
    return { a, attempt, s };
  };
  const { a, s } = await createQuiz();
  assert.equal(
    (await read(teacher, { view: 'SOURCES' })).rows.length,
    0,
    'no unpublished score evidence',
  );
  const g = await ok(assessment, teacher, {
    type: 'SAVE_QUIZ_GRADE',
    submissionId: s.submissionId,
    gradeRevision: null,
    manualMarks: { q2: '2' },
    feedback: '正式发布后才可作为概念证据。',
  });
  assert.equal((await read(teacher, { view: 'SOURCES' })).rows.length, 0, 'draft grade excluded');
  await ok(assessment, teacher, {
    type: 'PUBLISH_GRADE',
    submissionId: s.submissionId,
    revision: g.revision,
  });
  const sources = await read(teacher, { view: 'SOURCES' });
  assert.equal(sources.rows.length, 2);
  assert.equal(JSON.stringify(sources).includes('SECRET_KEY'), false);
  assert.equal(JSON.stringify(sources).includes('analysis'), false);
  const source = sources.rows.find((r: Evidence) => r.question_id === 'q1');
  assert.ok(source);
  assert.equal(source.item_points, 0);
  assert.equal(source.item_max, 1000);
  assert.equal(
    Number((await admin.query('SELECT count(*) FROM zhiban_concept.corrections')).rows[0].count),
    0,
  );
  for (const actor of [student, peer, outsider, foreign, manager])
    assert.notEqual((await http(base + '?mode=TEACHER&view=SOURCES', actor)).status, 200);
  assert.equal((await http(base + '?mode=STUDENT&view=SOURCES', student)).status, 400);
  assert.equal((await http(base + '?mode=TEACHER')).status, 401);
  const cmd = {
    type: 'CREATE_CORRECTION',
    publicationId: source.publication_id,
    questionId: source.question_id,
    expectedDigest: source.digest,
    concept: '观察事实与推断的区分',
    explanation: '你将推测当作已观察的事实，请对照该次选项解释区别。',
    guidance: '用自己的话列出一个观察事实和一个待核验推断。',
    privateNote: 'PRIVATE_CONCEPT_NOTE_NOT_FOR_STUDENT',
  };
  assert.equal((await http(base, teacher, { ...cmd, membershipId: student.member })).status, 400);
  assert.equal((await http(base, teacher, cmd, 'POST', { 'x-zhiban-csrf': 'bad' })).status, 403);
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
  await page.getByRole('link', { name: '概念纠错', exact: true }).click();
  await page.getByRole('button', { name: '正式作答证据', exact: true }).click();
  await page.getByLabel('搜索概念、活动或学生', { exact: true }).fill('概念证据旅程');
  await page.getByRole('button', { name: '查询', exact: true }).click();
  // q1 appears before q2, both belong to the same formal publication and student.
  await page.getByRole('button', { name: '登记概念证据', exact: true }).first().click();
  await page.getByLabel('概念名称', { exact: true }).fill(cmd.concept);
  await page.getByLabel('给学生的纠错说明', { exact: true }).fill(cmd.explanation);
  await page.getByLabel('给学生的下一步建议', { exact: true }).fill(cmd.guidance);
  await page.getByLabel('教师私有依据说明', { exact: true }).fill(cmd.privateNote);
  const reqP = page.waitForRequest(
      (r) => new URL(r.url()).pathname === base && r.method() === 'POST',
    ),
    resP = page.waitForResponse(
      (r) => new URL(r.url()).pathname === base && r.request().method() === 'POST',
    );
  await page.getByRole('button', { name: '保存教师草稿', exact: true }).click();
  const req = await reqP,
    res = await resP;
  assert.equal(res.status(), 200);
  const correction = (await res.json()) as R;
  await expect(page.getByRole('heading', { name: '概念纠错详情', exact: true })).toBeVisible();
  const key = req.headers()['x-zhiban-command'];
  assert.equal((await ok(base, teacher, req.postDataJSON(), key)).id, correction.id);
  assert.equal((await http(base, teacher, cmd)).status, 409);
  assert.equal(
    (
      await http(base, teacher, { ...cmd, concept: '不相同载荷' }, 'POST', {
        'x-zhiban-command': key,
      })
    ).status,
    409,
  );
  assert.equal((await read(student)).rows.length, 0);
  assert.equal(
    (await http(base + `?mode=STUDENT&view=DETAIL&id=${correction.id}`, student)).status,
    404,
  );
  let d = await detail(correction.id);
  assert.equal(
    (
      await http(base, teacher, {
        type: 'PUBLISH_CORRECTION',
        id: correction.id,
        revision: correction.revision,
        expectedDigest: d.current.digest,
      })
    ).status,
    409,
    'quiz review must close first',
  );
  // Close through the original quiz command, no synthetic backdating or SQL bypass.
  const ar = (
    await admin.query(
      'SELECT revision::text FROM zhiban_learning.activities WHERE tenant_id=$1 AND id=$2',
      [t, a.id],
    )
  ).rows[0];
  await ok(quiz, teacher, { type: 'CLOSE_QUIZ_REVIEW', id: a.id, revision: ar.revision });
  d = await detail(correction.id);
  // Audit failure cannot leave a public header or a replay receipt behind.
  const publish = {
      type: 'PUBLISH_CORRECTION',
      id: correction.id,
      revision: correction.revision,
      expectedDigest: d.current.digest,
    },
    publishKey = v7();
  await admin.query('REVOKE INSERT ON zhiban_concept.events FROM zhiban_academic_runtime');
  try {
    assert.equal(
      (await http(base, teacher, publish, 'POST', { 'x-zhiban-command': publishKey })).status,
      503,
    );
  } finally {
    await admin.query('GRANT INSERT ON zhiban_concept.events TO zhiban_academic_runtime');
  }
  assert.equal((await detail(correction.id)).record.state, 'DRAFT');
  assert.equal((await read(student)).rows.length, 0);
  assert.equal(await loadConcept(businessPool), true);
  await page.getByRole('button', { name: '刷新当前证据', exact: true }).click();
  await page.getByLabel('教师纠错动作', { exact: true }).selectOption('PUBLISH_CORRECTION');
  await page.getByRole('button', { name: '保存教师处理', exact: true }).click();
  await expect(page.getByText('待补充／复核 · 版本 2', { exact: true })).toBeVisible();
  const sd = await detail(correction.id, student);
  assert.equal(sd.record.concept, cmd.concept);
  assert.equal(JSON.stringify(sd).includes('PRIVATE_CONCEPT'), false);
  assert.equal(sd.rows.length, 1);
  assert.equal(JSON.stringify(sd).includes('SECRET_KEY'), false);
  assert.equal(
    (await http(base + `?mode=STUDENT&view=DETAIL&id=${correction.id}`, peer)).status,
    404,
  );
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
    `${origin}/zhiban/student/courses/${trial.courseId}/concepts?space=${t}&offering=${o}#correction-${correction.id}`,
  );
  await sp
    .getByLabel('我的补充解释或问题', { exact: true })
    .fill('观察事实是我记录的现象；推断需再设计测量或重复观察来验证。');
  await sp.getByRole('button', { name: '提交补充解释', exact: true }).click();
  await expect(
    sp.getByRole('heading', { name: '学生补充解释 · 版本 3', exact: true }),
  ).toBeVisible();
  await sp.screenshot({ path: 'docs/v2/evidence/concept/student-response.png' });
  d = await detail(correction.id);
  const respond = {
      type: 'RESPOND',
      id: correction.id,
      revision: d.record.revision,
      body: '并发补充解释不能覆盖教师评估。',
    },
    assess = {
      type: 'ASSESS',
      id: correction.id,
      revision: d.record.revision,
      expectedDigest: d.current.digest,
      responseRevision: d.latestResponseRevision,
      outcome: 'NEEDS_MORE',
      body: '请再补充具体的验证步骤。',
      privateNote: 'PRIVATE_CONCEPT_REVIEW',
    };
  const race = await Promise.all([http(base, student, respond), http(base, teacher, assess)]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  d = await detail(correction.id);
  assert.equal(
    (await http(base, teacher, { ...assess, revision: d.record.revision, responseRevision: '1' }))
      .status,
    409,
  );
  // Grade correction changes current source but never rewrites the original evidence.
  const gr = (
    await admin.query(
      'SELECT revision::text FROM zhiban_assessment.grades WHERE tenant_id=$1 AND submission_id=$2',
      [t, s.submissionId],
    )
  ).rows[0];
  await ok(assessment, teacher, {
    type: 'CORRECT_QUIZ_GRADE',
    submissionId: s.submissionId,
    revision: gr.revision,
    marks: { q1: '5', q2: '5' },
    overrides: { q1: '题意复核后部分给分' },
    feedback: '复核后更正正式评分。',
    reason: '保留原始评分与更正来源。',
  });
  const stale = d.current.digest;
  d = await detail(correction.id);
  assert.equal(d.record.evidence.item_points, 0);
  assert.equal(d.current.fresh, false);
  assert.notEqual(d.current.digest, stale);
  assert.equal(
    (
      await http(base, teacher, {
        type: 'REVISE_FEEDBACK',
        id: correction.id,
        revision: d.record.revision,
        expectedDigest: stale,
        ...{
          concept: cmd.concept,
          explanation: cmd.explanation,
          guidance: cmd.guidance,
          privateNote: cmd.privateNote,
        },
        reason: '旧事实不能继续改写为当前依据。',
      })
    ).status,
    409,
  );
  await page.getByRole('button', { name: '刷新当前证据', exact: true }).click();
  await expect(
    page.getByText('待补充／复核 · 版本 ' + d.record.revision, { exact: true }),
  ).toBeVisible();
  await page.getByLabel('教师纠错动作', { exact: true }).selectOption('ASSESS');
  await page.getByLabel('教师复核判断', { exact: true }).selectOption('RESOLVED');
  await page
    .getByLabel('给学生的复核／撤回说明', { exact: true })
    .fill('补充解释已区分观察与推断，本次概念澄清结束；正式成绩按原评分记录回看。');
  await page.getByLabel('教师私有依据说明', { exact: true }).fill('PRIVATE_CONCEPT_RESOLUTION');
  await page.getByRole('button', { name: '保存教师处理', exact: true }).click();
  try {
    await expect(page.getByText(/教师确认本次已纠正 · 版本/)).toBeVisible();
  } catch (error) {
    await writeFile(
      'docs/v2/evidence/concept/ui-failure.txt',
      await page.locator('main').innerText(),
    );
    await page.screenshot({ path: 'docs/v2/evidence/concept/ui-failure.png' });
    throw error;
  }
  await page.screenshot({ path: 'docs/v2/evidence/concept/teacher-assessment.png' });
  d = await detail(correction.id);
  assert.equal(d.record.state, 'RESOLVED');
  assert.equal(
    (
      await http(base, student, {
        type: 'RESPOND',
        id: correction.id,
        revision: d.record.revision,
        body: '已结束不能再补充',
      })
    ).status,
    409,
  );
  const retracted = await ok(base, teacher, {
    type: 'RETRACT',
    id: correction.id,
    revision: d.record.revision,
    body: '复核题意后撤回此前概念判断，请勿将历史说明当作当前要求。',
    privateNote: 'PRIVATE_RETRACTION',
  });
  assert.equal(retracted.state, 'RETRACTED');
  const history = await detail(correction.id, student);
  assert.equal(history.record.state, 'RETRACTED');
  assert.equal(JSON.stringify(history).includes('PRIVATE_'), false);
  // A formal text source reuses its original manual grade, without pretending it is an objective diagnosis.
  const learning = `/api/zhiban/learning/${t}/offerings/${o}`;
  const text = await ok(learning, teacher, {
    type: 'CREATE_ACTIVITY',
    title: '文本证据',
    prompt: '解释验证方法',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 2,
  });
  await ok(learning, teacher, { type: 'PUBLISH_ACTIVITY', id: text.id, revision: text.revision });
  const ta = await ok(learning, student, {
      type: 'START_ATTEMPT',
      id: text.id,
      expectedVersion: '1',
    }),
    ts = await ok(learning, student, {
      type: 'SUBMIT',
      id: ta.id,
      revision: ta.revision,
      answer: '未区分事实和推断。',
    }),
    tg = await ok(assessment, teacher, {
      type: 'SAVE_GRADE',
      submissionId: ts.submissionId,
      revision: null,
      score: '2',
      maxScore: '10',
      feedback: '人工评分',
    });
  await ok(assessment, teacher, {
    type: 'PUBLISH_GRADE',
    submissionId: ts.submissionId,
    revision: tg.revision,
  });
  const textSource = (await read(teacher, { view: 'SOURCES', q: '文本证据' })).rows.find(
    (r: Evidence) => r.activity_type === 'TEXT_RESPONSE',
  );
  assert.ok(textSource && textSource.question_id === '');
  const textDraft = await ok(base, teacher, {
    ...cmd,
    publicationId: textSource.publication_id,
    questionId: '',
    expectedDigest: textSource.digest,
  });
  let td = await detail(textDraft.id);
  const textPublishKey = v7();
  const textPublishCommand = {
    type: 'PUBLISH_CORRECTION',
    id: textDraft.id,
    revision: textDraft.revision,
    expectedDigest: td.current.digest,
  };
  const pubText = await ok(base, teacher, textPublishCommand, textPublishKey);
  td = await detail(textDraft.id);
  await ok(base, teacher, {
    type: 'REVISE_FEEDBACK',
    id: textDraft.id,
    revision: pubText.revision,
    expectedDigest: td.current.digest,
    concept: '观察与推断（教师更正）',
    explanation: '更正后的公开说明',
    guidance: '先列观察，再验证推断',
    privateNote: 'PRIVATE_REVISION',
    reason: '初次说明不够准确。',
  });
  assert.equal((await detail(textDraft.id, student)).record.concept, '观察与推断（教师更正）');
  const practice = await createQuiz('PRACTICE');
  assert.ok(
    !(await read(teacher, { view: 'SOURCES' })).rows.some(
      (r: Evidence) => r.activity_id === practice.a.id,
    ),
  );
  // Immutable histories, tenant RLS and recipient/teacher membership boundary.
  for (const table of ['events', 'commands']) {
    const acl = (
      await admin.query(
        "SELECT has_table_privilege('zhiban_academic_runtime',$1,'UPDATE') AS u,has_table_privilege('zhiban_academic_runtime',$1,'DELETE') AS d",
        ['zhiban_concept.' + table],
      )
    ).rows[0];
    assert.deepEqual(acl, { u: false, d: false });
  }
  assert.equal(
    (
      await admin.query(
        "SELECT has_column_privilege('zhiban_academic_runtime','zhiban_concept.corrections','evidence','UPDATE') AS allowed",
      )
    ).rows[0].allowed,
    false,
  );
  const raw = await businessPool.connect();
  try {
    await raw.query('BEGIN');
    await raw.query("SELECT set_config('app.tenant_id',$1,true)", [v7()]);
    assert.equal((await raw.query('SELECT id FROM zhiban_concept.corrections')).rows.length, 0);
  } finally {
    await raw.query('ROLLBACK');
    raw.release();
  }
  // Dedicated negative fixture: a current Enrollment alone must not authorize publication to a recipient whose STUDENT grant was revoked.
  const peerAttempt = await ok(learning, peer, {
    type: 'START_ATTEMPT',
    id: text.id,
    expectedVersion: '1',
  });
  const peerSubmission = await ok(learning, peer, {
    type: 'SUBMIT',
    id: peerAttempt.id,
    revision: peerAttempt.revision,
    answer: '合成接收者授权反向验证。',
  });
  const peerGrade = await ok(assessment, teacher, {
    type: 'SAVE_GRADE',
    submissionId: peerSubmission.submissionId,
    revision: null,
    score: '1',
    maxScore: '10',
    feedback: '仅用于本地授权验证。',
  });
  await ok(assessment, teacher, {
    type: 'PUBLISH_GRADE',
    submissionId: peerSubmission.submissionId,
    revision: peerGrade.revision,
  });
  const peerSource = (await read(teacher, { view: 'SOURCES', q: '文本证据' })).rows.find(
    (r) => r.membership_id === peer.member,
  );
  assert.ok(peerSource);
  const peerDraft = await ok(base, teacher, {
    ...cmd,
    explanation: '解'.repeat(2000),
    guidance: '练'.repeat(2000),
    privateNote: '证'.repeat(2000),
    publicationId: peerSource.publication_id,
    questionId: '',
    expectedDigest: peerSource.digest,
  });
  const peerDetail = await detail(peerDraft.id);
  await admin.query('UPDATE zhiban_identity.role_grants SET revoked_at=$2 WHERE grant_id=$1', [
    peer.grant,
    Date.now(),
  ]);
  assert.equal(
    (
      await http(base, teacher, {
        type: 'PUBLISH_CORRECTION',
        id: peerDraft.id,
        revision: peerDraft.revision,
        expectedDigest: peerDetail.current.digest,
      })
    ).status,
    403,
  );
  assert.equal((await detail(peerDraft.id)).record.state, 'DRAFT');
  const en = (
    await admin.query(
      'SELECT id,revision::text FROM zhiban_academic.enrollments WHERE tenant_id=$1 AND id=$2',
      [t, source.enrollment_id],
    )
  ).rows[0];
  await ok(`/api/zhiban/management/${t}/commands`, manager, {
    type: 'WITHDRAW',
    id: en.id,
    revision: en.revision,
  });
  assert.equal((await http(base + '?mode=STUDENT', student)).status, 403);
  assert.equal(
    (await http(base, teacher, textPublishCommand, 'POST', { 'x-zhiban-command': textPublishKey }))
      .status,
    403,
    'successful publish replay must recheck original Enrollment',
  );
  assert.equal(
    (await http(base + `?mode=STUDENT&view=DETAIL&id=${correction.id}`, student)).status,
    403,
  );
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
  assert.equal((await http(base + '?mode=TEACHER', teacher)).status, 403);
  assert.equal(
    (await http(base, teacher, req.postDataJSON(), 'POST', { 'x-zhiban-command': key })).status,
    403,
  );
  await sc.close();
  await tc.close();
  await writeFile(
    'docs/v2/evidence/concept/journey.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        scope:
          'FORMAL_QUIZ_AND_TEXT_EVIDENCE_EXPLICIT_PUBLICATION_RESPONSE_HUMAN_ASSESSMENT_AND_RETRACTION',
        draftExcluded: true,
        answerKeysNeverSelected: true,
        quizOriginalReviewReleaseRequired: true,
        teacherDraftPrivate: true,
        privateNotesNotReturnedToStudent: true,
        otherStudentDenied: true,
        originalEvidenceImmutable: true,
        formalCorrectionInvalidatesFreshness: true,
        responseAssessmentRevisionRace: true,
        publicationAuditRollback: true,
        commandIdempotency: true,
        textFeedbackVersioned: true,
        withdrawAndTeacherRevocation: true,
        recipientRoleRevocationPreventsPublication: true,
        chineseFieldLimitsAcceptedWithoutBodyTruncation: true,
        successfulPublishReplayRechecksOriginalEnrollment: true,
        rlsAndAcl: true,
        automaticMasteryOrGradeChange: false,
        automaticNotification: false,
      },
      null,
      2,
    ) + '\n',
  );
  record(
    'P5 formal concept evidence, teacher publication, student explanation, assessment/retraction and guarded concurrency PASS',
  );
}
