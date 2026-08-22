import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import { authorizationErrorResponse, requireRequestScopedPermission } from '@/lib/zhiban/rbac';

export async function GET(request: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const courseId = z.uuid().parse((await params).courseId);
    const bindingId = z.uuid().parse(request.nextUrl.searchParams.get('bindingId'));
    const principal = await requireRequestScopedPermission('course:manage', { courseIds: [courseId] });
    const result = await withZhibanTenant(getZhibanPool(), principal.tenantId, (client) => client.query<{ classroom_id: string; scenes: Array<Record<string, unknown>> }>(
      `SELECT cc.classroom_id,d.scenes FROM zhiban.course_classrooms cc JOIN zhiban.openmaic_classroom_documents d ON d.classroom_id=cc.classroom_id
       WHERE cc.id=$1 AND cc.course_id=$2`, [bindingId, courseId]));
    const scenes = result.rows[0]?.scenes ?? [];
    return NextResponse.json({ scenes: scenes.map((scene, index) => ({ id: String(scene.id), title: String(scene.title ?? scene.name ?? `场景 ${index + 1}`), type: String(scene.type ?? ((scene.content as Record<string, unknown> | undefined)?.type) ?? 'slide'), order: Number(scene.order ?? index + 1) })) });
  } catch (error) {
    return authorizationErrorResponse(error) ?? NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load scenes' }, { status: 400 });
  }
}
