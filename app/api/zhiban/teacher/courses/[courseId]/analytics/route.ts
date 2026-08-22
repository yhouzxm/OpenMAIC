import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestGrantedPermission } from '@/lib/zhiban/rbac';
import {
  createAnalysisSnapshot,
  createImprovementAction,
  getTeachingAnalytics,
  updateImprovementAction,
} from '@/lib/zhiban/teaching-analytics';
import { enqueueTeachingSnapshot } from '@/lib/zhiban/analysis';

const action = z.object({
  action: z.enum(['create_action', 'update_action', 'snapshot', 'schedule']),
  id: z.uuid().optional(),
  title: z.string().min(1).max(240).optional(),
  evidence: z.string().max(5000).optional(),
  hypothesis: z.string().max(5000).optional(),
  actionType: z
    .enum(['content', 'activity', 'assessment', 'agent', 'intervention', 'other'])
    .optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  targetMetric: z.string().max(80).optional(),
  targetValue: z.number().optional(),
  baselineValue: z.number().optional(),
  dueAt: z.string().datetime().optional(),
  status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).optional(),
  resultValue: z.number().optional(),
});
export async function GET(_: NextRequest, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const p = await requireRequestGrantedPermission('course:manage'),
      courseId = z.uuid().parse((await params).courseId);
    return NextResponse.json(await getTeachingAnalytics(getZhibanPool(), p, courseId));
  } catch (e) {
    return (
      authorizationErrorResponse(e) ??
      NextResponse.json(
        { error: e instanceof Error ? e.message : 'Unable to load analytics' },
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
    const p = await requireRequestGrantedPermission('course:manage'),
      courseId = z.uuid().parse((await params).courseId),
      body = action.parse(await request.json()),
      pool = getZhibanPool();
    if (body.action === 'snapshot') {
      const snapshot = await createAnalysisSnapshot(pool, p, courseId),
        schedule = await enqueueTeachingSnapshot(
          pool,
          p,
          courseId,
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        );
      return NextResponse.json({ snapshot, schedule });
    }
    if (body.action === 'schedule')
      return NextResponse.json(await enqueueTeachingSnapshot(pool, p, courseId));
    if (body.action === 'update_action')
      return NextResponse.json(
        await updateImprovementAction(pool, p, courseId, body.id!, {
          status: body.status!,
          resultValue: body.resultValue,
        }),
      );
    return NextResponse.json(
      await createImprovementAction(pool, p, courseId, {
        title: body.title!,
        evidence: body.evidence,
        hypothesis: body.hypothesis,
        actionType: body.actionType ?? 'other',
        priority: body.priority ?? 'medium',
        targetMetric: body.targetMetric,
        targetValue: body.targetValue,
        baselineValue: body.baselineValue,
        dueAt: body.dueAt,
      }),
      { status: 201 },
    );
  } catch (e) {
    return (
      authorizationErrorResponse(e) ??
      NextResponse.json(
        { error: e instanceof Error ? e.message : 'Unable to update analytics' },
        { status: 400 },
      )
    );
  }
}
