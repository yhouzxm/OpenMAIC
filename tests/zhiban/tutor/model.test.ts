import { describe, it, expect } from 'vitest';
import { digest, tutorCommand } from '../../../lib/zhiban/domain/tutor/model';
const id = '01a16369-cdf8-74e7-81b3-7309da52f77e';
describe('course tutor closed input boundary', () => {
  it('refuses client authority, history, tools and provider overrides', () => {
    const command = { type: 'ASK', mode: 'STUDENT', id, revision: '1', message: '请提示解题思路' };
    for (const extra of [
      { ownerId: id },
      { history: [] },
      { tools: [] },
      { model: 'other' },
      { apiKey: 'secret' },
      { source: { text: 'forged' } },
    ])
      expect(() => tutorCommand({ ...command, ...extra })).toThrow();
    expect(() => tutorCommand({ ...command, message: '\u0000' })).toThrow();
    expect(() =>
      tutorCommand({
        type: 'SET_POLICY',
        mode: 'STUDENT',
        revision: '0',
        enabled: true,
        guidance: '',
      }),
    ).toThrow();
  });
  it('has canonical command digests and bounded human input', () => {
    expect(digest({ a: 1, b: { x: 2, y: 3 } })).toBe(digest({ b: { y: 3, x: 2 }, a: 1 }));
    expect(() =>
      tutorCommand({ type: 'ASK', mode: 'STUDENT', id, revision: '1', message: 'x'.repeat(2001) }),
    ).toThrow();
  });
});

describe('explicit AI companion capability', () => {
  it('keeps legacy command digests and only permits the two immutable session styles', () => {
    const legacy = { type: 'CREATE_SESSION', mode: 'STUDENT', title: '课程讨论', resourceId: null };
    expect(tutorCommand({ ...legacy })).toEqual(legacy);
    expect(tutorCommand({ ...legacy, style: 'PEER' })).toMatchObject({ style: 'PEER' });
    for (const style of ['HUMAN', 'ADMIN', '', null])
      expect(() => tutorCommand({ ...legacy, style })).toThrow();
    expect(() => tutorCommand({ ...legacy, '': 'hidden' })).toThrow();
    expect(() =>
      tutorCommand({
        type: 'ASK',
        mode: 'STUDENT',
        id,
        revision: '1',
        message: 'hello',
        style: 'PEER',
      }),
    ).toThrow();
  });
  it('requires a teacher policy command and an explicit boolean for companion enablement', () => {
    const legacy = {
      type: 'SET_POLICY',
      mode: 'TEACHER',
      revision: '0',
      enabled: true,
      guidance: '',
    };
    expect(tutorCommand({ ...legacy })).toEqual(legacy);
    expect(tutorCommand({ ...legacy, peerEnabled: true })).toMatchObject({ peerEnabled: true });
    expect(() => tutorCommand({ ...legacy, peerEnabled: 'true' })).toThrow();
    expect(() => tutorCommand({ ...legacy, mode: 'STUDENT', peerEnabled: true })).toThrow();
  });
});
