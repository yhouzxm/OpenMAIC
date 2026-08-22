import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
describe('Monitor end-to-end coordination contract',()=>{
  const monitor=readFileSync('lib/zhiban/agents/service.ts','utf8');
  const tutor=readFileSync('lib/zhiban/tutor/service.ts','utf8');
  const tutorUi=readFileSync('components/zhiban/student-course-tutor.tsx','utf8');
  const worker=readFileSync('scripts/zhiban-analysis-worker.mts','utf8');
  it('delivers Tutor briefs in the regular course workspace',()=>{expect(tutor).toContain("target_role='tutor'");expect(tutorUi).toContain("['accept','start']");expect(tutorUi).toContain("finishBrief('deliver')");});
  it('creates teacher notifications for escalation',()=>{expect(monitor).toContain("'monitor_escalation'");expect(monitor).toContain('risk_notifications');});
  it('runs delayed follow-up across all active tenants',()=>{expect(monitor).toContain('monitor-followup:');expect(worker).toContain("SELECT id::text FROM zhiban.tenants WHERE status='active'");expect(worker).toContain('processAnalysisJobs');});
});
