import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAdministrativeClass, deleteAdministrativeClasses } from '@/lib/zhiban/academic';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
export const runtime = 'nodejs';
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
export async function POST(request: NextRequest) {
  try {
    const body = administrativeClassInputSchema.safeParse(await request.json());
    if (!body.success) return NextResponse.json({ error: '行政班信息不完整' }, { status: 400 });
    const p = await requireRequestPermission('class:manage');
    return NextResponse.json(
      { result: await createAdministrativeClass(getZhibanPool(), p, body.data) },
      { status: 201 },
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : '新建失败' },
        { status: 409 },
      )
    );
  }
}
export async function DELETE(request: NextRequest) {
  try {
    const body = z
      .object({ ids: z.array(z.uuid()).min(1).max(100), confirmed: z.literal(true) })
      .safeParse(await request.json());
    if (!body.success) return NextResponse.json({ error: '请选择要删除的行政班' }, { status: 400 });
    const p = await requireRequestPermission('class:manage');
    return NextResponse.json({
      result: await deleteAdministrativeClasses(getZhibanPool(), p, body.data.ids),
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : '删除失败' },
        { status: 409 },
      )
    );
  }
}
