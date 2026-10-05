import { it, expect, vi, afterEach } from 'vitest';
import { RetainedAdmission } from '@/lib/zhiban/infrastructure/openmaic/runtime/admission';
import { RuntimeFailure } from '@/lib/zhiban/infrastructure/openmaic/runtime/validation';
afterEach(() => vi.useRealTimers());
it('two ignoring tasks retain permits after caller timeout, third denied, eventual release', async () => {
  vi.useFakeTimers();
  const admission = new RetainedAdmission();
  let done1!: () => void, done2!: () => void;
  const first = admission
      .run(
        () =>
          new Promise<void>((r) => {
            done1 = r;
          }),
      )
      .catch((e) => e),
    second = admission
      .run(
        () =>
          new Promise<void>((r) => {
            done2 = r;
          }),
      )
      .catch((e) => e);
  await vi.advanceTimersByTimeAsync(10001);
  expect(await first).toBeInstanceOf(RuntimeFailure);
  expect(await second).toBeInstanceOf(RuntimeFailure);
  expect(() => admission.run(async () => {})).toThrow(RuntimeFailure);
  done1();
  done2();
  await Promise.resolve();
  await Promise.resolve();
  expect(await admission.run(async () => 7)).toBe(7);
});
it('abort before dispatch consumes no invocation; throws and late rejects release', async () => {
  const a = new RetainedAdmission(),
    before = new AbortController();
  before.abort();
  let calls = 0;
  expect(() =>
    a.run(async () => {
      calls++;
    }, before.signal),
  ).toThrow(RuntimeFailure);
  expect(calls).toBe(0);
  await expect(
    a.run(async () => {
      throw Error('sentinel');
    }),
  ).rejects.toThrow();
  expect(await a.run(async () => 3)).toBe(3);
  const abort = new AbortController();
  let reject!: (value: unknown) => void;
  const late = a
    .run(
      () =>
        new Promise<void>((_, r) => {
          reject = r;
        }),
      abort.signal,
    )
    .catch((e) => e);
  await Promise.resolve();
  abort.abort();
  abort.abort();
  expect(await late).toBeInstanceOf(RuntimeFailure);
  reject(Error('sentinel'));
  await Promise.resolve();
  await Promise.resolve();
  expect(await a.run(async () => 4)).toBe(4);
});
