import { NextResponse } from 'next/server';
import { createOucImportTemplate, type OucTemplateType } from '@/lib/zhiban/ouc-import';
import { authorizationErrorResponse, requireRequestPermission } from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';
const names: Record<OucTemplateType, string> = {
  users: '用户数据导入模板.xlsx',
  students: '学生数据导入模板.xlsx',
  registrations: '课程注册数据导入模板.xlsx',
};
export async function GET(_: Request, { params }: { params: Promise<{ type: string }> }) {
  try {
    await requireRequestPermission('account:manage');
    const type = (await params).type as OucTemplateType;
    if (!(type in names)) return NextResponse.json({ error: '未知模板类型' }, { status: 404 });
    return new NextResponse(new Uint8Array(createOucImportTemplate(type)), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(names[type])}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: '模板生成失败' }, { status: 500 })
    );
  }
}
