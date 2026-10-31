import { verifyInstalledSchema } from '@/lib/persistence/installed-schema';
import { writableAttempt } from '../../domain/learning/model';
/* eslint-disable @typescript-eslint/no-explicit-any -- native publication and original academic rows */
import { readFile } from 'node:fs/promises';
import type { Pool, PoolClient } from 'pg';
import { v7 } from 'uuid';
import { applySchemaMigrations } from '@openmaic/storage/pg-migrations';
import type { AcademicContext, AcademicStore } from '../../application/academic/service';
import { AcademicError, requireAcademic } from '../../domain/academic/model';
import type { ContentContext, ContentService } from '../content/service';
import { ContentError } from '../content/model';
import { LearningPgTransaction } from '../learning/postgres/transaction';
import { ClassroomAiService } from '../classroom-ai/service';
import { PublishedPblService } from '../classroom-ai/pbl';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { createWhiteboardRuntimeService } from '@/lib/whiteboard/runtime/store';
import { proseToPlainText } from '@/lib/export/pptx-rich-text';
import { configureCourseEvidenceGate, withCourseProof } from './learning-gate';
import {
  digest,
  taskSpec,
  quizEvidence,
  completedPblEvidence,
  reportText,
  type ResultCommand,
  type TaskSpec,
} from './model';
export async function initializeCourseResults(pool: Pool) {
  if (await verifyInstalledSchema(pool)) {
    configureCourseEvidenceGate(pool);
    return digest(await readFile('lib/zhiban/infrastructure/course-results/schema.sql', 'utf8'));
  }
  const sql = await readFile('lib/zhiban/infrastructure/course-results/schema.sql', 'utf8');
  await applySchemaMigrations(pool, {
    store: 'zhiban-course-results',
    migrations: [{ version: 1, name: 'trusted-course-evidence', up: sql }],
  });
  const expectedTables = [
    'zhiban_course_result_tasks',
    'zhiban_course_result_anchors',
    'zhiban_course_result_proofs',
    'zhiban_course_shared_results',
    'zhiban_course_result_events',
  ];
  const acl = await pool.query(
    `SELECT c.relname,c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned,
    NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner) AS closed
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1::text[])`,
    [expectedTables],
  );
  requireAcademic(
    acl.rows.length === expectedTables.length && acl.rows.every((r) => r.owned && r.closed),
    'UNAVAILABLE',
  );
  const immutable = (
    await pool.query(`SELECT p.prosrc,p.prosecdef,p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned,
    NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner) AS closed,
    (SELECT count(*)::int FROM pg_trigger t WHERE t.tgfoid=p.oid AND t.tgenabled='O' AND t.tgtype=27) AS triggers
    FROM pg_proc p WHERE p.oid='public.zhiban_course_result_immutable()'::regprocedure`)
  ).rows[0];
  requireAcademic(
    immutable?.owned &&
      immutable.closed &&
      !immutable.prosecdef &&
      immutable.triggers === 4 &&
      immutable.prosrc.trim() === sql.match(/AS \$\$([\s\S]*?)\$\$/)![1].trim(),
    'UNAVAILABLE',
  );
  configureCourseEvidenceGate(pool);
  return digest(sql);
}
export class CourseResultsService {
  readonly classroom: ClassroomAiService;
  readonly pbl: PublishedPblService;
  constructor(
    private store: AcademicStore,
    readonly pool: Pool,
    readonly content: ContentService,
  ) {
    this.classroom = new ClassroomAiService(content, pool);
    this.pbl = new PublishedPblService(this.classroom);
  }
  private cx(x: AcademicContext, o: string): ContentContext {
    return { handle: x.handle, tenant: x.tenantId, offering: o, member: x.actorMembershipId };
  }
  private tx<T>(
    x: AcademicContext,
    o: string,
    work: (a: any, l: LearningPgTransaction, teacher: boolean) => Promise<T>,
    kind?: 'TEACHER' | 'STUDENT',
  ) {
    return this.store.run(x, null, async (a, t) => {
      const l = t.learning as LearningPgTransaction,
        access = await l.access(a, o, kind);
      return work(a, l, access.mode === 'TEACHER');
    });
  }
  private async source<T>(
    x: AcademicContext,
    o: string,
    s: TaskSpec,
    work: (ctx: Awaited<ReturnType<ClassroomAiService['context']>>, c?: PoolClient) => Promise<T>,
    enabled = true,
  ) {
    const cx = this.cx(x, o),
      ctx = await this.classroom.context(cx, s.resourceId, s.publicationId);
    requireAcademic(ctx.snapshot.sourceDigest === s.sourceDigest, 'CONFLICT');
    const scene = ctx.doc.scenes.find((sc) => sc.id === s.sceneId);
    requireAcademic(scene, 'NOT_FOUND');
    requireAcademic(
      s.kind === 'REFLECTION' ||
        (s.kind === 'QUIZ' ? scene.content.type === 'quiz' : scene.content.type === 'pbl'),
    );
    let original: unknown;
    const guarded = async (c?: PoolClient) => {
      try {
        return await work(ctx, c);
      } catch (e) {
        original = e;
        throw e;
      }
    };
    try {
      return await (!enabled
        ? this.content.withPublishedAccess(cx, s.resourceId, s.publicationId, () => guarded())
        : s.kind === 'PBL'
          ? this.pbl.guard(cx, s.resourceId, s.publicationId, guarded)
          : this.classroom.guard(cx, s.resourceId, s.publicationId, guarded));
    } catch (e) {
      throw original ?? e;
    }
  }
  private async task(tenant: string, activity: string, version: number) {
    return (
      await this.pool.query(
        'SELECT *,revision::text FROM zhiban_course_result_tasks WHERE tenant_id=$1 AND activity_id=$2 AND activity_version=$3',
        [tenant, activity, version],
      )
    ).rows[0];
  }
  private async anchor(x: AcademicContext, o: string, attempt: string) {
    return this.tx(
      x,
      o,
      async (a, l) => {
        const [t] = await l.rows(
          'SELECT * FROM zhiban_learning.attempts WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 AND membership_id=$4',
          [a.tenantId, o, attempt, a.membershipId],
        );
        requireAcademic(t, 'NOT_FOUND');
        const b = (
          await this.pool.query(
            'SELECT * FROM zhiban_course_result_anchors WHERE attempt_id=$1 AND tenant_id=$2 AND offering_id=$3 AND member_id=$4',
            [attempt, a.tenantId, o, a.membershipId],
          )
        ).rows[0];
        requireAcademic(b, 'INVALID_STATE');
        return { attempt: t, anchor: b };
      },
      'STUDENT',
    );
  }
  private async baseline(
    ctx: Awaited<ReturnType<ClassroomAiService['context']>>,
    s: TaskSpec,
    c?: PoolClient,
  ) {
    if (s.kind === 'PBL') {
      const state = await this.pbl.read(ctx, s.sceneId, c ?? this.pool);
      return {
        revision: state.revision,
        eventIds: (state.project.runtimeEvents ?? []).map((e) => e.id),
      };
    }
    if (s.kind === 'QUIZ') {
      const { runtimeStore } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
      const sessions = (
        await runtimeStore.listSessions(ctx.binding.stage, ctx.binding.owner)
      ).filter((v) => v.kind === 'quizAttempt');
      requireAcademic(sessions.length <= 100, 'UNAVAILABLE');
      const tails: Record<string, number> = {};
      for (const v of sessions) {
        const rows = await runtimeStore.listRecords(v.id, { sceneId: s.sceneId });
        tails[v.id] = rows.at(-1)?.seq ?? -1;
      }
      return { tails };
    }
    return { source: 'LEARNER_REFLECTION', formalGrade: null };
  }
  async list(x: AcademicContext, o: string, before?: string) {
    const access = await this.tx(x, o, async (a, l, teacher) => {
      const [course] = await l.rows(
        'SELECT course_id,name FROM zhiban_academic.offerings WHERE tenant_id=$1 AND id=$2',
        [a.tenantId, o],
      );
      const rows = await l.rows(
        `SELECT a.id,a.title,a.activity_type,a.status,a.published_version FROM zhiban_learning.activities a WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.status='PUBLISHED' AND a.activity_type='TEXT_RESPONSE' ORDER BY a.id DESC LIMIT 100`,
        [a.tenantId, o],
      );
      const attempts = teacher
        ? []
        : await l.rows(
            'SELECT t.id,t.activity_id,t.activity_version,t.status,t.revision::text,v.allow_resubmit,v.deadline_at FROM zhiban_learning.attempts t JOIN zhiban_learning.activity_versions v ON v.tenant_id=t.tenant_id AND v.activity_id=t.activity_id AND v.version=t.activity_version WHERE t.tenant_id=$1 AND t.offering_id=$2 AND t.membership_id=$3 ORDER BY t.id DESC LIMIT 50',
            [a.tenantId, o, a.membershipId],
          );
      const submissions = await l.rows(
        `SELECT e.id,e.facts->'result' AS result,s.id AS submission_id,t.id AS attempt_id,t.membership_id,t.activity_id,person.display_name,v.title,p.score_points,p.max_points,p.feedback
    FROM zhiban_academic.audit_events e JOIN zhiban_learning.submissions s ON s.tenant_id=e.tenant_id AND s.id=(e.facts->'result'->>'submissionId')::uuid
    JOIN zhiban_learning.attempts t ON t.tenant_id=s.tenant_id AND t.id=s.attempt_id JOIN zhiban_learning.activity_versions v ON v.tenant_id=t.tenant_id AND v.activity_id=t.activity_id AND v.version=t.activity_version
    LEFT JOIN zhiban_academic.people person ON person.tenant_id=t.tenant_id AND person.membership_id=t.membership_id
    LEFT JOIN LATERAL(SELECT score_points,max_points,feedback FROM zhiban_assessment.publications WHERE tenant_id=s.tenant_id AND submission_id=s.id ORDER BY version DESC LIMIT 1)p ON true
    WHERE e.tenant_id=$1 AND e.facts->>'offeringId'=$2 AND e.facts->'result'->'classroomEvidence' IS NOT NULL AND ($3::uuid IS NULL OR t.membership_id=$3) AND ($4::uuid IS NULL OR e.id<$4)
    ORDER BY e.id DESC LIMIT 26`,
        [a.tenantId, o, teacher ? null : a.membershipId, before ?? null],
      );
      const labReports = await l.rows(
        `SELECT r.submission_id,r.notebook_id,n.membership_id,r.source_digest,r.conclusion,s.title,
        (SELECT coalesce(jsonb_agg(jsonb_build_object('id',run.id,'source',run.source,'model',run.model_id,'modelHash',run.model_sha256,'executorHash',run.executor_source_sha256,'inputHash',run.input_sha256,'outputHash',run.output_sha256,'parameters',run.parameters,'result',run.result) ORDER BY ref.position),'[]'::jsonb)
         FROM zhiban_flow.simulation_report_runs ref JOIN zhiban_flow.simulation_runs run ON run.tenant_id=ref.tenant_id AND run.id=ref.run_id WHERE ref.tenant_id=r.tenant_id AND ref.submission_id=r.submission_id) AS runs,
        p.score_points,p.max_points,p.feedback FROM zhiban_flow.reports r JOIN zhiban_flow.notebooks n ON n.tenant_id=r.tenant_id AND n.id=r.notebook_id JOIN zhiban_classroom.sessions s ON s.tenant_id=n.tenant_id AND s.id=n.classroom_id
        LEFT JOIN LATERAL(SELECT score_points,max_points,feedback FROM zhiban_assessment.publications WHERE tenant_id=r.tenant_id AND submission_id=r.submission_id ORDER BY version DESC LIMIT 1)p ON true
        WHERE r.tenant_id=$1 AND n.offering_id=$2 AND ($3::uuid IS NULL OR n.membership_id=$3) ORDER BY r.submission_id DESC LIMIT 25`,
        [a.tenantId, o, teacher ? null : a.membershipId],
      );
      return {
        teacher,
        progress: teacher ? null : await l.progress(a, o),
        labReports,
        courseId: course.course_id,
        courseName: course.name,
        activities: rows,
        attempts,
        submissions: submissions.slice(0, 25),
        next: submissions.length > 25 ? submissions[24].id : null,
      };
    });
    const tasks = (
      await this.pool.query(
        'SELECT activity_id,activity_version,revision::text,enabled,spec FROM zhiban_course_result_tasks WHERE tenant_id=$1 AND offering_id=$2 ORDER BY activity_id LIMIT 100',
        [x.tenantId, o],
      )
    ).rows;
    const ids = access.submissions.map((s) => (s.result as any).classroomEvidence.proofId);
    const proofs = (
      await this.pool.query(
        `SELECT id,attempt_id,digest,payload,created_at FROM zhiban_course_result_proofs WHERE tenant_id=$1 AND offering_id=$2 AND ${access.teacher ? 'id=ANY($3::uuid[])' : 'member_id=$3::uuid'} ORDER BY id DESC LIMIT 50`,
        [x.tenantId, o, access.teacher ? ids : x.actorMembershipId],
      )
    ).rows;
    const choices: unknown[] = [];
    if (access.teacher) {
      const list = await this.content.list(this.cx(x, o));
      for (const r of list.resources.slice(0, 50)) {
        if (r.state !== 'PUBLISHED' || !r.publication) continue;
        try {
          const p = await this.classroom.snapshots.published(this.cx(x, o), r.id, r.publication.id);
          choices.push({
            resourceId: r.id,
            publicationId: r.publication.id,
            sourceDigest: p.sourceDigest,
            title: r.publication.title,
            scenes: p.document.scenes.map((s) => ({
              id: s.id,
              title: s.title,
              kind:
                s.content.type === 'quiz'
                  ? 'QUIZ'
                  : s.content.type === 'pbl'
                    ? 'PBL'
                    : 'REFLECTION',
            })),
          });
        } catch (e) {
          if (!(e instanceof ContentError && e.status === 404)) throw e;
        }
      }
    }
    const shared = (
      await this.pool.query(
        `SELECT id,resource_id,publication_id,title,summary,whiteboard,source_digest,created_at FROM zhiban_course_shared_results s WHERE tenant_id=$1 AND offering_id=$2 AND NOT EXISTS(SELECT 1 FROM zhiban_course_result_events e WHERE e.tenant_id=s.tenant_id AND e.offering_id=s.offering_id AND e.event_kind='RETRACT_SHARED' AND e.payload->>'sharedId'=s.id::text) ORDER BY id DESC LIMIT 20`,
        [x.tenantId, o],
      )
    ).rows;
    // Copy-only shared notes remain course-qualified, with no private learner chat or generated grade.
    await this.tx(x, o, async () => {});
    return { ...access, tasks, proofs, choices, shared };
  }
  async execute(x: AcademicContext, o: string, c: ResultCommand, key: string) {
    requireAcademic(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    if (c.type === 'RETRACT_SHARED') return this.retract(x, o, c, key);
    if (c.type === 'SET_TASK') return this.setTask(x, o, c, key);
    if (c.type === 'START') return this.start(x, o, c, key);
    if (c.type === 'CAPTURE') return this.capture(x, o, c, key);
    if (c.type === 'SUBMIT') return this.submit(x, o, c, key);
    return this.share(x, o, c, key);
  }
  private async setTask(
    x: AcademicContext,
    o: string,
    c: Extract<ResultCommand, { type: 'SET_TASK' }>,
    key: string,
  ) {
    await this.tx(x, o, async () => {}, 'TEACHER');
    const work = () =>
      this.tx(
        x,
        o,
        async (a, l) => {
          const [activity] = await l.rows(
            'SELECT * FROM zhiban_learning.activities WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR UPDATE',
            [a.tenantId, o, c.activityId],
          );
          requireAcademic(
            activity?.status === 'PUBLISHED' &&
              activity.activity_type === 'TEXT_RESPONSE' &&
              activity.published_version === c.activityVersion,
            'INVALID_STATE',
          );
          const n = await this.pool.connect();
          try {
            await n.query('BEGIN');
            await n.query('SELECT pg_advisory_xact_lock(hashtext($1))', [a.tenantId + ':' + key]);
            const prior = (
              await n.query(
                'SELECT intent_digest,payload FROM zhiban_course_result_events WHERE tenant_id=$1 AND actor_id=$2 AND command_id=$3',
                [a.tenantId, a.membershipId, key],
              )
            ).rows[0];
            if (prior) {
              requireAcademic(prior.intent_digest === digest(c), 'CONFLICT');
              await n.query('COMMIT');
              return prior.payload;
            }
            const row = (
              await n.query(
                'SELECT revision::text,spec FROM zhiban_course_result_tasks WHERE tenant_id=$1 AND activity_id=$2 AND activity_version=$3 FOR UPDATE',
                [a.tenantId, c.activityId, c.activityVersion],
              )
            ).rows[0];
            requireAcademic(c.enabled || row, 'INVALID_STATE');
            requireAcademic((row?.revision ?? '0') === c.revision, 'CONFLICT');
            requireAcademic(!row || digest(row.spec) === digest(c.spec), 'CONFLICT');
            const next = String(BigInt(c.revision) + BigInt(1));
            await n.query(
              `INSERT INTO zhiban_course_result_tasks(tenant_id,offering_id,activity_id,activity_version,revision,enabled,spec,updated_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT(tenant_id,activity_id,activity_version) DO UPDATE SET revision=excluded.revision,enabled=excluded.enabled,spec=excluded.spec,updated_by=excluded.updated_by,updated_at=now()`,
              [
                a.tenantId,
                o,
                c.activityId,
                c.activityVersion,
                next,
                c.enabled,
                JSON.stringify(c.spec),
                a.membershipId,
              ],
            );
            const result = { revision: next };
            await n.query(
              'INSERT INTO zhiban_course_result_events(id,tenant_id,offering_id,actor_id,event_kind,command_id,intent_digest,payload)VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
              [v7(), a.tenantId, o, a.membershipId, c.type, key, digest(c), JSON.stringify(result)],
            );
            requireAcademic(Date.now() < a.expiresAt, 'FORBIDDEN');
            await n.query('COMMIT');
            return result;
          } catch (e) {
            await n.query('ROLLBACK');
            throw e;
          } finally {
            n.release();
          }
        },
        'TEACHER',
      );
    return c.enabled ? this.source(x, o, c.spec, () => work(), false) : work();
  }
  private async start(
    x: AcademicContext,
    o: string,
    c: Extract<ResultCommand, { type: 'START' }>,
    key: string,
  ) {
    await this.tx(x, o, async () => {}, 'STUDENT');
    const t = await this.task(x.tenantId, c.activityId, c.activityVersion);
    requireAcademic(t?.enabled, 'INVALID_STATE');
    const spec = taskSpec.parse(t.spec);
    return this.source(x, o, spec, (ctx, n) =>
      this.tx(
        x,
        o,
        async (a, l) => {
          const result = await l.execute(
            a,
            o,
            { type: 'START_ATTEMPT', id: c.activityId, expectedVersion: String(c.activityVersion) },
            key,
          );
          const [attempt] = await l.rows(
            'SELECT * FROM zhiban_learning.attempts WHERE tenant_id=$1 AND id=$2',
            [a.tenantId, result.id],
          );
          const previous = (
            await this.pool.query(
              'SELECT spec FROM zhiban_course_result_anchors WHERE attempt_id=$1 AND tenant_id=$2 AND member_id=$3',
              [attempt.id, a.tenantId, a.membershipId],
            )
          ).rows[0];
          if (!previous) {
            const baseline = await this.baseline(ctx, spec, n);
            await this.pool.query(
              'INSERT INTO zhiban_course_result_anchors(attempt_id,tenant_id,offering_id,member_id,enrollment_id,activity_id,activity_version,task_revision,spec,baseline) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(attempt_id) DO NOTHING',
              [
                attempt.id,
                a.tenantId,
                o,
                a.membershipId,
                attempt.enrollment_id,
                attempt.activity_id,
                attempt.activity_version,
                t.revision,
                JSON.stringify(spec),
                JSON.stringify(baseline),
              ],
            );
          }
          return {
            ...result,
            activityId: attempt.activity_id,
            activityVersion: attempt.activity_version,
            source: previous?.spec ?? spec,
          };
        },
        'STUDENT',
      ),
    );
  }
  private async capture(
    x: AcademicContext,
    o: string,
    c: Extract<ResultCommand, { type: 'CAPTURE' }>,
    key: string,
  ) {
    const { anchor, attempt } = await this.anchor(x, o, c.attemptId);
    const prior = (
      await this.pool.query(
        'SELECT id,digest,payload,intent_digest FROM zhiban_course_result_proofs WHERE tenant_id=$1 AND member_id=$2 AND command_id=$3',
        [x.tenantId, x.actorMembershipId, key],
      )
    ).rows[0];
    if (prior) {
      requireAcademic(prior.intent_digest === digest(c), 'CONFLICT');
      return prior;
    }
    requireAcademic(['IN_PROGRESS', 'SUBMITTED'].includes(String(attempt.status)), 'INVALID_STATE');
    const spec = taskSpec.parse(anchor.spec);
    return this.source(x, o, spec, async (ctx, n) => {
      let evidence: Record<string, unknown> = {
        source: 'LEARNER_REFLECTION_FIXED_PUBLICATION',
        formalGrade: null,
      };
      if (spec.kind === 'PBL') {
        if (n)
          await n.query(
            'SELECT 1 FROM zhiban_published_pbl_state WHERE owner_id=$1 AND stage_id=$2 AND scene_id=$3 FOR SHARE',
            [ctx.binding.owner, ctx.binding.stage, spec.sceneId],
          );
        const state = await this.pbl.read(ctx, spec.sceneId, n ?? this.pool);
        try {
          evidence = completedPblEvidence(
            state.project as unknown as Record<string, unknown>,
            anchor.baseline,
            state.revision,
          );
        } catch {
          throw new AcademicError('INVALID_STATE');
        }
      }
      if (spec.kind === 'QUIZ') {
        const { runtimeStore } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
        const sessions = (
          await runtimeStore.listSessions(ctx.binding.stage, ctx.binding.owner)
        ).filter((v) => v.kind === 'quizAttempt');
        requireAcademic(sessions.length <= 100, 'UNAVAILABLE');
        let latest: any;
        for (const session of sessions) {
          const records = await runtimeStore.listRecords(session.id, { sceneId: spec.sceneId });
          const last = records.at(-1);
          if (
            last &&
            last.seq > (anchor.baseline.tails?.[session.id] ?? -1) &&
            ['submitted', 'reviewed'].includes(String((last.payload as any).phase))
          )
            latest = { sessionId: session.id, record: last };
        }
        requireAcademic(latest, 'INVALID_STATE');
        const scene = ctx.doc.scenes.find((s) => s.id === spec.sceneId)!;
        requireAcademic(scene.content.type === 'quiz');
        try {
          evidence = {
            ...quizEvidence(scene.content.questions, (latest.record.payload as any).answers),
            nativeSession: latest.sessionId,
            nativeSequence: latest.record.seq,
          };
        } catch {
          throw new AcademicError('INVALID_INPUT');
        }
      }
      return this.tx(
        x,
        o,
        async (a, l) => {
          const [current] = await l.rows(
            `SELECT t.*,v.deadline_at,v.allow_resubmit,a.status AS activity_status,NOT EXISTS(SELECT 1 FROM zhiban_learning.attempts later WHERE later.tenant_id=t.tenant_id AND later.activity_id=t.activity_id AND later.membership_id=t.membership_id AND later.attempt_no>t.attempt_no) AS latest FROM zhiban_learning.attempts t JOIN zhiban_learning.activity_versions v ON v.tenant_id=t.tenant_id AND v.activity_id=t.activity_id AND v.version=t.activity_version JOIN zhiban_learning.activities a ON a.tenant_id=t.tenant_id AND a.id=t.activity_id WHERE t.tenant_id=$1 AND t.id=$2 AND t.membership_id=$3 FOR SHARE OF t,a`,
            [a.tenantId, c.attemptId, a.membershipId],
          );
          requireAcademic(
            current?.latest &&
              current.activity_status === 'PUBLISHED' &&
              current.activity_version === anchor.activity_version,
            'INVALID_STATE',
          );
          writableAttempt(
            String(current.status),
            !!current.allow_resubmit,
            current.deadline_at === null ? null : Number(current.deadline_at),
            Date.now(),
          );
          const payload = {
            attemptId: c.attemptId,
            activityId: anchor.activity_id,
            activityVersion: anchor.activity_version,
            enrollmentId: anchor.enrollment_id,
            taskRevision: String(anchor.task_revision),
            publication: spec,
            execution: evidence,
            reflection: c.reflection,
            capturedAt: new Date().toISOString(),
          };
          requireAcademic(JSON.stringify(payload).length <= 128000);
          const id = v7(),
            pin = digest(payload);
          const row = (
            await this.pool.query(
              'INSERT INTO zhiban_course_result_proofs(id,tenant_id,offering_id,member_id,attempt_id,command_id,intent_digest,digest,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,member_id,command_id) DO NOTHING RETURNING id,digest,payload',
              [
                id,
                a.tenantId,
                o,
                a.membershipId,
                c.attemptId,
                key,
                digest(c),
                pin,
                JSON.stringify(payload),
              ],
            )
          ).rows[0];
          if (row) return row;
          const old = (
            await this.pool.query(
              'SELECT id,digest,payload,intent_digest FROM zhiban_course_result_proofs WHERE tenant_id=$1 AND member_id=$2 AND command_id=$3',
              [a.tenantId, a.membershipId, key],
            )
          ).rows[0];
          requireAcademic(old?.intent_digest === digest(c), 'CONFLICT');
          return old;
        },
        'STUDENT',
      );
    });
  }
  private async submit(
    x: AcademicContext,
    o: string,
    c: Extract<ResultCommand, { type: 'SUBMIT' }>,
    key: string,
  ) {
    const { anchor } = await this.anchor(x, o, c.attemptId);
    const proof = (
      await this.pool.query(
        'SELECT * FROM zhiban_course_result_proofs WHERE tenant_id=$1 AND offering_id=$2 AND member_id=$3 AND attempt_id=$4 AND id=$5',
        [x.tenantId, o, x.actorMembershipId, c.attemptId, c.proofId],
      )
    ).rows[0];
    requireAcademic(proof && proof.digest === digest(proof.payload), 'NOT_FOUND');
    const payload = proof.payload as Record<string, unknown>;
    const answer = reportText(
      { ...payload, proofId: proof.id, proofDigest: proof.digest, reflection: undefined },
      String(payload.reflection),
    );
    return withCourseProof(
      {
        id: proof.id,
        tenant: x.tenantId,
        offering: o,
        member: x.actorMembershipId,
        attempt: c.attemptId,
        activityVersion: anchor.activity_version,
        digest: proof.digest,
      },
      () =>
        this.tx(
          x,
          o,
          async (a, l) =>
            l.execute(
              a,
              o,
              { type: 'SUBMIT', id: c.attemptId, revision: c.revision, answer },
              key,
              undefined,
              {
                kind: 'TEXT_RESPONSE',
                command: c,
                eventType: 'SUBMIT',
                after: async (result) => {
                  result.classroomEvidence = {
                    proofId: proof.id,
                    digest: proof.digest,
                    activityVersion: anchor.activity_version,
                    source: (payload.execution as any).source,
                  };
                },
              },
            ),
          'STUDENT',
        ),
    );
  }
  private async retract(
    x: AcademicContext,
    o: string,
    c: Extract<ResultCommand, { type: 'RETRACT_SHARED' }>,
    key: string,
  ) {
    return this.tx(
      x,
      o,
      async (a) => {
        const row = (
          await this.pool.query(
            'SELECT id FROM zhiban_course_shared_results WHERE tenant_id=$1 AND offering_id=$2 AND id=$3',
            [a.tenantId, o, c.sharedId],
          )
        ).rows[0];
        requireAcademic(row, 'NOT_FOUND');
        const result = { sharedId: c.sharedId, retracted: true };
        const wrote = (
          await this.pool.query(
            "INSERT INTO zhiban_course_result_events(id,tenant_id,offering_id,actor_id,event_kind,command_id,intent_digest,payload) VALUES($1,$2,$3,$4,'RETRACT_SHARED',$5,$6,$7) ON CONFLICT(tenant_id,actor_id,command_id) DO NOTHING RETURNING payload",
            [v7(), a.tenantId, o, a.membershipId, key, digest(c), JSON.stringify(result)],
          )
        ).rows[0];
        if (wrote) return wrote.payload;
        const old = (
          await this.pool.query(
            'SELECT payload,intent_digest FROM zhiban_course_result_events WHERE tenant_id=$1 AND actor_id=$2 AND command_id=$3',
            [a.tenantId, a.membershipId, key],
          )
        ).rows[0];
        requireAcademic(old?.intent_digest === digest(c), 'CONFLICT');
        return old.payload;
      },
      'TEACHER',
    );
  }
  private async share(
    x: AcademicContext,
    o: string,
    c: Extract<ResultCommand, { type: 'SHARE' }>,
    key: string,
  ) {
    await this.tx(x, o, async () => {}, 'TEACHER');
    const cx = this.cx(x, o),
      ctx = await this.classroom.context(cx, c.resourceId, c.publicationId);
    return this.classroom.guard(cx, c.resourceId, c.publicationId, () =>
      this.tx(
        x,
        o,
        async (a) => {
          let board: string[] = [];
          if (c.includeWhiteboard) {
            const { runtimeStore } = await getServerPersistenceProvider(
              process.env.DATABASE_URL ?? '',
            );
            const state = await createWhiteboardRuntimeService({
              store: runtimeStore,
              resolveLearnerKey: () => ctx.binding.owner,
            }).read(ctx.binding.stage);
            board = (state.whiteboard?.elements ?? [])
              .flatMap((e) => (e.type === 'text' ? [proseToPlainText(e.content)] : []))
              .map((t) => t.slice(0, 4000));
            requireAcademic(board.join('\n').length <= 16000);
          }
          const row = (
            await this.pool.query(
              `INSERT INTO zhiban_course_shared_results(id,tenant_id,offering_id,resource_id,publication_id,actor_id,command_id,intent_digest,source_digest,title,summary,whiteboard)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(tenant_id,actor_id,command_id) DO NOTHING RETURNING *`,
              [
                v7(),
                a.tenantId,
                o,
                c.resourceId,
                c.publicationId,
                a.membershipId,
                key,
                digest(c),
                ctx.snapshot.sourceDigest,
                c.title,
                c.summary,
                JSON.stringify(board),
              ],
            )
          ).rows[0];
          if (row) return row;
          const old = (
            await this.pool.query(
              'SELECT * FROM zhiban_course_shared_results WHERE tenant_id=$1 AND actor_id=$2 AND command_id=$3',
              [a.tenantId, a.membershipId, key],
            )
          ).rows[0];
          requireAcademic(old?.intent_digest === digest(c), 'CONFLICT');
          return old;
        },
        'TEACHER',
      ),
    );
  }
}
