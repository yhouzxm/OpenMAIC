import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { OpenMaicClassroomPlayer } from '@/components/openmaic-classroom-player';
import { ClassroomAgentBridge } from '@/components/zhiban/classroom-agent-bridge';
import { OpenMaicActivityTracker } from '@/components/zhiban/openmaic-activity-tracker';
import { isZhibanOpenMaicActivityEnabled } from '@/lib/config/feature-flags';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getOpenMaicActivityLaunch } from '@/lib/zhiban/openmaic-activity';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';

export default async function OpenMaicSingleActivityPage({ params }: { params: Promise<{ courseId: string; activityId: string }> }) {
  if (!isZhibanOpenMaicActivityEnabled()) notFound();
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value; if (!token) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), token); if (!principal?.permissions.includes('course:read')) redirect('/zhiban');
  const { courseId, activityId } = await params;
  const launch = await getOpenMaicActivityLaunch(getZhibanPool(), principal, courseId, activityId).catch(() => null); if (!launch) notFound();
  if (launch.rule.maxAttempts > 0 && launch.attemptCount >= launch.rule.maxAttempts) return <main className="mx-auto max-w-xl p-8"><h1 className="text-xl font-semibold">已达到最多尝试次数</h1><p className="mt-2 text-slate-600">该活动最多允许尝试 {launch.rule.maxAttempts} 次，请联系教师。</p><Link className="mt-5 inline-block text-blue-600" href={`/zhiban/student/courses/${courseId}`}>返回课程工作区</Link></main>;
  return <><OpenMaicActivityTracker courseId={courseId} activityId={activityId} /><ClassroomAgentBridge courseId={courseId} /><OpenMaicClassroomPlayer classroomId={launch.documentId} postgres readOnly backHref={`/zhiban/student/courses/${courseId}`} /></>;
}
