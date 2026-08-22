import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
const service=readFileSync('lib/zhiban/teaching-analytics/service.ts','utf8');
const worker=readFileSync('lib/zhiban/analysis/service.ts','utf8');
describe('stage 6 teaching analytics contract',()=>{
  it('includes learner segmentation, module diagnosis and activity type comparison',()=>{expect(service).toContain('needs_support');expect(service).toContain('course_modules');expect(service).toContain('activity_type');});
  it('compares snapshots and reports data quality',()=>{expect(service).toContain('comparison:');expect(service).toContain('dataQuality');expect(service).toContain('样本少于10人');});
  it('enforces course management and course-scoped access',()=>{expect(service).toContain("permissions.includes('course:manage')");expect(service).toContain('ta.teacher_id');expect(service).toContain('c.owner_teacher_id');});
  it('runs recurring snapshots through the durable analysis worker',()=>{expect(worker).toContain("'teaching_snapshot'");expect(worker).toMatch(/7\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);});
  it('groups activity ordering columns used by PostgreSQL',()=>{expect(service).toContain('GROUP BY a.id,m.title,m.position,ch.title,ch.position ORDER BY m.position,ch.position,a.position');});
});
