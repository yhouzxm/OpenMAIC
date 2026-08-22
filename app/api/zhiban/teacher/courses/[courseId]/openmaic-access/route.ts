import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createScopedAccessToken } from '@/lib/server/access-token';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { withZhibanTenant } from '@/lib/zhiban/db/tenant-context';
import { authorizationErrorResponse, requireRequestScopedPermission } from '@/lib/zhiban/rbac';

const bodySchema = z.object({ activityId: z.uuid() });

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const { courseId } = await context.params;
    const { activityId } = bodySchema.parse(await request.json());
    const principal = await requireRequestScopedPermission('course:manage', {
      courseIds: [courseId],
    });
    const exists = await withZhibanTenant(getZhibanPool(), principal.tenantId, async (client) =>
      client.query(
        `SELECT 1 FROM zhiban.course_activities a
         JOIN zhiban.openmaic_activity_documents d ON d.activity_id=a.id
         WHERE a.id=$1 AND a.course_id=$2
           AND a.activity_type IN('openmaic_slide','openmaic_quiz','openmaic_interactive','openmaic_pbl','openmaic_3d')`,
        [activityId, courseId],
      ),
    );
    if (!exists.rows[0])
      return NextResponse.json({ error: '活动不存在或尚未创建内容' }, { status: 404 });

    const response = NextResponse.json({ authorized: true, expiresIn: 7200 });
    const accessCode = process.env.ACCESS_CODE;
    if (accessCode)
      response.cookies.set(
        'zhiban_openmaic_access',
        createScopedAccessToken(accessCode, 'activity-agent'),
        {
          httpOnly: true,
          sameSite: 'lax',
          path: '/',
          maxAge: 60 * 60 * 2,
          secure: process.env.NODE_ENV === 'production',
        },
      );
    return response;
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : '活动生成授权失败' },
        { status: 400 },
      )
    );
  }
}
