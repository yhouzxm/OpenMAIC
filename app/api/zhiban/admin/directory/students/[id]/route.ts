import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { updateDirectoryStudent } from '@/lib/zhiban/admin-data';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
export const runtime = 'nodejs';
const schema = z.object({
  realName: z.string().trim().min(1).max(200).optional(),
  studyStatus: z.enum(['active', 'suspended', 'graduated', 'withdrawn']).optional(),
  registryStatusCode: z.string().trim().max(24).optional(),
  studentCategoryName: z.string().trim().max(100).optional(),
  programLevelName: z.string().trim().max(100).optional(),
  majorCode: z.string().trim().max(64).optional(),
  majorName: z.string().trim().max(200).optional(),
  classCode: z.string().trim().max(64).optional(),
  className: z.string().trim().max(200).optional(),
  trainingPlanNo: z.string().trim().max(100).optional(),
});
export async function PATCH(r: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const p = await requireRequestPermission('account:manage'),
      body = schema.parse(await r.json());
    return NextResponse.json(
      await updateDirectoryStudent(getZhibanPool(), p, (await params).id, body),
    );
  } catch (e) {
    return (
      authorizationErrorResponse(e) ??
      NextResponse.json({ error: e instanceof Error ? e.message : '修改失败' }, { status: 400 })
    );
  }
}
