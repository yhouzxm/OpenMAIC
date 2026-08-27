import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { OpenMaicClassroomPlayer } from '@/components/openmaic-classroom-player';
import { ClassroomAgentBridge } from '@/components/zhiban/classroom-agent-bridge';
import { OpenMaicActivityTracker } from '@/components/zhiban/openmaic-activity-tracker';
import { VirtualLabRunner } from '@/components/zhiban/virtual-lab-runner';
import { LearningStationLocked } from '@/components/zhiban/learning-station-locked';
import { isZhibanOpenMaicActivityEnabled } from '@/lib/config/feature-flags';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getOpenMaicActivityLaunch } from '@/lib/zhiban/openmaic-activity';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';
import { getMechLabActivity } from '@/lib/zhiban/virtual-lab/registry';
import { requiresLearningCenterStationGuard } from '@/lib/zhiban/learning-center/access';
import { canPrincipalAccessLearningStation } from '@/lib/zhiban/learning-center/service';
import { requireMechatronicsStudentEnrollment } from '@/lib/zhiban/mechatronics-course';

export default async function OpenMaicSingleActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string; activityId: string }>;
  searchParams?: Promise<{
    sourceStation?: string | string[];
    classroomBindingId?: string | string[];
    classroomSceneSessionId?: string | string[];
    sceneId?: string | string[];
    remediationRunId?: string | string[];
    sourceSceneId?: string | string[];
    targetSceneId?: string | string[];
    retryTarget?: string | string[];
    returnSceneId?: string | string[];
    contextMode?: string | string[];
    remediationStage?: string | string[];
    triggerConceptErrors?: string | string[];
  }>;
}) {
  const { courseId, activityId } = await params;
  const resolvedSearchParams = await searchParams;
  const sourceStationValue = resolvedSearchParams?.sourceStation;
  const sourceStation = Array.isArray(sourceStationValue)
    ? sourceStationValue[0]
    : sourceStationValue;
  const virtualLab = getMechLabActivity(courseId, activityId);
  if (virtualLab) {
    const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
    if (!token) redirect('/zhiban/login');
    const principal = await getAuthorizedPrincipal(getZhibanPool(), token);
    if (!principal || principal.accountType !== 'student') redirect('/zhiban');
    const pool = getZhibanPool();
    const course = await requireMechatronicsStudentEnrollment(pool, principal, courseId);
    if (courseId !== course.id)
      redirect(`/zhiban/student/courses/${course.id}/activities/${activityId}`);
    const hasEmbeddedContext = Boolean(
      sourceStation ||
        resolvedSearchParams?.classroomBindingId ||
        resolvedSearchParams?.classroomSceneSessionId ||
        resolvedSearchParams?.remediationRunId,
    );
    if (!hasEmbeddedContext)
      redirect(
        `/zhiban/student/courses/${course.id}/learning-center/station-06-virtual-lab`,
      );
    const boundVirtualLab = getMechLabActivity(course.id, activityId);
    if (!boundVirtualLab) notFound();
    if (requiresLearningCenterStationGuard(sourceStation)) {
      const access = await canPrincipalAccessLearningStation(
        pool,
        principal,
        course.id,
        'station-06-virtual-lab',
      );
      if (!access.decision.allowed)
        return (
          <LearningStationLocked
            courseId={course.id}
            stationId="station-06-virtual-lab"
            prerequisiteStationId={access.decision.prerequisiteStationId}
            reason={access.decision.reason}
          />
        );
    }
    const single = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
    const bindingId = single(resolvedSearchParams?.classroomBindingId);
    const sceneSessionId = single(resolvedSearchParams?.classroomSceneSessionId);
    const classroomSceneId = single(resolvedSearchParams?.sceneId);
    return (
      <VirtualLabRunner
        context={boundVirtualLab}
        classroomContext={bindingId && sceneSessionId && classroomSceneId ? {
          bindingId,
          sceneSessionId,
          sceneId: classroomSceneId,
        } : undefined}
        remediationContext={single(resolvedSearchParams?.remediationRunId) ? {
          remediationRunId: single(resolvedSearchParams?.remediationRunId)!,
          sourceSceneId: single(resolvedSearchParams?.sourceSceneId) ?? 'S06-02',
          targetSceneId: single(resolvedSearchParams?.targetSceneId) ?? '',
          retryTarget: single(resolvedSearchParams?.retryTarget) ?? 'mech-lab-line-stop',
          returnSceneId: single(resolvedSearchParams?.returnSceneId) ?? 'S06-02',
          contextMode: single(resolvedSearchParams?.contextMode) ?? 'POST_ASSESSMENT',
          remediationStage: single(resolvedSearchParams?.remediationStage) ?? 'retry',
          triggerConceptErrors: (single(resolvedSearchParams?.triggerConceptErrors) ?? '').split(',').filter(Boolean),
        } : undefined}
      />
    );
  }
  if (!isZhibanOpenMaicActivityEnabled()) notFound();
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), token);
  if (!principal?.permissions.includes('course:read')) redirect('/zhiban');
  const launch = await getOpenMaicActivityLaunch(
    getZhibanPool(),
    principal,
    courseId,
    activityId,
  ).catch(() => null);
  if (!launch) notFound();
  if (launch.rule.maxAttempts > 0 && launch.attemptCount >= launch.rule.maxAttempts)
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-xl font-semibold">已达到最多尝试次数</h1>
        <p className="mt-2 text-slate-600">
          该活动最多允许尝试 {launch.rule.maxAttempts} 次，请联系教师。
        </p>
        <Link
          className="mt-5 inline-block text-blue-600"
          href={`/zhiban/student/courses/${courseId}`}
        >
          返回课程工作区
        </Link>
      </main>
    );
  return (
    <>
      <OpenMaicActivityTracker courseId={courseId} activityId={activityId} />
      <ClassroomAgentBridge courseId={courseId} />
      <OpenMaicClassroomPlayer
        classroomId={launch.documentId}
        postgres
        readOnly
        backHref={`/zhiban/student/courses/${courseId}`}
      />
    </>
  );
}
