import { StudentCourseCatalog } from '@/components/zhiban/student-course-catalog';

export default async function StudentCourseWorkspacePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  return <StudentCourseCatalog courseId={courseId} />;
}
