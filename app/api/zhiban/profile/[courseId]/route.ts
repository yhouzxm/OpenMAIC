import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';
import {
  getLearnerProfileDetail,
  requestOwnProfileCorrection,
  setOwnProfilePreference,
} from '@/lib/zhiban/profile';

export const runtime = 'nodejs';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const principal = await requireRequestPrincipal();
    const { courseId } = await context.params;
    return NextResponse.json(
      await getLearnerProfileDetail(getZhibanPool(), principal, principal.id, courseId),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to load profile evidence' },
        { status: 400 },
      )
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const principal = await requireRequestPrincipal();
    const { courseId } = await context.params;
    const parsed = z
      .object({ collectionEnabled: z.boolean(), retentionDays: z.number().int().min(30).max(3650) })
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: 'Invalid profile preference' }, { status: 400 });
    return NextResponse.json(
      await setOwnProfilePreference(getZhibanPool(), principal, courseId, parsed.data),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to update profile preference' },
        { status: 400 },
      )
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const principal = await requireRequestPrincipal();
    const { courseId } = await context.params;
    const parsed = z
      .object({ reason: z.string().trim().min(5).max(2000) })
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { error: 'Please describe the correction in at least 5 characters' },
        { status: 400 },
      );
    return NextResponse.json(
      await requestOwnProfileCorrection(getZhibanPool(), principal, courseId, parsed.data.reason),
      { status: 201 },
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to request correction' },
        { status: 400 },
      )
    );
  }
}
