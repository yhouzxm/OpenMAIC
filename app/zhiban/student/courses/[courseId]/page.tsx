import { StudentCourseStructure } from '@/components/zhiban/student-course-structure';

export default async function StudentCourseWorkspacePage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  return (
    <div className="mx-auto max-w-6xl">
      <StudentCourseStructure courseId={courseId} />
    </div>
  );
}
