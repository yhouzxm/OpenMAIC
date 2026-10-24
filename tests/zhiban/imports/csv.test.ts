import { describe, it, expect } from 'vitest';
import { importCsv, importKind } from '@/lib/zhiban/application/imports/csv';
const m = '01a14505-1e98-752c-b372-1cc669735ff5';
describe('fixed import formats', () => {
  it('keeps trailing empty columns, physical lines, quoting, BOM and unicode names', () => {
    const rows = importCsv(
      'DIRECTORY',
      `\uFEFFmembershipId,formalName,studentNo,employeeNo\r\n${m},"张,同学",,\r\n`,
    );
    expect(rows[0].command).toMatchObject({
      formalName: '张,同学',
      studentNo: '',
      employeeNo: '',
      revision: null,
    });
    expect(rows[0].line).toBe(2);
    expect(importCsv('COURSES', 'code,name,description\nC01,课程,"a""b"')[0].command).toMatchObject(
      { description: 'a"b' },
    );
  });
  it('blocks duplicate members across classes and rejects widened or malformed shapes', () => {
    expect(importCsv('CLASS_MEMBERS', `classId,membershipId\n${m},${m}\n${m},${m}`)[1].code).toBe(
      'DUPLICATE',
    );
    expect(() => importCsv('CLASSES', 'code,name,role\nA,B,TEACHER')).toThrow();
    expect(importCsv('CLASSES', 'code,name\nA,"unterminated')[0].command).toBeNull();
    expect(() => importKind('USER_CREATE')).toThrow();
    expect(() =>
      importCsv('CLASSES', 'code,name\n' + Array(51).fill('C,Name').join('\n')),
    ).toThrow();
  });
  it('does not coerce capacity, publish courses or accept business numbers as identity', () => {
    expect(
      importCsv('OFFERINGS', `courseId,termId,classId,code,name,capacity\n${m},${m},,O,Name,1e2`)[0]
        .code,
    ).toBe('INVALID_INPUT');
    expect(importCsv('COURSES', 'code,name,description\nC,课程,')[0].command).toMatchObject({
      type: 'CREATE_COURSE',
      ownerMembershipId: null,
    });
    expect(importCsv('ENROLLMENTS', `offeringId,membershipId\n${m},S001`)[0].code).toBe(
      'INVALID_INPUT',
    );
  });
});
