export interface AcademicTerm {
  id: string;
  code: string;
  name: string;
  startsOn: string;
  endsOn: string;
  status: string;
}
export interface AcademicClass {
  id: string;
  termId: string;
  code: string;
  name: string;
  headTeacherId: string | null;
  headTeacherName: string | null;
  memberCount: number;
  status: string;
}
export interface AcademicCourse {
  id: string;
  code: string;
  name: string;
  credits: number | null;
  ownerTeacherId: string | null;
  ownerTeacherName: string | null;
  status: string;
}
export interface CourseOffering {
  id: string;
  courseId: string;
  courseName: string;
  termId: string;
  termName: string;
  classId: string | null;
  className: string | null;
  code: string;
  capacity: number | null;
  enrolledCount: number;
  status: string;
}
export interface AcademicPerson {
  id: string;
  displayName: string;
  identifier: string;
}
export interface EnrollmentRecord {
  id: string;
  offeringId: string;
  offeringCode: string;
  studentId: string;
  studentName: string;
  studentNo: string;
  status: string;
  source: string;
}

export interface AcademicOverview {
  terms: AcademicTerm[];
  classes: AcademicClass[];
  courses: AcademicCourse[];
  offerings: CourseOffering[];
  students: AcademicPerson[];
  teachers: AcademicPerson[];
  enrollments: EnrollmentRecord[];
}
