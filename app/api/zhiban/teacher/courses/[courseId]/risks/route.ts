import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  actOnRiskCase,
  batchRiskCases,
  evaluateLearnerRisk,
  handleLearnerRiskRequest,
  listRiskDashboard,
  updateRiskControl,
} from '@/lib/zhiban/risk';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestScopedPermission } from '@/lib/zhiban/rbac';
async function auth(raw: string, permission: 'risk:read' | 'risk:handle') {
  const id = z.uuid().parse(raw);
  return { id, p: await requireRequestScopedPermission(permission, { courseIds: [id] }) };
}
export async function GET(_: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const { id, p } = await auth((await params).courseId, 'risk:read');
    return NextResponse.json(await listRiskDashboard(getZhibanPool(), p, id));
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to load risks' },
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
    const { id, p } = await auth((await params).courseId, 'risk:handle');
    const body = await request.json();
    if (body.action === 'evaluate') {
      const pool = getZhibanPool();
      const learners = await (
        await import('@/lib/zhiban/db/tenant-context')
      ).withZhibanTenant(pool, p.tenantId, (c) =>
        c.query<{ student_id: string }>(
          `SELECT DISTINCT e.student_id FROM zhiban.enrollments e JOIN zhiban.course_offerings o ON o.id=e.offering_id WHERE o.course_id=$1 AND e.status='enrolled'`,
          [id],
        ),
      );
      for (const learner of learners.rows)
        await evaluateLearnerRisk(pool, p.tenantId, {
          learnerId: learner.student_id,
          courseId: id,
          eventId: `manual:${randomUUID()}`,
        });
      return NextResponse.json({ evaluated: learners.rows.length });
    }
    if (body.action === 'control')
      return NextResponse.json(
        await updateRiskControl(
          getZhibanPool(),
          p,
          id,
          z
            .object({
              mode: z.enum(['off', 'shadow', 'active']),
              automatic: z.boolean(),
              emergencyStop: z.boolean(),
            })
            .parse(body),
        ),
      );
    if (body.action === 'batch') {
      const parsed = z
        .object({
          caseIds: z.array(z.uuid()).min(1).max(500),
          batchAction: z.enum(['assign', 'resolve', 'dismiss']),
          note: z.string().min(1).max(5000),
        })
        .parse(body);
      return NextResponse.json(
        await batchRiskCases(getZhibanPool(), p, id, {
          caseIds: parsed.caseIds,
          action: parsed.batchAction,
          note: parsed.note,
        }),
      );
    }
    if (body.action === 'request')
      return NextResponse.json(
        await handleLearnerRiskRequest(
          getZhibanPool(),
          p,
          id,
          z
            .object({
              requestId: z.uuid(),
              status: z.enum(['handled', 'rejected']),
              response: z.string().min(1).max(5000),
            })
            .parse(body),
        ),
      );
    const input = z
      .object({
        caseId: z.uuid(),
        action: z.enum(['acknowledge', 'assign', 'takeover', 'escalate', 'resolve', 'dismiss']),
        note: z.string().max(5000).optional(),
        assignedTo: z.uuid().optional(),
      })
      .parse(body);
    return NextResponse.json(await actOnRiskCase(getZhibanPool(), p, id, input));
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to handle risk' },
        { status: 400 },
      )
    );
  }
}
