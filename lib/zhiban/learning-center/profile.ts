import { randomUUID } from 'node:crypto';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import type { ZhibanDatabasePool } from '@/lib/zhiban/db/types';
import {
  calculateActuationKnowledgeProfile,
  calculateControlKnowledgeProfile,
  type KnowledgeStationProfile,
} from './control-actuation';
import { calculateSensingKnowledgeProfile } from './sensing';
import { calculateLearningCenterProfile } from './learning-center-profile';
import type { PersistedVirtualLabSession } from '@/lib/zhiban/virtual-lab/persistence/types';
import type { LearningEvent, StationId } from './types';

const profileIdentity: Partial<Record<StationId, { activityId: string; scenarioId: string }>> = {
  'station-02-sensing': {
    activityId: 'knowledge-station-02-sensing',
    scenarioId: 'knowledge-station-02-sensing',
  },
  'station-03-control': {
    activityId: 'knowledge-station-03-control',
    scenarioId: 'knowledge-station-03-control',
  },
  'station-04-actuation': {
    activityId: 'knowledge-station-04-actuation',
    scenarioId: 'knowledge-station-04-actuation',
  },
};

/** Stores code-course knowledge evidence in the existing Virtual Lab profile ledger; no second profile table. */
export async function updateSensingKnowledgeProfile(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  events: LearningEvent[],
) {
  return updateKnowledgeStationProfile(pool, principal, courseId, 'station-02-sensing', events);
}

/** Reuses the Virtual Lab learner profile ledger while preserving the knowledge-station source. */
export async function updateKnowledgeStationProfile(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  stationId: StationId,
  events: LearningEvent[],
) {
  const identity = profileIdentity[stationId];
  if (!identity) return null;
  const profile: KnowledgeStationProfile | ReturnType<typeof calculateSensingKnowledgeProfile> =
    stationId === 'station-02-sensing'
      ? calculateSensingKnowledgeProfile(events)
      : stationId === 'station-03-control'
        ? calculateControlKnowledgeProfile(events)
        : calculateActuationKnowledgeProfile(events);
  if (profile.sourceAttempts === 0) return null;
  await withZhibanTenant(pool, principal.tenantId, async (client) => {
    await client.query(
      `INSERT INTO zhiban.virtual_lab_learner_profiles(
        id,tenant_id,user_id,course_id,activity_id,scenario_id,dimensions,weak_points_json,performance_json,source_label,source_attempts
      ) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'[]'::jsonb,$8::jsonb,$9,$10)
      ON CONFLICT(tenant_id,user_id,course_id,activity_id,scenario_id) DO UPDATE SET
        dimensions=EXCLUDED.dimensions,performance_json=EXCLUDED.performance_json,source_label=EXCLUDED.source_label,
        source_attempts=EXCLUDED.source_attempts,updated_at=now()`,
      [
        randomUUID(),
        principal.tenantId,
        principal.id,
        courseId,
        identity.activityId,
        identity.scenarioId,
        JSON.stringify(
          'dimensions' in profile
            ? profile.dimensions
            : {
                sensorDetection: profile.sensorDetection,
                toolMeasurement: profile.toolMeasurement,
                plcSignalAnalysis: profile.plcSignalAnalysis,
              },
        ),
        JSON.stringify({
          source: profile.sourceLabel,
          dimensions:
            'dimensions' in profile
              ? Object.keys(profile.dimensions)
              : ['sensorDetection', 'toolMeasurement', 'plcSignalAnalysis'],
        }),
        profile.sourceLabel,
        profile.sourceAttempts,
      ],
    );
  });
  return profile;
}

export async function updateLearningCenterAggregateProfile(
  pool: ZhibanDatabasePool,
  principal: AuthorizedPrincipal,
  courseId: string,
  events: LearningEvent[],
) {
  return withZhibanTenant(pool, principal.tenantId, async (client) => {
    const sessionsResult = await client.query<{
      id: string;
      attempt_number: number;
      status: 'completed';
      started_at: Date | string;
      completed_at: Date | string | null;
      duration_seconds: number | null;
      overall_score: number | string | null;
      assessment_json: PersistedVirtualLabSession['assessment'];
      hints_used: number;
      wrong_actions: string[];
      actions_count: number;
      verification_passed: boolean;
    }>(
      `SELECT id,attempt_number,status,started_at,completed_at,duration_seconds,overall_score,
              assessment_json,hints_used,wrong_actions,actions_count,verification_passed
       FROM zhiban.virtual_lab_sessions
       WHERE tenant_id=$1 AND user_id=$2 AND course_id=$3 AND activity_id='mech-lab-line-stop'
         AND scenario_id='line-stop-001' AND status='completed'
       ORDER BY attempt_number DESC`,
      [principal.tenantId, principal.id, courseId],
    );
    const sessions: PersistedVirtualLabSession[] = sessionsResult.rows.map((row) => ({
      id: row.id,
      courseId,
      chapterId: 'chapter-3-5',
      activityId: 'mech-lab-line-stop',
      scenarioId: 'line-stop-001',
      attemptNumber: row.attempt_number,
      status: row.status,
      startedAt: new Date(row.started_at).toISOString(),
      completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      durationSeconds: row.duration_seconds,
      overallScore: row.overall_score === null ? null : Number(row.overall_score),
      assessment: row.assessment_json,
      hintsUsed: row.hints_used,
      wrongActions: row.wrong_actions ?? [],
      actionsCount: row.actions_count,
      verificationPassed: row.verification_passed,
    }));
    const profile = calculateLearningCenterProfile(courseId, events, sessions);
    await client.query(
      `INSERT INTO zhiban.virtual_lab_learner_profiles(
        id,tenant_id,user_id,course_id,activity_id,scenario_id,dimensions,weak_points_json,
        performance_json,source_label,source_attempts
      ) VALUES($1,$2,$3,$4,'knowledge-learning-center','knowledge-learning-center',$5::jsonb,$6::jsonb,$7::jsonb,$8,$9)
      ON CONFLICT(tenant_id,user_id,course_id,activity_id,scenario_id) DO UPDATE SET
        dimensions=EXCLUDED.dimensions,weak_points_json=EXCLUDED.weak_points_json,
        performance_json=EXCLUDED.performance_json,source_label=EXCLUDED.source_label,
        source_attempts=EXCLUDED.source_attempts,updated_at=now()`,
      [
        randomUUID(),
        principal.tenantId,
        principal.id,
        courseId,
        JSON.stringify(
          Object.fromEntries(
            Object.entries(profile.dimensions).map(([key, value]) => [key, value.score]),
          ),
        ),
        JSON.stringify(profile.recommendations),
        JSON.stringify(profile),
        'Learning Center Knowledge + Virtual Lab Assessment',
        events.length + sessions.length,
      ],
    );
    return profile;
  });
}
