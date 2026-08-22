import { TeacherAgentConsole } from '@/components/zhiban/teacher-agent-console';
import { TeacherCourseTutor } from '@/components/zhiban/teacher-course-tutor';
import { TeacherCoursePeer } from '@/components/zhiban/teacher-course-peer';
export default async function CourseAgentsPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  return <div className="space-y-6"><TeacherCourseTutor courseId={courseId} /><TeacherCoursePeer courseId={courseId} /><TeacherAgentConsole embedded fixedCourseId={courseId} /></div>;
}
