import { randomUUID } from 'node:crypto';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { AuthorizationError, hasScopedPermission } from '@/lib/zhiban/rbac/service';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool, ZhibanQueryable } from '@/lib/zhiban/db/types';
import { calculateAssessment, type VirtualLabAssessment } from '../assessment';
import {
  buildTeacherLearningCenterAnalytics,
  type LearningCenterDimensionKey,
} from '@/lib/zhiban/learning-center';
import type { TrainingContext, VirtualLabLearningProfile } from '../ai/types';
import {
  buildTeacherVirtualLabAnalytics,
  buildVirtualLabLearningProfile,
  makeHistorySummary,
} from './logic';
import type {
  PersistedVirtualLabAction,
  PersistedVirtualLabSession,
  TeacherVirtualLabAnalytics,
  TeacherVirtualLabStudent,
  VirtualLabHistory,
  VirtualLabSessionContext,
} from './types';

interface SessionRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  course_id: string;
  chapter_id: string;
  activity_id: string;
  scenario_id: string;
  attempt_number: number;
  status: 'in_progress' | 'completed' | 'abandoned';
  started_at: Date | string;
  completed_at: Date | string | null;
  duration_seconds: number | null;
  overall_score: number | string | null;
  assessment_json: VirtualLabAssessment | null;
  hints_used: number;
  wrong_actions: string[] | null;
  actions_count: number;
  verification_passed: boolean;
  display_name?: string;
}
interface ProfileRow extends Record<string, unknown> {
  dimensions: VirtualLabLearningProfile;
  weak_points_json: string[];
  performance_json: Record<string, unknown>;
  source_label: string;
  source_attempts: number;
}

function asIso(value: Date | string | null) {
  return value ? new Date(value).toISOString() : null;
}
function toSession(
  row: SessionRow,
): PersistedVirtualLabSession & { userId: string; name?: string } {
  return {
    id: row.id,
    userId: row.user_id,
    ...(row.display_name ? { name: row.display_name } : {}),
    courseId: row.course_id,
    chapterId: row.chapter_id,
    activityId: row.activity_id,
    scenarioId: row.scenario_id,
    attemptNumber: row.attempt_number,
    status: row.status,
    startedAt: asIso(row.started_at)!,
    completedAt: asIso(row.completed_at),
    durationSeconds: row.duration_seconds,
    overallScore: row.overall_score === null ? null : Number(row.overall_score),
    assessment:
      row.assessment_json && Object.keys(row.assessment_json).length ? row.assessment_json : null,
    hintsUsed: row.hints_used,
    wrongActions: row.wrong_actions ?? [],
    actionsCount: row.actions_count,
    verificationPassed: row.verification_passed,
  };
}
function assertStudent(principal: AuthorizedPrincipal) {
  if (principal.accountType !== 'student')
    throw new AuthorizationError('Student access required', 403);
}
function assertTeacher(principal: AuthorizedPrincipal, courseId: string) {
  if (principal.accountType !== 'teacher' && principal.accountType !== 'admin')
    throw new AuthorizationError('Teacher access required', 403);
  if (!hasScopedPermission(principal, 'course:manage', { courseIds: [courseId] }))
    throw new AuthorizationError('Permission denied for this course', 403);
}
function contextParams(context: VirtualLabSessionContext) {
  return [context.courseId, context.activityId, context.scenarioId] as const;
}

async function readProfile(
  query: ZhibanQueryable,
  tenantId: string,
  userId: string,
  context: VirtualLabSessionContext,
) {
  const result = await query.query<ProfileRow>(
    `SELECT dimensions,weak_points_json,performance_json,source_label,source_attempts FROM zhiban.virtual_lab_learner_profiles WHERE tenant_id=$1 AND user_id=$2 AND course_id=$3 AND activity_id=$4 AND scenario_id=$5`,
    [tenantId, userId, ...contextParams(context)],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    profile: {
      ...row.dimensions,
      weakPoints: row.weak_points_json,
      previousVirtualLabPerformance: row.performance_json,
    },
    source: row.source_label,
  };
}

