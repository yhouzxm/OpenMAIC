import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { OpenMaicClassroomPlayer } from '@/app/classroom/[id]/page';
import { ClassroomProgressTracker } from '@/components/zhiban/classroom-progress-tracker';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { listStudentClassrooms } from '@/lib/zhiban/classroom';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';

export default async function StudentClassroomPage({ params }: { params: Promise<{ bindingId: string }> }) {
  const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value; if (!token) redirect('/zhiban/login');
  const principal = await getAuthorizedPrincipal(getZhibanPool(), token); if (!principal?.permissions.includes('course:read')) redirect('/zhiban');
  const { bindingId } = await params; const classroom = (await listStudentClassrooms(getZhibanPool(), principal)).find((item) => item.id === bindingId); if (!classroom) notFound();
  return <><ClassroomProgressTracker bindingId={bindingId} /><OpenMaicClassroomPlayer classroomId={classroom.classroomId} /></>;
}
