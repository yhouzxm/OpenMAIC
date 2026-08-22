export interface CourseTeacherRecord {
  id: string;
  employeeNo: string;
  name: string;
  organizationName: string;
  teachingRole: 'primary' | 'assistant' | 'tutor';
  offeringName: string;
  assignedAt: string;
}

export interface CourseStudentRecord {
  id: string;
  studentNo: string;
  name: string;
  organizationName: string;
  className: string;
  offeringName: string;
  status: string;
  enrolledAt: string;
}

export interface CourseRoster {
  teachers: CourseTeacherRecord[];
  students: CourseStudentRecord[];
}
