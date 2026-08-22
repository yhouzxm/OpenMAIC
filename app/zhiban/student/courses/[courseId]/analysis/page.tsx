import { StudentProfileConsole } from '@/components/zhiban/student-profile-console';

export default async function StudentCourseAnalysisPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  return <StudentProfileConsole hideHeader courseId={courseId} />;
}
