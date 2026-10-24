import { expect, it } from 'vitest';
import { v7 } from 'uuid';
import { localRequestTarget } from '@/scripts/zhiban-local/request-target';
import {
  followupQuery,
  followupCursor,
  type FollowupRow,
} from '@/lib/zhiban/application/analytics/followups';
import type { AcademicContext } from '@/lib/zhiban/application/academic/service';
it('allows encoded search on the exact report without weakening path or write-route restrictions', () => {
  const base = `/api/zhiban/analytics/${v7()}/offerings/${v7()}`;
  expect(localRequestTarget(base + '/followups?q=' + encodeURIComponent('学生%_姓名'))).toBe(true);
  for (const suffix of [
    '?q=%E5%AD%A6',
    '/commands?q=%E5%AD%A6',
    '/%66ollowups?q=x',
    '/followups/../followups?q=%E5%AD%A6',
    '/followups?q=%E5%AD%A6//',
  ])
    expect(localRequestTarget(base + suffix)).toBe(false);
});
it('binds keyset continuation to teacher, offering and exact filters; never treats a cursor as authority', () => {
  const context = { tenantId: v7(), actorMembershipId: v7() } as AcademicContext;
  const offering = v7(),
    query = followupQuery(context, offering, { q: '学生' });
  const row = { activityId: v7(), membershipId: v7() } as FollowupRow;
  const cursor = followupCursor(context, offering, query, row);
  expect(followupQuery(context, offering, { q: '学生', cursor }).after).toEqual([
    row.activityId,
    row.membershipId,
  ]);
  const invalid: Record<string, string>[] = [
    { q: '其他', cursor },
    { q: '学生', state: 'OVERDUE', cursor },
    { q: '学生', limit: '50', cursor },
    { q: '学生', cursor: cursor + '=' },
    { member: v7() },
    { state: 'HIGH_RISK' },
    { limit: '100' },
    { q: 'x'.repeat(121) },
  ];
  for (const input of invalid)
    expect(() => followupQuery(context, offering, input)).toThrow('INVALID_INPUT');
  expect(() =>
    followupQuery({ ...context, actorMembershipId: v7() }, offering, { q: '学生', cursor }),
  ).toThrow('INVALID_INPUT');
  expect(() => followupQuery(context, v7(), { q: '学生', cursor })).toThrow('INVALID_INPUT');
});
