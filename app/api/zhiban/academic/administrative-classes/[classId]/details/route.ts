import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdministrativeClass, updateAdministrativeClass } from '@/lib/zhiban/academic';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
const administrativeClassInputSchema = z.object({
  code: z.string().trim().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  admissionTerm: z.string().trim().min(5).max(8),
  studyCenterCode: z.string().trim().min(1).max(32),
  expectedSize: z.coerce.number().int().nonnegative().optional(),
  studentCategory: z.string().trim().max(100).optional(),
  majorCode: z.string().trim().max(64).optional(),
  majorName: z.string().trim().max(240).optional(),
  trainingPlanNo: z.string().trim().max(64).optional(),
});
export const runtime = 'nodejs';
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ classId: string }> },
) {
  try {
    const p = await requireRequestPermission('class:read'),
      { classId } = await params;
    return NextResponse.json({ record: await getAdministrativeClass(getZhibanPool(), p, classId) });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : '读取失败' },
        { status: 404 },
      )
    );
  }
}
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> },
) {
  try {
    const body = administrativeClassInputSchema.safeParse(await request.json());
    if (!body.success) return NextResponse.json({ error: '行政班信息不完整' }, { status: 400 });
    const p = await requireRequestPermission('class:manage'),
      { classId } = await params;
    return NextResponse.json({
      result: await updateAdministrativeClass(getZhibanPool(), p, classId, body.data),
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : '修改失败' },
        { status: 409 },
      )
    );
  }
}
