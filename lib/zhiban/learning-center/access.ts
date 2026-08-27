import { hasScopedPermission } from '@/lib/zhiban/rbac/service';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac/types';
import type { PersistedVirtualLabSession } from '@/lib/zhiban/virtual-lab/persistence/types';
import type { LearningCenterProgress, StationId } from './types';
import { STATION_IDS } from './types';

export type StationAccessMode = 'student' | 'teacher_preview' | 'review_demo';

export interface StationAccessDecision {
  allowed: boolean;
  reason: string | null;
  prerequisiteStationId: StationId | null;
  mode: StationAccessMode;
}

export interface LearningCenterAccessState {
  stations: Record<StationId, StationAccessDecision>;
  currentStationId: StationId | null;
  mode: StationAccessMode;
}

const PREREQUISITES: Partial<Record<StationId, StationId>> = {
  'station-02-sensing': 'station-01-system',
  'station-03-control': 'station-02-sensing',
  'station-04-actuation': 'station-03-control',
  'station-05-diagnosis': 'station-04-actuation',
  'station-06-virtual-lab': 'station-05-diagnosis',
};

function reviewDemoLogins(raw = process.env.ZHIBAN_REVIEW_DEMO_ACCOUNTS) {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((login) => login.trim())
      .filter(Boolean),
  );
}

export function isReviewDemoPrincipal(principal: AuthorizedPrincipal): boolean {
  return principal.accountType === 'student' && reviewDemoLogins().has(principal.loginName);
}

export function isTeacherPreviewPrincipal(principal: AuthorizedPrincipal, courseId: string): boolean {
  return (
    (principal.accountType === 'teacher' || principal.accountType === 'admin') &&
    hasScopedPermission(principal, 'course:manage', { courseIds: [courseId] })
  );
}

export function hasValidVirtualLabAssessment(sessions: PersistedVirtualLabSession[]): boolean {
  return sessions.some(
    (session) =>
      session.status === 'completed' &&
      session.assessment !== null &&
      Number.isFinite(session.assessment.overallScore),
  );
}

export function canAccessStation(input: {
  stationId: StationId;
  progress: LearningCenterProgress;
  hasCompletedVirtualLabAssessment: boolean;
  mode?: StationAccessMode;
}): StationAccessDecision {
  const mode = input.mode ?? 'student';
  if (mode === 'teacher_preview' || mode === 'review_demo')
    return { allowed: true, reason: null, prerequisiteStationId: null, mode };

  if (input.stationId === 'station-01-system')
    return { allowed: true, reason: null, prerequisiteStationId: null, mode };
  if (input.stationId === 'station-07-assessment') {
    return input.hasCompletedVirtualLabAssessment
      ? { allowed: true, reason: null, prerequisiteStationId: null, mode }
      : {
          allowed: false,
          reason: '完成一次综合实训并生成评价后解锁',
          prerequisiteStationId: 'station-06-virtual-lab',
          mode,
        };
  }

  const prerequisiteStationId = PREREQUISITES[input.stationId];
  if (!prerequisiteStationId) return { allowed: false, reason: '学习站配置无效', prerequisiteStationId: null, mode };
  if (input.progress.stations[prerequisiteStationId]?.status === 'completed')
    return { allowed: true, reason: null, prerequisiteStationId, mode };
  return {
    allowed: false,
    reason: '完成上一学习站后解锁',
    prerequisiteStationId,
    mode,
  };
}

export function buildLearningCenterAccessState(input: {
  progress: LearningCenterProgress;
  sessions: PersistedVirtualLabSession[];
  mode?: StationAccessMode;
}): LearningCenterAccessState {
  const mode = input.mode ?? 'student';
  const hasCompletedVirtualLabAssessment = hasValidVirtualLabAssessment(input.sessions);
  const stations = Object.fromEntries(
    STATION_IDS.map((stationId) => [
      stationId,
      canAccessStation({ stationId, progress: input.progress, hasCompletedVirtualLabAssessment, mode }),
    ]),
  ) as Record<StationId, StationAccessDecision>;
  const currentStationId = STATION_IDS.find(
    (stationId) => stations[stationId].allowed && input.progress.stations[stationId]?.status !== 'completed',
  ) ?? null;
  return { stations, currentStationId, mode };
}

export function requiresLearningCenterStationGuard(sourceStation: string | undefined): boolean {
  return sourceStation === 'station-06-virtual-lab';
}
