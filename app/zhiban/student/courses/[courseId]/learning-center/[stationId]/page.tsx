import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { LearningStation } from '@/components/zhiban/learning-station';
import { LearningStationLocked } from '@/components/zhiban/learning-station-locked';
import { getStation, type StationId } from '@/lib/zhiban/learning-center';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { canPrincipalAccessLearningStation } from '@/lib/zhiban/learning-center/service';
import { requireMechatronicsStudentEnrollment } from '@/lib/zhiban/mechatronics-course';

export default async function LearningStationPage({
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
  const course = await requireMechatronicsStudentEnrollment(pool, principal, courseId);
  if (courseId !== course.id)
    redirect(`/zhiban/student/courses/${course.id}/learning-center/${stationId}`);
  const access = await canPrincipalAccessLearningStation(
    pool,
    principal,
    course.id,
    stationId as StationId,
  );
  if (!access.decision.allowed)
    return (
      <LearningStationLocked
        courseId={course.id}
        stationId={stationId as StationId}
        prerequisiteStationId={access.decision.prerequisiteStationId}
        reason={access.decision.reason}
      />
    );
  if (access.decision.mode === 'teacher_preview')
    redirect(`/zhiban/teacher/courses/${courseId}/learning-center/${stationId}`);
  return (
    <LearningStation
      courseId={course.id}
      stationId={stationId}
      previewMode={access.decision.mode === 'review_demo' ? 'review' : undefined}
    />
  );
}
