import { describe, it, expect } from 'vitest';
import { v7 } from 'uuid';
import {
  recordQuery,
  recordCursor,
  readRecordCursor,
} from '@/lib/zhiban/application/learning/pages';
import type { AcademicContext } from '@/lib/zhiban/application/academic/service';
import { localRequestTarget } from '@/scripts/zhiban-local/request-target';
describe('teacher grading queue filters', () => {
  it('defaults to actionable work with no activity or student narrowing', () => {
    expect(recordQuery('queue', {})).toMatchObject({
      kind: 'queue',
      target: null,
      member: null,
      state: 'TODO',
      limit: 20,
    });
    expect(
      recordQuery('queue', {
        activity: v7(),
        member: v7(),
        q: ' 陈晓 ',
        state: 'DRAFT',
        limit: '50',
      }),
    ).toMatchObject({ q: '陈晓', state: 'DRAFT', limit: 50 });
  });
  it('rejects unbounded, unknown and forged authority inputs', () => {
    for (const input of [
      { limit: '500' },
      { state: 'SUBMITTED' },
      { activity: 'all' },
      { member: 'student' },
      { mode: 'TEACHER' },
      { submission: v7() },
    ] as Record<string, string>[])
      expect(() => recordQuery('queue', input)).toThrow('INVALID_INPUT');
  });
  it('does not accept a cursor from a different queue scope or publication history', () => {
    const c = { tenantId: v7(), actorMembershipId: v7() } as AcademicContext,
      o = v7(),
      q = recordQuery('queue', {}),
      cursor = recordCursor(c, o, q, v7());
    for (const query of [
      { ...q, state: 'ALL' },
      { ...q, target: v7() },
      { ...q, q: '陈晓' },
      { ...q, member: v7() },
      { ...q, kind: 'publications' as const },
    ])
      expect(() => readRecordCursor(c, o, query, cursor)).toThrow('INVALID_INPUT');
  });
  it('only extends encoded queries to the explicit read endpoint', () => {
    expect(
      localRequestTarget(`/api/zhiban/assessment/${v7()}/offerings/${v7()}/queue?q=%E8%AF%BE`),
    ).toBe(true);
    expect(localRequestTarget(`/api/zhiban/assessment/${v7()}/offerings/${v7()}?q=%E8%AF%BE`)).toBe(
      false,
    );
  });
});
