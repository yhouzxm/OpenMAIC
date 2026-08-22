import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('course structure governance service', () => {
  const service = readFileSync(
    new URL('../../../lib/zhiban/curriculum/service.ts', import.meta.url),
    'utf8',
  );

  it('validates publication references and empty chapters', () => {
    expect(service).toContain('每个章节至少需要一个学习活动');
    expect(service).toContain('必须关联具体内容');
    expect(service).toContain('类型不匹配的关联内容');
  });

  it('protects learning records and detects cyclic dependencies', () => {
    expect(service).toContain('student_activity_progress');
    expect(service).toContain('已有学生学习记录，不能删除');
    expect(service).toContain('WITH RECURSIVE reach');
    expect(service).toContain('活动依赖形成循环');
  });

  it('blocks destructive version restore after learning begins', () => {
    expect(service).toContain('不能直接恢复旧结构');
    expect(service).toContain('复制旧版内容到新草稿后再发布');
    expect(service).toContain('安全回滚自 v');
    expect(service).toContain('rolledBackFrom');
  });
});
