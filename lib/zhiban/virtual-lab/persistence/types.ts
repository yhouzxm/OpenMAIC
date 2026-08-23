import type { VirtualLabAssessment } from '../assessment';
import type { VirtualLabLearningProfile } from '../ai/types';

export type VirtualLabSessionStatus = 'in_progress' | 'completed' | 'abandoned';

export interface VirtualLabSessionContext {
  courseId: string;
  chapterId: string;
  activityId: string;
  scenarioId: string;
}

export interface PersistedVirtualLabSession extends VirtualLabSessionContext {
  id: string;
  attemptNumber: number;
  status: VirtualLabSessionStatus;
  startedAt: string;
  completedAt: string | null;
  durationSeconds: number | null;
  overallScore: number | null;
  assessment: VirtualLabAssessment | null;
  hintsUsed: number;
  wrongActions: string[];
  actionsCount: number;
  verificationPassed: boolean;
}

export interface PersistedVirtualLabAction {
  action: string;
  target?: string;
  value?: string | number;
  unit?: string;
  phase?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

export interface VirtualLabHistory {
  sessions: PersistedVirtualLabSession[];
  summary: {
    attempts: number;
    highestScore: number | null;
    latestScore: number | null;
    bestDurationSeconds: number | null;
    latestHintsUsed: number | null;
  };
  profile: VirtualLabLearningProfile | null;
  profileSource: string | null;
}

export interface TeacherVirtualLabStudent {
  userId: string;
  name: string;
  attempts: number;
  latestScore: number | null;
  highestScore: number | null;
  latestDurationSeconds: number | null;
  latestHintsUsed: number | null;
  weakPoints: string[];
  completedAt: string | null;
  latestAssessment: VirtualLabAssessment | null;
}

export interface TeacherVirtualLabAnalytics {
  metrics: {
    participatingStudents: number;
    completedStudents: number;
    completionRate: number | null;
    averageScore: number | null;
    averageDurationSeconds: number | null;
    averageHintsUsed: number | null;
  };
  students: TeacherVirtualLabStudent[];
  errorPatterns: { code: string; count: number; percent: number }[];
  dimensions: { key: string; label: string; average: number | null }[];
  interventions: string[];
}
