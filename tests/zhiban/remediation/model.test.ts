import { expect, it } from 'vitest';
import { v7 } from 'uuid';
import { remediationCommand } from '@/lib/zhiban/domain/remediation/model';
import { localCoursePageAsset, localRequestTarget } from '@/scripts/zhiban-local/request-target';
it('closes the public plan DTO and bounds versioned task anchors', () => {
  const task = { activityId: v7(), version: 1 },
    c = {
      type: 'ASSIGN_PLAN',
      caseId: v7(),
      revision: '1',
      title: ' 计划 ',
      goal: ' 学生可见目标 ',
      dueAt: null,
      tasks: [task],
    };
  expect(remediationCommand(c)).toMatchObject({ title: '计划', goal: '学生可见目标' });
  for (const extra of [
    { membershipId: v7() },
    { actorId: v7() },
    { baseline: { score: 100 } },
    { state: 'CLOSED' },
  ])
    expect(() => remediationCommand({ ...c, ...extra })).toThrow('INVALID_INPUT');
  for (const tasks of [
    [],
    [task, task],
    Array.from({ length: 6 }, () => ({ activityId: v7(), version: 1 })),
    [{ ...task, version: 0 }],
  ])
    expect(() => remediationCommand({ ...c, tasks })).toThrow('INVALID_INPUT');
  expect(() => remediationCommand({ ...c, goal: 'bad\0' })).toThrow('INVALID_INPUT');
  expect(() =>
    remediationCommand({
      type: 'REPORT_TASK',
      id: v7(),
      revision: '1',
      taskId: v7(),
      status: 'COMPLETED',
      body: 'done',
    }),
  ).toThrow('INVALID_INPUT');
  expect(() =>
    remediationCommand({
      type: 'REVIEW_PLAN',
      id: v7(),
      revision: '1',
      outcome: 'ACHIEVED',
      body: '评估',
      score: 100,
    }),
  ).toThrow('INVALID_INPUT');
});
it('routes only scoped course pages and encoded exact API read queries', () => {
  for (const role of ['teacher', 'student'])
    expect(localCoursePageAsset(`/zhiban/${role}/courses/${v7()}/remediation`)).toBe(
      '/zhiban/remediation',
    );
  const url = `/api/zhiban/remediation/${v7()}/offerings/${v7()}`;
  expect(localRequestTarget(url + '?mode=TEACHER&options=1&q=' + encodeURIComponent('观察'))).toBe(
    true,
  );
  expect(localRequestTarget(url + '/%2e%2e')).toBe(false);
});
