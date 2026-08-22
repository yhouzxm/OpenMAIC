export interface ActivityAssignmentRecord {
  id: string;
  activityId: string;
  activityTitle: string;
  title: string;
  instructions: string;
  submissionType: 'text' | 'file' | 'mixed';
  maxFiles: number;
  maxFileSize: number;
  maxAttempts: number;
  opensAt: string | null;
  dueAt: string | null;
  allowLate: boolean;
  status: 'draft' | 'published' | 'closed' | 'archived';
  gradeItemId: string | null;
  submissions?: AssignmentSubmissionRecord[];
  mySubmissions?: AssignmentSubmissionRecord[];
}

export interface AssignmentSubmissionRecord {
  id: string;
  studentId: string;
  studentName?: string;
  attemptNo: number;
  textContent: string;
  status: 'draft' | 'submitted' | 'returned' | 'graded';
  isLate: boolean;
  feedback: string;
  score: number | null;
  submittedAt: string | null;
  files: Array<{ id: string; fileName: string; mimeType: string; fileSize: number }>;
}
