import { describe, expect, it } from 'vitest';
import {
  emptyLearningCenterProgress,
  type StationId,
} from '@/lib/zhiban/learning-center';
import {
  buildLearningCenterAccessState,
  canAccessStation,
  hasValidVirtualLabAssessment,
  isTeacherPreviewPrincipal,
  requiresLearningCenterStationGuard,
} from '@/lib/zhiban/learning-center/access';
import type { AuthorizedPrincipal } from '@/lib/zhiban/rbac';
import type { PersistedVirtualLabSession } from '@/lib/zhiban/virtual-lab/persistence/types';

const courseId = 'mech-mechatronics-system';

function progressThrough(lastCompleted?: StationId) {
  const progress = emptyLearningCenterProgress(courseId);
  const stations: StationId[] = [
    'station-01-system',
    'station-02-sensing',
    'station-03-control',
    'station-04-actuation',
    'station-05-diagnosis',
  ];
  for (const stationId of stations) {
    if (lastCompleted === undefined) break;
    progress.stations[stationId].status = 'completed';
    progress.stations[stationId].progressPercent = 100;
    if (stationId === lastCompleted) break;
  }
  return progress;
}

function completedSession(assessment = true): PersistedVirtualLabSession {
  return {
    id: 'attempt-1',
    courseId,
    chapterId: 'chapter-3-5',
    activityId: 'mech-lab-line-stop',
    scenarioId: 'line-stop-001',
    attemptNumber: 1,
    status: 'completed',
    startedAt: '2026-08-25T08:00:00.000Z',
    completedAt: '2026-08-25T08:04:00.000Z',
    durationSeconds: 240,
    overallScore: 90,
    assessment: assessment ? ({ overallScore: 90 } as PersistedVirtualLabSession['assessment']) : null,
    hintsUsed: 0,
    wrongActions: [],
    actionsCount: 8,
    verificationPassed: true,
  };
}

describe('Learning Center sequential station access', () => {
  it('only opens Station 01 for a new student', () => {
    const progress = progressThrough();
    expect(canAccessStation({ stationId: 'station-01-system', progress, hasCompletedVirtualLabAssessment: false }).allowed).toBe(true);
    expect(canAccessStation({ stationId: 'station-02-sensing', progress, hasCompletedVirtualLabAssessment: false })).toMatchObject({
      allowed: false,
      prerequisiteStationId: 'station-01-system',
    });
  });

  it.each([
    ['station-01-system', 'station-02-sensing'],
    ['station-02-sensing', 'station-03-control'],
    ['station-03-control', 'station-04-actuation'],
    ['station-04-actuation', 'station-05-diagnosis'],
    ['station-05-diagnosis', 'station-06-virtual-lab'],
  ] as const)('unlocks the following station after %s is completed', (completed, next) => {
    const progress = progressThrough(completed);
    expect(canAccessStation({ stationId: next, progress, hasCompletedVirtualLabAssessment: false }).allowed).toBe(true);
  });

  it('requires a completed Virtual Lab assessment for Station 07', () => {
    const progress = progressThrough('station-05-diagnosis');
    expect(canAccessStation({ stationId: 'station-07-assessment', progress, hasCompletedVirtualLabAssessment: false })).toMatchObject({
      allowed: false,
      prerequisiteStationId: 'station-06-virtual-lab',
    });
    expect(hasValidVirtualLabAssessment([completedSession(false)])).toBe(false);
    expect(hasValidVirtualLabAssessment([completedSession(true)])).toBe(true);
    expect(canAccessStation({ stationId: 'station-07-assessment', progress, hasCompletedVirtualLabAssessment: true }).allowed).toBe(true);
  });

  it('keeps completed stations available for review even if concept errors exist', () => {
    const progress = progressThrough('station-03-control');
    expect(canAccessStation({ stationId: 'station-02-sensing', progress, hasCompletedVirtualLabAssessment: false }).allowed).toBe(true);
    expect(canAccessStation({ stationId: 'station-03-control', progress, hasCompletedVirtualLabAssessment: false }).allowed).toBe(true);
  });

  it('identifies the first unlocked unfinished station as current learning', () => {
    const state = buildLearningCenterAccessState({
      progress: progressThrough('station-02-sensing'),
      sessions: [],
    });
    expect(state.currentStationId).toBe('station-03-control');
    expect(state.stations['station-04-actuation'].allowed).toBe(false);
  });

  it('allows only trusted modes to bypass the student prerequisite chain', () => {
    const progress = progressThrough();
    expect(canAccessStation({ stationId: 'station-06-virtual-lab', progress, hasCompletedVirtualLabAssessment: false, mode: 'teacher_preview' }).allowed).toBe(true);
    expect(canAccessStation({ stationId: 'station-07-assessment', progress, hasCompletedVirtualLabAssessment: false, mode: 'review_demo' }).allowed).toBe(true);
  });

  it('requires scoped course management permission for teacher preview', () => {
    const teacher = {
      id: 'teacher-1',
      tenantId: 'tenant-1',
      loginName: 'teacher-001',
      displayName: '示例教师',
      accountType: 'teacher',
      mustChangePassword: false,
      roles: ['course_teacher'],
      permissions: ['course:manage'],
      grants: [
        {
          roleCode: 'course_teacher',
          permission: 'course:manage',
          scopeType: 'course',
          scopeId: courseId,
        },
      ],
    } satisfies AuthorizedPrincipal;
    expect(isTeacherPreviewPrincipal(teacher, courseId)).toBe(true);
    expect(isTeacherPreviewPrincipal({ ...teacher, grants: [] }, courseId)).toBe(false);
  });

  it('guards only Learning Center launches of the independently usable Virtual Lab', () => {
    expect(requiresLearningCenterStationGuard('station-06-virtual-lab')).toBe(true);
    expect(requiresLearningCenterStationGuard(undefined)).toBe(false);
    expect(requiresLearningCenterStationGuard('station-05-diagnosis')).toBe(false);
  });
});
