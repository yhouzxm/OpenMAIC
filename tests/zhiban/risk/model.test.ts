import { expect, it } from 'vitest';
import { v7 } from 'uuid';
import { riskCommand, observation, type Observation } from '@/lib/zhiban/domain/risk/model';
import { localCoursePageAsset, localRequestTarget } from '@/scripts/zhiban-local/request-target';
it('bounds opt-in thresholds and rejects actor/state/evidence injection', () => {
  const c = {
    type: 'SAVE_RULE',
    ruleCode: 'LOW_SCORE',
    revision: '0',
    enabled: true,
    threshold: 60,
  };
  expect(riskCommand(c)).toEqual(c);
  for (const threshold of [0, 101, 1.2, '60'])
    expect(() => riskCommand({ ...c, threshold })).toThrow('INVALID_INPUT');
  expect(riskCommand({ ...c, ruleCode: 'OVERDUE', threshold: 0 })).toMatchObject({ threshold: 0 });
  for (const extra of [{ actorId: v7() }, { evidence: {} }, { state: 'RESOLVED' }])
    expect(() => riskCommand({ ...c, ...extra })).toThrow('INVALID_INPUT');
});
it('uses exact formal ratios and stable evidence digests, not duration or display names', () => {
  const input: Omit<Observation, 'matched' | 'digest'> = {
    ruleCode: 'LOW_SCORE',
    ruleRevision: '1',
    threshold: 60,
    currentRuleRevision: '1',
    currentRuleEnabled: true,
    enrollmentId: v7(),
    membershipId: v7(),
    displayName: '同学',
    anchorId: v7(),
    anchorVersion: 1,
    sourceKey: 'g:' + v7(),
    title: '活动',
    caseId: null,
    eligible: true,
    facts: { publicationId: v7(), scorePoints: 6000, maxPoints: 10000 },
  };
  expect(observation(input, 100).matched).toBe(false);
  const low = { ...input, facts: { ...input.facts, scorePoints: 5999 } };
  expect(observation(low, 100).matched).toBe(true);
  expect(observation({ ...low, displayName: '新名字' }, 999).digest).toBe(
    observation(low, 100).digest,
  );
  expect(observation({ ...low, eligible: false }, 100).matched).toBe(false);
  const overdue = {
    ...input,
    ruleCode: 'OVERDUE' as const,
    threshold: 1,
    facts: { deadlineAt: 1000, submissionId: null },
  };
  expect(observation(overdue, 3600999).matched).toBe(false);
  expect(observation(overdue, 3601000).matched).toBe(true);
  expect(
    observation({ ...overdue, facts: { ...overdue.facts, submissionId: v7() } }, 3601000).matched,
  ).toBe(false);
});
it('routes the teacher surface only and exact encoded API filters', () => {
  expect(localCoursePageAsset(`/zhiban/teacher/courses/${v7()}/risk`)).toBe('/zhiban/risk');
  expect(localCoursePageAsset(`/zhiban/student/courses/${v7()}/risk`)).toBe(null);
  const base = `/api/zhiban/risk/${v7()}/offerings/${v7()}`;
  expect(localRequestTarget(base + '?q=' + encodeURIComponent('待核查'))).toBe(true);
  expect(localRequestTarget(base + '/%2e%2e')).toBe(false);
});
