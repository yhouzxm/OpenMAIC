import { expect, it } from 'vitest';
import { v7 } from 'uuid';
import { reminderCommand } from '@/lib/zhiban/domain/reminder/model';
import { localCoursePageAsset, localRequestTarget } from '@/scripts/zhiban-local/request-target';
it('accepts only public reminder text and server-anchored case, never recipient/actor/private evidence', () => {
  const c = {
    type: 'SEND_REMINDER',
    caseId: v7(),
    revision: '1',
    title: ' 提醒 ',
    body: ' 学生可见 ',
  };
  expect(reminderCommand(c)).toMatchObject({ title: '提醒', body: '学生可见' });
  for (const extra of [
    { membershipId: v7() },
    { actorId: v7() },
    { evidence: {} },
    { confirmedAt: 123 },
  ])
    expect(() => reminderCommand({ ...c, ...extra })).toThrow('INVALID_INPUT');
  for (const body of ['', 'x'.repeat(2001), 'bad\0'])
    expect(() => reminderCommand({ ...c, body })).toThrow('INVALID_INPUT');
  expect(() => reminderCommand({ type: 'CONFIRM_REMINDER', id: v7(), caseId: c.caseId })).toThrow(
    'INVALID_INPUT',
  );
});
it('maps only the student inbox and exact reminder query route', () => {
  expect(localCoursePageAsset(`/zhiban/student/courses/${v7()}/reminders`)).toBe(
    '/zhiban/reminders',
  );
  expect(localCoursePageAsset(`/zhiban/teacher/courses/${v7()}/reminders`)).toBe(null);
  const base = `/api/zhiban/reminders/${v7()}/offerings/${v7()}`;
  expect(localRequestTarget(base + '?cursor=abc%3D')).toBe(true);
  expect(localRequestTarget(base + '/%2e%2e')).toBe(false);
  expect(localRequestTarget(base + '/commands?case=%20')).toBe(false);
});
