import { describe, it, expect } from 'vitest';
import { v7 } from 'uuid';
import { learnerCommand, observationText } from '../../../lib/zhiban/domain/learner/model';
describe('evidence-backed observation boundary', () => {
  const text = {
    title: '复核依据',
    body: '仅对本次可核对记录作观察',
    confidence: 'LIMITED',
    evidence: [{ kind: 'GRADE', id: v7(), digest: 'a'.repeat(64) }],
  };
  it('requires 1–5 unique bound references and explicit teacher certainty', () => {
    expect(observationText(text).confidence).toBe('LIMITED');
    expect(() => observationText({ ...text, evidence: [] })).toThrow();
    expect(() =>
      observationText({ ...text, evidence: [text.evidence[0], text.evidence[0]] }),
    ).toThrow();
    expect(() => observationText({ ...text, confidence: 'MASTERED' })).toThrow();
  });
  it('rejects actor, dimensions and replacement injection', () => {
    const c = { type: 'CREATE_OBSERVATION', enrollmentId: v7(), ...text };
    expect(learnerCommand(c).type).toBe('CREATE_OBSERVATION');
    expect(() => learnerCommand({ ...c, actorId: v7() })).toThrow();
    expect(() => learnerCommand({ ...c, dimensions: [100, 100] })).toThrow();
    expect(() =>
      learnerCommand({
        type: 'RESOLVE_DISPUTE',
        id: v7(),
        revision: '1',
        noteRevision: '2',
        outcome: 'KEEP',
        response: '说明',
        expectedDigest: 'a'.repeat(64),
        replacement: text,
      }),
    ).toThrow();
  });
});
