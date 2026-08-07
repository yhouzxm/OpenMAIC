import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('asynchronous learning analysis contract', () => {
  const worker = readFileSync('lib/zhiban/analysis/service.ts', 'utf8');
  const classroomRoute = readFileSync(
    'app/api/zhiban/classrooms/[bindingId]/session/route.ts',
    'utf8',
  );
  const pblRoute = readFileSync('app/api/zhiban/pbl/learning/[instanceId]/route.ts', 'utf8');
  const scoringRoute = readFileSync(
    'app/api/zhiban/pbl/projects/[projectId]/collaboration/route.ts',
    'utf8',
  );

  it('claims jobs concurrently with retry and stale-lock recovery', () => {
    expect(worker).toContain('FOR UPDATE SKIP LOCKED');
    expect(worker).toContain("locked_at<now()-interval '10 minutes'");
    expect(worker).toContain("terminal ? 'failed' : 'queued'");
  });

  it('enqueues analysis after event persistence instead of awaiting profile calculation', () => {
    for (const route of [classroomRoute, pblRoute, scoringRoute]) {
      expect(route).toContain('enqueueLearningAnalysis');
      expect(route).toContain('after(() => processAnalysisJobs');
      expect(route).not.toContain('await rebuildLearnerProfile');
    }
  });
});
