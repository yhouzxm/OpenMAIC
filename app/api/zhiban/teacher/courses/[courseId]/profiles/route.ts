import { NextRequest, NextResponse } from 'next/server';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import { listCourseProfiles, rebuildCourseProfiles } from '@/lib/zhiban/profile';
export async function GET(_r: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const p = await requireRequestPrincipal();
    const { courseId } = await params;
    return NextResponse.json({ profiles: await listCourseProfiles(getZhibanPool(), p, courseId) });
  } catch (e) {
    return (
      authorizationErrorResponse(e) ??
      NextResponse.json(
        { error: e instanceof Error ? e.message : 'Unable to load profiles' },
        { status: 400 },
      )
    );
  }
}
export async function POST(_r: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const p = await requireRequestPrincipal();
    const { courseId } = await params;
    return NextResponse.json(await rebuildCourseProfiles(getZhibanPool(), p, courseId));
  } catch (e) {
    return (
      authorizationErrorResponse(e) ??
      NextResponse.json(
        { error: e instanceof Error ? e.message : 'Unable to rebuild profiles' },
        { status: 400 },
      )
    );
  }
}
