import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  deleteAcademicImportBatch,
  listAdministrativeClassBatches,
  validateAdministrativeClassImport,
} from '@/lib/zhiban/ouc-import';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';
export const runtime = 'nodejs';
export async function GET() {
  try {
    const principal = await requireRequestPermission('account:manage');
    return NextResponse.json({
      batches: await listAdministrativeClassBatches(getZhibanPool(), principal),
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: '无法读取行政班导入批次' }, { status: 500 })
    );
  }
}
export async function DELETE(request: NextRequest) {
  try {
    const principal = await requireRequestPermission('account:manage');
    const batchId = z.uuid().parse(request.nextUrl.searchParams.get('batchId'));
    return NextResponse.json(
      await deleteAcademicImportBatch(getZhibanPool(), principal, batchId, 'administrative_class'),
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
    const principal = await requireRequestPermission('account:manage'),
      form = await request.formData(),
      file = form.get('file');
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.xlsx'))
      return NextResponse.json({ error: '请选择 .xlsx 文件' }, { status: 400 });
    if (file.size > 30 * 1024 * 1024)
      return NextResponse.json({ error: '文件不能超过 30MB' }, { status: 413 });
    return NextResponse.json(
      await validateAdministrativeClassImport(getZhibanPool(), principal, {
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
