export type CourseActivityType =
  | 'content'
  | 'resource'
  | 'classroom'
  | 'pbl'
  | 'assignment'
  | 'quiz'
  | 'discussion'
  | 'ema'
  | 'practice'
  | 'summary'
  | 'ai_support'
  | 'openmaic_slide'
  | 'openmaic_quiz'
  | 'openmaic_interactive'
  | 'openmaic_pbl'
  | 'openmaic_3d';

export interface CourseActivity {
  id: string;
  chapterId: string;
  title: string;
  description: string;
  activityType: CourseActivityType;
  referenceId: string | null;
  position: number;
  estimatedMinutes: number;
  required: boolean;
  opensAt: string | null;
  closesAt: string | null;
  openingRule: Record<string, unknown>;
  completionRule: Record<string, unknown>;
  prerequisiteActivityIds: string[];
  progress?: {
    status: 'not_started' | 'in_progress' | 'completed';
    progressPercent: number;
    score: number | null;
  };
  available?: boolean;
  unavailableReason?: string | null;
}

export interface CourseChapter {
  id: string;
  title: string;
  description: string;
  position: number;
  estimatedMinutes: number;
  activities: CourseActivity[];
}

export interface CourseModule {
  id: string;
  title: string;
  description: string;
  position: number;
  chapters: CourseChapter[];
}

export interface CourseStructure {
  courseId: string;
  version: number;
  publishedAt: string | null;
  modules: CourseModule[];
}

export interface CourseDesignVersion {
  id: string;
  version: number;
  status: 'published' | 'superseded';
  changeNote: string;
  publishedAt: string;
  publishedByName: string;
}

export interface CourseActivityReference {
  id: string;
  type:
    | 'content'
    | 'resource'
    | 'classroom'
    | 'pbl'
    | 'assignment'
    | 'quiz'
    | 'practice'
    | 'discussion';
  title: string;
  synced?: boolean;
}

export interface CourseStructureChanges {
  added: number;
  removed: number;
  changed: number;
  summary: string[];
}
