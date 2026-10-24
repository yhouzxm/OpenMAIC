import { expect, it } from 'vitest';
import { v7 } from 'uuid';
import { directoryCursor, directoryQuery } from '@/lib/zhiban/application/directory/service';
import type { AcademicContext } from '@/lib/zhiban/application/academic/service';
const context = { tenantId: v7(), actorMembershipId: v7() } as AcademicContext;
it('has bounded defaults, trims literal search text and normalizes full IDs', () => {
  expect(directoryQuery(context, {})).toEqual({ q: '', state: 'CURRENT', limit: 20, after: null });
  expect(directoryQuery(context, { q: '  学生%_  ' })).toMatchObject({ q: '学生%_' });
  const id = v7();
  expect(directoryQuery(context, { q: id.toUpperCase() }).q).toBe(id);
});
it('resumes a canonical keyset cursor only with its original tenant, admin, search and page size', () => {
  const query = directoryQuery(context, { q: '学生', state: 'ALL', limit: '10' }),
    id = v7(),
    cursor = directoryCursor(context, query, id);
  expect(directoryQuery(context, { q: '学生', state: 'ALL', limit: '10', cursor }).after).toBe(id);
  for (const input of [
    { q: 'other', state: 'ALL', limit: '10', cursor },
    { q: '学生', state: 'CURRENT', limit: '10', cursor },
    { q: '学生', state: 'ALL', limit: '50', cursor },
    { q: '学生', state: 'ALL', limit: '10', cursor: cursor + '=' },
  ])
    expect(() => directoryQuery(context, input)).toThrow('INVALID_INPUT');
  expect(() =>
    directoryQuery(
      { ...context, tenantId: v7() },
      { q: '学生', state: 'ALL', limit: '10', cursor },
    ),
  ).toThrow();
  expect(() =>
    directoryQuery(
      { ...context, actorMembershipId: v7() },
      { q: '学生', state: 'ALL', limit: '10', cursor },
    ),
  ).toThrow();
});
it('rejects unsupported query grammar and unbounded inputs', () => {
  const invalid: Record<string, string>[] = [
    { limit: '0' },
    { limit: '100' },
    { limit: '2e1' },
    { state: 'ACTIVE' },
    { q: 'x'.repeat(121) },
    { q: 'a\nname' },
    { cursor: 'bad' },
    { tenantId: v7() },
  ];
  for (const input of invalid)
    expect(() => directoryQuery(context, input)).toThrow('INVALID_INPUT');
});
