export interface ZhibanCourseClassroom {
  id: string;
  courseId: string;
  courseCode: string;
  courseName: string;
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
