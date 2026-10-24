import { describe, expect, it } from 'vitest';
import { v7 } from 'uuid';
import { learningCommand, writableAttempt } from '@/lib/zhiban/domain/learning/model';
const draft = {
  type: 'CREATE_ACTIVITY',
  title: '活动',
  prompt: '第一行\n第二行',
  deadlineAt: null,
  allowResubmit: false,
  maxAttempts: null,
};
describe('learning product boundary', () => {
  it('accepts explicit optional deadline and attempt limits without inventing defaults', () => {
    expect(learningCommand(draft)).toEqual(draft);
    expect(
      learningCommand({ ...draft, deadlineAt: 2000, allowResubmit: true, maxAttempts: 3 }),
    ).toMatchObject({ deadlineAt: 2000, maxAttempts: 3 });
  });
  it.each([0, -1, 1.5, 1001, '2', NaN])('rejects attempt limit %s', (maxAttempts) => {
    expect(() => learningCommand({ ...draft, maxAttempts })).toThrow('INVALID_INPUT');
  });
  it.each([0, -1, 1.5, '2026-10-09', Infinity])('rejects deadline %s', (deadlineAt) => {
    expect(() => learningCommand({ ...draft, deadlineAt })).toThrow('INVALID_INPUT');
  });
  it('rejects forged authority, unknown types and omitted rules', () => {
    expect(() => learningCommand({ ...draft, enrolled: true })).toThrow();
    expect(() => learningCommand({ type: 'COMPLETE', id: v7() })).toThrow();
    const { maxAttempts, ...partial } = draft;
    void maxAttempts;
    expect(() => learningCommand(partial)).toThrow();
  });
  it('permits an empty multiline draft but requires a nonblank final submission', () => {
    expect(
      learningCommand({ type: 'SAVE_DRAFT', id: v7(), revision: '1', answer: '' }),
    ).toMatchObject({ answer: '' });
    expect(() =>
      learningCommand({ type: 'SUBMIT', id: v7(), revision: '1', answer: ' \n ' }),
    ).toThrow();
  });
  it('rejects oversized and malformed text rather than normalizing it', () => {
    for (const answer of ['x'.repeat(4001), '\ud800', '\u0000'])
      expect(() => learningCommand({ type: 'SUBMIT', id: v7(), revision: '1', answer })).toThrow();
  });
  it('uses exclusive deadline equality and immutable resubmission policy', () => {
    expect(() => writableAttempt('IN_PROGRESS', false, 100, 99)).not.toThrow();
    expect(() => writableAttempt('IN_PROGRESS', false, 100, 100)).toThrow('DEADLINE_PASSED');
    expect(() => writableAttempt('SUBMITTED', false, null, 100)).toThrow('INVALID_STATE');
    expect(() => writableAttempt('SUBMITTED', true, null, 100)).not.toThrow();
  });
});
