import { PblProjectConsole } from '@/components/zhiban/pbl-project-console';
export default async function CoursePblPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <PblProjectConsole embedded fixedCourseId={courseId} />;
}
