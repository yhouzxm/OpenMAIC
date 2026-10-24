import { describe, it, expect } from 'vitest';
import { conceptCommand, evidenceDigest } from '../../../lib/zhiban/domain/concept/model';
import { v7 } from 'uuid';
describe('concept correction boundary', () => {
  it('rejects actor/evidence injection, invalid digest and invalid outcome', () => {
    const command = {
      type: 'CREATE_CORRECTION',
      publicationId: v7(),
      questionId: 'q1',
      expectedDigest: 'a'.repeat(64),
      concept: '观察与推断',
      explanation: '教师明确说明',
      guidance: '下一步验证',
      privateNote: '教师依据',
    };
    expect(conceptCommand(command)).toEqual(command);
    expect(() => conceptCommand({ ...command, actorId: v7() })).toThrow();
    expect(() => conceptCommand({ ...command, expectedDigest: 'x' })).toThrow();
    expect(() =>
      conceptCommand({
        type: 'ASSESS',
        id: v7(),
        revision: '1',
        expectedDigest: 'a'.repeat(64),
        responseRevision: '1',
        outcome: 'MASTERED',
        body: '不能伪造掌握',
        privateNote: '依据',
      }),
    ).toThrow();
  });
  it('binds canonical evidence to source changes', () => {
    expect(evidenceDigest({ a: 1, b: 2 })).toBe(evidenceDigest({ b: 2, a: 1 }));
    expect(evidenceDigest({ publicationId: 'a' })).not.toBe(evidenceDigest({ publicationId: 'b' }));
  });
});
