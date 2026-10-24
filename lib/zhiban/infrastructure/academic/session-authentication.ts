import { createHash } from 'node:crypto';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';

/** Queue only Session authentication/touch. Never cache authority or replay business writes.
 * The HTTP facade bounds live requests to eight; queue entries disappear on completion.
 */
export function academicSessionAuthentication<T>(
  authenticate: (token: string) => Promise<T>,
  observe: (code: string) => void = () => {},
) {
  const pending = new Map<string, Promise<void>>();
  return async (token: string): Promise<T> => {
    const key = createHash('sha256').update(token).digest('hex');
    const previous = pending.get(key) ?? Promise.resolve();
    let release!: () => void;
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => slot);
    pending.set(key, tail);
    await previous;
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          return await authenticate(token);
        } catch (error) {
          // Other Identity entrypoints may touch this Session outside our queue.
          if (!(error instanceof IdentityPortError) || error.code !== 'STALE_WRITE' || attempt >= 2)
            throw error;
          observe('SESSION_TOUCH_RETRY');
        }
      }
    } finally {
      release();
      if (pending.get(key) === tail) pending.delete(key);
    }
  };
}
