import { randomUUID } from 'node:crypto';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { AuthorizationError } from '@/lib/zhiban/rbac/service';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import { getKnowledgePoint, getStation, isStationId } from './registry';
import { deriveLearningCenterProgress } from './progress';
import {
  buildLearningCenterAccessState,
  isReviewDemoPrincipal,
  isTeacherPreviewPrincipal,
  type LearningCenterAccessState,
} from './access';
import { updateKnowledgeStationProfile } from './profile';
import { updateLearningCenterAggregateProfile } from './profile';
import { calculateLearningCenterProfile } from './learning-center-profile';
import { deriveConceptErrorStates, deriveRemediationRuns } from '@/lib/zhiban/scene-orchestration/remediation';
import type { PersistedVirtualLabSession } from '@/lib/zhiban/virtual-lab/persistence/types';
import type {
  LearningCenterProgress,
  LearningEvent,
  LearningEventInput,
  StationId,
} from './types';

function assertStudent(principal: AuthorizedPrincipal) {
  if (principal.accountType !== 'student')
    throw new AuthorizationError('Student access required', 403);
}

function asIso(value: Date | string) {
  return new Date(value).toISOString();
}

export async function listKnowledgeLearningEvents(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
): Promise<LearningEvent[]> {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<{
      id: string;
      station_id: string;
      knowledge_point_id: string | null;
      event_type: LearningEventInput['eventType'];
      payload: Record<string, unknown>;
      is_correct: boolean | null;
      attempt: number;
      occurred_at: Date | string;
    }>(
      `SELECT id,station_id,knowledge_point_id,event_type,payload,is_correct,attempt,occurred_at
       FROM zhiban.knowledge_learning_events
       WHERE tenant_id=$1 AND learner_id=$2 AND course_id=$3
       ORDER BY occurred_at ASC`,
      [principal.tenantId, principal.id, courseId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      courseId,
      stationId: row.station_id as LearningEvent['stationId'],
      knowledgePointId: row.knowledge_point_id ?? undefined,
      eventType: row.event_type,
      payload: row.payload ?? {},
      isCorrect: row.is_correct ?? undefined,
      attempt: row.attempt,
      timestamp: asIso(row.occurred_at),
    }));
  });
}

export async function recordKnowledgeLearningEvent(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  input: LearningEventInput,
): Promise<LearningEvent> {
  assertStudent(principal);
  if (!isStationId(input.stationId) || !getStation(input.stationId))
    throw new Error('Invalid learning station');
  if (input.knowledgePointId && !getKnowledgePoint(input.knowledgePointId))
    throw new Error('Invalid knowledge point');
  const id = randomUUID();
  const timestamp =
    input.timestamp && Number.isFinite(Date.parse(input.timestamp))
      ? new Date(input.timestamp).toISOString()
      : new Date().toISOString();
  await withZhibanTenant(pool, principal.tenantId, async (client) => {
    await client.query(
      `INSERT INTO zhiban.knowledge_learning_events(id,tenant_id,learner_id,course_id,station_id,knowledge_point_id,event_type,payload,is_correct,attempt,occurred_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11)`,
      [
        id,
        principal.tenantId,
        principal.id,
        courseId,
        input.stationId,
        input.knowledgePointId ?? null,
        input.eventType,
        JSON.stringify(input.payload ?? {}),
        input.isCorrect ?? null,
        Math.max(1, input.attempt ?? 1),
        timestamp,
      ],
    );
  });
  if (
    ['station-02-sensing', 'station-03-control', 'station-04-actuation'].includes(
      input.stationId,
    ) &&
    input.eventType === 'SUBMIT_MICRO_EXERCISE'
  ) {
    try {
      await updateKnowledgeStationProfile(
        pool,
        principal,
        courseId,
        input.stationId,
        await listKnowledgeLearningEvents(pool, principal, courseId),
      );
    } catch {
      // Learning evidence is already saved. Profile enrichment must remain non-blocking.
    }
  }
  if (input.eventType === 'SUBMIT_MICRO_EXERCISE') {
    try {
      await updateLearningCenterAggregateProfile(
        pool,
        principal,
        courseId,
        await listKnowledgeLearningEvents(pool, principal, courseId),
      );
    } catch {
      // Aggregate profile enrichment is non-blocking; the learning event is authoritative.
    }
  }
  return { ...input, id, courseId, timestamp };
}

