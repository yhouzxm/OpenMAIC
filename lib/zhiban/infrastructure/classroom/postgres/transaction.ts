import {
  flowClassroomGuard,
  ensureFlowNotebook,
  closeFlowForClassroom,
  flowTaskInfo,
  flowInstalled,
} from '../../flow/postgres/guards';
import { progressBarrier, requireProgress } from '../../curriculum/postgres/progress';
import { classroomResults } from './results';
import type { PoolClient } from 'pg';
import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import { requireAcademic, type AcademicActor } from '../../../domain/academic/model';
import type { ClassroomCommand, ClassroomLecture } from '../../../domain/classroom/model';
import { QuizPgTransaction } from '../../quiz/postgres/transaction';
import { AcademicError } from '../../../domain/academic/model';
import { LearningPgTransaction } from '../../learning/postgres/transaction';
type Row = Record<string, any>;
export class ClassroomPgTransaction {
  constructor(private readonly client: PoolClient) {}
  private async rows(sql: string, args: unknown[]) {
    return (await this.client.query(sql, args)).rows as Row[];
  }
  results(actor: AcademicActor, offering: string, page: number) {
    return classroomResults(this.client, actor, offering, page);
  }
  async jointTarget(actor: AcademicActor, offering: string, session: string, dispatch: string) {
    await new LearningPgTransaction(this.client).access(actor, offering, 'STUDENT');
    return (
      await this.rows(
        'SELECT j.resource_id,j.publication_id FROM zhiban_classroom.joint_tasks j JOIN zhiban_classroom.dispatches d ON d.tenant_id=j.tenant_id AND d.id=j.dispatch_id WHERE j.tenant_id=$1 AND d.offering_id=$2 AND d.session_id=$3 AND d.id=$4',
        [actor.tenantId, offering, session, dispatch],
      )
    )[0] as { resource_id: string; publication_id: string } | undefined;
  }
  private async jointSql(sql: string, args: unknown[]) {
    try {
      return await this.rows(sql, args);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === '23514') throw new AcademicError('INVALID_STATE');
      if (code === '42501') throw new AcademicError('FORBIDDEN');
      throw error;
    }
  }
  private async joint(actor: AcademicActor, dispatch: string, enabled: boolean) {
    return enabled
      ? (
          await this.rows(
            'SELECT resource_id,publication_id FROM zhiban_classroom.joint_tasks WHERE tenant_id=$1 AND dispatch_id=$2',
            [actor.tenantId, dispatch],
          )
        )[0]
      : undefined;
  }
  private async lockJoint(
    actor: AcademicActor,
    offering: string,
    j: Row,
    lectures: ClassroomLecture[],
  ) {
    const resource = lectures.find((r) => r.id === j.resource_id);
    requireAcademic(
      resource?.interactive &&
        resource.state === 'PUBLISHED' &&
        !resource.quarantined &&
        resource.publication?.id === j.publication_id,
      'INVALID_STATE',
    );
    return (
      await this.jointSql('SELECT zhiban_content.lock_joint_publication($1,$2,$3,$4) AS metadata', [
        actor.tenantId,
        j.resource_id,
        offering,
        j.publication_id,
      ])
    )[0].metadata;
  }
  private async bindJoint(actor: AcademicActor, d: Row, j: Row, attempt: string) {
    const [{ binding }] = await this.jointSql(
      'SELECT zhiban_content.bind_joint_attempt($1,$2,$3,$4,$5) AS binding',
      [actor.tenantId, d.id, actor.membershipId, attempt, v7()],
    );
    await this.client.query(
      'INSERT INTO zhiban_classroom.joint_entries VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
      [actor.tenantId, d.id, actor.membershipId, attempt, binding, j.resource_id, j.publication_id],
    );
    const [entry] = await this.rows(
      'SELECT attempt_id,runtime_binding_id FROM zhiban_classroom.joint_entries WHERE tenant_id=$1 AND dispatch_id=$2 AND membership_id=$3',
      [actor.tenantId, d.id, actor.membershipId],
    );
    requireAcademic(
      entry?.attempt_id === attempt && entry.runtime_binding_id === binding,
      'INVALID_STATE',
    );
    return String(binding);
  }
  private async available(
    actor: AcademicActor,
    offering: string,
    kind: string,
    target: string,
    version: string,
    lectures: ClassroomLecture[],
  ) {
    const outline = (
      await this.rows(
        'SELECT published FROM zhiban_curriculum.outlines WHERE tenant_id=$1 AND offering_id=$2 FOR SHARE',
        [actor.tenantId, offering],
      )
    )[0];
    requireAcademic(
      outline?.published.some((c: any) =>
        c.units.some((u: any) => u.kind === kind && u.target === target),
      ),
      'INVALID_STATE',
    );
    if (kind === 'LECTURE') {
      const r = lectures.find((r) => r.id === target);
      requireAcademic(
        r &&
          r.state === 'PUBLISHED' &&
          !r.quarantined &&
          String(r.publication?.publication_no) === version,
        'INVALID_STATE',
      );
      return r.title;
    }
    const a = (
      await this.rows(
        "SELECT v.title FROM zhiban_learning.activities a JOIN zhiban_learning.activity_versions v ON v.tenant_id=a.tenant_id AND v.activity_id=a.id AND v.version=a.published_version WHERE a.tenant_id=$1 AND a.offering_id=$2 AND a.id=$3 AND a.status='PUBLISHED' AND a.published_version::text=$4 FOR SHARE OF a",
        [actor.tenantId, offering, target, version],
      )
    )[0];
    requireAcademic(!!a, 'INVALID_STATE');
    return a.title as string;
  }
  private open(row: Row, now: number) {
    return (
      row.state === 'PUBLISHED' &&
      (row.opens_at === null || Number(row.opens_at) <= now) &&
      (row.closes_at === null || now < Number(row.closes_at))
    );
  }
  async read(
    actor: AcademicActor,
    offering: string,
    lectures: ClassroomLecture[],
    jointEnabled = false,
  ) {
    const { mode, offering: courseOffering } = await new LearningPgTransaction(this.client).access(
      actor,
      offering,
    );
    const teacher = mode === 'TEACHER';
    const sessions = await this.rows(
      `SELECT id,title,description,state,revision::text,opens_at,closes_at FROM zhiban_classroom.sessions WHERE tenant_id=$1 AND offering_id=$2 ${teacher ? '' : "AND state='PUBLISHED' AND (opens_at IS NULL OR opens_at<=$3) AND (closes_at IS NULL OR closes_at>$3)"} ORDER BY created_at DESC,id DESC LIMIT 101`,
      teacher ? [actor.tenantId, offering] : [actor.tenantId, offering, actor.now],
    );
    requireAcademic(sessions.length <= 100, 'UNAVAILABLE');
    const flowEnabled = await flowInstalled(this.client);
    for (const s of sessions) {
      if (flowEnabled)
        s.flow =
          (
            await this.client.query(
              'SELECT state,step_index FROM zhiban_flow.runs WHERE tenant_id=$1 AND classroom_id=$2',
              [actor.tenantId, s.id],
            )
          ).rows[0] ?? null;
      const tasks = await this.rows(
        `SELECT d.id,d.kind,d.target_id,d.target_version,d.title,d.state,d.created_at,d.current_page,d.presentation_revision::text,d.presentation_updated_at,EXISTS(SELECT 1 FROM zhiban_classroom.entries e WHERE e.tenant_id=d.tenant_id AND e.dispatch_id=d.id AND e.membership_id=$3) AS entered FROM zhiban_classroom.dispatches d WHERE d.tenant_id=$1 AND d.session_id=$2 ${teacher ? '' : "AND d.state='ACTIVE'"} ORDER BY d.created_at DESC,d.id DESC LIMIT 101`,
        [actor.tenantId, s.id, actor.membershipId],
      );
      requireAcademic(tasks.length <= 100, 'UNAVAILABLE');
      s.tasks = [];
      for (const d of tasks) {
        const paired = await this.joint(actor, String(d.id), jointEnabled);
        if (paired)
          d.joint = { resourceId: paired.resource_id, publicationId: paired.publication_id };
        try {
          if (paired) {
            const resource = lectures.find((r) => r.id === paired.resource_id);
            requireAcademic(
              resource?.interactive &&
                resource.state === 'PUBLISHED' &&
                !resource.quarantined &&
                resource.publication?.id === paired.publication_id,
              'INVALID_STATE',
            );
            d.joint.title = resource.title;
          }
          await this.available(actor, offering, d.kind, d.target_id, d.target_version, lectures);
          d.available = true;
          const resource = lectures.find((r) => r.id === d.target_id);
          d.interactive = d.kind === 'LECTURE' && !!resource?.interactive;
          d.publicationId = d.kind === 'LECTURE' ? (resource?.publication?.id ?? null) : null;
          if (d.kind === 'LECTURE')
            d.page_count = lectures.find((r) => r.id === d.target_id)?.publication?.page_count ?? 0;
        } catch (e) {
          if ((e as { code?: string }).code !== 'INVALID_STATE') throw e;
          d.available = false;
        }
        // Only current teacher sees membership/submission facts. No learner answer or draft is read.
        if (teacher)
          d.participants = await this.rows(
            `SELECT e.membership_id,p.display_name,e.entered_at,
 (SELECT count(*)::int FROM zhiban_learning.submissions z JOIN zhiban_learning.attempts a ON a.tenant_id=z.tenant_id AND a.id=z.attempt_id WHERE a.tenant_id=e.tenant_id AND a.offering_id=$3 AND a.activity_id=$4 AND a.activity_version::text=$5 AND a.membership_id=e.membership_id AND a.id::text=binding.attempt_id) AS submissions,
 (SELECT count(*)::int FROM zhiban_assessment.publications g JOIN zhiban_learning.submissions z ON z.tenant_id=g.tenant_id AND z.id=g.submission_id JOIN zhiban_learning.attempts a ON a.tenant_id=z.tenant_id AND a.id=z.attempt_id WHERE a.tenant_id=e.tenant_id AND a.offering_id=$3 AND a.activity_id=$4 AND a.activity_version::text=$5 AND a.membership_id=e.membership_id AND a.id::text=binding.attempt_id AND NOT EXISTS(SELECT 1 FROM zhiban_assessment.publications newer WHERE newer.tenant_id=g.tenant_id AND newer.grade_id=g.grade_id AND newer.version>g.version)) AS published_grades
 FROM zhiban_classroom.entries e LEFT JOIN LATERAL (
 SELECT audit.facts#>>'{result,attemptId}' AS attempt_id FROM zhiban_academic.audit_events audit
 WHERE audit.tenant_id=e.tenant_id AND audit.actor_id=e.membership_id
 AND audit.event_type='CLASSROOM_ENTER_TASK' AND audit.facts#>>'{result,dispatchId}'=e.dispatch_id::text
 ORDER BY audit.occurred_at,audit.id LIMIT 1
 ) binding ON true LEFT JOIN zhiban_academic.people p ON p.tenant_id=e.tenant_id AND p.membership_id=e.membership_id WHERE e.tenant_id=$1 AND e.dispatch_id=$2 ORDER BY e.entered_at,e.membership_id LIMIT 1001`,
            [actor.tenantId, d.id, offering, d.target_id, d.target_version],
          );
        if (teacher) requireAcademic(d.participants.length <= 1000, 'UNAVAILABLE');
        const flow = await flowTaskInfo(this.client, actor, String(d.id));
        if (flow) {
          d.flow = {
            state: flow.state,
            position: flow.position,
            kind: flow.steps[flow.position]?.kind,
          };
          if (flow.state !== 'RUNNING' || flow.position !== flow.step_index) d.available = false;
        }
        s.tasks.push(d);
      }
    }
    const outline = (
      await this.rows(
        'SELECT published FROM zhiban_curriculum.outlines WHERE tenant_id=$1 AND offering_id=$2',
        [actor.tenantId, offering],
      )
    )[0];
    const choices: Row[] = [];
    if (teacher)
      for (const c of outline?.published ?? [])
        for (const u of c.units) {
          let version: string;
          if (u.kind === 'LECTURE')
            version = String(
              lectures.find((r) => r.id === u.target)?.publication?.publication_no ?? '',
            );
          else
            version = String(
              (
                await this.rows(
                  'SELECT published_version FROM zhiban_learning.activities WHERE tenant_id=$1 AND offering_id=$2 AND id=$3',
                  [actor.tenantId, offering, u.target],
                )
              )[0]?.published_version ?? '',
            );
          if (!version) continue;
          try {
            const title = await this.available(
              actor,
              offering,
              u.kind,
              u.target,
              version,
              lectures,
            );
            if (!choices.some((x) => x.kind === u.kind && x.target === u.target))
              choices.push({
                kind: u.kind,
                target: u.target,
                version,
                title,
                interactive:
                  u.kind === 'LECTURE' && !!lectures.find((r) => r.id === u.target)?.interactive,
                publicationId:
                  u.kind === 'LECTURE'
                    ? lectures.find((r) => r.id === u.target)?.publication?.id
                    : undefined,
              });
          } catch (e) {
            if ((e as { code?: string }).code !== 'INVALID_STATE') throw e;
          }
        }
    return {
      mode,
      courseId: String(courseOffering.course_id),
      sessions,
      choices,
      editingEnabled: true,
      jointEnabled,
      flowEnabled,
    };
  }
  async execute(
    actor: AcademicActor,
    offering: string,
    command: ClassroomCommand,
    key: string,
    lectures: ClassroomLecture[],
    jointEnabled = false,
    trustedFlow = false,
  ) {
    await progressBarrier(this.client, actor, offering);
    requireAcademic(command.type !== 'DISPATCH_JOINT_TASK' || jointEnabled, 'UNAVAILABLE');
    const { offering: o } = await new LearningPgTransaction(this.client).access(
      actor,
      offering,
      command.type === 'ENTER_TASK' ? 'STUDENT' : 'TEACHER',
    );
    requireAcademic(o.status === 'OPEN', 'INVALID_STATE');
    await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `academic-command:${actor.tenantId}:${key}`,
    ]);
    const flowDecision =
      'id' in command
        ? await flowClassroomGuard(
            this.client,
            actor,
            command.id,
            command.type,
            'dispatchId' in command ? command.dispatchId : undefined,
            trustedFlow,
          )
        : null;
    const digest = createHash('sha256')
      .update(JSON.stringify({ offering, command, scope: 'classroom-v1' }))
      .digest('hex');
    const old = (
      await this.rows(
        'SELECT c.actor_id,c.payload_digest,a.facts FROM zhiban_academic.commands c JOIN zhiban_academic.audit_events a ON a.tenant_id=c.tenant_id AND a.command_key=c.command_key WHERE c.tenant_id=$1 AND c.command_key=$2',
        [actor.tenantId, key],
      )
    )[0];
    if (old) {
      requireAcademic(
        old.actor_id === actor.membershipId && old.payload_digest === digest,
        'CONFLICT',
      );
      if (command.type === 'ENTER_TASK' || command.type === 'PRESENT_LECTURE_PAGE') {
        const s = (
          await this.rows(
            'SELECT * FROM zhiban_classroom.sessions WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR UPDATE',
            [actor.tenantId, offering, command.id],
          )
        )[0];
        requireAcademic(
          !!s && this.open(s, Date.now()) && s.revision === command.revision,
          'INVALID_STATE',
        );
        const d = (
          await this.rows(
            "SELECT * FROM zhiban_classroom.dispatches WHERE tenant_id=$1 AND session_id=$2 AND id=$3 AND state='ACTIVE'",
            [actor.tenantId, s.id, command.dispatchId],
          )
        )[0];
        requireAcademic(!!d, 'INVALID_STATE');
        await this.available(actor, offering, d.kind, d.target_id, d.target_version, lectures);
        const paired = await this.joint(actor, String(d.id), jointEnabled);
        if (paired) {
          await this.lockJoint(actor, offering, paired, lectures);
          requireAcademic(command.type === 'ENTER_TASK', 'INVALID_STATE');
          const binding = await this.bindJoint(
            actor,
            d,
            paired,
            String(old.facts.result.attemptId),
          );
          requireAcademic(binding === old.facts.result.runtimeBindingId, 'INVALID_STATE');
        }
      }
      return old.facts.result;
    }
    let result: Row;
    let progressDecision: Awaited<ReturnType<typeof requireProgress>> | undefined;
    if (command.type === 'CREATE_CLASSROOM') {
      // Bound list cost. Offering advisory lock avoids concurrent creates exceeding the cap.
      await this.client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `classroom-list:${actor.tenantId}:${offering}`,
      ]);
      const count = (
        await this.rows(
          'SELECT count(*)::int AS n FROM zhiban_classroom.sessions WHERE tenant_id=$1 AND offering_id=$2',
          [actor.tenantId, offering],
        )
      )[0].n;
      requireAcademic(count < 100, 'INVALID_STATE');
      const id = v7();
      await this.client.query(
        "INSERT INTO zhiban_classroom.sessions(tenant_id,id,offering_id,title,description,state,opens_at,closes_at,created_at,created_by) VALUES($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8,$9)",
        [
          actor.tenantId,
          id,
          offering,
          command.title,
          command.description,
          command.opensAt,
          command.closesAt,
          actor.now,
          actor.membershipId,
        ],
      );
      result = { id, revision: '1' };
    } else {
      const s = (
        await this.rows(
          'SELECT * FROM zhiban_classroom.sessions WHERE tenant_id=$1 AND offering_id=$2 AND id=$3 FOR UPDATE',
          [actor.tenantId, offering, command.id],
        )
      )[0];
      requireAcademic(!!s, 'NOT_FOUND');
      requireAcademic(s.revision === command.revision, 'CONFLICT');
      const now = Number(
        (
          await this.client.query(
            'SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS now',
          )
        ).rows[0].now,
      );
      if (command.type === 'EDIT_CLASSROOM' || command.type === 'RESCHEDULE_CLASSROOM') {
        requireAcademic(
          s.state === (command.type === 'EDIT_CLASSROOM' ? 'DRAFT' : 'PUBLISHED'),
          'INVALID_STATE',
        );
        await this.client.query(
          'UPDATE zhiban_classroom.sessions SET title=$3,description=$4,opens_at=$5,closes_at=$6,revision=revision+1 WHERE tenant_id=$1 AND id=$2',
          [
            actor.tenantId,
            s.id,
            command.type === 'EDIT_CLASSROOM' ? command.title : s.title,
            command.type === 'EDIT_CLASSROOM' ? command.description : s.description,
            command.opensAt,
            command.closesAt,
          ],
        );
        result = {
          id: s.id,
          revision: String(BigInt(s.revision) + BigInt(1)),
          beforeWindow: { opensAt: s.opens_at, closesAt: s.closes_at },
          afterWindow: { opensAt: command.opensAt, closesAt: command.closesAt },
          changedFields:
            command.type === 'EDIT_CLASSROOM'
              ? ['title', 'description', 'opens_at', 'closes_at']
              : ['opens_at', 'closes_at'],
        };
      } else if (command.type === 'PRESENT_LECTURE_PAGE') {
        requireAcademic(this.open(s, now), 'INVALID_STATE');
        const d = (
          await this.rows(
            "SELECT * FROM zhiban_classroom.dispatches WHERE tenant_id=$1 AND session_id=$2 AND id=$3 AND state='ACTIVE' FOR UPDATE",
            [actor.tenantId, s.id, command.dispatchId],
          )
        )[0];
        requireAcademic(!!d && d.kind === 'LECTURE', 'INVALID_STATE');
        await this.available(actor, offering, d.kind, d.target_id, d.target_version, lectures);
        const count = lectures.find((r) => r.id === d.target_id)?.publication?.page_count;
        requireAcademic(Number.isInteger(count) && command.page <= count!, 'INVALID_INPUT');
        requireAcademic(d.presentation_revision === command.presentationRevision, 'CONFLICT');
        requireAcademic(
          BigInt(d.presentation_revision) < BigInt('9223372036854775807'),
          'INVALID_STATE',
        );
        await this.client.query(
          'UPDATE zhiban_classroom.dispatches SET current_page=$4,presentation_revision=presentation_revision+1,presentation_updated_at=$5 WHERE tenant_id=$1 AND session_id=$2 AND id=$3',
          [actor.tenantId, s.id, d.id, command.page, now],
        );
        result = {
          id: s.id,
          revision: s.revision,
          dispatchId: d.id,
          target: d.target_id,
          version: d.target_version,
          previousPage: d.current_page,
          page: command.page,
          presentationRevision: String(BigInt(d.presentation_revision) + BigInt(1)),
        };
      } else if (command.type === 'ENTER_TASK') {
        requireAcademic(this.open(s, now), 'INVALID_STATE');
        const d = (
          await this.rows(
            "SELECT * FROM zhiban_classroom.dispatches WHERE tenant_id=$1 AND session_id=$2 AND id=$3 AND state='ACTIVE'",
            [actor.tenantId, s.id, command.dispatchId],
          )
        )[0];
        requireAcademic(!!d, 'INVALID_STATE');
        const paired = await this.joint(actor, String(d.id), jointEnabled);
        if (paired) await this.lockJoint(actor, offering, paired, lectures);
        await this.available(actor, offering, d.kind, d.target_id, d.target_version, lectures);
        if (d.kind === 'ACTIVITY') {
          const prior = await this.client.query(
            'SELECT dispatch_id FROM zhiban_classroom.entries WHERE tenant_id=$1 AND dispatch_id=$2 AND membership_id=$3',
            [actor.tenantId, d.id, actor.membershipId],
          );
          if (!prior.rowCount)
            progressDecision = await requireProgress(
              this.client,
              actor,
              offering,
              String(d.target_id),
            );
        }
        const entered = await this.client.query(
          'INSERT INTO zhiban_classroom.entries VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING dispatch_id',
          [actor.tenantId, d.id, s.id, actor.membershipId, now],
        );
        let attemptId: string | null = null;
        if (d.kind === 'ACTIVITY' && !entered.rowCount) {
          // The first atomic entry audit is the immutable dispatch/learner/Attempt binding.
          // A new command key must never consume another attempt for this same dispatch.
          const bound = (
            await this.rows(
              `SELECT t.id FROM zhiban_academic.audit_events e JOIN zhiban_learning.attempts t
             ON t.tenant_id=e.tenant_id AND t.id::text=e.facts#>>'{result,attemptId}'
             WHERE e.tenant_id=$1 AND e.actor_id=$2 AND e.event_type='CLASSROOM_ENTER_TASK'
             AND e.facts#>>'{result,dispatchId}'=$3 AND t.offering_id=$4
             AND t.membership_id=$2 AND t.activity_id=$5 AND t.activity_version::text=$6
             ORDER BY e.occurred_at,e.id LIMIT 1`,
              [actor.tenantId, actor.membershipId, d.id, offering, d.target_id, d.target_version],
            )
          )[0];
          requireAcademic(!!bound, 'UNAVAILABLE');
          attemptId = String(bound.id);
        } else if (d.kind === 'ACTIVITY') {
          const [activity] = await this.rows(
            'SELECT activity_type FROM zhiban_learning.activities WHERE tenant_id=$1 AND id=$2',
            [actor.tenantId, d.target_id],
          );
          const attemptKey = createHash('sha256')
            .update('classroom-attempt:' + key)
            .digest('hex');
          const attempt =
            activity.activity_type === 'QUIZ'
              ? await new QuizPgTransaction(this.client).execute(
                  actor,
                  offering,
                  {
                    type: 'START_QUIZ_ATTEMPT',
                    activityId: d.target_id,
                    expectedVersion: d.target_version,
                  },
                  attemptKey,
                )
              : await new LearningPgTransaction(this.client).execute(
                  actor,
                  offering,
                  { type: 'START_ATTEMPT', id: d.target_id, expectedVersion: d.target_version },
                  attemptKey,
                );
          attemptId = String(attempt.id);
        }
        const runtimeBindingId = paired ? await this.bindJoint(actor, d, paired, attemptId!) : null;
        result = {
          joint: !!paired,
          interactiveId: paired?.resource_id ?? null,
          jointPublicationId: paired?.publication_id ?? null,
          runtimeBindingId,
          id: s.id,
          revision: s.revision,
          dispatchId: d.id,
          kind: d.kind,
          target: d.target_id,
          version: d.target_version,
          attemptId,
          interactive:
            d.kind === 'LECTURE' && !!lectures.find((r) => r.id === d.target_id)?.interactive,
          publicationId:
            d.kind === 'LECTURE'
              ? (lectures.find((r) => r.id === d.target_id)?.publication?.id ?? null)
              : null,
        };
      } else {
        if (command.type === 'PUBLISH_CLASSROOM') {
          requireAcademic(
            s.state === 'DRAFT' && (s.closes_at === null || now < Number(s.closes_at)),
            'INVALID_STATE',
          );
        } else if (command.type === 'END_CLASSROOM')
          requireAcademic(s.state === 'PUBLISHED', 'INVALID_STATE');
        else requireAcademic(this.open(s, now), 'INVALID_STATE');
        if (command.type === 'DISPATCH_TASK' || command.type === 'DISPATCH_JOINT_TASK') {
          const count = (
            await this.rows(
              'SELECT count(*)::int AS n FROM zhiban_classroom.dispatches WHERE tenant_id=$1 AND session_id=$2',
              [actor.tenantId, s.id],
            )
          )[0].n;
          requireAcademic(count < 100, 'INVALID_STATE');
          const combined = command.type === 'DISPATCH_JOINT_TASK';
          const kind = combined ? 'ACTIVITY' : command.kind,
            target = combined ? command.activityId : command.target,
            version = combined ? command.activityVersion : command.version;
          let metadata: Row | undefined;
          if (combined) {
            const resource = lectures.find((r) => r.id === command.interactiveId);
            await this.available(
              actor,
              offering,
              'LECTURE',
              command.interactiveId,
              String(resource?.publication?.publication_no ?? ''),
              lectures,
            );
            metadata = await this.lockJoint(
              actor,
              offering,
              { resource_id: command.interactiveId, publication_id: command.publicationId },
              lectures,
            );
          }
          const activityTitle = await this.available(
            actor,
            offering,
            kind,
            target,
            version,
            lectures,
          );
          const title = combined
            ? `${metadata!.title} ＋ ${activityTitle}`.slice(0, 120)
            : activityTitle;
          await this.client.query(
            "UPDATE zhiban_classroom.dispatches SET state='ENDED' WHERE tenant_id=$1 AND session_id=$2 AND state='ACTIVE'",
            [actor.tenantId, s.id],
          );
          const id = v7();
          await this.client.query(
            "INSERT INTO zhiban_classroom.dispatches(tenant_id,id,session_id,offering_id,kind,target_id,target_version,title,state,created_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'ACTIVE',$9,$10)",
            [
              actor.tenantId,
              id,
              s.id,
              offering,
              kind,
              target,
              version,
              title,
              now,
              actor.membershipId,
            ],
          );
          if (combined)
            await this.client.query(
              'INSERT INTO zhiban_classroom.joint_tasks(tenant_id,dispatch_id,resource_id,publication_id,offering_id,activity_id,activity_version) VALUES($1,$2,$3,$4,$5,$6,$7)',
              [
                actor.tenantId,
                id,
                command.interactiveId,
                command.publicationId,
                offering,
                command.activityId,
                command.activityVersion,
              ],
            );
          result = {
            id: s.id,
            dispatchId: id,
            revision: String(BigInt(s.revision) + BigInt(1)),
            joint: combined,
          };
        } else {
          if (command.type === 'END_TASK' || command.type === 'END_CLASSROOM') {
            const ended = await this.client.query(
              "UPDATE zhiban_classroom.dispatches SET state='ENDED' WHERE tenant_id=$1 AND session_id=$2 AND state='ACTIVE'",
              [actor.tenantId, s.id],
            );
            if (command.type === 'END_TASK') requireAcademic(ended.rowCount === 1, 'INVALID_STATE');
          }
          result = { id: s.id, revision: String(BigInt(s.revision) + BigInt(1)) };
        }
        await this.client.query(
          'UPDATE zhiban_classroom.sessions SET state=$3,revision=revision+1 WHERE tenant_id=$1 AND id=$2',
          [
            actor.tenantId,
            s.id,
            command.type === 'PUBLISH_CLASSROOM'
              ? 'PUBLISHED'
              : command.type === 'END_CLASSROOM'
                ? 'ENDED'
                : s.state,
          ],
        );
      }
    }
    if (command.type === 'ENTER_TASK') {
      if (flowDecision) result.flowDecision = flowDecision;
      const notebookId = await ensureFlowNotebook(
        this.client,
        actor,
        offering,
        String(result.dispatchId),
        result.attemptId ? String(result.attemptId) : null,
      );
      if (notebookId) result.labNotebookId = notebookId;
    }
    if (command.type === 'END_CLASSROOM' && !trustedFlow)
      await closeFlowForClassroom(this.client, actor, command.id);
    await this.client.query('INSERT INTO zhiban_academic.commands VALUES($1,$2,$3,$4,$5)', [
      actor.tenantId,
      key,
      actor.membershipId,
      digest,
      actor.now,
    ]);
    await this.client.query(
      'INSERT INTO zhiban_academic.audit_events(tenant_id,id,actor_id,command_key,event_type,occurred_at,facts) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        actor.tenantId,
        v7(),
        actor.membershipId,
        key,
        `CLASSROOM_${command.type}`,
        actor.now,
        JSON.stringify({
          offeringId: offering,
          result,
          ...(progressDecision ? { progressDecision } : {}),
        }),
      ],
    );
    return result;
  }
}
