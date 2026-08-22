import { NextRequest, NextResponse } from 'next/server';
import { createFileResource, replaceResourceFile } from '@/lib/zhiban/content';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestScopedPermission } from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const { courseId } = await context.params;
    const principal = await requireRequestScopedPermission('course:manage', {
      courseIds: [courseId],
    });
    const form = await request.formData(),
      file = form.get('file');
    if (!(file instanceof File) || !file.size)
      return NextResponse.json({ error: '请选择资源文件' }, { status: 400 });
    if (file.size > 15 * 1024 * 1024)
      return NextResponse.json({ error: '资源文件不能超过 15MB' }, { status: 413 });
    const type = String(form.get('resourceType') ?? 'document');
    if (!['document', 'video', 'audio', 'image', 'dataset', 'other'].includes(type))
      return NextResponse.json({ error: '资源类型无效' }, { status: 400 });
    const resourceId = String(form.get('resourceId') ?? '');
    if (resourceId)
      return NextResponse.json(
        await replaceResourceFile(getZhibanPool(), principal, courseId, {
          resourceId,
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          content: Buffer.from(await file.arrayBuffer()),
        }),
      );
    const activityIds = String(form.get('activityIds') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return NextResponse.json(
      await createFileResource(getZhibanPool(), principal, courseId, {
        title: String(form.get('title') ?? file.name).trim() || file.name,
        description: String(form.get('description') ?? ''),
        resourceType: type as 'document',
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        content: Buffer.from(await file.arrayBuffer()),
        activityIds,
        downloadAllowed: form.get('downloadAllowed') !== 'false',
        aiIndexEnabled: form.get('aiIndexEnabled') === 'true',
      }),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to upload resource' },
        { status: 409 },
      )
    );
  }
}
