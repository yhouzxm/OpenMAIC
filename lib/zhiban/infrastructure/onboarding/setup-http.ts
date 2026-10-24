import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { OrdinaryCredentials } from './credentials';
import { exact, ticketParts } from '../../domain/onboarding/model';
import { AcademicError, requireAcademic } from '../../domain/academic/model';
import {
  body,
  query,
  headers,
  response,
  failure,
  requestId,
  ProtocolRefusal,
} from '../identity/http/protocol';
const name = '__Host-zhiban_setup';
export function createAccountSetupHttp(service: OrdinaryCredentials, origin: string) {
  const key = randomBytes(32),
    buckets = new Map<string, { start: number; n: number }>();
  let active = 0;
  const proof = (digest: string, nonce: string, revision: string) =>
    createHmac('sha256', key)
      .update(JSON.stringify([origin, digest, nonce, revision]))
      .digest('base64url');
  return async (request: Request, observedPeer: string) => {
    const id = requestId();
    if (active >= 4) return failure(id, 503, 'UNAVAILABLE');
    active++;
    try {
      headers(request, origin, true);
      requireAcademic(request.method === 'POST');
      requireAcademic(new URL(request.url).pathname === '/api/zhiban/onboarding/claim');
      query(request, []);
      const at = Date.now();
      for (const [k, b] of buckets) if (at - b.start >= 60000) buckets.delete(k);
      const bucket = createHmac('sha256', key).update(observedPeer).digest('hex'),
        old = buckets.get(bucket);
      if (!old) {
        requireAcademic(buckets.size < 256, 'UNAVAILABLE');
        buckets.set(bucket, { start: at, n: 1 });
      } else {
        old.n++;
        if (old.n > 40) return failure(id, 429, 'UNAVAILABLE');
      }
      const value = await body(request, 8192, 3000);
      requireAcademic(!!value && typeof value === 'object');
      const v = value as Record<string, unknown>;
      if (v.type === 'INSPECT') {
        exact(v, ['type', 'ticket']);
        const p = ticketParts(v.ticket),
          ctx = await service.inspect(v.ticket as string),
          nonce = randomBytes(32).toString('base64url');
        const r = response(id, 200, { ...ctx, proof: proof(p.digest, nonce, ctx.revision) });
        r.headers.append(
          'set-cookie',
          `${name}=${nonce}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=600`,
        );
        return r;
      }
      exact(v, ['type', 'ticket', 'revision', 'proof', 'password', 'confirmPassword']);
      requireAcademic(
        v.type === 'SET_PASSWORD' &&
          typeof v.password === 'string' &&
          v.password === v.confirmPassword &&
          typeof v.revision === 'string' &&
          typeof v.proof === 'string' &&
          /^[A-Za-z0-9_-]{43}$/.test(v.proof),
      );
      const p = ticketParts(v.ticket),
        matches = (request.headers.get('cookie') ?? '')
          .split(';')
          .map((x) => x.trim())
          .filter((x) => x.startsWith(name + '='));
      requireAcademic(matches.length === 1, 'FORBIDDEN');
      const nonce = matches[0].slice(name.length + 1);
      requireAcademic(/^[A-Za-z0-9_-]{43}$/.test(nonce), 'FORBIDDEN');
      const expected = proof(p.digest, nonce, v.revision);
      requireAcademic(timingSafeEqual(Buffer.from(v.proof), Buffer.from(expected)), 'FORBIDDEN');
      return response(id, 200, await service.set(v.ticket as string, v.revision, v.password));
    } catch (e) {
      if (e instanceof ProtocolRefusal) return failure(id, e.status, 'INVALID_REQUEST');
      if (e instanceof AcademicError)
        return failure(
          id,
          e.code === 'INVALID_INPUT'
            ? 400
            : e.code === 'FORBIDDEN'
              ? 403
              : e.code === 'CONFLICT'
                ? 409
                : 503,
          e.code,
        );
      const code = (e as { code?: string }).code;
      return failure(
        id,
        code === 'CONFLICT' ||
          code === '23505' ||
          code === '40001' ||
          code === 'RETRYABLE_PERSISTENCE_FAILURE'
          ? 409
          : code === '42501'
            ? 403
            : 503,
        code === '42501' ? 'CLAIM_REJECTED' : 'SETUP_UNAVAILABLE',
      );
    } finally {
      active--;
    }
  };
}
