import { TeacherAgentConsole } from '@/components/zhiban/teacher-agent-console';
export default async function CourseAgentsPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  return <TeacherAgentConsole embedded fixedCourseId={courseId} />;
}
