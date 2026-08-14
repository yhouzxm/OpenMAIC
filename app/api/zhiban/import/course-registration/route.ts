import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  deleteAcademicImportBatch,
  listCourseRegistrationBatches,
  validateCourseRegistrationImport,
} from '@/lib/zhiban/ouc-import';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
export const runtime = 'nodejs';
export async function GET() {
  try {
    const p = await requireRequestPermission('account:manage');
    return NextResponse.json({ batches: await listCourseRegistrationBatches(getZhibanPool(), p) });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: '无法读取导入批次' }, { status: 500 })
    );
  }
}
export async function DELETE(request: NextRequest) {
  try {
    const principal = await requireRequestPermission('account:manage');
    const batchId = z.uuid().parse(request.nextUrl.searchParams.get('batchId'));
    return NextResponse.json(
      await deleteAcademicImportBatch(getZhibanPool(), principal, batchId, 'course_registration'),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : '删除批次失败' },
        { status: 400 },
      )
    );
  }
}
export async function POST(request: NextRequest) {
  try {
    const p = await requireRequestPermission('account:manage');
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.xlsx'))
      return NextResponse.json({ error: '请选择 .xlsx 文件' }, { status: 400 });
    if (file.size > 30 * 1024 * 1024)
      return NextResponse.json({ error: '文件不能超过 30MB' }, { status: 413 });
    return NextResponse.json(
      await validateCourseRegistrationImport(getZhibanPool(), p, {
        fileName: file.name,
        buffer: Buffer.from(await file.arrayBuffer()),
      }),
      { status: 201 },
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : '预检失败' },
        { status: 400 },
      )
    );
  }
}
