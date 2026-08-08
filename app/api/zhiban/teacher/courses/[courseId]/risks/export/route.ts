import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listRiskDashboard, pseudonymizeRiskLearner } from '@/lib/zhiban/risk';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestScopedPermission } from '@/lib/zhiban/rbac';
const csv = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
export async function GET(_: Request, { params }: { params: Promise<{ courseId: string }> }) {
  try {
    const id = z.uuid().parse((await params).courseId);
    const p = await requireRequestScopedPermission('risk:read', { courseIds: [id] });
    const data = await listRiskDashboard(getZhibanPool(), p, id);
    const lines = [
      ['学习者代号', '风险类型', '等级', '分数', '置信度', '状态', '证据来源', '时间']
        .map(csv)
        .join(','),
      ...data.cases.map((r) =>
        [
          pseudonymizeRiskLearner(p.tenantId, String(r.learner_id)),
          r.risk_type,
          r.severity,
          r.score,
          r.confidence,
          r.status,
          JSON.stringify(r.sources),
          r.created_at,
        ]
          .map(csv)
          .join(','),
      ),
    ];
    return new NextResponse('\uFEFF' + lines.join('\r\n'), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="risk-${id}.csv"`,
      },
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to export risks' },
        { status: 400 },
      )
    );
  }
}
