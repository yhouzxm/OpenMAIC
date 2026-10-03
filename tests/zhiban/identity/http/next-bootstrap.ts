/** Explicit isolated Next subprocess injection; never imported by production modules. */
import { createIdentityHttp } from '@/lib/zhiban/infrastructure/identity/http/adapter';
import {
  newApprovedSession,
  bearerForCookie,
  DEFAULT_SESSION_POLICY,
} from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import { SessionCsrfPolicy } from '@/lib/zhiban/infrastructure/identity/sessions/browser-security';
import { userId, instant } from '@/lib/zhiban/domain/identity';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { refuse } from '@/lib/zhiban/infrastructure/identity/composition/refusals';

const id = userId('01960000-0000-7000-8000-000000000001'),
  origin = 'https://synthetic.example';
const csrf = new SessionCsrfPolicy(origin),
  handles = new WeakMap<object, string>(),
  sessions = new Map<string, string>();
let initializations = 0;
function session(h: object) {
  const raw = handles.get(h),
    id = raw ? sessions.get(raw) : null;
  if (!id) refuse('SESSION_REJECTED');
  return id;
}
const own = () => ({
  userId: id,
  absoluteExpiresAt: Date.now() + 3600000,
  idleExpiresAt: Date.now() + 1800000,
});
const composition = {
  security: {
    login: async () => {
      const issued = newApprovedSession(
        { userId: id, credentialId: id as never, revision: repositoryRevision('1'), epoch: '1' },
        repositoryRevision('1'),
        instant(Date.now()),
        DEFAULT_SESSION_POLICY,
      );
      sessions.set(bearerForCookie(issued.bearer), issued.record.id);
      return { status: 'ISSUED', bearer: issued.bearer, identity: own() };
    },
    authenticate: async (raw: string) => {
      if (!sessions.has(raw)) return null;
      const h = { kind: 'AUTHENTICATED_REQUEST' };
      handles.set(h, raw);
      return h;
    },
  },
  application: {
    me: async (h: object) => {
      session(h);
      return own();
    },
    csrfToken: async (h: object) => csrf.token(session(h) as never),
    assertUnsafe: async (h: object, o: string, p: string) => {
      if (!csrf.permitsUnsafeRequest(o, p, session(h) as never)) refuse('POLICY_DENIED');
    },
    logout: async (h: object) => {
      session(h);
      sessions.delete(handles.get(h)!);
    },
  },
  queries: {},
  members: null,
};
const facade = createIdentityHttp(
  async () => {
    initializations++;
    return composition as never;
  },
  { origin, concurrentRequests: 8, bodyTimeoutMs: 1000, retryAfterSeconds: 30 },
);
const g = globalThis as typeof globalThis & { [key: symbol]: unknown };
g[Symbol.for('zhiban.identity.http.process-facade.v1')] = {
  sealed: true,
  promise: Promise.resolve({
    handle: async (r: Request) => {
      const result = await facade.handle(r);
      result.headers.set('X-Synthetic-Root-Initializations', String(initializations));
      return result;
    },
  }),
};
