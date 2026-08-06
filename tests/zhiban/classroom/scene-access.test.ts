import { describe, expect, it } from 'vitest';
import { evaluateSceneAccess } from '@/lib/zhiban/classroom';
const context = {
  visitedSceneIds: ['scene-1'],
  maxScore: 75,
  now: new Date('2026-08-06T10:00:00Z'),
};
describe('classroom scene access', () => {
  it('supports date, dependency, and score conditions', () => {
    expect(evaluateSceneAccess([], 'scene-1', context).allowed).toBe(true);
    expect(
      evaluateSceneAccess(
        [{ sceneId: 's', name: '', condition: 'date', value: '2026-08-07T00:00:00Z' }],
        's',
        context,
      ).allowed,
    ).toBe(false);
    expect(
      evaluateSceneAccess(
        [{ sceneId: 's', name: '', condition: 'previous_completed', value: 'scene-1' }],
        's',
        context,
      ).allowed,
    ).toBe(true);
    expect(
      evaluateSceneAccess(
        [{ sceneId: 's', name: '', condition: 'score', value: '80' }],
        's',
        context,
      ).allowed,
    ).toBe(false);
  });
});
