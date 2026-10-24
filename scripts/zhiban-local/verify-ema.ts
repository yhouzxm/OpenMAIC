/** Real PG16/Identity/browser journey. Controlled model failures are separate from the real native model acceptance. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { v7 } from 'uuid';
import { expect } from '@playwright/test';
import type { QueryResultRow, Pool } from 'pg';
import type { prepareTrial } from './prepare-trial';
import type { AcademicStore } from '../../lib/zhiban/application/academic/service';
import type { IdentityAuthentication } from '../../lib/zhiban/infrastructure/identity/composition/authentication';
import { EmaService } from '../../lib/zhiban/application/ema/service';
import { dimensions, type Finding } from '../../lib/zhiban/domain/ema/model';
import type { EmaEngine } from '../../lib/zhiban/infrastructure/ema/native';
import { loadEma } from './ema';
type Row = QueryResultRow;
type Input = Parameters<typeof prepareTrial>[0] & {
  trial: Awaited<ReturnType<typeof prepareTrial>>;
  businessPool: Pool;
  store: AcademicStore;
  security: IdentityAuthentication;
};
export async function verifyEma(input: Input) {
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
    store,
    security,
  } = input;
  const [teacher, student, outsider, foreign, manager, peer] = actors,
    o = trial.offeringId;
  const base = `/api/zhiban/ema/${t}/offerings/${o}`,
    learner = `/api/zhiban/learner/${t}/offerings/${o}`,
    assessment = `/api/zhiban/assessment/${t}/offerings/${o}`;
  const send = async (path: string, c: unknown, a = teacher, key = v7()) => {
    const r = await http(path, a, c, 'POST', { 'x-zhiban-command': key });
    assert.equal(r.status, 200, JSON.stringify({ command: c, response: r.json }));
    return r.json as Row;
  };
  const read = async (path: string, a = teacher) => {
    const r = await http(path, a);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.json as Row;
  };
  const overview = await read(learner + '?mode=STUDENT', student),
    enrollment = overview.enrollment.id;
  const qs = (view = 'DIMENSIONS', extra: Record<string, string> = {}) =>
    '?' +
    new URLSearchParams({
      mode: 'TEACHER',
      ...(view === 'JOB' ? {} : { enrollment }),
      view,
      ...extra,
    });
  const note = (id: string, a = teacher) =>
    read(
      learner +
        '?' +
        new URLSearchParams({ mode: a === teacher ? 'TEACHER' : 'STUDENT', view: 'NOTE', id }),
      a,
    );
  const detail = (id: string) => read(base + qs('JOB', { id }));
  let sources = await read(learner + '?mode=TEACHER&view=EVIDENCE&enrollment=' + enrollment);
  const source = sources.rows.find((s: Row) => s.kind === 'GRADE');
  assert.ok(source);
  const ref = (s: Row) => ({ kind: s.kind, id: s.id, digest: s.digest });
  const text = {
    title: '本次技能应用的证据边界',
    body: '仅描述本次正式任务的表现；没有实际操作过程证明，不推断稳定技能。',
    confidence: 'LIMITED',
    evidence: [ref(source)],
  };
  const zero = await read(base + qs());
  assert.equal(zero.dimensions.length, 6);
  assert.equal(zero.rows.length, 0);
  assert.equal((await http(base + qs())).status, 401);
  for (const a of [student, outsider, foreign, manager, peer])
    assert.notEqual((await http(base + qs(), a)).status, 200);
  assert.equal((await http(base + '?mode=STUDENT&view=JOBS', student)).status, 400);
  assert.equal((await http(base + '?mode=STUDENT&enrollment=' + enrollment, student)).status, 400);
  const badDto = await http(base, teacher, {
    type: 'QUEUE',
    enrollmentId: enrollment,
    purpose: '拒绝伪造来源',
    dueAt: null,
    evidence: [{ kind: 'CHAT', id: v7(), digest: '0'.repeat(64) }],
  });
  assert.equal(badDto.status, 400);
  const key = v7(),
    command = {
      type: 'CREATE_OBSERVATION',
      enrollmentId: enrollment,
      dimension: 'APPLICATION',
      text,
    };
  const draft = await send(base, command, teacher, key);
  assert.deepEqual(await send(base, command, teacher, key), draft);
  assert.equal(
    (
      await http(base, teacher, { ...command, text: { ...text, title: '异载荷' } }, 'POST', {
        'x-zhiban-command': key,
      })
    ).status,
    409,
  );
  assert.equal((await read(base + '?mode=STUDENT', student)).rows.length, 0);
  assert.equal(
    (await http(learner + '?mode=STUDENT&view=NOTE&id=' + draft.id, student)).status,
    404,
  );
  const dn = await note(draft.id);
  await send(learner, {
    type: 'PUBLISH_OBSERVATION',
    id: draft.id,
    revision: dn.record.revision,
    expectedDigest: dn.evidence.digest,
  });
  assert.equal(
    (await read(base + '?mode=STUDENT', student)).counts.find(
      (c: Row) => c.dimension === 'APPLICATION',
    ).published,
    1,
  );
  assert.equal((await http(learner + '?mode=STUDENT&view=NOTE&id=' + draft.id, peer)).status, 404);
  record(
    'Six dimensions: shared Learner evidence locks, private drafts, original publication/recipient guard, current course/tenant/self scope and payload-bound replay',
  );
  const future = await send(base, {
    type: 'QUEUE',
    enrollmentId: enrollment,
    purpose: '预约分析，不代存教师凭据',
    dueAt: Date.now() + 3600000,
    evidence: [ref(source)],
  });
  assert.equal(
    (await http(base, teacher, { type: 'RUN', id: future.id, revision: future.revision })).status,
    409,
  );
  await send(base, { type: 'CANCEL', id: future.id, revision: future.revision });
  const conceptBase = `/api/zhiban/concept/${t}/offerings/${o}`;
  const conceptSources = await read(conceptBase + '?mode=TEACHER&view=SOURCES');
  const cs = conceptSources.rows.find((s: Row) => s.publication_id === source.id);
  assert.ok(cs);
  const correction = await send(conceptBase, {
    type: 'CREATE_CORRECTION',
    publicationId: cs.publication_id,
    questionId: '',
    expectedDigest: cs.digest,
    concept: '断电确认的目的与复核依据',
    explanation:
      '教师核对本次已提交的安全检查说明后判断：本次能解释断电确认的目的，能列出检查步骤；仍需补充复核依据。该判断仅限这次概念解释。',
    guidance: '下一次请区分现场观察与自己的推断，再说明如何验证。',
    privateNote: 'EMA_PRIVATE_NOTE_MUST_NOT_BE_SENT',
  });
  const cd = await read(conceptBase + '?mode=TEACHER&view=DETAIL&id=' + correction.id);
  await send(conceptBase, {
    type: 'PUBLISH_CORRECTION',
    id: correction.id,
    revision: correction.revision,
    expectedDigest: cd.current.digest,
  });
  const publicConcepts = await read(
    learner + '?mode=TEACHER&view=EVIDENCE&enrollment=' + enrollment + '&kind=CONCEPT',
  );
  const conceptSource = publicConcepts.rows.find((s: Row) => s.id === correction.id);
  assert.ok(conceptSource);
  const queued = await send(base, {
    type: 'QUEUE',
    enrollmentId: enrollment,
    purpose:
      '分析这次已公开的教师概念观察与正式任务记录，准确区分教师本次判断和稳定能力；没有依据的维度明确证据不足。',
    dueAt: null,
    evidence: [ref(source), ref(conceptSource)],
  });
  let job = await detail(queued.id);
  assert.equal(
    job.capability.ready,
    true,
    'Actual model configuration is required for this explicit native-model journey',
  );
  const runKey = v7(),
    runCommand = { type: 'RUN', id: queued.id, revision: queued.revision };
  await send(base, runCommand, teacher, runKey);
  await send(base, runCommand, teacher, runKey);
  const deadline = Date.now() + 110000;
  do {
    job = await detail(queued.id);
    if (job.job.state !== 'RUNNING') break;
    await new Promise((r) => setTimeout(r, 600));
  } while (Date.now() < deadline);
  assert.equal(
    job.job.state,
    'READY',
    JSON.stringify({ state: job.job.state, failure: job.job.failure }),
  );
  assert.equal(job.job.result.length, 6);
  assert.ok(job.job.model.provider && job.job.model.model);
  assert.equal('lease' in job.job, false);
  assert.ok(!JSON.stringify(job.job.evidence).includes('answer'));
  assert.ok(!JSON.stringify(job.job.evidence).includes('EMA_PRIVATE_NOTE_MUST_NOT_BE_SENT'));
  await writeFile(
    'docs/v2/evidence/ema/real-model-output.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        scope: 'SYNTHETIC_FORMAL_GRADE_AND_PUBLIC_TEACHER_CONCEPT_OBSERVATION',
        model: job.job.model,
        findings: job.job.result,
      },
      null,
      2,
    ) + '\n',
  );
  const finding = job.job.result.find(
    (f: Finding) => f.state === 'LIMITED' && f.evidence.length > 0,
  ) as Finding | undefined;
  assert.ok(
    finding,
    'This fixture supplies a public task-specific teacher observation for a bounded finding; grade-only results may legitimately be fully insufficient',
  );
  const used = finding.evidence.map((i) => ref(job.job.evidence[i - 1]));
  const adopt = {
    type: 'ADOPT',
    id: queued.id,
    revision: job.job.revision,
    dimension: finding.dimension,
    text: {
      title: 'EMA 审阅：本次正式任务',
      body: finding.observation,
      confidence: 'LIMITED',
      evidence: used,
    },
    reason: '教师核对固定正式来源，仅采用本次任务描述。',
  };
  const race = await Promise.all([http(base, teacher, adopt), http(base, teacher, adopt)]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  const adopted = (race.find((r) => r.status === 200)!.json as Row).noteId;
  assert.ok(adopted);
  assert.equal((await note(adopted)).record.state, 'DRAFT');
  assert.equal(
    (await http(learner + '?mode=STUDENT&view=NOTE&id=' + adopted, student)).status,
    404,
  );
  const an = await note(adopted);
  await send(learner, {
    type: 'PUBLISH_OBSERVATION',
    id: adopted,
    revision: an.record.revision,
    expectedDigest: an.evidence.digest,
  });
  assert.equal((await note(adopted, student)).record.state, 'PUBLISHED');
  job = await detail(queued.id);
  const other = job.job.result.find((f: Finding) => f.dimension !== finding.dimension) as Finding;
  await send(base, {
    type: 'REJECT',
    id: queued.id,
    revision: job.job.revision,
    dimension: other.dimension,
    reason: '本维证据不足，暂不生成学生观察。',
  });
  const rejected = await detail(queued.id);
  assert.equal(
    (await http(base, teacher, { ...adopt, revision: rejected.job.revision })).status,
    409,
  );
  const insuff = job.job.result.find(
    (f: Finding) => f.state === 'INSUFFICIENT' && f.dimension !== other.dimension,
  ) as Finding | undefined;
  if (insuff)
    assert.equal(
      (
        await http(base, teacher, {
          ...adopt,
          revision: rejected.job.revision,
          dimension: insuff.dimension,
        })
      ).status,
      409,
    );
  record(
    'EMA REAL_NATIVE_MODEL: fixed public evidence -> six descriptive findings -> teacher adopt/reject -> Learner draft/publication; concurrent adoption writes once; students cannot see private job/model/refusal notes',
  );
  const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [],
    errors: string[] = [];
  const pageFor = async (a: typeof teacher, role: string) => {
    const ctx = await browser.newContext();
    contexts.push(ctx);
    const [name, ...rest] = a.cookie!.split('=');
    await ctx.addCookies([
      {
        name,
        value: rest.join('='),
        url: origin,
        httpOnly: true,
        secure: true,
        sameSite: 'Strict',
      },
    ]);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(
      `${origin}/zhiban/${role}/courses/${trial.courseId}/evidence-profile?space=${t}&offering=${o}${role === 'teacher' ? '#student-' + enrollment : ''}`,
    );
    return page;
  };
  try {
    const tp = await pageFor(teacher, 'teacher'),
      sp = await pageFor(student, 'student');
    await expect(
      tp.getByRole('heading', { name: '六维证据画像与 EMA', exact: true }),
    ).toBeVisible();
    await expect(
      sp.getByRole('heading', { name: '六维证据画像与 EMA', exact: true }),
    ).toBeVisible();
    await expect(sp.getByRole('button', { name: 'EMA 分析作业', exact: true })).toHaveCount(0);
    await sp.getByRole('button', { name: '查看技能应用', exact: true }).click();
    await expect(sp.getByRole('heading', { name: text.title, exact: true })).toBeVisible();
    await sp
      .getByRole('link', { name: '查看证据、历史与提出本人纠错', exact: true })
      .filter({ hasText: '查看证据' })
      .first()
      .click();
    // Follow the specifically authored record when another adopted observation shares the dimension.
    await sp.goto(
      `${origin}/zhiban/student/courses/${trial.courseId}/learning-profile?space=${t}&offering=${o}#note-${draft.id}`,
    );
    await sp
      .getByLabel('我认为需要纠正的问题', { exact: true })
      .fill('请明确这只是本次任务的成绩，不能推断稳定技能。');
    await sp.getByLabel('我希望如何纠正或补充', { exact: true }).fill('希望保留范围说明。');
    const openedPromise = sp.waitForResponse(
      (r) => new URL(r.url()).pathname === learner && r.request().method() === 'POST',
    );
    await sp.getByRole('button', { name: '提交本人纠错', exact: true }).click();
    const opened = await openedPromise;
    assert.equal(opened.status(), 200);
    const dispute = await opened.json();
    const disputeDetail = await read(learner + '?mode=TEACHER&view=DISPUTE&id=' + dispute.id);
    await send(learner, {
      type: 'RESOLVE_DISPUTE',
      id: dispute.id,
      revision: disputeDetail.record.revision,
      noteRevision: disputeDetail.note.revision,
      outcome: 'REVISE',
      response: '已核对范围并公开补充说明。',
      replacement: {
        ...text,
        body: '本观察仅指这次正式任务结果，不代表稳定技能；本人补充已纳入。',
      },
    });
    const updated = await read(base + qs('NOTES', { dimension: 'APPLICATION' }));
    assert.ok(updated.rows.some((n: Row) => n.id === draft.id && n.body.includes('本人补充')));
    await tp.getByRole('button', { name: 'EMA 分析作业', exact: true }).click();
    await expect(tp.getByRole('heading', { name: 'EMA 分析作业', exact: true })).toBeVisible();
    await tp.screenshot({ path: 'docs/v2/evidence/ema/teacher-jobs.png', fullPage: true });
    await sp.goto(
      `${origin}/zhiban/student/courses/${trial.courseId}/evidence-profile?space=${t}&offering=${o}`,
    );
    await sp.setViewportSize({ width: 390, height: 844 });
    await sp.getByRole('button', { name: '查看技能应用', exact: true }).click();
    await expect(
      sp.getByText('本观察仅指这次正式任务结果，不代表稳定技能；本人补充已纳入。', { exact: true }),
    ).toBeVisible();
    assert.equal(await sp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await sp.screenshot({
      path: 'docs/v2/evidence/ema/student-corrected-mobile.png',
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    record(
      'Real browser: teacher six-dimension/job page, student published-only dimensions -> original self-correction -> atomic teacher revision -> dimension readback; 390px has no horizontal overflow',
    );
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
  const handle = await security.authenticate(teacher.cookie!.split('=').slice(1).join('='));
  assert.ok(handle);
  const context = { handle, tenantId: t, actorMembershipId: teacher.member };
  const pending: { resolve: (v: Awaited<ReturnType<EmaEngine['generate']>>) => void }[] = [];
  const controlled: EmaEngine = {
    capability: async () => ({
      ready: true,
      provider: 'CONTROLLED_FAULT_ONLY',
      model: 'NOT_REAL_ACCEPTANCE',
    }),
    generate: async () => new Promise((resolve) => pending.push({ resolve })),
  };
  const faultService = new EmaService(store, controlled, true);
  const limited: Finding[] = dimensions.map((d, i) => ({
    dimension: d.id,
    state: i === 0 ? 'LIMITED' : 'INSUFFICIENT',
    observation: i === 0 ? '故障切点：本次任务正式记录。' : '本范围证据不足。',
    evidence: i === 0 ? [1] : [],
  }));
  const fake = {
    findings: limited,
    model: { provider: 'CONTROLLED_FAULT_ONLY', model: 'NOT_REAL_ACCEPTANCE' },
  };
  const faultSend = (c: unknown, key = v7()) => faultService.execute(context, o, c, key);
  const prepareFault = () =>
    faultSend({
      type: 'QUEUE',
      enrollmentId: enrollment,
      purpose: 'CONTROLLED_FAULT_ONLY',
      dueAt: null,
      evidence: [ref(sources.rows.find((s: Row) => s.kind === 'GRADE'))],
    });
  const settle = async (id: string, state: string) => {
    for (let i = 0; i < 70; i++) {
      const d = await detail(id);
      if (d.job.state === state) return d;
      await new Promise((r) => setTimeout(r, 40));
    }
    assert.fail('Fault job did not reach ' + state);
  };
  let q = await prepareFault();
  await faultSend({ type: 'RUN', id: q.id, revision: q.revision });
  assert.equal(pending.length, 1);
  let d = await detail(String(q.id));
  await faultSend({ type: 'CANCEL', id: q.id, revision: d.job.revision });
  pending[0].resolve(fake);
  await faultService.stop();
  d = await detail(String(q.id));
  assert.equal(d.job.state, 'CANCELLED');
  assert.equal(d.job.result, null);
  // Controlled provider errors do not produce a fallback report.
  const failing = new EmaService(
    store,
    {
      capability: controlled.capability,
      generate: async () => {
        throw Error('INJECTED_PROVIDER_FAILURE');
      },
    },
    true,
  );
  q = await prepareFault();
  await failing.execute(context, o, { type: 'RUN', id: q.id, revision: q.revision }, v7());
  await failing.stop();
  await settle(String(q.id), 'FAILED');
  const readyFault = await prepareFault();
  await faultSend({ type: 'RUN', id: readyFault.id, revision: readyFault.revision });
  pending[pending.length - 1].resolve(fake);
  await faultService.stop();
  await settle(String(readyFault.id), 'READY');
  q = await prepareFault();
  await faultSend({ type: 'RUN', id: q.id, revision: q.revision });
  const runningIndex = pending.length - 1;
  const gradeRev = (
    await admin.query(
      'SELECT revision::text FROM zhiban_assessment.grades WHERE tenant_id=$1 AND submission_id=$2',
      [t, source.snapshot.submissionId],
    )
  ).rows[0].revision;
  await send(assessment, {
    type: 'CORRECT_GRADE',
    submissionId: source.snapshot.submissionId,
    revision: gradeRev,
    score: '90',
    maxScore: '100',
    feedback: '正式复核后更正。',
    reason: 'EMA 来源变化并发切点。',
  });
  pending[runningIndex].resolve(fake);
  await faultService.stop();
  await settle(String(q.id), 'STALE');
  const staleReady = await detail(String(readyFault.id));
  assert.equal(staleReady.fresh, false);
  assert.equal(
    (
      await http(base, teacher, {
        ...adopt,
        id: readyFault.id,
        revision: staleReady.job.revision,
        dimension: 'KNOWLEDGE',
        text: { ...text, evidence: [ref(source)] },
      })
    ).status,
    409,
  );
  assert.equal((await note(adopted, student)).evidence.fresh, false);
  job = await detail(queued.id);
  assert.equal(job.fresh, false);
  const unreviewed = (job.job.result as Finding[]).find(
    (f) => !job.reviews.some((r: Row) => r.dimension === f.dimension) && f.state === 'LIMITED',
  );
  if (unreviewed)
    assert.equal(
      (
        await http(base, teacher, {
          ...adopt,
          revision: job.job.revision,
          dimension: unreviewed.dimension,
        })
      ).status,
      409,
    );
  sources = await read(learner + '?mode=TEACHER&view=EVIDENCE&enrollment=' + enrollment);
  q = await prepareFault();
  await faultSend({ type: 'RUN', id: q.id, revision: q.revision });
  await admin.query('UPDATE zhiban_ema.jobs SET started_at=$3 WHERE tenant_id=$1 AND id=$2', [
    t,
    q.id,
    Date.now() - 180000,
  ]);
  d = await detail(String(q.id));
  await faultSend({ type: 'EXPIRE', id: q.id, revision: d.job.revision });
  pending[pending.length - 1].resolve(fake);
  await faultService.stop();
  assert.equal((await detail(String(q.id))).job.failure, 'EXPIRED');
  // Rollback retains neither classified draft nor nested Learner receipt.
  const before = Number(
    (await admin.query('SELECT count(*) FROM zhiban_learner.observations')).rows[0].count,
  );
  await admin.query('REVOKE INSERT ON zhiban_ema.tags FROM zhiban_academic_runtime');
  try {
    assert.equal(
      (
        await http(base, teacher, {
          ...command,
          text: { ...text, evidence: [ref(sources.rows[0])] },
        })
      ).status,
      503,
    );
  } finally {
    await admin.query('GRANT INSERT ON zhiban_ema.tags TO zhiban_academic_runtime');
  }
  assert.equal(
    Number((await admin.query('SELECT count(*) FROM zhiban_learner.observations')).rows[0].count),
    before,
  );
  assert.equal(await loadEma(businessPool), true);
  await admin.query('GRANT UPDATE ON zhiban_ema.reviews TO zhiban_academic_runtime');
  try {
    await assert.rejects(loadEma(businessPool));
  } finally {
    await admin.query('REVOKE UPDATE ON zhiban_ema.reviews FROM zhiban_academic_runtime');
  }
  assert.equal(await loadEma(businessPool), true);
  for (const table of ['tags', 'reviews', 'events', 'commands'])
    assert.deepEqual(
      (
        await admin.query(
          "SELECT has_table_privilege('zhiban_academic_runtime',$1,'UPDATE') AS u,has_table_privilege('zhiban_academic_runtime',$1,'DELETE') AS d",
          ['zhiban_ema.' + table],
        )
      ).rows[0],
      { u: false, d: false },
    );
  const raw = await businessPool.connect();
  try {
    await raw.query('BEGIN');
    await raw.query("SELECT set_config('app.tenant_id',$1,true)", [v7()]);
    assert.equal((await raw.query('SELECT id FROM zhiban_ema.jobs')).rows.length, 0);
  } finally {
    await raw.query('ROLLBACK');
    raw.release();
  }
  record(
    'CONTROLLED_FAULT_ONLY: cancel/late output, real-source correction during inference, provider failure, expired leases, atomic draft/tag rollback, immutable ACL drift and tenant RLS; no controlled output counted as real AI success',
  );
  // Revocation during inference cannot write back accepted findings under an old teacher session.
  q = await prepareFault();
  await faultSend({ type: 'RUN', id: q.id, revision: q.revision });
  await admin.query('UPDATE zhiban_identity.role_grants SET revoked_at=$2 WHERE grant_id=$1', [
    teacher.grant,
    Date.now(),
  ]);
  pending[pending.length - 1].resolve(fake);
  await faultService.stop();
  const rejectedFinish = (
    await admin.query('SELECT state,result FROM zhiban_ema.jobs WHERE tenant_id=$1 AND id=$2', [
      t,
      q.id,
    ])
  ).rows[0];
  assert.equal(rejectedFinish.state, 'RUNNING');
  assert.equal(rejectedFinish.result, null);
  assert.equal((await http(base + qs(), teacher)).status, 403);
  record(
    'Current Identity teacher revocation during inference refuses accepted result; abandoned RUNNING job remains explicit for expiry by a currently authorized teacher',
  );
  await writeFile(
    'docs/v2/evidence/zhiban-ema-journey-local.json',
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        status: 'PASS',
        at: new Date().toISOString(),
        scope: 'SIX_DESCRIPTIVE_DIMENSIONS_FIXED_EVIDENCE_NATIVE_MODEL_AND_TEACHER_REVIEW',
        actualModel: job.job.model,
        realJobId: queued.id,
        adoptedNoteId: adopted,
        controlledFailureTestsSeparate: true,
        numericAbilityScores: false,
        unattendedDispatch: false,
        sourceKinds: ['GRADE', 'CONCEPT', 'REMEDIATION'],
        browserErrors: errors,
      },
      null,
      2,
    ) + '\n',
  );
}
