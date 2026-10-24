import { it, expect } from 'vitest';
import { v7 } from 'uuid';
import { attainmentCommand } from '../../../lib/zhiban/domain/attainment/model';
const rule = {
  type: 'SET_CREDIT_RULE',
  id: v7(),
  revision: '1',
  sourceCourse: v7(),
  targetCourse: v7(),
  title: '校内',
  creditsTenths: 15,
  threshold: 6000,
  enabled: true,
};
it('uses bounded integer credit tenths and hundredth score thresholds', () => {
  expect(attainmentCommand(rule)).toEqual(rule);
  for (const patch of [
    { creditsTenths: 0 },
    { creditsTenths: 301 },
    { creditsTenths: 1.5 },
    { threshold: 10001 },
    { actor: v7() },
    { enabled: 'true' },
  ])
    expect(() => attainmentCommand({ ...rule, ...patch })).toThrow();
});
