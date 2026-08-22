import { StudentCoursePeer } from '@/components/zhiban/student-course-peer';
import { StudentCourseTutor } from '@/components/zhiban/student-course-tutor';
export default async function StudentCourseToolsPage({ params }: { params: Promise<{ courseId: string }> }) { const { courseId } = await params; return <div className="mx-auto max-w-6xl space-y-5"><StudentCourseTutor courseId={courseId} /><StudentCoursePeer courseId={courseId} /></div>; }
