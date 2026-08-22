import { NextResponse } from 'next/server';
import { z } from 'zod';
import { readAssignmentFile } from '@/lib/zhiban/coursework';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

export async function GET(_: Request, { params }: { params: Promise<{ fileId: string }> }) {
  try {
    const principal = await requireRequestPrincipal(),
      fileId = z.uuid().parse((await params).fileId);
    const file = await readAssignmentFile(getZhibanPool(), principal, fileId);
    return new NextResponse(new Uint8Array(file.content), {
      headers: {
        'content-type': file.mime_type || 'application/octet-stream',
        'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
      },
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to read assignment file' },
        { status: 400 },
      )
    );
  }
}
