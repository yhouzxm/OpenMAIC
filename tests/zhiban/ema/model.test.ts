import { describe, it, expect } from 'vitest';
import { v7 } from 'uuid';
import { dimensions, emaCommand, parseFindings } from '../../../lib/zhiban/domain/ema/model';
const output = () => ({
  findings: dimensions.map((d) => ({
    dimension: d.id,
    state: 'INSUFFICIENT',
    observation: '现有证据不足以说明本维表现。',
    evidence: [],
  })),
});
describe('six-dimension EMA closed evidence boundary', () => {
  it('keeps all six descriptive dimensions, with insufficient evidence distinct from low ability', () =>
    expect(parseFindings(JSON.stringify(output()), 1)).toHaveLength(6));
  it('refuses scores, missing/duplicate dimensions and uncited claims', () => {
    const score = output();
    Object.assign(score.findings[0], { score: 88 });
    expect(() => parseFindings(JSON.stringify(score), 1)).toThrow();
    const duplicate = output();
    duplicate.findings[1].dimension = duplicate.findings[0].dimension;
    expect(() => parseFindings(JSON.stringify(duplicate), 1)).toThrow();
    const missing = output();
    missing.findings.pop();
    expect(() => parseFindings(JSON.stringify(missing), 1)).toThrow();
    const claim = output();
    claim.findings[0].state = 'LIMITED';
    expect(() => parseFindings(JSON.stringify(claim), 1)).toThrow();
  });
  it('refuses foreign evidence positions and arbitrary model/auth fields', () => {
    const value = output();
    Object.assign(value.findings[0], { state: 'LIMITED', evidence: [2] });
    expect(() => parseFindings(JSON.stringify(value), 1)).toThrow();
    expect(() => emaCommand({ type: 'RUN', id: v7(), revision: '1', model: 'forged' })).toThrow();
    expect(() =>
      emaCommand({
        type: 'QUEUE',
        enrollmentId: v7(),
        purpose: '分析',
        dueAt: null,
        evidence: [{ kind: 'CHAT', id: v7(), digest: 'a'.repeat(64) }],
      }),
    ).toThrow();
  });
});
