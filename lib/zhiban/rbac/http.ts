import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { ZHIBAN_SESSION_COOKIE } from '@/lib/zhiban/auth/http';
import { getZhibanPool } from '@/lib/zhiban/db/connection';

import { AuthorizationError, requirePermission, requireScopedPermission } from './service';
import type { PermissionCode, ResourceScopeContext } from './types';

export async function requireRequestPermission(permission: PermissionCode) {
  const cookieStore = await cookies();
  return requirePermission(
    getZhibanPool(),
    cookieStore.get(ZHIBAN_SESSION_COOKIE)?.value,
    permission,
  );
}

export async function requireRequestScopedPermission(
  permission: PermissionCode,
  context: ResourceScopeContext,
) {
  const cookieStore = await cookies();
  return requireScopedPermission(
    getZhibanPool(),
    cookieStore.get(ZHIBAN_SESSION_COOKIE)?.value,
    permission,
    context,
  );
}

export function authorizationErrorResponse(error: unknown) {
  if (error instanceof AuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}
