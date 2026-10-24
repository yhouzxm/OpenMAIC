/** Owned synthetic PG16, actual Identity/HTTP, real native model separately from controlled fault injection. */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { Pool, QueryResultRow } from 'pg';
import type { prepareTrial } from './prepare-trial';
import type { AcademicStore } from '../../lib/zhiban/application/academic/service';
import type { IdentityAuthentication } from '../../lib/zhiban/infrastructure/identity/composition/authentication';
import { AutoGradeWorker } from '../../lib/zhiban/infrastructure/autograde/worker';
import { nativeAutoEngine } from '../../lib/zhiban/infrastructure/autograde/native';
import { loadAutograde } from './autograde';
import { loadAttainment } from './attainment';
type Row = QueryResultRow;
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  businessPool: Pool;
  store: AcademicStore;
  security: IdentityAuthentication;
  worker: AutoGradeWorker;
  workerPool: Pool;
};
export async function verifyAttainment(x: Input) {
  const {
    admin,
    businessPool,
    browser,
    http,
    origin,
    tenant: t,
    actors,
    trial,
    record,
    worker,
    workerPool,
  } = x;
  const [teacher, student, outsider, foreign, manager, peer] = actors,
    o = trial.offeringId;
  const attainment = `/api/zhiban/attainment/${t}`,
    auto = `/api/zhiban/autograde/${t}/offerings/${o}`,
    learning = `/api/zhiban/learning/${t}/offerings/${o}`,
    assessment = `/api/zhiban/assessment/${t}/offerings/${o}`,
    totals = assessment + '/finalgrades';
  const send = async (path: string, c: unknown, a = teacher, key = v7()) => {
    const r = await http(path, a, c, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify({ c, response: r.json }));
    return r.json as Row;
  };
  const read = async (path: string, a = teacher) => {
    const r = await http(path, a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Row;
  };
  const no = async (path: string, c: unknown, a = teacher) => {
    assert.notEqual((await http(path, a, c, 'POST', { 'x-zhiban-command': v7() })).status, 200);
  };
  const pg = async (sql: string, args: unknown[] = []) => (await admin.query(sql, args)).rows;
  const aq = (mode = 'TEACHER', view = 'RECORDS', extra: Record<string, string> = {}) =>
    attainment +
    '?' +
    new URLSearchParams({ mode, view, ...(mode === 'TEACHER' ? { offering: o } : {}), ...extra });
  for (const a of [student, outsider, foreign, manager, peer])
    assert.notEqual((await http(auto + '?mode=TEACHER', a)).status, 200);
  assert.equal((await http(auto + '?mode=STUDENT&member=' + peer.member, student)).status, 400);
  const enable = async (activity: Row, revision = '1') =>
    send(auto, {
      type: 'ENABLE',
      activityId: activity.id,
      activityVersion: 1,
      revision,
      rubric:
        '只按本次作答评分：断电20分，确认隔离30分，记录并复核50分；若满分不是100，按比例分配；给出简短可核对依据。',
      maxPoints: activity.max ?? 10000,
    });
  const create = async (title: string) => {
    const a = await send(learning, {
      type: 'CREATE_ACTIVITY',
      title,
      prompt: '维护前应如何断电、确认隔离、记录并复核？',
      deadlineAt: null,
      allowResubmit: true,
      maxAttempts: 8,
    });
    await send(learning, { type: 'PUBLISH_ACTIVITY', id: a.id, revision: a.revision });
    await enable(a);
    return a;
  };
  const submit = async (
    a: Row,
    answer = '先断电并确认隔离，按检查表逐项记录，异常说明依据并复核。',
  ): Promise<Row> => {
    const at = await send(learning, { type: 'START_ATTEMPT', id: a.id }, student),
      s = await send(
        learning,
        { type: 'SUBMIT', id: at.id, revision: at.revision, answer },
        student,
      );
    return { ...s, attempt: at };
  };
  // Durable outbox is committed with original submission; no teacher session/run command dispatches it.
  const a = await create('本地真实服务正式评分'),
    s = await submit(a);
  assert.equal(
    (
      await pg(
        'SELECT state FROM zhiban_autograde.requests WHERE tenant_id=$1 AND submission_id=$2',
        [t, s.submissionId],
      )
    )[0].state,
    'PENDING',
  );
  const capability = await nativeAutoEngine.capability();
  assert.equal(capability.ready, true, 'Real model required for this directed acceptance');
  worker.start([t]);
  async function waitJob(sub: string) {
    let rows: Row[] = [];
    for (let i = 0; i < 110; i++) {
      rows = await pg(
        'SELECT * FROM zhiban_autograde.jobs WHERE tenant_id=$1 AND submission_id=$2 ORDER BY created_at DESC LIMIT 1',
        [t, sub],
      );
      if (rows[0] && rows[0].state !== 'RUNNING') return rows[0];
      const request = (
        await pg(
          'SELECT state FROM zhiban_autograde.requests WHERE tenant_id=$1 AND submission_id=$2',
          [t, sub],
        )
      )[0];
      if (!rows.length && request?.state === 'FAILED') throw Error('Service prepare refused');
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw Error('service job did not terminate');
  }
  const job = await waitJob(s.submissionId);
  assert.equal(job.state, 'APPLIED', JSON.stringify({ state: job.state, failure: job.failure }));
  assert.equal(job.result.model.provider, capability.provider);
  assert.equal(job.result.model.model, capability.model);
  const [pub] = await pg(
    'SELECT * FROM zhiban_assessment.publications WHERE tenant_id=$1 AND id=$2',
    [t, job.publication_id],
  );
  assert.equal(pub.published_by, null);
  assert.equal(pub.service_job_id, job.id);
  assert.equal((await read(auto + '?mode=STUDENT&view=JOBS', student)).rows[0].id, pub.id);
  const quiz = await send(learning + '/quizzes', {
    type: 'CREATE_QUIZ',
    title: '客观与简答联合服务评分',
    mode: 'ASSESSED',
    content: {
      type: 'quiz',
      questions: [
        {
          id: 'objective',
          type: 'single',
          question: '应先断电吗？',
          options: [
            { value: 'A', label: '是' },
            { value: 'B', label: '否' },
          ],
          answer: ['A'],
          points: 2,
        },
        {
          id: 'written',
          type: 'short_answer',
          question: '说明隔离并记录的维护顺序。',
          commentPrompt: '按安全隔离和记录复核评分。',
          points: 8,
        },
      ],
    },
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 3,
  });
  await send(learning + '/quizzes', { type: 'PUBLISH_QUIZ', id: quiz.id, revision: quiz.revision });
  await enable({ ...quiz, max: 1000 });
  const qa = await send(
    learning + '/quizzes',
    { type: 'START_QUIZ_ATTEMPT', activityId: quiz.id, expectedVersion: '1' },
    student,
  );
  const qs = await send(
    learning + '/quizzes',
    {
      type: 'SUBMIT_QUIZ',
      attemptId: qa.id,
      revision: qa.revision,
      answers: { objective: 'A', written: '先断电并确认隔离，再逐项检查记录、依据异常复核。' },
    },
    student,
  );
  const qjob = await waitJob(qs.submissionId);
  assert.equal(qjob.state, 'APPLIED', JSON.stringify({ state: qjob.state, failure: qjob.failure }));
  assert.equal(qjob.result.marks.objective, 200);
  assert.ok(qjob.result.marks.written >= 0 && qjob.result.marks.written <= 800);
  await worker.stop();
  record(
    'REAL_NATIVE_MODEL: original submit atomic outbox -> dedicated SQL service -> real pinned model -> TEXT and mixed QUIZ formal publications; objective marks remain native; no fictitious human publisher',
  );
  // Original human correction and appeal, never an alternate direct score editing API.
  const appeal = await send(
    auto,
    { type: 'OPEN_APPEAL', publicationId: pub.id, body: '请老师核对复核步骤的评分依据。' },
    student,
  );
  await no(auto, { type: 'OPEN_APPEAL', publicationId: pub.id, body: '越权申诉' }, peer);
  const [g] = await pg(
    'SELECT *,revision::text FROM zhiban_assessment.grades WHERE tenant_id=$1 AND submission_id=$2',
    [t, s.submissionId],
  );
  const correction = await send(assessment, {
    type: 'CORRECT_GRADE',
    submissionId: s.submissionId,
    revision: g.revision,
    score: '92',
    maxScore: '100',
    feedback: '教师复核后认可补充步骤。',
    reason: '核对完整检查顺序后更正。',
  });
  const [corrected] = await pg(
    'SELECT * FROM zhiban_assessment.publications WHERE tenant_id=$1 AND id=$2',
    [t, correction.publicationId],
  );
  assert.equal(corrected.published_by, teacher.member);
  assert.equal(corrected.service_job_id, null);
  assert.deepEqual(
    (
      await pg('SELECT * FROM zhiban_assessment.publications WHERE tenant_id=$1 AND id=$2', [
        t,
        pub.id,
      ])
    )[0],
    pub,
  );
  await send(auto, {
    type: 'RESOLVE_APPEAL',
    id: appeal.id,
    revision: appeal.revision,
    response: '已经按原更正流程复核并公开更正依据。',
    replacementId: correction.publicationId,
  });
  record(
    'AI original publication immutable; teacher original CORRECT_GRADE and public reason work; own appeal resolves against latest actual correction, unauthorized appeal refused',
  );
  // Published totals reused by certificate and administrator course-credit equivalence.
  const weights = await send(totals, {
    type: 'SAVE_WEIGHTS',
    revision: '1',
    items: [{ activityId: a.id, version: 1, weightBps: 10000 }],
  });
  await send(totals, { type: 'PUBLISH_WEIGHTS', revision: weights.revision });
  const total = await read(totals + '?member=' + student.member);
  await send(totals, {
    type: 'PUBLISH_TOTAL',
    memberId: student.member,
    sourceDigest: total.preview.sourceDigest,
    previousId: null,
    reason: '教师首次明确发布本教学班总评。',
  });
  const ev = (await read(aq('TEACHER', 'TOTAL', { member: student.member }))).evidence;
  const rule = await send(attainment, {
    type: 'SET_CERT_RULE',
    offeringId: o,
    revision: '1',
    title: '机电安全维护校内证明',
    threshold: 6000,
    enabled: true,
  });
  const issue = {
      type: 'ISSUE_CERT',
      offeringId: o,
      memberId: student.member,
      ruleRevision: rule.revision,
      totalId: ev.latest.id,
      sourceDigest: ev.sourceDigest,
    },
    key = v7(),
    cert = await send(attainment, issue, teacher, key);
  assert.deepEqual(await send(attainment, issue, teacher, key), cert);
  const duplicate = await Promise.all([
    http(attainment, teacher, issue, 'POST', { 'x-zhiban-command': v7() }),
    http(attainment, teacher, issue, 'POST', { 'x-zhiban-command': v7() }),
  ]);
  assert.ok(duplicate.every((x) => x.status === 409));
  const creditRule = {
    type: 'SET_CREDIT_RULE',
    id: v7(),
    revision: '1',
    sourceCourse: trial.courseId,
    targetCourse: trial.courseId,
    title: '跨教学班安全维护学分互认',
    creditsTenths: 15,
    threshold: 6000,
    enabled: true,
  };
  const cr = await send(attainment, creditRule, manager),
    award = {
      type: 'AWARD_CREDIT',
      ruleId: cr.id,
      ruleRevision: cr.revision,
      offeringId: o,
      memberId: student.member,
      totalId: ev.latest.id,
      sourceDigest: ev.sourceDigest,
      reason: '管理员核对该课程当前发布总评，按校内规则认定。',
    };
  await no(attainment, award, teacher);
  const awards = await Promise.all([
    http(attainment, manager, award, 'POST', { 'x-zhiban-command': v7() }),
    http(attainment, manager, award, 'POST', { 'x-zhiban-command': v7() }),
  ]);
  assert.deepEqual(awards.map((x) => x.status).sort(), [200, 409]);
  const own = await read(aq('STUDENT'), student);
  assert.equal(own.rows.length, 2);
  assert.ok(own.rows.every((r: Row) => r.source.current));
  assert.equal((await read(aq('STUDENT'), peer)).rows.length, 0);
  assert.notEqual((await http(aq('STUDENT', 'DETAIL', { id: cert.id }), peer)).status, 200);
  const manage = (c: unknown) => send(`/api/zhiban/management/${t}/commands`, c, manager);
  const [offering] = await pg(
    'SELECT * FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
    [t, o],
  );
  await manage({
    type: 'CREATE_OFFERING',
    code: 'CREDIT_OTHER',
    name: '另一教学班学分去重验证',
    courseId: trial.courseId,
    termId: offering.term_id,
    classId: offering.class_id,
    capacity: 20,
  });
  const [other] = await pg(
    "SELECT id FROM zhiban_academic.offerings WHERE tenant_id=$1 AND code='CREDIT_OTHER'",
    [t],
  );
  await manage({
    type: 'ASSIGN_TEACHER',
    offeringId: other.id,
    membershipId: teacher.member,
    revision: null,
  });
  await manage({
    type: 'ENROLL',
    offeringId: other.id,
    membershipId: student.member,
    revision: null,
  });
  const ol = `/api/zhiban/learning/${t}/offerings/${other.id}`,
    og = `/api/zhiban/assessment/${t}/offerings/${other.id}`;
  const oa = await send(ol, {
    type: 'CREATE_ACTIVITY',
    title: '另一班正式任务',
    prompt: '说明检查记录。',
    deadlineAt: null,
    allowResubmit: true,
    maxAttempts: 2,
  });
  await send(ol, { type: 'PUBLISH_ACTIVITY', id: oa.id, revision: oa.revision });
  const ot = await send(ol, { type: 'START_ATTEMPT', id: oa.id }, student),
    os = await send(
      ol,
      { type: 'SUBMIT', id: ot.id, revision: ot.revision, answer: '逐项检查并复核记录。' },
      student,
    );
  const oh = await send(og, {
    type: 'SAVE_GRADE',
    submissionId: os.submissionId,
    revision: null,
    score: '91',
    maxScore: '100',
    feedback: '教师确认。',
  });
  await send(og, { type: 'PUBLISH_GRADE', submissionId: os.submissionId, revision: oh.revision });
  const ow = await send(og + '/finalgrades', {
    type: 'SAVE_WEIGHTS',
    revision: '1',
    items: [{ activityId: oa.id, version: 1, weightBps: 10000 }],
  });
  await send(og + '/finalgrades', { type: 'PUBLISH_WEIGHTS', revision: ow.revision });
  const oe = (await read(og + '/finalgrades?member=' + student.member)).preview;
  await send(og + '/finalgrades', {
    type: 'PUBLISH_TOTAL',
    memberId: student.member,
    sourceDigest: oe.sourceDigest,
    previousId: null,
    reason: '教师首次明确发布本教学班总评。',
  });
  const oth = (
    await read(aq('ADMIN', 'TOTAL', { offering: other.id, member: student.member }), manager)
  ).evidence;
  await no(
    attainment,
    { ...award, offeringId: other.id, totalId: oth.latest.id, sourceDigest: oth.sourceDigest },
    manager,
  );
  const otherRule = await send(attainment, {
    type: 'SET_CERT_RULE',
    offeringId: other.id,
    revision: '1',
    title: '另一班证书',
    threshold: 6000,
    enabled: true,
  });
  await no(attainment, {
    ...issue,
    offeringId: other.id,
    ruleRevision: otherRule.revision,
    totalId: oth.latest.id,
    sourceDigest: oth.sourceDigest,
  });
  record(
    'Two real source offerings both have independent published totals; active certificate/target-course credit cannot be duplicated through another class',
  );
  await no(attainment, { ...issue, sourceDigest: '0'.repeat(64) });
  await no(attainment, { ...issue, memberId: peer.member });
  await send(attainment, {
    type: 'REVOKE_CERT',
    id: cert.id,
    revision: cert.revision,
    reason: '校内演示撤销，历史继续可查。',
  });
  const revoked = (await read(aq('STUDENT'), student)).rows.find((r: Row) => r.id === cert.id);
  assert.equal(revoked.state, 'REVOKED');
  // Source change invalidates records instead of silently rewriting/deleting them.
  const [head] = await pg(
    'SELECT revision::text FROM zhiban_assessment.grades WHERE tenant_id=$1 AND submission_id=$2',
    [t, s.submissionId],
  );
  await send(assessment, {
    type: 'CORRECT_GRADE',
    submissionId: s.submissionId,
    revision: head.revision,
    score: '90',
    maxScore: '100',
    feedback: '再次核对原始依据。',
    reason: '以记录为准调整两分。',
  });
  assert.ok((await read(aq('STUDENT'), student)).rows.every((r: Row) => !r.source.current));
  await no(attainment, issue);
  record(
    'Published total digest/threshold/recipient guards; certificate replay and duplicate refusal; admin-only cross-class credit unique per target course, concurrent award once; own history/revoke retained; later correction marks stale',
  );
  // SQL role / expected-profile negatives.
  await assert.rejects(workerPool.query('SELECT * FROM zhiban_assessment.grades'));
  await assert.rejects(
    workerPool.query('SELECT zhiban_autograde.input_for($1,$2)', [t, s.submissionId]),
  );
  await assert.rejects(businessPool.query('SELECT zhiban_autograde.pending($1)', [t]));
  const bc = await businessPool.connect();
  try {
    await bc.query('BEGIN');
    await bc.query("SELECT set_config('app.tenant_id',$1,true)", [t]);
    await assert.rejects(
      bc.query(
        "INSERT INTO zhiban_autograde.events VALUES($1,$2,$3,$4,'FORGED','SERVICE',NULL,'formal_ai_grader','{}',$5)",
        [t, v7(), job.id, a.id, Date.now()],
      ),
    );
  } finally {
    await bc.query('ROLLBACK');
    bc.release();
  }

  await admin.query('GRANT SELECT ON zhiban_autograde.jobs TO zhiban_autograde_worker');
  try {
    await assert.rejects(loadAutograde(businessPool));
  } finally {
    await admin.query('REVOKE SELECT ON zhiban_autograde.jobs FROM zhiban_autograde_worker');
  }
  assert.equal(await loadAutograde(businessPool), true);
  assert.equal(await loadAttainment(businessPool), true);
  // Controlled-fault SQL proofs: no fake model success. Prepare uses actual restricted login and no teacher session.
  const f = await create('故障切点专用非真实模型');
  const prepare = async (sub: string) => {
    const secret = randomBytes(32).toString('base64url'),
      id = v7();
    const r = (
      await workerPool.query('SELECT zhiban_autograde.prepare($1,$2,$3,$4,$5) AS value', [
        t,
        sub,
        id,
        createHash('sha256').update(secret).digest('hex'),
        v7(),
      ])
    ).rows[0].value;
    return { ...r, secret };
  };
  const result = (j: Row) => ({
    marks: { text: 6000 },
    feedback: 'CONTROLLED_FAULT_ONLY，不作为真实模型验收。',
    model: { provider: j.input.provider, model: j.input.model, promptSha256: '1'.repeat(64) },
  });
  const apply = (j: Row, value = result(j), secret = j.secret) =>
    workerPool.query('SELECT zhiban_autograde.apply($1,$2,$3,$4,$5,$6,$7)', [
      t,
      j.id,
      secret,
      JSON.stringify(value),
      v7(),
      v7(),
      v7(),
    ]);
  const fail = (j: Row) =>
    workerPool.query('SELECT zhiban_autograde.fail($1,$2,$3,$4,$5)', [
      t,
      j.id,
      j.secret,
      'AUTHORITY_OR_SOURCE_CHANGED',
      v7(),
    ]);
  const fs = await submit(f),
    fj = await prepare(fs.submissionId);
  await assert.rejects(apply(fj, result(fj), null));
  await assert.rejects(apply(fj, result(fj), 'x'.repeat(43)));
  await assert.rejects(apply(fj, { ...result(fj), marks: { text: 10001 } }));
  await assert.rejects(
    apply(fj, { ...result(fj), model: { ...result(fj).model, model: 'foreign-model' } }),
  );
  await send(auto, { type: 'DISABLE', activityId: f.id, revision: '2' });
  await assert.rejects(apply(fj));
  await fail(fj);
  assert.equal(
    (
      await pg(
        'SELECT count(*)::int AS n FROM zhiban_assessment.publications WHERE tenant_id=$1 AND submission_id=$2',
        [t, fs.submissionId],
      )
    )[0].n,
    0,
  );
  await enable(f, '3');
  const f2 = await submit(f),
    j2 = await prepare(f2.submissionId);
  // Revoke authorizer while the model is outside transaction; no stale publication.
  await admin.query(
    'UPDATE zhiban_identity.memberships SET authorization_version=authorization_version+1,repository_revision=repository_revision+1 WHERE tenant_id=$1 AND membership_id=$2',
    [t, teacher.member],
  );
  const revokedGrant = (
    await pg('SELECT teacher_grant FROM zhiban_autograde.policies WHERE tenant_id=$1 AND id=$2', [
      t,
      j2.input.policyId,
    ])
  )[0].teacher_grant;
  await admin.query(
    'UPDATE zhiban_identity.role_grants SET revoked_at=$3 WHERE tenant_id=$1 AND grant_id=$2',
    [t, revokedGrant, Date.now()],
  );
  await admin.query(
    "INSERT INTO zhiban_identity.role_grants SELECT $1,$2,$3,coalesce(max(grant_ordinal),-1)+1,'TEACHER','TENANT',NULL,$4,$4,NULL,NULL FROM zhiban_identity.role_grants WHERE tenant_id=$2 AND membership_id=$3",
    [v7(), t, teacher.member, Date.now()],
  );
  await assert.rejects(apply(j2));
  await fail(j2);
  await enable(f, '4');
  const f3 = await submit(f),
    j3 = await prepare(f3.submissionId);
  await admin.query('UPDATE zhiban_autograde.jobs SET expires_at=0 WHERE tenant_id=$1 AND id=$2', [
    t,
    j3.id,
  ]);
  await assert.rejects(apply(j3));
  await workerPool.query('SELECT * FROM zhiban_autograde.pending($1)', [t]);
  assert.equal(
    (
      await pg('SELECT state FROM zhiban_autograde.jobs WHERE tenant_id=$1 AND id=$2', [t, j3.id])
    )[0].state,
    'FAILED',
  );
  // Audit failure must roll back grade and publication together.
  const f4 = await submit(f),
    j4 = await prepare(f4.submissionId);
  await admin.query(
    "ALTER TABLE zhiban_autograde.events ADD CONSTRAINT controlled_audit_refusal CHECK(action<>'PUBLISH_FORMAL_GRADE') NOT VALID",
  );
  try {
    await assert.rejects(apply(j4));
  } finally {
    await admin.query(
      'ALTER TABLE zhiban_autograde.events DROP CONSTRAINT controlled_audit_refusal',
    );
  }
  assert.equal(
    (
      await pg(
        'SELECT count(*)::int AS n FROM zhiban_assessment.publications WHERE tenant_id=$1 AND submission_id=$2',
        [t, f4.submissionId],
      )
    )[0].n,
    0,
  );
  await fail(j4);
  // Apply's Identity barrier is held until the actual commit. A concurrent revoker waits.
  const f5 = await submit(f),
    j5 = await prepare(f5.submissionId),
    wc = await workerPool.connect(),
    rc = await admin.connect();
  try {
    await wc.query('BEGIN');
    const pid = (await wc.query('SELECT pg_backend_pid() AS id')).rows[0].id;
    await wc.query('SELECT zhiban_autograde.apply($1,$2,$3,$4,$5,$6,$7)', [
      t,
      j5.id,
      j5.secret,
      JSON.stringify(result(j5)),
      v7(),
      v7(),
      v7(),
    ]);
    const rid = (await rc.query('SELECT pg_backend_pid() AS id')).rows[0].id;
    let finished = false;
    const revoke = rc
      .query(
        'UPDATE zhiban_identity.memberships SET authorization_version=authorization_version+1,repository_revision=repository_revision+1 WHERE tenant_id=$1 AND membership_id=$2',
        [t, teacher.member],
      )
      .then(() => {
        finished = true;
      });
    let blocked = false;
    for (let n = 0; n < 30; n++) {
      const b = (
        await pg('SELECT $1::integer=ANY(pg_blocking_pids($2)) AS blocked', [pid, rid])
      )[0];
      if (b.blocked) {
        blocked = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal(blocked, true);
    assert.equal(finished, false);
    await wc.query('COMMIT');
    await revoke;
    await enable(f, '5');
  } finally {
    await wc.query('ROLLBACK');
    wc.release();
    rc.release();
  }
  const f6 = await submit(f),
    j6 = await prepare(f6.submissionId);
  await Promise.all([apply(j6), apply(j6)]);
  assert.equal(
    (
      await pg(
        'SELECT count(*)::int AS n FROM zhiban_assessment.publications WHERE tenant_id=$1 AND submission_id=$2',
        [t, f6.submissionId],
      )
    )[0].n,
    1,
  );
  const f7 = await submit(f),
    modelFailure = new AutoGradeWorker(workerPool, {
      capability: async () => capability,
      generate: async () => {
        throw Error('CONTROLLED_FAULT_ONLY model failure');
      },
    });
  await modelFailure.enqueue(t, f7.submissionId);
  const failedJob = await waitJob(f7.submissionId);
  await modelFailure.stop();
  assert.equal(failedJob.state, 'FAILED');
  assert.equal(failedJob.failure, 'MODEL_FAILED');
  record(
    'CONTROLLED_FAULT_ONLY: exact commit Identity table-lock barrier blocks concurrent authorization writer; concurrent service apply publishes once; raw business connection cannot forge SERVICE audit',
  );
  record(
    'CONTROLLED_FAULT_ONLY: null/wrong private token, out-of-bound marks, wrong model, delegation disable, authorizer version revocation, lease expiry, audit failure all prevent formal publication; dedicated worker raw SQL/internal-helper and business helper access refused; profile rejects ACL drift',
  );
  // Actual affected pages, with existing original authentication cookie.
  const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [],
    errors: string[] = [];
  const pageFor = async (actor: typeof teacher, url: string) => {
    const c = await browser.newContext();
    contexts.push(c);
    const [name, ...rest] = actor.cookie!.split('=');
    await c.addCookies([
      {
        name,
        value: rest.join('='),
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(origin + url);
    return p;
  };
  try {
    const tp = await pageFor(
      teacher,
      `/zhiban/teacher/courses/${trial.courseId}/auto-grading?space=${t}&offering=${o}`,
    );
    await expect(
      tp.locator('#auto-grading').getByRole('heading', { name: '受限 AI 正式评分', exact: true }),
    ).toBeVisible();
    await expect(
      tp.locator('#auto-grading').getByText('本地真实服务正式评分', { exact: true }),
    ).toBeVisible();
    await tp.getByRole('button', { name: '服务任务', exact: true }).click();
    await expect(
      tp
        .locator('#auto-grading')
        .getByText(/APPLIED/)
        .first(),
    ).toBeVisible();
    const sp = await pageFor(
      student,
      `/zhiban/student/courses/${trial.courseId}/auto-grading?space=${t}&offering=${o}`,
    );
    await sp.getByRole('button', { name: '本人成绩与申诉', exact: true }).click();
    await expect(
      sp
        .locator('#auto-grading')
        .getByText(/AI 服务正式评分版本/)
        .first(),
    ).toBeVisible();
    await expect(
      sp.getByRole('button', { name: '启用／更新自动正式评分', exact: true }),
    ).toHaveCount(0);
    const cp = await pageFor(student, `/zhiban/attainment?tenant=${t}&mode=STUDENT`);
    await expect(
      cp.locator('#attainment').getByRole('heading', { name: '机电安全维护校内证明', exact: true }),
    ).toBeVisible();
    await expect(
      cp
        .locator('#attainment')
        .getByText(/已撤销/)
        .first(),
    ).toBeVisible();
    await expect(
      cp.getByRole('button', { name: '打印／保存 PDF', exact: true }).first(),
    ).toBeVisible();
    const ap = await pageFor(manager, `/zhiban/attainment?tenant=${t}&mode=ADMIN`);
    await expect(ap.getByRole('heading', { name: '跨班课程学分规则', exact: true })).toBeVisible();
    await expect(ap.locator('[role=alert]')).toBeEmpty();
    await writeFile(
      'docs/v2/evidence/attainment/browser.png',
      await cp.screenshot({ fullPage: true }),
    );
    assert.deepEqual(errors, []);
  } finally {
    for (const c of contexts) await c.close();
  }
  record(
    'Actual browser teacher fixed policies/jobs, student formal results/appeal boundaries and certificate print/download/revoked history, admin credit selector; no page script errors',
  );
  await writeFile(
    'docs/v2/evidence/attainment/real-model.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        provider: capability.provider,
        model: capability.model,
        text: { jobId: job.id, publicationId: pub.id, model: job.result.model },
        quiz: {
          jobId: qjob.id,
          publicationId: qjob.publication_id,
          objective: qjob.result.marks.objective,
          model: qjob.result.model,
        },
        controlledFaultResultsNotRealModel: true,
      },
      null,
      2,
    ) + '\n',
  );
}
