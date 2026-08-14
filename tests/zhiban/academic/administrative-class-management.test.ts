import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('administrative class management contract', () => {
  const service = fs.readFileSync(
    path.join(process.cwd(), 'lib/zhiban/academic/service.ts'),
    'utf8',
  );
  const consoleSource = fs.readFileSync(
    path.join(process.cwd(), 'components/zhiban/administrative-class-console.tsx'),
    'utf8',
  );
  it('queries only administrative classes with ten-row pagination', () => {
    expect(service).toContain("c.class_kind='administrative'");
    expect(service).toContain('pageSize = 10');
    expect(consoleSource).toContain('请设置条件后点击查询');
  });
  it('assigns and revokes scoped head teacher roles with audit', () => {
    expect(service).toContain("'head_teacher', 'class'");
    expect(service).toContain('class.head_teacher.assigned');
    expect(service).toContain('class.head_teacher.removed');
    expect(consoleSource).toContain('安排班主任');
    expect(consoleSource).toContain('移除班主任');
    expect(consoleSource).toContain('<Dialog open={assignOpen}');
    expect(consoleSource).toContain('<Dialog open={removeOpen}');
    expect(consoleSource).toContain('placeholder="工号"');
    expect(consoleSource).toContain('placeholder="姓名"');
    expect(consoleSource).toContain('是否本校：');
    expect(consoleSource).toContain('>学习中心</th>');
    expect(consoleSource).toContain('每页 10 条记录，共');
    expect(consoleSource).toContain('跳转');
    expect(consoleSource).toContain('新建行政班');
    expect(consoleSource).toContain('修改行政班');
    expect(consoleSource).toContain('administrative-classes/export');
    expect(consoleSource).toContain("defaultValue={editingClass?.expectedSize ?? ''}");
    expect(consoleSource).toContain("defaultValue={editingClass?.trainingPlanNo || ''}");
    expect(consoleSource).toContain('/${selected[0]}/details');
    expect(service).toContain('expectedSize: row.expected_size ?? row.capacity');
    expect(service).toContain('memberCount: row.member_count');
    expect(consoleSource).toContain('当前学生人数');
    expect(consoleSource).toContain('value={editingClass.memberCount}');
    expect(service).toContain('SET revoked_at=now()');
    expect(service).not.toContain('revoked_by');
    expect(consoleSource).toContain('if (remove) setRemoveOpen(false)');
    expect(consoleSource).toContain('else setAssignOpen(false)');
  });
});
