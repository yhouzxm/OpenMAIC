import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
describe('Peer phase 4 governance', () => {
  const service = readFileSync('lib/zhiban/peer/service.ts', 'utf8');
  const monitor = readFileSync('lib/zhiban/agents/service.ts', 'utf8');
  const route = readFileSync('app/api/zhiban/student/courses/[courseId]/peer/route.ts', 'utf8');
  it('supports explicit session rollover', () => {
    expect(service).toContain('archivePeerSession');
    expect(route).toContain("body.action === 'new_session'");
  });
  it('uses course Peer enablement and cooldown in Monitor routing', () => {
    expect(monitor).toContain('peer_proactive_enabled');
    expect(monitor).toContain('peer_cooldown_minutes');
    expect(monitor).toContain("$4::int*interval '1 minute'");
  });
  it('audits messages and schedules asynchronous analysis', () => {
    expect(service).toContain('peer_message_sent');
    expect(service).toContain('peer_response_delivered');
    expect(route).toContain('enqueueLearningAnalysis');
    expect(route).toContain('processAnalysisJobs');
  });
  it('acknowledges proactive briefs through the existing intervention lifecycle', () => {
    expect(route).toContain("body.action === 'proactive_seen'");
    expect(route).toContain('respondToIntervention');
    expect(route).toContain("outcome: 'deliver'");
  });
});
