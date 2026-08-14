import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { createLocalAccount } from '@/lib/zhiban/auth/service';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  authorizationErrorResponse,
  listManagedAccounts,
  requireRequestPermission,
} from '@/lib/zhiban/rbac';

export const runtime = 'nodejs';

const common = {
  realName: z.string().trim().min(1).max(128),
  password: z.string().min(8).max(128),
  mobile: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().max(32).optional(),
  ),
  initialRoleCode: z.string().trim().min(1).max(64).optional(),
  initialRoleScopeType: z
    .enum(['self', 'project_group', 'class', 'course', 'tenant', 'system'])
    .optional(),
  initialRoleScopeId: z.uuid().optional(),
};

const createSchema = z
  .discriminatedUnion('accountType', [
    z.object({
      ...common,
      accountType: z.literal('student'),
      studentNo: z.string().trim().min(1).max(64),
    }),
    z.object({
      ...common,
      accountType: z.literal('teacher'),
      employeeNo: z.string().trim().min(1).max(64),
    }),
  ])
  .superRefine((value, context) => {
    const needsId = value.initialRoleScopeType
      ? ['project_group', 'class', 'course'].includes(value.initialRoleScopeType)
      : false;
    if (needsId !== Boolean(value.initialRoleScopeId)) {
      context.addIssue({
        code: 'custom',
        message: 'Scope ID must match scope type',
        path: ['initialRoleScopeId'],
      });
    }
  });

export async function GET() {
  try {
    const principal = await requireRequestPermission('account:read');
    return NextResponse.json({ accounts: await listManagedAccounts(getZhibanPool(), principal) });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Unable to load accounts' }, { status: 500 })
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const principal = await requireRequestPermission('account:manage');
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: 'Invalid account data' }, { status: 400 });
    const invalidInitialRole =
      parsed.data.accountType === 'student'
        ? parsed.data.initialRoleCode !== 'student' || parsed.data.initialRoleScopeType !== 'self'
        : Boolean(parsed.data.initialRoleCode || parsed.data.initialRoleScopeType);
    if (invalidInitialRole) {
      return NextResponse.json(
        { error: '新建用户不能直接授予管理员权限，请在权限管理中为教师授权' },
        { status: 400 },
      );
    }
    if (
      parsed.data.initialRoleCode === 'system_admin' &&
      !principal.roles.includes('system_admin')
    ) {
      return NextResponse.json(
        { error: 'Only a system administrator can grant this role' },
        { status: 403 },
      );
    }
    const identifier =
      parsed.data.accountType === 'student' ? parsed.data.studentNo : parsed.data.employeeNo;
    const account = await createLocalAccount(getZhibanPool(), {
      tenantId: principal.tenantId,
      ...parsed.data,
      loginName: identifier,
      displayName: parsed.data.realName,
    });
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    const message = error instanceof Error ? error.message : 'Unable to create account';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
