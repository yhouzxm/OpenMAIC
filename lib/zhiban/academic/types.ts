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
  name: string | null;
  capacity: number | null;
  enrolledCount: number;
  status: string;
}
export interface AcademicPerson {
  id: string;
  displayName: string;
  identifier: string;
}
export interface AdministrativeClassTeacher extends AcademicPerson {
  organizationId: string | null;
  organizationCode: string | null;
  organizationName: string | null;
}
export interface AcademicOverview {
  terms: AcademicTerm[];
  classes: AcademicClass[];
  courses: AcademicCourse[];
  offerings: CourseOffering[];
  teachers: AcademicPerson[];
}

export interface AdministrativeClassRecord {
  id: string;
  admissionTerm: string | null;
  code: string;
  name: string;
  headTeacherId: string | null;
  headTeacherName: string | null;
  expectedSize: number | null;
  memberCount: number;
  studentCategory: string | null;
  branchCode: string | null;
  branchName: string | null;
  studyCenterCode: string | null;
  studyCenterName: string | null;
  majorCode: string | null;
  majorName: string | null;
  trainingPlanNo: string | null;
}
