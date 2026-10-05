import { it, expect } from 'vitest';
import { pendingBinding } from './fakes';
import {
  chatPayload,
  validateBinding,
  validateNativeSession,
} from '@/lib/zhiban/infrastructure/openmaic/runtime/records';
import {
  next,
  opaque,
  allocateRef,
  RuntimeFailure,
  canonicalTime,
} from '@/lib/zhiban/infrastructure/openmaic/runtime/validation';
it.each(['0', '01', '-1', '1.0', '9223372036854775808', ' 1', '1\n'])(
  'revision %s fails closed',
  (value) => expect(() => next(value)).toThrow(RuntimeFailure),
);
it('revision uses exact int8 headroom', () => {
  expect(next('9007199254740993')).toBe('9007199254740994');
  expect(() => next('9223372036854775807')).toThrow(RuntimeFailure);
});
it.each([
  () => ({ role: 'system', content: 'fixture' }),
  () => ({ role: 'user', content: '\ud800' }),
  () => ({ role: 'user', content: '\0' }),
  () => ({ role: 'user', content: 'x'.repeat(8193) }),
  () => ({ role: 'user', content: 'fixture', tool: true }),
  () => ({
    role: 'user',
    get content() {
      throw new Error('sentinel');
    },
  }),
])('closed payload rejects malformed/content/provider configuration', (make) =>
  expect(() => chatPayload(make(), 'user')).toThrow(RuntimeFailure),
);
it('valid Unicode counts UTF-8 bytes', () => {
  expect(chatPayload({ role: 'user', content: '中文' }, 'user').content).toBe('中文');
  expect(() => chatPayload({ role: 'user', content: '中'.repeat(2731) }, 'user')).toThrow(
    RuntimeFailure,
  );
});
it('opaque encoding is canonical and independent', () => {
  const a = allocateRef();
  expect(opaque(a)).toBe(a);
  expect(allocateRef()).not.toBe(a);
  expect(() => opaque('A'.repeat(42) + 'B')).toThrow(RuntimeFailure);
});
it.each(['bindingId', 'tenantId', 'generationId', 'attemptId'] as const)(
  'malformed %s rejects',
  (field) => {
    const b = pendingBinding();
    b[field] = 'bad';
    expect(() => validateBinding(b)).toThrow(RuntimeFailure);
  },
);
it('counter, native time and unexpected field corruption fail closed', () => {
  const b = pendingBinding();
  expect(validateBinding(b)).toBe(b);
  for (const override of [
    { recordCount: 1 },
    { recordBytes: 1 },
    { nativeUpdatedAt: 0 },
    { revision: '0' },
    { token: 'sentinel' },
  ])
    expect(() => validateBinding({ ...b, ...override })).toThrow(RuntimeFailure);
});
it('native envelope requires exact ownership, protocol, kind and timestamps', () => {
  const b = pendingBinding(),
    stage = allocateRef(),
    good = {
      id: b.runtimeRef,
      stageId: stage,
      learnerKey: b.learnerHandle,
      kind: 'chat',
      status: 'active',
      createdAt: new Date(b.createdAt).toISOString(),
      updatedAt: new Date(b.createdAt).toISOString(),
      runtimeDslVersion: '0.1.0',
    };
  validateNativeSession(good, b, stage, 'active', b.createdAt);
  for (const override of [
    { id: allocateRef() },
    { learnerKey: allocateRef() },
    { stageId: allocateRef() },
    { kind: 'quizAttempt' },
    { runtimeDslVersion: '0.11.2' },
    { createdAt: '2026-02-30T00:00:00.000Z' },
    { token: 'sentinel' },
  ])
    expect(() =>
      validateNativeSession({ ...good, ...override }, b, stage, 'active', b.createdAt),
    ).toThrow(RuntimeFailure);
  expect(() => canonicalTime('2026-02-30T00:00:00.000Z')).toThrow(RuntimeFailure);
});
