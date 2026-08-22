import { StudentGradeConsole } from '@/components/zhiban/student-grade-console';

export default async function StudentCourseGradesPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <StudentGradeConsole hideHeader courseId={courseId} />;
}
