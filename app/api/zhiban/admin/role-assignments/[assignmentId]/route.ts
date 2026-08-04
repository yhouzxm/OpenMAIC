import { NextResponse } from 'next/server';

import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  authorizationErrorResponse,
  requireRequestPermission,
  revokeRoleAssignment,
} from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ assignmentId: string }> },
) {
  try {
    const principal = await requireRequestPermission('account:manage');
    const { assignmentId } = await context.params;
    const revoked = await revokeRoleAssignment(getZhibanPool(), principal, assignmentId);
    if (!revoked)
      return NextResponse.json({ error: 'Assignment not found or protected' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Unable to revoke role' }, { status: 500 })
    );
  }
}
