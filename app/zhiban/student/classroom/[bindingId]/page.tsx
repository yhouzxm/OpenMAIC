import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { OpenMaicClassroomPlayer } from '@/components/openmaic-classroom-player';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { ClassroomProgressTracker } from '@/components/zhiban/classroom-progress-tracker';
import { EmaPrompt } from '@/components/zhiban/ema-prompt';
import { ClassroomAgentBridge } from '@/components/zhiban/classroom-agent-bridge';
import { ClassroomSceneDispatch } from '@/components/zhiban/classroom-scene-dispatch';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { listStudentClassrooms } from '@/lib/zhiban/classroom';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';

export default async function StudentClassroomPage({
  params,
  searchParams,
}: {
  params: Promise<{ bindingId: string }>;
  searchParams: Promise<{ sceneId?: string }>;
}) {
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value;
  if (!token) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), token);
  if (!principal?.permissions.includes('course:read')) redirect('/zhiban');
  const { bindingId } = await params;
  const { sceneId } = await searchParams;
  const classroom = (await listStudentClassrooms(getZhibanPool(), principal)).find(
    (item) => item.id === bindingId,
  );
  if (!classroom) notFound();
  return (
    <>
      <Link
        href="/zhiban/student/classrooms"
        className="fixed left-4 top-4 z-[100] inline-flex items-center rounded-md bg-slate-950/90 px-3 py-2 text-sm font-medium text-white shadow-lg hover:bg-slate-800"
      >
        <ArrowLeft className="mr-2 size-4" />
        返回我的课堂
      </Link>
      <ClassroomProgressTracker bindingId={bindingId} preferredSceneId={sceneId} />
      <EmaPrompt />
      <ClassroomAgentBridge courseId={classroom.courseId} />
      <ClassroomSceneDispatch bindingId={bindingId} courseId={classroom.courseId} />
      <OpenMaicClassroomPlayer classroomId={classroom.classroomId} postgres readOnly initialSceneId={sceneId} />
    </>
  );
}
