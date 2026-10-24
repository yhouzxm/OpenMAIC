import { expect, it } from 'vitest';
import { v7 } from 'uuid';
import { rosterCsv } from '@/lib/zhiban/application/roster/csv';
it('accepts UTF-8 BOM, CRLF and a quoted single-column CSV with physical line numbers', () => {
  const id = v7();
  expect(rosterCsv('\uFEFF"membershipId"\r\n"' + id + '"\r\n')).toEqual([
    { line: 2, membershipId: id, error: null },
  ]);
});
it('reports invalid and duplicate IDs without treating blank records as missing rows', () => {
  const id = v7();
  expect(
    rosterCsv('membershipId\n' + id + '\n' + id + '\n\nnot-an-id\n').map((r) => [r.line, r.error]),
  ).toEqual([
    [2, null],
    [3, 'DUPLICATE'],
    [4, 'INVALID_ID'],
    [5, 'INVALID_ID'],
  ]);
});
it('rejects authority columns, invalid grammar, excessive rows and binary/oversized inputs', () => {
  for (const csv of [
    'membershipId,role\n' + v7() + ',TENANT_ADMIN',
    'password\nsecret',
    'membershipId\n',
    'membershipId\n' + Array.from({ length: 51 }, () => v7()).join('\n'),
    'membershipId\n\u0000',
    'x'.repeat(8193),
  ])
    expect(() => rosterCsv(csv)).toThrow('INVALID_INPUT');
});
