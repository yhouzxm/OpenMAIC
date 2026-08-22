import { TeacherClassroomConsole } from '@/components/zhiban/teacher-classroom-console';
import { CourseStructureDesigner } from '@/components/zhiban/course-structure-designer';
import { CourseContentConsole } from '@/components/zhiban/course-content-console';
import { TeacherCourseworkConsole } from '@/components/zhiban/teacher-coursework-console';
export default async function CourseClassroomsPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams: Promise<{ contentActivityId?: string }>;
}) {
  const { courseId } = await params;
  const { contentActivityId } = await searchParams;
  return (
    <div className="space-y-8">
      <CourseStructureDesigner courseId={courseId} />
      <CourseContentConsole courseId={courseId} initialContentActivityId={contentActivityId} />
      <TeacherCourseworkConsole courseId={courseId} />
      <section className="border-t pt-8">
        <TeacherClassroomConsole embedded fixedCourseId={courseId} />
      </section>
    </div>
  );
}
