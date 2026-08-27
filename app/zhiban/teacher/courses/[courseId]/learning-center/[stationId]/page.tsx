import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { LearningStation } from '@/components/zhiban/learning-station';
import { getStation } from '@/lib/zhiban/learning-center';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { getLearningCenterAccessState } from '@/lib/zhiban/learning-center/service';
import { resolveMechatronicsCourse } from '@/lib/zhiban/mechatronics-course';

export default async function TeacherLearningStationPreviewPage({
  params,
}: {
  params: Promise<{ courseId: string; stationId: string }>;
}) {
  const { courseId, stationId } = await params;
  if (!getStation(stationId)) notFound();
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), token);
  if (!principal) redirect('/zhiban/login');
  const pool = getZhibanPool();
  const course = await resolveMechatronicsCourse(pool, principal, courseId);
  if (!course) redirect(`/zhiban/teacher/courses/${courseId}`);
  if (courseId !== course.id)
    redirect(`/zhiban/teacher/courses/${course.id}/learning-center/${stationId}`);
  const access = await getLearningCenterAccessState(pool, principal, course.id);
  if (access.access.mode !== 'teacher_preview') redirect(`/zhiban/teacher/courses/${course.id}`);
  return (
    <>
      <p className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        教师预览：当前操作不会写入学生学习记录、学习画像或班级统计。
      </p>
      <LearningStation courseId={course.id} stationId={stationId} previewMode="teacher" />
    </>
  );
}
