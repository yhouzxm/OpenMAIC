import { StudentCourseContent } from '@/components/zhiban/student-course-content';
import { StudentCoursework } from '@/components/zhiban/student-coursework';
export default async function StudentCourseCourseworkPage({ params }: { params: Promise<{ courseId: string }> }) { const { courseId } = await params; return <div className="mx-auto max-w-6xl space-y-5"><StudentCoursework courseId={courseId} /><StudentCourseContent courseId={courseId} sections={['discussions']} /></div>; }
