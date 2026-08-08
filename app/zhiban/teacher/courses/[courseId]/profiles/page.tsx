import { TeacherProfileConsole } from '@/components/zhiban/teacher-profile-console';
export default async function CourseProfilesPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  return <TeacherProfileConsole embedded fixedCourseId={courseId} />;
}
