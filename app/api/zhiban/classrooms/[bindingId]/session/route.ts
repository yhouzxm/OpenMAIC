import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import {
  AuthorizationError,
  authorizationErrorResponse,
  requireRequestPrincipal,
} from '@/lib/zhiban/rbac';
import { recordClassroomEvent, startClassroomSession } from '@/lib/zhiban/classroom';

const eventSchema = z.object({
  eventId: z.uuid(),
  eventType: z.enum([
    'classroom_opened',
    'scene_viewed',
    'slide_action',
    'quiz_answered',
    'quiz_completed',
    'simulation_interacted',
    'pbl_activity',
    'chat_message',
    'resource_opened',
    'classroom_completed',
  ]),
  sceneId: z.string().max(160).optional(),
  progressPercent: z.number().min(0).max(100),
  payload: z.record(z.string(), z.unknown()).default({}),
  occurredAt: z.iso.datetime(),
});
async function student() {
  const principal = await requireRequestPrincipal();
  if (!principal.permissions.includes('course:read'))
    throw new AuthorizationError('Permission denied');
  return principal;
}

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ bindingId: string }> },
) {
  try {
    const principal = await student();
    const { bindingId } = await context.params;
    return NextResponse.json(await startClassroomSession(getZhibanPool(), principal, bindingId));
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to start classroom' },
        { status: 400 },
      )
    );
  }
}
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ bindingId: string }> },
) {
  try {
    const parsed = eventSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: 'Invalid classroom event' }, { status: 400 });
    const principal = await student();
    const { bindingId } = await context.params;
    return NextResponse.json(
      await recordClassroomEvent(getZhibanPool(), principal, bindingId, parsed.data),
    );
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to save classroom progress' },
        { status: 400 },
      )
    );
  }
}
