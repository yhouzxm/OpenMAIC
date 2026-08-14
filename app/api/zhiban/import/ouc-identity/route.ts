import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  deleteIdentityImportBatch,
  listOucIdentityBatches,
  validateOucIdentityImport,
} from '@/lib/zhiban/ouc-import';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const principal = await requireRequestPermission('account:manage');
    const pool = getZhibanPool();
    const [batches, organizations] = await Promise.all([
      listOucIdentityBatches(pool, principal),
      pool.query(
        `SELECT id,external_id,name,organization_level FROM zhiban.organization_units WHERE status='active' ORDER BY path_external_ids`,
      ),
    ]);
    return NextResponse.json({ batches, organizations: organizations.rows });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: '无法读取导入批次' }, { status: 500 })
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await requireRequestPermission('account:manage');
    const form = await request.formData();
    const mode = String(form.get('mode') ?? 'users');
    const file = form.get('file');
    if (!(file instanceof File))
      return NextResponse.json({ error: '请选择导入文件' }, { status: 400 });
    if (!file.name.toLowerCase().endsWith('.xlsx'))
      return NextResponse.json({ error: '仅支持 .xlsx 文件' }, { status: 400 });
    if (file.size > 30 * 1024 * 1024)
      return NextResponse.json({ error: '文件不能超过 30MB' }, { status: 413 });
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await validateOucIdentityImport(getZhibanPool(), principal, {
      usersName: mode === 'students' ? undefined : file.name,
      users: mode === 'students' ? undefined : buffer,
      studentsName: mode === 'students' ? file.name : undefined,
      students: mode === 'students' ? buffer : undefined,
      defaultOrganizationId: '',
      unmatchedPolicy: mode === 'students' ? 'student' : 'reject',
    });
    return NextResponse.json(result, { status: 201 });
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

export async function DELETE(request: NextRequest) {
  try {
    const principal = await requireRequestPermission('account:manage');
    const batchId = z.uuid().parse(request.nextUrl.searchParams.get('batchId'));
    return NextResponse.json(await deleteIdentityImportBatch(getZhibanPool(), principal, batchId));
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
