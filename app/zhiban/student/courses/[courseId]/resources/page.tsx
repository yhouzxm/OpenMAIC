import { StudentCourseContent } from '@/components/zhiban/student-course-content';
export default async function StudentCourseResourcesPage({ params }: { params: Promise<{ courseId: string }> }) { const { courseId } = await params; return <div className="mx-auto max-w-6xl"><StudentCourseContent courseId={courseId} sections={['resources']} /></div>; }
