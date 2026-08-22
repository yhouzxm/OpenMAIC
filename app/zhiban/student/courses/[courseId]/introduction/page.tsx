import { StudentCourseIntroduction } from '@/components/zhiban/student-course-introduction';

export default async function StudentCourseIntroductionPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <StudentCourseIntroduction courseId={courseId} />;
}
