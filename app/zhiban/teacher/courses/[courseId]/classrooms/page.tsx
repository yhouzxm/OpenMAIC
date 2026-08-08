import { TeacherClassroomConsole } from '@/components/zhiban/teacher-classroom-console';
export default async function CourseClassroomsPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  return <TeacherClassroomConsole embedded fixedCourseId={courseId} />;
}
