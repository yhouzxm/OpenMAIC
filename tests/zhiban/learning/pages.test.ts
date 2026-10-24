import { describe, expect, it } from 'vitest';
import { v7 } from 'uuid';
import type { AcademicContext } from '@/lib/zhiban/application/academic/service';
import {
  recordQuery,
  recordCursor,
  readRecordCursor,
} from '@/lib/zhiban/application/learning/pages';
import { localRequestTarget } from '../../../scripts/zhiban-local/request-target';
describe('record page boundary', () => {
  const context = { tenantId: v7(), actorMembershipId: v7() } as AcademicContext,
    offering = v7();
  it('binds cursors to kind, target, offering, actor, filters and size', () => {
    const q = recordQuery('attempts', { activity: v7(), limit: '10' }),
      id = v7(),
      cursor = recordCursor(context, offering, q, id);
    expect(readRecordCursor(context, offering, q, cursor).after).toBe(id);
    for (const [c, o, n] of [
      [context, v7(), q],
      [{ ...context, actorMembershipId: v7() }, offering, q],
      [{ ...context, tenantId: v7() }, offering, q],
      [context, offering, { ...q, target: v7() }],
      [context, offering, { ...q, state: 'SUBMITTED' }],
      [context, offering, { ...q, limit: 20 }],
      [context, offering, { ...q, kind: 'submissions' }],
    ] as const)
      expect(() => readRecordCursor(c, o, n, cursor)).toThrow('INVALID_INPUT');
    expect(() => readRecordCursor(context, offering, q, cursor + '=')).toThrow();
  });
  it.each<Record<string, string>>([
    { limit: '501' },
    { limit: '0' },
    { limit: '2.5' },
    { state: 'DELETED' },
    { q: '\ud800' },
    { member: v7() },
    { isTeacher: 'true' },
  ])('rejects invalid activity input %j', (input) => {
    expect(() => recordQuery('activities', input)).toThrow('INVALID_INPUT');
  });
  it('requires precise targets and refuses extra nested filters', () => {
    for (const kind of ['attempts', 'submissions', 'publications'] as const)
      expect(() => recordQuery(kind, {})).toThrow();
    expect(() => recordQuery('submissions', { attempt: v7(), q: 'x' })).toThrow();
    expect(recordQuery('activities', { q: '  实训  ', limit: '50' })).toMatchObject({
      q: '实训',
      limit: 50,
      after: null,
    });
  });
  it('allows encoded search only on explicit read-page paths', () => {
    expect(
      localRequestTarget(
        `/api/zhiban/learning/${context.tenantId}/offerings/${offering}/activities?q=%E8%AF%BE`,
      ),
    ).toBe(true);
    expect(
      localRequestTarget(
        `/api/zhiban/learning/${context.tenantId}/offerings/${offering}?q=%E8%AF%BE`,
      ),
    ).toBe(false);
    expect(
      localRequestTarget(`/api/zhiban/learning/${context.tenantId}/offerings/%2F/activities?q=x`),
    ).toBe(false);
  });
});
