import { writableAttempt } from '../../../domain/learning/model';
import type { PoolClient, QueryResultRow } from 'pg';
import { v7 } from 'uuid';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import {
  flowDigest,
  flowSteps,
  labValues,
  labReportText,
  type FlowCommand,
  type FlowStep,
} from '../../../domain/flow/model';
import type { ClassroomLecture } from '../../../domain/classroom/model';
import { progressBarrier } from '../../curriculum/postgres/progress';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
import { ClassroomPgTransaction } from '../../classroom/postgres/transaction';
import { executeSimulation, SIMULATION_SOURCE } from '../../../domain/flow/simulation';
export class FlowPgTransaction {
  constructor(private readonly c: PoolClient) {}
  private async rows(sql: string, args: unknown[] = []) {
    return (await this.c.query(sql, args)).rows;
  }
  private async simulationRuns(a: AcademicActor, notebook: string) {
    const runs = await this.rows(
      'SELECT *,notebook_revision::text FROM zhiban_flow.simulation_runs WHERE tenant_id=$1 AND notebook_id=$2 ORDER BY sequence LIMIT 51',
      [a.tenantId, notebook],
    );
    requireAcademic(runs.length <= 50, 'UNAVAILABLE');
    return runs;
  }
  private simulationRows(runs: QueryResultRow[]) {
    return runs.map((r) => ({
      values: r.result,
      note: `服务端模拟 #${r.sequence} · ${r.model_id} · ${r.id}`,
    }));
  }
  private async session(a: AcademicActor, o: string, id: string, lock = false) {
    const [s] = await this.rows(
      'SELECT *,revision::text FROM zhiban_classroom.sessions WHERE tenant_id=$1 AND offering_id=$2 AND id=$3' +
        (lock ? ' FOR UPDATE' : ''),
      [a.tenantId, o, id],
    );
    requireAcademic(s, 'NOT_FOUND');
    return s;
  }
  private async plan(a: AcademicActor, id: string) {
    return (
      (
        await this.rows(
          'SELECT *,revision::text,published_version::text FROM zhiban_flow.plans WHERE tenant_id=$1 AND classroom_id=$2',
          [a.tenantId, id],
        )
      )[0] ?? null
    );
  }
  private async run(a: AcademicActor, id: string) {
    return (
      (
        await this.rows(
          'SELECT *,revision::text,plan_version::text FROM zhiban_flow.runs WHERE tenant_id=$1 AND classroom_id=$2',
          [a.tenantId, id],
        )
      )[0] ?? null
    );
  }
  private async version(a: AcademicActor, id: string, version: string) {
    const [v] = await this.rows(
      'SELECT * FROM zhiban_flow.versions WHERE tenant_id=$1 AND classroom_id=$2 AND version=$3',
      [a.tenantId, id, version],
    );
    requireAcademic(v, 'INVALID_STATE');
    return flowSteps(v.steps);
  }
  private async validateTargets(
    a: AcademicActor,
    o: string,
    steps: FlowStep[],
    lectures: ClassroomLecture[],
  ) {
    const snapshot = await new ClassroomPgTransaction(this.c).read(a, o, lectures, true);
    for (const step of steps) {
      const kind = step.kind === 'LECTURE' ? 'LECTURE' : 'ACTIVITY';
      requireAcademic(
        snapshot.choices.some(
          (x) => x.kind === kind && x.target === step.target && x.version === step.version,
        ),
        'INVALID_STATE',
      );
      if (step.kind === 'LECTURE')
        requireAcademic(
          lectures.some((r) => r.id === step.target && r.publication?.id === step.publicationId),
          'INVALID_STATE',
        );
      if (step.interactiveId)
        requireAcademic(
          snapshot.choices.some(
            (x) =>
              x.kind === 'LECTURE' &&
              x.target === step.interactiveId &&
              x.interactive &&
              x.publicationId === step.publicationId,
          ),
          'INVALID_STATE',
        );
      if (step.kind === 'LAB') {
        const [activity] = await this.rows(
          'SELECT activity_type FROM zhiban_learning.activities WHERE tenant_id=$1 AND id=$2 AND offering_id=$3',
          [a.tenantId, step.target, o],
        );
        requireAcademic(activity?.activity_type === 'TEXT_RESPONSE', 'INVALID_INPUT');
      }
    }
  }
  async read(
    a: AcademicActor,
    o: string,
    query: { classroomId: string | null; notebookId: string | null; after: string | null },
  ) {
    const access = await new LearningPgTransaction(this.c).access(a, o);
    const teacher = access.mode === 'TEACHER';
    if (query.notebookId) {
      const [n] = await this.rows(
        `SELECT n.*,n.revision::text,t.revision::text AS attempt_revision,t.status AS attempt_status,av.deadline_at,av.allow_resubmit,a.status AS activity_state,a.published_version,t.activity_version,NOT EXISTS(SELECT 1 FROM zhiban_learning.attempts later WHERE later.tenant_id=t.tenant_id AND later.activity_id=t.activity_id AND later.membership_id=t.membership_id AND later.attempt_no>t.attempt_no) AS latest_attempt,v.steps,s.title AS classroom_title FROM zhiban_flow.notebooks n JOIN zhiban_learning.attempts t ON t.tenant_id=n.tenant_id AND t.id=n.attempt_id JOIN zhiban_learning.activities a ON a.tenant_id=t.tenant_id AND a.id=t.activity_id JOIN zhiban_learning.activity_versions av ON av.tenant_id=t.tenant_id AND av.activity_id=t.activity_id AND av.version=t.activity_version JOIN zhiban_flow.versions v ON v.tenant_id=n.tenant_id AND v.classroom_id=n.classroom_id AND v.version=n.plan_version JOIN zhiban_classroom.sessions s ON s.tenant_id=n.tenant_id AND s.id=n.classroom_id WHERE n.tenant_id=$1 AND n.offering_id=$2 AND n.id=$3 AND ($4::uuid IS NULL OR n.membership_id=$4)`,
        [a.tenantId, o, query.notebookId, teacher ? null : a.membershipId],
      );
      requireAcademic(n, 'NOT_FOUND');
      const steps = flowSteps(n.steps);
      const step = steps[n.position];
      delete n.steps;
      let writable =
        !teacher &&
        n.enrollment_id === access.enrollmentId &&
        n.latest_attempt &&
        n.activity_state === 'PUBLISHED' &&
        Number(n.published_version) === Number(n.activity_version);
      try {
        writableAttempt(
          n.attempt_status,
          n.allow_resubmit,
          n.deadline_at === null ? null : Number(n.deadline_at),
          a.now,
        );
      } catch {
        writable = false;
      }
      n.writable = !!writable;
      if (step.lab?.execution) {
        const [live] = await this.rows(
          'SELECT s.state,s.opens_at,s.closes_at,r.state AS run_state,r.step_index,r.plan_version::text,d.state AS dispatch_state FROM zhiban_classroom.sessions s JOIN zhiban_flow.runs r ON r.tenant_id=s.tenant_id AND r.classroom_id=s.id JOIN zhiban_classroom.dispatches d ON d.tenant_id=s.tenant_id AND d.session_id=s.id WHERE s.tenant_id=$1 AND s.id=$2 AND d.id=$3',
          [a.tenantId, n.classroom_id, n.dispatch_id],
        );
        n.simulation_can_run = !!(
          writable &&
          live?.state === 'PUBLISHED' &&
          live.run_state === 'RUNNING' &&
          live.dispatch_state === 'ACTIVE' &&
          live.step_index === n.position &&
          live.plan_version === String(n.plan_version) &&
          (live.opens_at === null || Number(live.opens_at) <= a.now) &&
          (live.closes_at === null || Number(live.closes_at) > a.now)
        );
      }
      const reports = await this.rows(
        `SELECT r.*,r.notebook_revision::text,p.version AS grade_version,p.score_points,p.max_points,p.feedback,p.reason
        FROM zhiban_flow.reports r LEFT JOIN LATERAL (SELECT version,score_points,max_points,feedback,reason FROM zhiban_assessment.publications WHERE tenant_id=r.tenant_id AND submission_id=r.submission_id ORDER BY version DESC LIMIT 1)p ON true
        WHERE r.tenant_id=$1 AND r.notebook_id=$2 AND ($3::bigint IS NULL OR r.notebook_revision<$3) ORDER BY r.notebook_revision DESC LIMIT 21`,
        [a.tenantId, n.id, query.after],
      );
      const simulationRuns = step.lab?.execution ? await this.simulationRuns(a, n.id) : [];
      if (step.lab?.execution)
        for (const r of reports)
          r.simulationRunIds = (
            await this.rows(
              'SELECT run_id FROM zhiban_flow.simulation_report_runs WHERE tenant_id=$1 AND notebook_id=$2 AND notebook_revision=$3 ORDER BY position',
              [a.tenantId, n.id, r.notebook_revision],
            )
          ).map((x) => x.run_id);
      return {
        mode: access.mode,
        simulationRuns,
        notebook: n,
        step,
        reports: reports.slice(0, 20),
        reportNext: reports.length > 20 ? String(reports[19].notebook_revision) : null,
        source: step.lab?.execution ? SIMULATION_SOURCE : 'LEARNER_REPORTED',
        nativeRuntimeEnabled: false,
      };
    }
    if (query.classroomId) {
      const s = await this.session(a, o, query.classroomId);
      requireAcademic(teacher || s.state !== 'DRAFT', 'NOT_FOUND');
      const plan = await this.plan(a, s.id),
        run = await this.run(a, s.id);
      const steps = run
        ? await this.version(a, s.id, run.plan_version)
        : plan?.published_version
          ? await this.version(a, s.id, plan.published_version)
          : [];
      const dispatches = await this.rows(
        `SELECT f.position,f.dispatch_id,d.state,d.kind,d.target_id,d.target_version,d.title,d.current_page FROM zhiban_flow.dispatches f JOIN zhiban_classroom.dispatches d ON d.tenant_id=f.tenant_id AND d.id=f.dispatch_id WHERE f.tenant_id=$1 AND f.classroom_id=$2 ORDER BY f.position`,
        [a.tenantId, s.id],
      );
      return {
        mode: access.mode,
        classroom: s,
        plan: teacher ? plan : plan ? { published_version: plan.published_version } : null,
        run,
        steps,
        dispatches,
        nativeRuntimeEnabled: false,
      };
    }
    const rows = await this.rows(
      `SELECT n.id,n.classroom_id,n.attempt_id,n.submission_id,n.revision::text,n.updated_at,s.title AS classroom_title,(v.steps->n.position)->>'title' AS title FROM zhiban_flow.notebooks n JOIN zhiban_classroom.sessions s ON s.tenant_id=n.tenant_id AND s.id=n.classroom_id JOIN zhiban_flow.versions v ON v.tenant_id=n.tenant_id AND v.classroom_id=n.classroom_id AND v.version=n.plan_version WHERE n.tenant_id=$1 AND n.offering_id=$2 AND ($3::uuid IS NULL OR (n.membership_id=$3 AND $4::uuid IS NOT NULL)) AND ($5::uuid IS NULL OR n.id<$5) ORDER BY n.id DESC LIMIT 21`,
      [a.tenantId, o, teacher ? null : a.membershipId, access.enrollmentId ?? null, query.after],
    );
    const more = rows.length > 20;
    return {
      mode: access.mode,
      rows: rows.slice(0, 20),
      next: more ? rows[19].id : null,
      nativeRuntimeEnabled: false,
    };
  }
  async publication(a: AcademicActor, o: string, c: FlowCommand, key: string) {
    await new LearningPgTransaction(this.c).access(
      a,
      o,
      ['OPEN_LAB', 'SAVE_LAB', 'SUBMIT_LAB', 'RUN_SIMULATION'].includes(c.type)
        ? 'STUDENT'
        : 'TEACHER',
    );
    const [old] = await this.rows(
      'SELECT * FROM zhiban_flow.commands WHERE tenant_id=$1 AND command_key=$2',
      [a.tenantId, key],
    );
    if (old) {
      requireAcademic(
        old.offering_id === o &&
          old.actor_id === a.membershipId &&
          old.payload_digest === flowDigest({ offering: o, command: c }),
        'CONFLICT',
      );
      return null;
    }
    if (c.type === 'OPEN_LAB') {
      const [d] = await this.rows(
        'SELECT f.*,v.steps FROM zhiban_flow.dispatches f JOIN zhiban_flow.versions v ON v.tenant_id=f.tenant_id AND v.classroom_id=f.classroom_id AND v.version=f.plan_version WHERE f.tenant_id=$1 AND f.classroom_id=$2 AND f.dispatch_id=$3',
        [a.tenantId, c.classroomId, c.dispatchId],
      );
      requireAcademic(d, 'NOT_FOUND');
      const step = flowSteps(d.steps)[d.position];
      return step.interactiveId
        ? { resource: step.interactiveId, publication: step.publicationId! }
        : null;
    }
    if (c.type !== 'START_FLOW' && c.type !== 'NEXT_STEP') return null;
    const r = await this.run(a, c.classroomId);
    const version = c.type === 'START_FLOW' ? c.planVersion : r?.plan_version;
    requireAcademic(version, 'INVALID_STATE');
    const steps = await this.version(a, c.classroomId, version);
    const index = c.type === 'START_FLOW' ? 0 : Number(r.step_index) + 1;
    requireAcademic(index < steps.length, 'INVALID_STATE');
    const step = steps[index];
    return step.interactiveId
      ? { resource: step.interactiveId, publication: step.publicationId! }
      : null;
  }
  async execute(
    a: AcademicActor,
    o: string,
    c: FlowCommand,
    key: string,
    lectures: ClassroomLecture[],
    executorSourceSha256?: string,
  ) {
    await progressBarrier(this.c, a, o);
    const learning = new LearningPgTransaction(this.c);
    const student = ['OPEN_LAB', 'SAVE_LAB', 'SUBMIT_LAB', 'RUN_SIMULATION'].includes(c.type);
    const access = await learning.access(a, o, student ? 'STUDENT' : 'TEACHER');
    requireAcademic(access.offering.status === 'OPEN', 'INVALID_STATE');
    await this.c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `flow-command:${a.tenantId}:${key}`,
    ]);
    const digest = flowDigest({ offering: o, command: c });
    const [old] = await this.rows(
      'SELECT * FROM zhiban_flow.commands WHERE tenant_id=$1 AND command_key=$2',
      [a.tenantId, key],
    );
    if (old) {
      requireAcademic(
        old.actor_id === a.membershipId && old.offering_id === o && old.payload_digest === digest,
        'CONFLICT',
      );
      return old.result;
    }
    let classroom: string, result: QueryResultRow;
    let evidenceSource = c.type === 'OPEN_LAB' ? 'SERVER_LEARNING_TRANSACTION' : 'TEACHER_COMMAND';
    if (c.type === 'RUN_SIMULATION') {
      requireAcademic(
        executorSourceSha256 && /^[a-f0-9]{64}$/.test(executorSourceSha256),
        'UNAVAILABLE',
      );
      const [hint] = await this.rows(
        'SELECT classroom_id FROM zhiban_flow.notebooks WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND membership_id=$4',
        [a.tenantId, o, c.id, a.membershipId],
      );
      requireAcademic(hint, 'NOT_FOUND');
      const session = await this.session(a, o, hint.classroom_id, true);
      const run = await this.run(a, hint.classroom_id);
      const [n] = await this.rows(
        'SELECT *,revision::text FROM zhiban_flow.notebooks WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND membership_id=$4 FOR UPDATE',
        [a.tenantId, o, c.id, a.membershipId],
      );
      requireAcademic(n && n.enrollment_id === access.enrollmentId, 'NOT_FOUND');
      requireAcademic(n.revision === c.revision, 'CONFLICT');
      requireAcademic(
        session.state === 'PUBLISHED' &&
          (session.opens_at === null || Number(session.opens_at) <= a.now) &&
          (session.closes_at === null || Number(session.closes_at) > a.now) &&
          run?.state === 'RUNNING' &&
          run.plan_version === String(n.plan_version) &&
          run.step_index === n.position,
        'INVALID_STATE',
      );
      const [dispatch] = await this.rows(
        'SELECT state FROM zhiban_classroom.dispatches WHERE tenant_id=$1 AND id=$2',
        [a.tenantId, n.dispatch_id],
      );
      requireAcademic(dispatch?.state === 'ACTIVE', 'INVALID_STATE');
      const step = (await this.version(a, n.classroom_id, n.plan_version))[n.position];
      requireAcademic(step.lab?.execution, 'INVALID_STATE');
      const previous = await this.simulationRuns(a, n.id);
      requireAcademic(previous.length < 50, 'INVALID_STATE');
      const [attempt] = await this.rows(
        'SELECT draft,revision::text FROM zhiban_learning.attempts WHERE tenant_id=$1 AND id=$2 AND membership_id=$3',
        [a.tenantId, n.attempt_id, a.membershipId],
      );
      requireAcademic(attempt?.revision === c.attemptRevision, 'CONFLICT');
      await learning.execute(
        a,
        o,
        {
          type: 'SAVE_DRAFT',
          id: n.attempt_id,
          revision: c.attemptRevision,
          answer: String(attempt.draft),
        },
        flowDigest({ key, scope: 'flow-simulation' }),
      );
      const calculation = executeSimulation(
        step.lab.execution.model,
        c.parameters,
        executorSourceSha256,
      );
      const id = v7(),
        sequence = previous.length + 1,
        nextRevision = String(BigInt(n.revision) + BigInt(1));
      await this.c.query(
        'INSERT INTO zhiban_flow.simulation_runs VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [
          a.tenantId,
          id,
          n.id,
          sequence,
          nextRevision,
          SIMULATION_SOURCE,
          calculation.modelId,
          calculation.modelSha256,
          calculation.executorSourceSha256,
          calculation.inputSha256,
          calculation.outputSha256,
          JSON.stringify(calculation.parameters),
          JSON.stringify(calculation.values),
          a.now,
        ],
      );
      const rows = this.simulationRows([
        ...previous,
        { id, sequence, model_id: calculation.modelId, result: calculation.values },
      ]);
      labValues({ parameters: calculation.parameters, rows, conclusion: c.conclusion }, step.lab);
      await this.c.query(
        'UPDATE zhiban_flow.notebooks SET revision=revision+1,parameters=$3,measurements=$4,conclusion=$5,updated_at=$6 WHERE tenant_id=$1 AND id=$2',
        [
          a.tenantId,
          n.id,
          JSON.stringify(calculation.parameters),
          JSON.stringify(rows),
          c.conclusion,
          a.now,
        ],
      );
      result = {
        id: n.id,
        revision: nextRevision,
        runId: id,
        source: SIMULATION_SOURCE,
        model: calculation.modelId,
        outputSha256: calculation.outputSha256,
      };
      classroom = n.classroom_id;
      evidenceSource = SIMULATION_SOURCE;
    } else if (c.type === 'SAVE_LAB' || c.type === 'SUBMIT_LAB') {
      const [n] = await this.rows(
        'SELECT *,revision::text FROM zhiban_flow.notebooks WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND membership_id=$4 FOR UPDATE',
        [a.tenantId, o, c.id, a.membershipId],
      );
      requireAcademic(n && n.enrollment_id === access.enrollmentId, 'NOT_FOUND');
      requireAcademic(n.revision === c.revision, 'CONFLICT');

      const steps = await this.version(a, n.classroom_id, n.plan_version);
      const step = steps[n.position];
      const values = labValues(c, step.lab!, c.type === 'SUBMIT_LAB');
      const simulationRuns = step.lab?.execution ? await this.simulationRuns(a, n.id) : [];
      if (step.lab?.execution) {
        requireAcademic(executorSourceSha256, 'UNAVAILABLE');
        requireAcademic(
          flowDigest(values.parameters) === flowDigest(n.parameters) &&
            flowDigest(values.rows) === flowDigest(this.simulationRows(simulationRuns)),
          'INVALID_INPUT',
        );
        requireAcademic(c.type !== 'SUBMIT_LAB' || simulationRuns.length > 0, 'INVALID_STATE');
        evidenceSource = SIMULATION_SOURCE;
      } else evidenceSource = 'LEARNER_REPORTED';
      const [attempt] = await this.rows(
        'SELECT *,revision::text FROM zhiban_learning.attempts WHERE tenant_id=$1 AND id=$2 AND membership_id=$3',
        [a.tenantId, n.attempt_id, a.membershipId],
      );
      requireAcademic(attempt?.revision === c.attemptRevision, 'CONFLICT');
      let submission: string | null = null;
      if (c.type === 'SUBMIT_LAB') {
        const r = await learning.execute(
          a,
          o,
          {
            type: 'SUBMIT',
            id: n.attempt_id,
            revision: c.attemptRevision,
            answer: labReportText(step, values, n.id),
          },
          flowDigest({ key, scope: 'flow-report' }),
          undefined,
          undefined,
          n.id,
        );
        submission = String(r.submissionId);
      } else {
        // Reuse original deadline/current-version/latest-Attempt checks without replacing a learner's text draft.
        await learning.execute(
          a,
          o,
          {
            type: 'SAVE_DRAFT',
            id: n.attempt_id,
            revision: c.attemptRevision,
            answer: String(attempt.draft),
          },
          flowDigest({ key, scope: 'flow-draft' }),
        );
      }
      const nextRevision = String(BigInt(n.revision) + BigInt(1));
      if (submission)
        await this.c.query(
          'INSERT INTO zhiban_flow.reports VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
          [
            a.tenantId,
            n.id,
            nextRevision,
            submission,
            n.attempt_id,
            JSON.stringify(values.parameters),
            JSON.stringify(values.rows),
            values.conclusion,
            step.lab?.execution
              ? flowDigest({
                  step,
                  values,
                  simulation: simulationRuns.map((r) => ({
                    id: r.id,
                    inputSha256: r.input_sha256,
                    outputSha256: r.output_sha256,
                  })),
                })
              : flowDigest({ step, values }),
            a.now,
          ],
        );
      if (submission && step.lab?.execution)
        for (const r of simulationRuns)
          await this.c.query(
            'INSERT INTO zhiban_flow.simulation_report_runs VALUES($1,$2,$3,$4,$5,$6)',
            [a.tenantId, n.id, nextRevision, submission, r.id, r.sequence],
          );
      const [next] = await this.rows(
        'UPDATE zhiban_flow.notebooks SET revision=revision+1,parameters=$3,measurements=$4,conclusion=$5,submission_id=coalesce($6,submission_id),submitted_revision=CASE WHEN $6::uuid IS NULL THEN submitted_revision ELSE revision+1 END,updated_at=$7 WHERE tenant_id=$1 AND id=$2 RETURNING id,revision::text,submission_id',
        [
          a.tenantId,
          n.id,
          JSON.stringify(values.parameters),
          JSON.stringify(values.rows),
          values.conclusion,
          submission,
          a.now,
        ],
      );
      result = next;
      classroom = n.classroom_id;
    } else {
      requireAcademic('classroomId' in c);
      classroom = c.classroomId;
      const s = await this.session(a, o, classroom, true);
      const plan = await this.plan(a, classroom),
        run = await this.run(a, classroom);
      const classrooms = new ClassroomPgTransaction(this.c);
      const innerKey = flowDigest({ key, scope: 'flow-classroom' });
      if (c.type === 'SAVE_PLAN') {
        requireAcademic(s.state !== 'ENDED' && !run, 'INVALID_STATE');
        requireAcademic((plan?.revision ?? '0') === c.revision, 'CONFLICT');
        await this.validateTargets(a, o, c.steps, lectures);
        const [p] = await this.rows(
          'INSERT INTO zhiban_flow.plans VALUES($1,$2,$3,1,$4,NULL,$5,$6) ON CONFLICT(tenant_id,classroom_id) DO UPDATE SET revision=zhiban_flow.plans.revision+1,draft=excluded.draft,updated_by=excluded.updated_by,updated_at=excluded.updated_at RETURNING revision::text',
          [a.tenantId, classroom, o, JSON.stringify(c.steps), a.membershipId, a.now],
        );
        result = { classroomId: classroom, revision: p.revision };
      } else if (c.type === 'PUBLISH_PLAN') {
        requireAcademic(plan && plan.revision === c.revision, 'CONFLICT');
        requireAcademic(s.state !== 'ENDED' && !run, 'INVALID_STATE');
        const steps = flowSteps(plan.draft);
        await this.validateTargets(a, o, steps, lectures);
        const version = String(BigInt(plan.revision) + BigInt(1));
        await this.c.query('INSERT INTO zhiban_flow.versions VALUES($1,$2,$3,$4,$5,$6,$7)', [
          a.tenantId,
          classroom,
          version,
          JSON.stringify(steps),
          flowDigest(steps),
          a.membershipId,
          a.now,
        ]);
        await this.c.query(
          'UPDATE zhiban_flow.plans SET published_version=$3,revision=revision+1,updated_by=$4,updated_at=$5 WHERE tenant_id=$1 AND classroom_id=$2',
          [a.tenantId, classroom, version, a.membershipId, a.now],
        );
        result = { classroomId: classroom, revision: version, planVersion: version };
      } else if (c.type === 'OPEN_LAB') {
        const steps = run ? await this.version(a, classroom, run.plan_version) : [];
        const [d] = await this.rows(
          'SELECT position FROM zhiban_flow.dispatches WHERE tenant_id=$1 AND classroom_id=$2 AND dispatch_id=$3',
          [a.tenantId, classroom, c.dispatchId],
        );
        requireAcademic(d && steps[d.position]?.kind === 'LAB', 'INVALID_STATE');
        const entered = await classrooms.execute(
          a,
          o,
          { type: 'ENTER_TASK', id: classroom, revision: s.revision, dispatchId: c.dispatchId },
          innerKey,
          lectures,
          true,
          true,
        );
        const [n] = await this.rows(
          'SELECT id,revision::text FROM zhiban_flow.notebooks WHERE tenant_id=$1 AND attempt_id=$2 AND membership_id=$3',
          [a.tenantId, entered.attemptId, a.membershipId],
        );
        requireAcademic(n, 'INVALID_STATE');
        result = { ...n, attemptId: entered.attemptId };
      } else {
        requireAcademic(s.state === 'PUBLISHED', 'INVALID_STATE');
        if (c.type === 'START_FLOW') {
          requireAcademic(
            !run && plan?.published_version === c.planVersion && plan.revision === c.planVersion,
            'INVALID_STATE',
          );
          requireAcademic(s.revision === c.classroomRevision, 'CONFLICT');
        } else requireAcademic(run && run.revision === c.revision, 'CONFLICT');
        if (c.type === 'START_FLOW' || c.type === 'NEXT_STEP') {
          requireAcademic(c.type === 'START_FLOW' || run.state === 'RUNNING', 'INVALID_STATE');
          const version = c.type === 'START_FLOW' ? c.planVersion : run.plan_version,
            steps = await this.version(a, classroom, version),
            index = c.type === 'START_FLOW' ? 0 : Number(run.step_index) + 1;
          requireAcademic(index < steps.length, 'INVALID_STATE');
          const step = steps[index];
          await this.validateTargets(a, o, [{ ...step, requires: [] }], lectures);
          if (!run)
            await this.c.query(
              "INSERT INTO zhiban_flow.runs VALUES($1,$2,$3,$4,'RUNNING',0,1,$5,$6)",
              [a.tenantId, classroom, o, version, a.membershipId, a.now],
            );
          const dispatched = await classrooms.execute(
            a,
            o,
            step.interactiveId
              ? {
                  type: 'DISPATCH_JOINT_TASK',
                  id: classroom,
                  revision: s.revision,
                  activityId: step.target,
                  activityVersion: step.version,
                  interactiveId: step.interactiveId,
                  publicationId: step.publicationId!,
                }
              : {
                  type: 'DISPATCH_TASK',
                  id: classroom,
                  revision: s.revision,
                  kind: step.kind === 'LECTURE' ? 'LECTURE' : 'ACTIVITY',
                  target: step.target,
                  version: step.version,
                },
            innerKey,
            lectures,
            true,
            true,
          );
          await this.c.query('INSERT INTO zhiban_flow.dispatches VALUES($1,$2,$3,$4,$5)', [
            a.tenantId,
            classroom,
            version,
            index,
            dispatched.dispatchId,
          ]);
          if (run)
            await this.c.query(
              'UPDATE zhiban_flow.runs SET step_index=$3,revision=revision+1,updated_by=$4,updated_at=$5 WHERE tenant_id=$1 AND classroom_id=$2',
              [a.tenantId, classroom, index, a.membershipId, a.now],
            );
          result = {
            classroomId: classroom,
            revision: run ? String(BigInt(run.revision) + BigInt(1)) : '1',
            dispatchId: dispatched.dispatchId,
            stepIndex: index,
          };
        } else {
          requireAcademic(['RUNNING', 'PAUSED'].includes(run.state), 'INVALID_STATE');
          if (c.type === 'PAUSE_FLOW') requireAcademic(run.state === 'RUNNING', 'INVALID_STATE');
          if (c.type === 'RESUME_FLOW') requireAcademic(run.state === 'PAUSED', 'INVALID_STATE');
          if (c.type === 'FINISH_FLOW') {
            const steps = await this.version(a, classroom, run.plan_version);
            requireAcademic(run.step_index === steps.length - 1, 'INVALID_STATE');
          }
          if (c.type === 'FINISH_FLOW' || c.type === 'CANCEL_FLOW')
            await classrooms.execute(
              a,
              o,
              { type: 'END_CLASSROOM', id: classroom, revision: s.revision },
              innerKey,
              lectures,
              true,
              true,
            );
          const state =
            c.type === 'PAUSE_FLOW'
              ? 'PAUSED'
              : c.type === 'RESUME_FLOW'
                ? 'RUNNING'
                : c.type === 'FINISH_FLOW'
                  ? 'FINISHED'
                  : 'CANCELLED';
          await this.c.query(
            'UPDATE zhiban_flow.runs SET state=$3,revision=revision+1,updated_by=$4,updated_at=$5 WHERE tenant_id=$1 AND classroom_id=$2',
            [a.tenantId, classroom, state, a.membershipId, a.now],
          );
          result = {
            classroomId: classroom,
            revision: String(BigInt(run.revision) + BigInt(1)),
            state,
          };
        }
      }
    }
    await this.c.query('INSERT INTO zhiban_flow.events VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [
      a.tenantId,
      v7(),
      o,
      classroom,
      a.membershipId,
      c.type,
      JSON.stringify({
        command: c.type,
        result,
        reason: 'reason' in c ? c.reason : null,
        source: evidenceSource,
      }),
      a.now,
    ]);
    await this.c.query('INSERT INTO zhiban_flow.commands VALUES($1,$2,$3,$4,$5,$6,$7)', [
      a.tenantId,
      key,
      o,
      a.membershipId,
      digest,
      JSON.stringify(result),
      a.now,
    ]);
    return result;
  }
}
