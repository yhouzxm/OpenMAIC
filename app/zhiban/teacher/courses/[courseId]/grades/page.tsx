import { TeacherGradebookConsole } from '@/components/zhiban/teacher-gradebook-console';
export default async function CourseGradesPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  return <TeacherGradebookConsole embedded fixedCourseId={courseId} />;
}
