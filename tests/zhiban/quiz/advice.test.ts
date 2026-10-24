import { describe, it, expect } from 'vitest';
import { parseAdvice } from '../../../lib/zhiban/application/quiz/advice-parser';
const input = {
  submissionId: 'fixed',
  gradeRevision: null,
  version: '1',
  answers: { q: '断电' },
  content: {
    type: 'quiz',
    questions: [{ id: 'q', type: 'short_answer', question: '如何检修', points: 2 }],
  },
};
describe('strict AI advice, never fallback credit', () => {
  it('preserves decimal marks and explanation', () => {
    expect(
      parseAdvice('{"items":[{"id":"q","score":1.25,"comment":"缺少验电"}]}', input, 'native')
        .marks,
    ).toEqual({ q: '1.25' });
  });
  it('rejects malformed, missing, duplicate, foreign, string, nonfinite, out-of-range and excess precision scores', () => {
    for (const text of [
      'invalid',
      '{}',
      '{"items":[]}',
      ...[-1, 3, 0.123, '1', null].map((score) =>
        JSON.stringify({ items: [{ id: 'q', score, comment: '评语' }] }),
      ),
      JSON.stringify({ items: [{ id: 'foreign', score: 1, comment: '评语' }] }),
      JSON.stringify({ items: [{ id: 'q', score: 1, comment: '' }] }),
      JSON.stringify({
        items: [
          { id: 'q', score: 1, comment: '评语' },
          { id: 'q', score: 1, comment: '评语' },
        ],
      }),
    ])
      expect(() => parseAdvice(text, input, 'native')).toThrow();
  });
});

import { QuizAdviceService } from '../../../lib/zhiban/application/quiz/advice';
import type {
  AcademicContext,
  AcademicStore,
} from '../../../lib/zhiban/application/academic/service';
import { AcademicError } from '../../../lib/zhiban/domain/academic/model';
it('joined generation rechecks its own session after provider completion', async () => {
  let finish!: (value: { marks: Record<string, string>; feedback: string; model: string }) => void;
  let started!: () => void,
    joined!: () => void,
    revoked = false,
    calls = 0,
    finds = 0;
  const begin = new Promise<void>((r) => (started = r)),
    join = new Promise<void>((r) => (joined = r));
  const provider = new Promise<{ marks: Record<string, string>; feedback: string; model: string }>(
    (r) => (finish = r),
  );
  let receipt: unknown = null;
  const tx = {
    adviceSnapshot: async () => input,
    findAdvice: async () => {
      if (++finds === 2) joined();
      return receipt;
    },
    saveAdvice: async () => {
      receipt = { id: 'receipt' };
      return receipt;
    },
  };
  const store = {
    run: async (
      context: { handle: string },
      _command: unknown,
      work: (actor: unknown, tx: unknown) => Promise<unknown>,
    ) => {
      if (context.handle === 'second' && revoked) throw new AcademicError('FORBIDDEN');
      return work({}, { quiz: tx });
    },
  } as unknown as AcademicStore;
  const service = new QuizAdviceService(store, async () => {
    calls++;
    started();
    return provider;
  });
  const context = (handle: string) =>
    ({ handle, tenantId: 'tenant', actorMembershipId: 'member' }) as unknown as AcademicContext;
  const command = {
    type: 'SUGGEST_QUIZ_GRADE',
    submissionId: '01a1694d-810f-76dd-bb75-e9fae3dd1e71',
  };
  const offering = '01a1694d-95d1-7795-ab7f-467b6a5dff3b';
  const first = service.command(context('first'), offering, command, 'abcdefghijklmnop');
  await begin;
  const second = service.command(context('second'), offering, command, 'abcdefghijklmnop');
  const denial = expect(second).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await join;
  revoked = true;
  finish({ marks: { q: '1' }, feedback: '依据', model: 'unit-test' });
  await first;
  await denial;
  expect(calls).toBe(1);
});