export async function createVirtualLabSession(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  context: VirtualLabSessionContext,
) {
  assertStudent(principal);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const lockKey = `${principal.id}:${context.courseId}:${context.activityId}:${context.scenarioId}`;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);
    const count = await client.query<{ next_attempt: number }>(
      `SELECT COALESCE(MAX(attempt_number),0)::integer + 1 AS next_attempt FROM zhiban.virtual_lab_sessions WHERE tenant_id=$1 AND user_id=$2 AND course_id=$3 AND activity_id=$4 AND scenario_id=$5`,
      [principal.tenantId, principal.id, ...contextParams(context)],
    );
    const attemptNumber = Number(count.rows[0]?.next_attempt ?? 1);
    const id = randomUUID();
    const result = await client.query<SessionRow>(
      `INSERT INTO zhiban.virtual_lab_sessions(id,tenant_id,user_id,course_id,chapter_id,activity_id,scenario_id,attempt_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        id,
        principal.tenantId,
        principal.id,
        context.courseId,
        context.chapterId,
        context.activityId,
        context.scenarioId,
        attemptNumber,
      ],
    );
    return toSession(result.rows[0]);
  });
}

async function assertOwnedSession(
  query: ZhibanQueryable,
  principal: AuthorizedPrincipal,
  sessionId: string,
) {
  const result = await query.query<SessionRow>(
    `SELECT * FROM zhiban.virtual_lab_sessions WHERE tenant_id=$1 AND id=$2 AND user_id=$3`,
    [principal.tenantId, sessionId, principal.id],
  );
  if (!result.rows[0]) throw new Error('Virtual Lab session not found');
  return result.rows[0];
}

export async function saveVirtualLabAction(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  sessionId: string,
  action: PersistedVirtualLabAction,
) {
  assertStudent(principal);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    await assertOwnedSession(client, principal, sessionId);
    await client.query(
      `INSERT INTO zhiban.virtual_lab_actions(id,tenant_id,session_id,action_type,target,value,unit,phase,payload_json,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,COALESCE($10::timestamptz,now()))`,
      [
        randomUUID(),
        principal.tenantId,
        sessionId,
        action.action,
        action.target ?? null,
        action.value === undefined ? null : JSON.stringify(action.value),
        action.unit ?? null,
        action.phase ?? null,
        JSON.stringify(action.payload ?? {}),
        action.timestamp ?? null,
      ],
    );
    await client.query(
      `UPDATE zhiban.virtual_lab_sessions SET updated_at=now() WHERE tenant_id=$1 AND id=$2 AND user_id=$3`,
      [principal.tenantId, sessionId, principal.id],
    );
  });
}

export async function completeVirtualLabSession(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  sessionId: string,
  trainingContext: TrainingContext,
  durationSeconds: number,
) {
  assertStudent(principal);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const row = await assertOwnedSession(client, principal, sessionId);
    const context: VirtualLabSessionContext = {
      courseId: row.course_id,
      chapterId: row.chapter_id,
      activityId: row.activity_id,
      scenarioId: row.scenario_id,
    };
    const previousRows = await client.query<SessionRow>(
      `SELECT * FROM zhiban.virtual_lab_sessions WHERE tenant_id=$1 AND user_id=$2 AND course_id=$3 AND activity_id=$4 AND scenario_id=$5 AND status='completed' ORDER BY attempt_number DESC LIMIT 1`,
      [principal.tenantId, principal.id, ...contextParams(context)],
    );
    const previous = previousRows.rows[0] ? toSession(previousRows.rows[0]) : null;
    const assessment = calculateAssessment({
      trainingContext,
      attemptNumber: row.attempt_number,
      durationSeconds,
      ...(previous
        ? {
            previousAttemptSummary: {
              attemptNumber: previous.attemptNumber,
              overallScore: previous.overallScore ?? 0,
              durationSeconds: previous.durationSeconds ?? 0,
              wrongActions: previous.wrongActions.length,
              hintsUsed: previous.hintsUsed,
            },
          }
        : {}),
    });
    await client.query(
      `UPDATE zhiban.virtual_lab_sessions SET status='completed',completed_at=now(),duration_seconds=$4,overall_score=$5,assessment_json=$6::jsonb,weak_points_json=$7::jsonb,recommendations_json=$8::jsonb,hints_used=$9,wrong_actions=$10::jsonb,actions_count=$11,verification_passed=$12,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND user_id=$3`,
      [
        principal.tenantId,
        sessionId,
        principal.id,
        assessment.durationSeconds,
        assessment.overallScore,
        JSON.stringify(assessment),
        JSON.stringify(assessment.weakPoints),
        JSON.stringify(assessment.recommendedContent),
        assessment.hintsUsed,
        JSON.stringify(assessment.wrongActions),
        assessment.actionsCount,
        trainingContext.evidence.verificationPassed,
      ],
    );
    const completedCount = await client.query<{ total: number }>(
      `SELECT count(*)::integer AS total FROM zhiban.virtual_lab_sessions WHERE tenant_id=$1 AND user_id=$2 AND course_id=$3 AND activity_id=$4 AND scenario_id=$5 AND status='completed'`,
      [principal.tenantId, principal.id, ...contextParams(context)],
    );
    const previousProfile = await readProfile(client, principal.tenantId, principal.id, context);
    const profile = buildVirtualLabLearningProfile(
      previousProfile?.profile ?? null,
      assessment,
      Number(completedCount.rows[0]?.total ?? 1),
    );
    await client.query(
      `INSERT INTO zhiban.virtual_lab_learner_profiles(id,tenant_id,user_id,course_id,activity_id,scenario_id,dimensions,weak_points_json,performance_json,source_attempts) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10) ON CONFLICT(tenant_id,user_id,course_id,activity_id,scenario_id) DO UPDATE SET dimensions=EXCLUDED.dimensions,weak_points_json=EXCLUDED.weak_points_json,performance_json=EXCLUDED.performance_json,source_attempts=EXCLUDED.source_attempts,updated_at=now()`,
      [
        randomUUID(),
        principal.tenantId,
        principal.id,
        ...contextParams(context),
        JSON.stringify({
          sensorKnowledgeMastery: profile.sensorKnowledgeMastery,
          plcKnowledgeMastery: profile.plcKnowledgeMastery,
        }),
        JSON.stringify(profile.weakPoints ?? []),
        JSON.stringify(profile.previousVirtualLabPerformance ?? {}),
        Number(completedCount.rows[0]?.total ?? 1),
      ],
    );
    return { assessment, profile, previousAttempt: previous };
  });
}

export async function getStudentVirtualLabHistory(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  context: VirtualLabSessionContext,
): Promise<VirtualLabHistory> {
  assertStudent(principal);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const rows = await client.query<SessionRow>(
      `SELECT * FROM zhiban.virtual_lab_sessions WHERE tenant_id=$1 AND user_id=$2 AND course_id=$3 AND activity_id=$4 AND scenario_id=$5 ORDER BY attempt_number DESC`,
      [principal.tenantId, principal.id, ...contextParams(context)],
    );
    const sessions = rows.rows.map(toSession);
    const profile = await readProfile(client, principal.tenantId, principal.id, context);
    return {
      sessions,
      summary: makeHistorySummary(sessions),
      profile: profile?.profile ?? null,
      profileSource: profile?.source ?? null,
    };
  });
}

export async function getTeacherVirtualLabAnalytics(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  context: VirtualLabSessionContext,
): Promise<TeacherVirtualLabAnalytics> {
  assertTeacher(principal, context.courseId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const enrollmentRows = await client.query<{ user_id: string; display_name: string }>(
      `SELECT DISTINCT e.student_id AS user_id,a.display_name
       FROM zhiban.enrollments e
       JOIN zhiban.course_offerings o
         ON o.id=e.offering_id AND o.tenant_id=e.tenant_id
       JOIN zhiban.accounts a
         ON a.id=e.student_id AND a.tenant_id=e.tenant_id
       WHERE e.tenant_id=$1 AND o.course_id=$2 AND e.status='enrolled'
       ORDER BY a.display_name`,
      [principal.tenantId, context.courseId],
    );
    const enrolledLearnerIds = enrollmentRows.rows.map((row) => row.user_id);
    const enrolledLearners = new Set(enrolledLearnerIds);
    const result = await client.query<SessionRow>(
      `SELECT s.*,a.display_name FROM zhiban.virtual_lab_sessions s JOIN zhiban.accounts a ON a.id=s.user_id AND a.tenant_id=s.tenant_id WHERE s.tenant_id=$1 AND s.course_id=$2 AND s.activity_id=$3 AND s.scenario_id=$4 ORDER BY s.user_id,s.attempt_number DESC`,
      [principal.tenantId, ...contextParams(context)],
    );
    const sessions = result.rows.map(toSession).filter((item) => enrolledLearners.has(item.userId));
    const analytics = buildTeacherVirtualLabAnalytics(sessions, enrolledLearnerIds);
    const grouped = new Map<
      string,
      (PersistedVirtualLabSession & { userId: string; name?: string })[]
    >();
    sessions.forEach((item) =>
      grouped.set(item.userId, [...(grouped.get(item.userId) ?? []), item]),
    );
    analytics.students = enrollmentRows.rows.map((enrollment) => {
      const studentSessions = grouped.get(enrollment.user_id) ?? [];
      if (!studentSessions.length) {
        return {
          userId: enrollment.user_id,
          name: enrollment.display_name,
          attempts: 0,
          latestScore: null,
          highestScore: null,
          latestDurationSeconds: null,
          latestHintsUsed: null,
          weakPoints: [],
          completedAt: null,
          latestAssessment: null,
        } satisfies TeacherVirtualLabStudent;
      }
      const latest =
        studentSessions.find((item) => item.status === 'completed') ?? studentSessions[0];
      const completed = studentSessions.filter((item) => item.status === 'completed');
      return {
        userId: latest.userId,
        name: enrollment.display_name || latest.name || '学生',
        attempts: studentSessions.length,
        latestScore: latest.overallScore,
        highestScore: completed.length
          ? Math.max(...completed.map((item) => item.overallScore ?? 0))
          : null,
        latestDurationSeconds: latest.durationSeconds,
        latestHintsUsed: latest.hintsUsed,
        weakPoints: latest.assessment?.weakPoints.map((point) => point.knowledgePoint) ?? [],
        completedAt: latest.completedAt,
        latestAssessment: latest.assessment,
      } satisfies TeacherVirtualLabStudent;
    });
    const eventRows = await client.query<{
      learner_id: string;
      station_id: string;
      event_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT learner_id,station_id,event_type,payload
       FROM zhiban.knowledge_learning_events
       WHERE tenant_id=$1 AND course_id=$2`,
      [principal.tenantId, context.courseId],
    );
    const profileRows = await client.query<{
      user_id: string;
      dimensions: Partial<Record<LearningCenterDimensionKey, number>>;
    }>(
      `SELECT user_id,dimensions
       FROM zhiban.virtual_lab_learner_profiles
       WHERE tenant_id=$1 AND course_id=$2
         AND activity_id='knowledge-learning-center'
         AND scenario_id='knowledge-learning-center'`,
      [principal.tenantId, context.courseId],
    );
    analytics.knowledgeLearning = buildTeacherLearningCenterAnalytics(
      eventRows.rows.map((row) => ({
        learnerId: row.learner_id,
        stationId: row.station_id,
        eventType: row.event_type,
        payload: row.payload ?? {},
      })),
      profileRows.rows.map((row) => ({ userId: row.user_id, dimensions: row.dimensions ?? {} })),
      [
        ...new Set(
          sessions.filter((item) => item.status === 'completed').map((item) => item.userId),
        ),
      ],
      enrolledLearnerIds,
    );
    return analytics;
  });
}

export async function getTeacherVirtualLabStudent(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  context: VirtualLabSessionContext,
  studentId: string,
) {
  assertTeacher(principal, context.courseId);
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<SessionRow>(
      `SELECT s.*,a.display_name FROM zhiban.virtual_lab_sessions s JOIN zhiban.accounts a ON a.id=s.user_id AND a.tenant_id=s.tenant_id WHERE s.tenant_id=$1 AND s.user_id=$2 AND s.course_id=$3 AND s.activity_id=$4 AND s.scenario_id=$5 ORDER BY s.attempt_number DESC`,
      [principal.tenantId, studentId, ...contextParams(context)],
    );
    return result.rows.map(toSession);
  });
}
