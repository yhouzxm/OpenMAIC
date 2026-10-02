import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import type { SessionId } from '@/lib/zhiban/application/identity/ports/session-repository';

/** Future HTTP adapter MUST use cookies only, never URL/localStorage or response logging. */
export function sessionCookiePolicy(productionHttps = true) {
  if (typeof productionHttps !== 'boolean') throw new IdentityPortError('INTEGRITY_FAILURE');
  return Object.freeze({ name: productionHttps ? '__Host-zhiban_session' : 'zhiban_session_dev', httpOnly: true as const, secure: productionHttps, sameSite: 'lax' as const, path: '/' as const });
}
/** Server-only synchronizer contract: exact configured origin AND session-bound CSRF proof.
 * The authenticated SessionId comes from validated server state, NEVER a client User/Tenant claim.
 * Keep instance/key shared for adapter lifetime. No secrets are serialized on the instance.
 */
export class SessionCsrfPolicy {
  #key = randomBytes(32);
  private readonly origin: string;
  constructor(origin: string, productionHttps = true) {
    try {
      if (typeof productionHttps !== 'boolean') throw new Error();
      const url = new URL(origin);
      if (url.origin !== origin || url.username || url.password || productionHttps && url.protocol !== 'https:' || !['http:', 'https:'].includes(url.protocol)) throw new Error();
      this.origin = url.origin;
    } catch { throw new IdentityPortError('INTEGRITY_FAILURE'); }
  }
  token(id: SessionId) {
    if (typeof id !== 'string' || !/^ses_[A-Za-z0-9_-]{43}$(?![\s\S])/.test(id)) throw new IdentityPortError('INTEGRITY_FAILURE');
    return createHmac('sha256', this.#key).update(id, 'utf8').digest('base64url');
  }
  permitsUnsafeRequest(origin: unknown, csrf: unknown, validatedId: SessionId): boolean {
    if (origin !== this.origin || typeof csrf !== 'string' || !/^[A-Za-z0-9_-]{43}$(?![\s\S])/.test(csrf) || typeof validatedId !== 'string' || !/^ses_[A-Za-z0-9_-]{43}$(?![\s\S])/.test(validatedId)) return false;
    return timingSafeEqual(Buffer.from(csrf, 'ascii'), Buffer.from(this.token(validatedId), 'ascii'));
  }
}
