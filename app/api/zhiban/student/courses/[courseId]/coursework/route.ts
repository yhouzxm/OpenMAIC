import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getStudentCoursework, submitActivityAssignment } from '@/lib/zhiban/coursework';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestGrantedPermission } from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

export async function GET(_: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const courseId = z.uuid().parse((await params).courseId),
      principal = await requireRequestGrantedPermission('course:read');
    return NextResponse.json({
      assignments: await getStudentCoursework(getZhibanPool(), principal, courseId),
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to load coursework' },
        { status: 400 },
      )
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ courseId: string }> },
) {
  try {
    const courseId = z.uuid().parse((await params).courseId),
      principal = await requireRequestGrantedPermission('course:read');
    const form = await request.formData(),
      assignmentId = z.uuid().parse(form.get('assignmentId'));
    const textContent = String(form.get('textContent') ?? '').slice(0, 50000);
    const mode = form.get('mode') === 'draft' ? 'draft' : 'submit';
    const files = form
      .getAll('files')
      .filter((value): value is File => value instanceof File && value.size > 0);
    if (files.length > 20) throw new Error('文件数量超过限制');
    const prepared = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        type: file.type,
        content: Buffer.from(await file.arrayBuffer()),
      })),
    );
    return NextResponse.json(
      await submitActivityAssignment(getZhibanPool(), principal, courseId, {
        assignmentId,
        textContent,
        files: prepared,
        mode,
      }),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to submit assignment' },
        { status: 400 },
      )
    );
  }
}
