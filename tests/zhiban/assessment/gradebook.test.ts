import { describe, it, expect } from 'vitest';
import {
  gradebookQuery,
  gradebookCursor,
  gradebookExportQuery,
} from '../../../lib/zhiban/application/assessment/gradebook';
import type { AcademicContext } from '../../../lib/zhiban/application/academic/service';
import { localRequestTarget } from '../../../scripts/zhiban-local/request-target';
const tenant = '00000000-0000-7000-8000-000000000001',
  member = '00000000-0000-7000-8000-000000000002',
  offering = '00000000-0000-7000-8000-000000000003',
  id = '00000000-0000-7000-8000-000000000004';
const context = { tenantId: tenant, actorMembershipId: member } as AcademicContext;
describe('bounded gradebook cursor contract', () => {
  it('gateway accepts encoded filters only on the exact export path', () => {
    const path = `/api/zhiban/assessment/${tenant}/offerings/${offering}/gradebook-export.csv`;
    expect(localRequestTarget(path + '?q=%E9%99%88')).toBe(true);
    for (const unsafe of [
      path.replace('gradebook-export', 'other-export'),
      path.replace('/assessment/', '/assessment%2f/'),
      path + '/extra',
    ])
      expect(localRequestTarget(unsafe + '?q=%E9%99%88')).toBe(false);
  });
  it('export uses only a validated filter and fixed server limits, never page cursors', () => {
    expect(gradebookExportQuery({ q: ' 陈 ' })).toEqual({
      q: '陈',
      limit: 500,
      activityLimit: 100,
      after: null,
      activityAfter: null,
      exportAll: true,
    });
    for (const input of [
      { limit: '500' },
      { activityCursor: 'x' },
      { cursor: 'x' },
      { all: 'true' },
      { q: '\ud800' },
    ])
      expect(() => gradebookExportQuery(Object.fromEntries(Object.entries(input)))).toThrow();
  });
  it('binds actor, offering, filters, limits and pagination axis', () => {
    const q = gradebookQuery(context, offering, { q: '陈', limit: '10' }),
      cursor = gradebookCursor(context, offering, q, 'student', id);
    expect(gradebookQuery(context, offering, { q: '陈', limit: '10', cursor }).after).toBe(id);
    for (const input of [
      { q: 'other', limit: '10', cursor },
      { q: '陈', limit: '20', cursor },
      { q: '陈', limit: '10', activityLimit: '10', cursor },
      { q: '陈', limit: '10', activityCursor: cursor },
    ] as Record<string, string>[])
      expect(() => gradebookQuery(context, offering, input)).toThrow();
    expect(() =>
      gradebookQuery({ ...context, actorMembershipId: id }, offering, {
        q: '陈',
        limit: '10',
        cursor,
      }),
    ).toThrow();
    expect(() => gradebookQuery(context, id, { q: '陈', limit: '10', cursor })).toThrow();
  });
  it('rejects unsupported sizes, malformed cursors and unknown query keys', () => {
    for (const input of [
      { limit: '100' },
      { activityLimit: '50' },
      { cursor: 'bad' },
      { state: 'ALL' },
      { q: '\ud800' },
    ] as Record<string, string>[])
      expect(() => gradebookQuery(context, offering, input)).toThrow();
  });
});
