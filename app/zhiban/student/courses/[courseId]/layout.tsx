import { StudentCourseWorkspaceShell } from '@/components/zhiban/student-course-workspace';

export default async function StudentCourseLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  return <StudentCourseWorkspaceShell courseId={courseId}>{children}</StudentCourseWorkspaceShell>;
}
