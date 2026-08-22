import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLearnerRiskRequest, getOwnRisks, setRiskPreference } from '@/lib/zhiban/risk';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestGrantedPermission } from '@/lib/zhiban/rbac';
export async function GET() {
  try {
    const p = await requireRequestGrantedPermission('course:read');
    return NextResponse.json(await getOwnRisks(getZhibanPool(), p));
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to load support status' },
        { status: 400 },
      )
    );
  }
}
export async function PATCH(request: NextRequest) {
  try {
    const p = await requireRequestGrantedPermission('course:read');
    const body = z
      .object({
        courseId: z.uuid(),
        enabled: z.boolean(),
        pauseDays: z.number().int().min(0).max(90).optional(),
      })
      .parse(await request.json());
    return NextResponse.json(await setRiskPreference(getZhibanPool(), p, body));
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to update preference' },
        { status: 400 },
      )
    );
  }
}
export async function POST(request: NextRequest) {
  try {
    const p = await requireRequestGrantedPermission('course:read');
    const body = z
      .object({
        courseId: z.uuid(),
        caseId: z.uuid().optional(),
        type: z.enum(['help', 'explanation', 'correction']),
        content: z.string().min(1).max(5000),
      })
      .parse(await request.json());
    return NextResponse.json(await createLearnerRiskRequest(getZhibanPool(), p, body));
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to submit request' },
        { status: 400 },
      )
    );
  }
}
