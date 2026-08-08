import { TeacherRiskConsole } from '@/components/zhiban/teacher-risk-console';
export default async function CourseRisksPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  return <TeacherRiskConsole embedded fixedCourseId={courseId} />;
}
