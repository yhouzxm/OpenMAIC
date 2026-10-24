import { expect, it } from 'vitest';
import { v7 } from 'uuid';
import { caseCommand } from '@/lib/zhiban/domain/followup/model';
import { localRequestTarget } from '@/scripts/zhiban-local/request-target';
it('requires a closed server-anchored command; clients cannot assign actors, state or evidence', () => {
  const create = {
    type: 'CREATE_CASE',
    activityId: v7(),
    version: 1,
    membershipId: v7(),
    body: '  联系并约定复核。  ',
  };
  expect(caseCommand(create).body).toBe('联系并约定复核。');
  for (const extra of [{ actorId: v7() }, { state: 'CLOSED' }, { evidence: { reason: 'GRADED' } }])
    expect(() => caseCommand({ ...create, ...extra })).toThrow('INVALID_INPUT');
  for (const body of ['', 'x'.repeat(2001), 'bad\u0000note'])
    expect(() => caseCommand({ ...create, body })).toThrow('INVALID_INPUT');
  for (const version of [0, -1, 1.5, '1'])
    expect(() => caseCommand({ ...create, version })).toThrow('INVALID_INPUT');
  expect(() => caseCommand({ type: 'CLOSE_CASE', id: v7(), revision: '01', body: '结案' })).toThrow(
    'INVALID_INPUT',
  );
});
it('permits encoded read filters only at exact case/list routes, never encoded path or mutation aliases', () => {
  const base = `/api/zhiban/analytics/${v7()}/offerings/${v7()}/followup-cases`;
  expect(localRequestTarget(base + '?q=' + encodeURIComponent('历史%_记录'))).toBe(true);
  expect(localRequestTarget(base + '/' + v7() + '?cursor=abc')).toBe(true);
  expect(localRequestTarget(base + '/%2e%2e?q=x')).toBe(false);
  expect(localRequestTarget(base + '/commands?q=%E5%AD%A6')).toBe(false);
});