async function listCompletedVirtualLabSessions(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
): Promise<PersistedVirtualLabSession[]> {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM zhiban.virtual_lab_sessions
       WHERE tenant_id=$1 AND user_id=$2 AND course_id=$3 AND activity_id='mech-lab-line-stop'
         AND scenario_id='line-stop-001' AND status='completed' AND assessment_json IS NOT NULL
       ORDER BY attempt_number DESC`,
      [principal.tenantId, principal.id, courseId],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      courseId,
      chapterId: String(row.chapter_id),
      activityId: String(row.activity_id),
      scenarioId: String(row.scenario_id),
      attemptNumber: Number(row.attempt_number),
      status: 'completed',
      startedAt: new Date(String(row.started_at)).toISOString(),
      completedAt: row.completed_at ? new Date(String(row.completed_at)).toISOString() : null,
      durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
      overallScore: row.overall_score === null ? null : Number(row.overall_score),
      assessment:
        row.assessment_json && typeof row.assessment_json === 'object'
          ? (row.assessment_json as PersistedVirtualLabSession['assessment'])
          : null,
      hintsUsed: Number(row.hints_used ?? 0),
      wrongActions: Array.isArray(row.wrong_actions) ? (row.wrong_actions as string[]) : [],
      actionsCount: Number(row.actions_count ?? 0),
      verificationPassed: row.verification_passed === true,
    }));
  });
}

async function getStudentLearningCenterData(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  const events = await listKnowledgeLearningEvents(pool, principal, courseId);
  const sessions = await listCompletedVirtualLabSessions(pool, principal, courseId);
  const progress = deriveLearningCenterProgress(courseId, events, true);
  if (sessions.length) {
    const station06 = progress.stations['station-06-virtual-lab'];
    station06.status = 'completed';
    station06.progressPercent = 100;
    station06.completedKnowledgePoints = 1;
    station06.totalKnowledgePoints = 1;
    station06.lastEventAt = sessions[0].completedAt;
  }
  return { events, sessions, progress };
}

export async function getLearningCenterAccessState(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
): Promise<{
  progress: LearningCenterProgress;
  sessions: PersistedVirtualLabSession[];
  access: LearningCenterAccessState;
  preview: boolean;
}> {
  if (isTeacherPreviewPrincipal(principal, courseId)) {
    const progress = deriveLearningCenterProgress(courseId, [], true);
    return {
      progress,
      sessions: [],
      access: buildLearningCenterAccessState({ progress, sessions: [], mode: 'teacher_preview' }),
      preview: true,
    };
  }
  assertStudent(principal);
  const { sessions, progress } = await getStudentLearningCenterData(pool, principal, courseId);
  const mode = isReviewDemoPrincipal(principal) ? 'review_demo' : 'student';
  return {
    progress,
    sessions,
    access: buildLearningCenterAccessState({ progress, sessions, mode }),
    preview: false,
  };
}

export async function canPrincipalAccessLearningStation(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  stationId: StationId,
) {
  const state = await getLearningCenterAccessState(pool, principal, courseId);
  return { ...state, decision: state.access.stations[stationId] };
}

export async function getLearningCenterIntegratedSummary(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  assertStudent(principal);
  const { events, sessions, progress } = await getStudentLearningCenterData(pool, principal, courseId);
  try {
    await updateLearningCenterAggregateProfile(pool, principal, courseId, events);
  } catch {
    // The integrated summary remains available even if profile persistence is temporarily offline.
  }
  return {
    progress,
    profile: calculateLearningCenterProfile(courseId, events, sessions),
    sessions,
    conceptErrorStates: deriveConceptErrorStates(events),
    remediationRuns: deriveRemediationRuns(events),
  };
}

export async function getLearningCenterSummaryForPrincipal(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
) {
  const accessState = await getLearningCenterAccessState(pool, principal, courseId);
  if (accessState.preview) {
    return {
      ...accessState,
      profile: calculateLearningCenterProfile(courseId, [], []),
      conceptErrorStates: [],
      remediationRuns: [],
    };
  }
  const summary = await getLearningCenterIntegratedSummary(pool, principal, courseId);
  return { ...summary, access: accessState.access, preview: false };
}

export async function getKnowledgeLearningCenterProgress(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
): Promise<LearningCenterProgress> {
  assertStudent(principal);
  return deriveLearningCenterProgress(
    courseId,
    await listKnowledgeLearningEvents(pool, principal, courseId),
    true,
  );
}
