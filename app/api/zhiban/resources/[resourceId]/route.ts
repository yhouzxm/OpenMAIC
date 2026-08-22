import { NextRequest, NextResponse } from 'next/server';
import { readCourseResource } from '@/lib/zhiban/content';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ resourceId: string }> },
) {
  try {
    const principal = await requireRequestPrincipal(),
      { resourceId } = await context.params;
    const resource = await readCourseResource(getZhibanPool(), principal, resourceId);
    return new NextResponse(new Uint8Array(resource.content!), {
      headers: {
        'content-type': resource.mime_type || 'application/octet-stream',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(resource.file_name || 'resource')}`,
        'cache-control': 'private, no-store',
      },
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to read resource' },
        { status: 404 },
      )
    );
  }
}
