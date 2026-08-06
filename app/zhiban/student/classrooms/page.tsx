import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { StudentClassroomConsole } from '@/components/zhiban/student-classroom-console';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { getAuthorizedPrincipal } from '@/lib/zhiban/rbac';
export default async function StudentClassroomsPage() { const token = (await cookies()).get(ZHIBAN_SESSION_COOKIE)?.value; if (!token) redirect('/zhiban/login'); const principal = await getAuthorizedPrincipal(getZhibanPool(), token); if (!principal?.permissions.includes('course:read')) redirect('/zhiban'); return <StudentClassroomConsole />; }
