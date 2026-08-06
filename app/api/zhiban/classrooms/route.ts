import { NextResponse } from 'next/server';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { AuthorizationError, authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { listStudentClassrooms } from '@/lib/zhiban/classroom';

export async function GET() {
  try {
    const principal = await requireRequestPrincipal();
    if (!principal.permissions.includes('course:read')) throw new AuthorizationError('Permission denied');
    return NextResponse.json({ classrooms: await listStudentClassrooms(getZhibanPool(), principal) });
  } catch (error) { return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load classrooms' }, { status: 400 }); }
}
