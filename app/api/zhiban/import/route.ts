import { NextRequest, NextResponse } from 'next/server';

import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { listImportJobs, validateImport } from '@/lib/zhiban/import';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const principal = await requireRequestPermission('account:manage');
    return NextResponse.json({ jobs: await listImportJobs(getZhibanPool(), principal) });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Unable to load import jobs' }, { status: 500 })
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await requireRequestPermission('account:manage');
    const form = await request.formData();
    const file = form.get('file');
    const mode = form.get('mode') === 'update' ? 'update' : 'skip';
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.xlsx'))
      return NextResponse.json({ error: '请选择.xlsx文件' }, { status: 400 });
    if (file.size > 10 * 1024 * 1024)
      return NextResponse.json({ error: '文件不能超过10MB' }, { status: 413 });
    const result = await validateImport(
      getZhibanPool(),
      principal,
      file.name,
      Buffer.from(await file.arrayBuffer()),
      mode,
    );
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '预检失败' },
      { status: 400 },
    );
  }
}
