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
  loginName: z.string().trim().min(1).max(128),
  displayName: z.string().trim().min(1).max(128),
  realName: z.string().trim().min(1).max(128),
  password: z.string().min(12).max(128),
  mobile: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().max(32).optional(),
  ),
  initialRoleCode: z.string().trim().min(1).max(64),
};

const createSchema = z.discriminatedUnion('accountType', [
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
  z.object({
    ...common,
    accountType: z.literal('admin'),
    adminLevel: z.enum(['teaching', 'institution']).default('institution'),
  }),
]);

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
    if (
      parsed.data.initialRoleCode === 'system_admin' &&
      !principal.roles.includes('system_admin')
    ) {
      return NextResponse.json(
        { error: 'Only a system administrator can grant this role' },
        { status: 403 },
      );
    }
    const account = await createLocalAccount(getZhibanPool(), {
      tenantId: principal.tenantId,
      ...parsed.data,
    });
    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    const response = authorizationErrorResponse(error);
    if (response) return response;
    const message = error instanceof Error ? error.message : 'Unable to create account';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
