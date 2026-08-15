export interface PblProjectSetting {
  name: string;
  description: string;
  deliverable: string;
}

export interface SceneRuleSetting {
  sceneId: string;
  name: string;
  condition: 'always' | 'date' | 'previous_completed' | 'score';
  value: string;
}

export interface CourseResourceSetting {
  title: string;
  type: 'document' | 'video' | 'link' | 'dataset' | 'other';
  url: string;
}

export interface TeacherCourse {
  id: string;
  code: string;
  name: string;
  description: string;
  credits: number | null;
  startsAt: string | null;
  endsAt: string | null;
  deliveryMode: 'online' | 'blended' | 'face_to_face';
  learningObjectives: string[];
  teachingNotes: string;
  settingsConfigured: boolean;
  pblEnabled: boolean;
  pblProjects: PblProjectSetting[];
  sceneRules: SceneRuleSetting[];
  courseResources: CourseResourceSetting[];
  agentSettings: {
    tutorEnabled: boolean;
    peerEnabled: boolean;
    monitorEnabled: boolean;
    strategyEnabled: boolean;
  };
  promptStrategy: { version: string; policy: string };
  gradingPolicy: { formativeWeight: number; projectWeight: number; finalWeight: number };
  assignmentPolicy: { assignmentCount: number; maxAttempts: number };
  warningPolicy: { scoreThreshold: number; inactivityDays: number; missedAssignments: number };
  interventionPolicy: {
    strategy: 'notify_student' | 'notify_teacher' | 'agent_coaching' | 'manual_follow_up';
    message: string;
  };
  publicationStatus: 'draft' | 'published';
  version: number;
}

export type TeacherCourseUpdate = Omit<
  TeacherCourse,
  'id' | 'code' | 'version' | 'settingsConfigured'
> & {
  expectedVersion: number;
};
