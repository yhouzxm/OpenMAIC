import { expect, it, vi } from 'vitest';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { academicSessionAuthentication } from '@/lib/zhiban/infrastructure/academic/session-authentication';

it('serializes same-session touches and issues a fresh result per request', async () => {
  let unlock!: () => void,
    started!: () => void,
    active = 0,
    maximum = 0,
    count = 0;
  const gate = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const first = new Promise<void>((resolve) => {
    started = resolve;
  });
  const authenticate = academicSessionAuthentication(async () => {
    active++;
    maximum = Math.max(maximum, active);
    const value = ++count;
    if (value === 1) {
      started();
      await gate;
    }
    active--;
    return { value };
  });
  const calls = Array.from({ length: 8 }, () => authenticate('same-session'));
  await first;
  expect(count).toBe(1);
  unlock();
  const results = await Promise.all(calls);
  expect(maximum).toBe(1);
  expect(results.map((r) => r.value)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  expect(new Set(results).size).toBe(8);
  expect((await authenticate('same-session')).value).toBe(9);
});

it('does not block unrelated sessions behind the queue', async () => {
  let unlock!: () => void;
  const gate = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  const authenticate = academicSessionAuthentication(async (token) => {
    if (token === 'a') await gate;
    return token;
  });
  const a = authenticate('a');
  expect(await authenticate('b')).toBe('b');
  unlock();
  expect(await a).toBe('a');
});

it('retries only authentic stale-touch errors and caps attempts at three', async () => {
  const delegate = vi
    .fn()
    .mockRejectedValueOnce(new IdentityPortError('STALE_WRITE'))
    .mockRejectedValueOnce(new IdentityPortError('STALE_WRITE'))
    .mockResolvedValue(null);
  expect(await academicSessionAuthentication(delegate)('token')).toBeNull();
  expect(delegate).toHaveBeenCalledTimes(3);
  const stale = vi.fn().mockRejectedValue(new IdentityPortError('STALE_WRITE'));
  await expect(academicSessionAuthentication(stale)('token')).rejects.toThrow('STALE_WRITE');
  expect(stale).toHaveBeenCalledTimes(3);
});

it('does not retry outages or accept a caller error code as retry authority; failed queue releases', async () => {
  const outage = new IdentityPortError('UNAVAILABLE');
  const delegate = vi.fn().mockRejectedValueOnce(outage).mockResolvedValue(null);
  const authenticate = academicSessionAuthentication(delegate);
  await expect(authenticate('token')).rejects.toBe(outage);
  expect(delegate).toHaveBeenCalledTimes(1);
  expect(await authenticate('token')).toBeNull();
  const fake = vi.fn().mockRejectedValue({ code: 'STALE_WRITE' });
  await expect(academicSessionAuthentication(fake)('token')).rejects.toEqual({
    code: 'STALE_WRITE',
  });
  expect(fake).toHaveBeenCalledTimes(1);
});
