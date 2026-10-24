import { expect, it } from 'vitest';
import { v7 } from 'uuid';
import { localRequestTarget } from '@/scripts/zhiban-local/request-target';
it('allows encoded literal directory search without relaxing legacy path/query restrictions', () => {
  const id = v7();
  expect(
    localRequestTarget('/api/zhiban/directory/' + id + '?q=' + encodeURIComponent('百分%_同学')),
  ).toBe(true);
  for (const raw of [
    '/api/zhiban/directory/' + id + '%2f?q=x',
    '/api/zhiban/directory/../' + id + '?q=x',
    '/api/zhiban/academic/' + id + '?x=%31',
    '/api/zhiban/identity/spaces?limit=%31',
    '//api/zhiban/directory/' + id,
    '/api\\zhiban/directory/' + id,
  ])
    expect(localRequestTarget(raw)).toBe(false);
  expect(localRequestTarget('/api/zhiban/identity/spaces?limit=50')).toBe(true);
});
