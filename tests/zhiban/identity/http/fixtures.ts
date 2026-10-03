import { vi } from 'vitest';
import { userId, instant } from '@/lib/zhiban/domain/identity';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import {
  newApprovedSession,
  DEFAULT_SESSION_POLICY,
  bearerForCookie,
} from '@/lib/zhiban/infrastructure/identity/sessions/session-material';
import { SessionCsrfPolicy } from '@/lib/zhiban/infrastructure/identity/sessions/browser-security';
import { refuse } from '@/lib/zhiban/infrastructure/identity/composition/refusals';
import {
  createIdentityHttp,
  type HttpComposition,
} from '@/lib/zhiban/infrastructure/identity/http/adapter';

export const origin = 'https://synthetic.example';
export const id = userId('01960000-0000-7000-8000-000000000001');
export const tid = '01960000-0000-7000-8000-000000000002';
export const mid = '01960000-0000-7000-8000-000000000003';
export const secret = 'Synthetic-http-test-only-input!';
export const policy = { origin, concurrentRequests: 8, bodyTimeoutMs: 1000, retryAfterSeconds: 30 };
export function setup() {
  const csrf = new SessionCsrfPolicy(origin),
    handles = new WeakMap<object, string>(),
    live = new Map<string, { session: string; absoluteExpiresAt: number; idleExpiresAt: number }>();
  const me = (h: object) => {
    const raw = handles.get(h),
      s = raw ? live.get(raw) : null;
    if (!s) refuse('SESSION_REJECTED');
    return { userId: id, absoluteExpiresAt: s.absoluteExpiresAt, idleExpiresAt: s.idleExpiresAt };
  };
  const security = {
    authenticate: vi.fn(async (raw: string) => {
      if (!live.has(raw)) return null;
      const h = Object.freeze({ kind: 'AUTHENTICATED_REQUEST' });
      handles.set(h, raw);
      return h;
    }),
    login: vi.fn(async (locator: string, p: string) => {
      if (locator !== id || p !== secret) return { status: 'REJECTED' };
      const now = instant(Date.now()),
        issued = newApprovedSession(
          {
            userId: id,
            credentialId: userId(tid) as never,
            revision: repositoryRevision('1'),
            epoch: '1',
          },
          repositoryRevision('1'),
          now,
          DEFAULT_SESSION_POLICY,
        );
      live.set(bearerForCookie(issued.bearer), {
        session: issued.record.id,
        absoluteExpiresAt: issued.record.absoluteExpiresAt,
        idleExpiresAt: issued.record.idleExpiresAt,
      });
      return {
        status: 'ISSUED',
        bearer: issued.bearer,
        identity: {
          userId: id,
          absoluteExpiresAt: issued.record.absoluteExpiresAt,
          idleExpiresAt: issued.record.idleExpiresAt,
        },
      };
    }),
  };
  const application = {
    me: vi.fn(async (h: object) => me(h)),
    csrfToken: vi.fn(async (h: object) => {
      me(h);
      return csrf.token(live.get(handles.get(h)!)!.session as never);
    }),
    assertUnsafe: vi.fn(async (h: object, o: string, p: string) => {
      me(h);
      if (!csrf.permitsUnsafeRequest(o, p, live.get(handles.get(h)!)!.session as never))
        refuse('POLICY_DENIED');
    }),
    logout: vi.fn(async (h: object) => {
      me(h);
      live.delete(handles.get(h)!);
    }),
    logoutAll: vi.fn(async (h: object, p: string) => {
      me(h);
      if (p !== secret) refuse('REAUTH_REJECTED');
      live.clear();
    }),
    changePassword: vi.fn(
      async (
        h: object,
        p: string,
        _fresh: string,
        _transport: object,
        _request: string,
        expected: string,
      ) => {
        me(h);
        if (p !== secret) refuse('REAUTH_REJECTED');
        if (expected !== '1') refuse('REQUEST_STALE');
        live.clear();
      },
    ),
    spaces: vi.fn(async (h: object) => {
      me(h);
      return [];
    }),
  };
  const queries = {
    passwordState: vi.fn(async (h: object) => {
      me(h);
      return { credentialRevision: '1' };
    }),
    member: vi.fn(async () => refuse('TARGET_HIDDEN')),
    consentContext: vi.fn(async () => {
      throw new Error('Synthetic helper outage.');
    }),
  };
  const members = {
    execute: vi.fn(async () => ({ commandId: id, status: 'APPLIED', effects: [] })),
    invite: vi.fn(async () => ({ commandId: id, status: 'APPLIED', effects: [] })),
    consent: vi.fn(async () => ({ commandId: id, status: 'APPLIED', effects: [] })),
  };
  const root = { security, application, queries, members } as unknown as HttpComposition;
  const load = vi.fn(async () => root),
    telemetry = vi.fn(),
    facade = createIdentityHttp(load, policy, telemetry);
  return { facade, security, application, queries, members, live, load, telemetry };
}
export function request(path: string, method = 'GET', value?: unknown, extras: HeadersInit = {}) {
  const h = new Headers({
    'X-Zhiban-Request': 'identity-v1',
    'X-Zhiban-Client-IP': '127.0.0.1',
    ...Object.fromEntries(new Headers(extras)),
  });
  if (method === 'POST') {
    if (!h.has('Origin')) h.set('Origin', origin);
    if (!h.has('Content-Type')) h.set('Content-Type', 'application/json');
  }
  return new Request(origin + '/api/zhiban/identity/' + path, {
    method,
    headers: h,
    ...(value === undefined
      ? {}
      : { body: typeof value === 'string' ? value : JSON.stringify(value) }),
  });
}
export async function login(e: ReturnType<typeof setup>) {
  const result = await e.facade.handle(request('login', 'POST', { userId: id, password: secret }));
  const cookie = result.headers.get('set-cookie')!.split(';')[0];
  const csrf = await e.facade.handle(request('csrf', 'GET', undefined, { Cookie: cookie }));
  const { csrfToken } = await csrf.json();
  return { Cookie: cookie, 'X-Zhiban-CSRF': csrfToken };
}
