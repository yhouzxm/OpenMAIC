import { StudentRiskConsole } from '@/components/zhiban/student-risk-console';

export default async function StudentCourseSupportPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <StudentRiskConsole hideHeader courseId={courseId} />;
}
