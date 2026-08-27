export interface ZhibanCourseClassroom {
  id: string;
  courseId: string;
  courseCode: string;
  courseName: string;
  academicYear?: string;
  termName?: string;
  offeringStatus?: string;
  department?: string;
  learningCenter?: string;
  pblEnabled?: boolean | null;
  classroomId: string;
  title: string;
  description: string;
  displayOrder: number;
  opensAt: string | null;
  closesAt: string | null;
  status: 'draft' | 'published' | 'archived';
  sessionId: string | null;
  progressPercent: number;
  currentSceneId: string | null;
  lastActivityAt: string | null;
}

export interface ClassroomBindingInput {
  classroomId: string;
  title: string;
  description: string;
  displayOrder: number;
  opensAt: string | null;
  closesAt: string | null;
  status: 'draft' | 'published';
}

export type ClassroomEventType =
  | 'classroom_opened'
  | 'scene_viewed'
  | 'slide_action'
  | 'quiz_answered'
  | 'quiz_completed'
  | 'simulation_interacted'
  | 'pbl_activity'
  | 'chat_message'
  | 'resource_opened'
  | 'classroom_completed';

export type ClassroomSceneDispatchType = 'SCENE' | 'VIRTUAL_LAB';
export type ClassroomSceneSessionStatus = 'PREPARED' | 'ACTIVE' | 'COMPLETED';

export interface ClassroomSceneSession {
  id: string;
  courseClassroomId: string;
  activeSceneId: string | null;
  dispatchType: ClassroomSceneDispatchType;
  dispatchPayload: Record<string, unknown>;
  status: ClassroomSceneSessionStatus;
  version: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ClassroomSceneLearningEventType =
  | 'ENTER_SCENE'
  | 'INTERACTING'
  | 'COMPLETE_SCENE'
  | 'REMEDIATION_SCENE_ENTERED';

export interface ClassroomSceneLearningEventPayload {
  sceneId: string;
  classroomBindingId: string;
  classroomSceneSessionId: string;
  eventType: ClassroomSceneLearningEventType;
  isCorrect?: boolean | null;
  firstChoice?: string | null;
  durationMs?: number | null;
  conceptErrors: string[];
  attempt?: number | null;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface ClassroomSceneAnalytics {
  participants: number;
  completed: number;
  completionRate: number;
  correctRate: number | null;
  averageDurationMs: number | null;
  firstChoice: Array<{ value: string; count: number }>;
  conceptErrors: Array<{ code: string; count: number; percentage: number }>;
}
