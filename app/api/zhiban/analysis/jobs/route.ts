import { NextResponse } from 'next/server';
import { getOwnAnalysisJobs } from '@/lib/zhiban/analysis';
import { getZhibanPool } from '@/lib/zhiban/db/connection';
import { authorizationErrorResponse, requireRequestPrincipal } from '@/lib/zhiban/rbac';

export async function GET() {
  try {
    const principal = await requireRequestPrincipal();
    return NextResponse.json({ jobs: await getOwnAnalysisJobs(getZhibanPool(), principal) });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json(
        { error: error instanceof Error ? error.message : 'Unable to load analysis jobs' },
        { status: 400 },
      )
    );
  }
}
