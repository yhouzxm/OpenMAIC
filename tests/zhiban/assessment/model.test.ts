import { describe, it, expect } from 'vitest';
import { v7 } from 'uuid';
import { scorePoints, assessmentCommand } from '@/lib/zhiban/domain/assessment/model';
describe('manual assessment boundary', () => {
  it('stores decimal scores as exact hundredths with explicit maximum', () => {
    expect(scorePoints('85.25')).toBe(8525);
    expect(scorePoints('0')).toBe(0);
    expect(scorePoints('0.01', true)).toBe(1);
    expect(scorePoints('1000', true)).toBe(100000);
  });
  it.each(['-1', '01', '1.001', '1e2', '1000.01', 'Infinity', '', 85, null])(
    'rejects invalid decimal %s',
    (value) => {
      expect(() => scorePoints(value)).toThrow('INVALID_INPUT');
    },
  );
  it('rejects zero maximum and score above maximum', () => {
    expect(() => scorePoints('0', true)).toThrow();
    expect(() =>
      assessmentCommand({
        type: 'SAVE_GRADE',
        submissionId: v7(),
        revision: null,
        score: '10.01',
        maxScore: '10',
        feedback: '',
      }),
    ).toThrow();
  });
  it('requires nonblank public reason for correction and rejects forged authority', () => {
    const c = {
      type: 'CORRECT_GRADE',
      submissionId: v7(),
      revision: '1',
      score: '10',
      maxScore: '20',
      feedback: '',
      reason: '依据复核',
    };
    expect(assessmentCommand(c)).toEqual(c);
    expect(() => assessmentCommand({ ...c, reason: ' \n ' })).toThrow();
    expect(() => assessmentCommand({ ...c, teacher: true })).toThrow();
  });
});
