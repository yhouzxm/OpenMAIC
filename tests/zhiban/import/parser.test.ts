import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseImportWorkbook } from '@/lib/zhiban/import/parser';
describe('Zhiban import template', () => {
  it('parses the published seven-sheet template without errors', async () => {
    const buffer = await readFile('public/templates/zhiban-bulk-import-template.xlsx');
    const parsed = await parseImportWorkbook(buffer);
    expect(parsed.summary).toEqual({
      学生: 1,
      教师: 1,
      学期: 1,
      班级: 1,
      课程: 1,
      开课班: 1,
      选课: 1,
    });
    expect(parsed.totalRows).toBe(7);
    expect(parsed.invalidRows).toBe(0);
  });
});
