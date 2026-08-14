import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  AuthorizationError,
  authorizationErrorResponse,
  getAuthorizedPrincipal,
} from '@/lib/zhiban/rbac';
import { listTeacherCourses } from '@/lib/zhiban/teacher-courses';
export const runtime = 'nodejs';
export async function GET() {
  try {
    const store = await cookies();
    const principal = await getAuthorizedPrincipal(
      getZhibanPool(),
      store.get(ZHIBAN_SESSION_COOKIE)?.value ?? '',
    );
    if (!principal) throw new AuthorizationError('Authentication required', 401);
    if (principal.accountType !== 'teacher') throw new AuthorizationError('Permission denied');
    return NextResponse.json({ courses: await listTeacherCourses(getZhibanPool(), principal) });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Unable to load courses' }, { status: 500 })
    );
  }
}
