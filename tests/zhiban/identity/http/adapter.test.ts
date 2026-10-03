import { describe, expect, it, vi } from 'vitest';
import { createIdentityHttp } from '@/lib/zhiban/infrastructure/identity/http/adapter';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import {
  observeOperation,
  refuse,
} from '@/lib/zhiban/infrastructure/identity/composition/refusals';
import { setup, request, login, id, secret, policy, tid, mid } from './fixtures';

describe('D8 route/protocol/private errors/cookies', () => {
  it.each(['reset', 'control', 'signup', 'select-space', 'tenants/x/memberships/y/arbitrary'])(
    'unknown route %s no DB',
    async (p) => {
      const e = setup();
      const r = await e.facade.handle(request(p));
      expect(r.status).toBe(404);
      expect(e.security.authenticate).not.toHaveBeenCalled();
      expect(r.headers.get('Cache-Control')).toBe('no-store');
    },
  );
  it.each(['HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE'])(
    'unsupported method %s never touches',
    async (method) => {
      const e = setup();
      const r = await e.facade.handle(request('me', method));
      expect(r.status).toBe(405);
      expect(r.headers.get('Allow')).toBe('GET');
      expect(e.security.authenticate).not.toHaveBeenCalled();
      expect(r.headers.has('Access-Control-Allow-Origin')).toBe(false);
    },
  );
  it('login bearer only Set-Cookie, whitelisted own identity and security flags', async () => {
    const e = setup(),
      r = await e.facade.handle(request('login', 'POST', { userId: id, password: secret }));
    expect(r.status).toBe(200);
    const c = r.headers.get('set-cookie')!;
    expect(c).toMatch(
      /^__Host-zhiban_session=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=/,
    );
    expect(c).not.toContain('Domain=');
    expect(Object.keys(await r.json()).sort()).toEqual([
      'absoluteExpiresAt',
      'idleExpiresAt',
      'userId',
    ]);
    expect(e.security.login.mock.calls[0]?.length).toBe(4);
    expect(JSON.stringify(e.telemetry.mock.calls).includes(secret)).toBe(false);
    expect(r.headers.has('ETag')).toBe(false);
  });
  it.each(['unknown', 'missing', 'disabled', 'wrong'])(
    'unified bounded rejection %s',
    async (locator) => {
      const e = setup();
      const r = await e.facade.handle(
        request('login', 'POST', { userId: locator, password: secret }),
      );
      expect(r.status).toBe(401);
      expect((await r.json()).error.code).toBe('UNAUTHENTICATED');
      expect(r.headers.has('Set-Cookie')).toBe(false);
    },
  );
  it('storage failure is 503 not anonymous logout success', async () => {
    const e = setup();
    e.security.authenticate.mockRejectedValue(new IdentityPortError('CONFLICT'));
    const r = await e.facade.handle(
      request('logout', 'POST', {}, { Cookie: '__Host-zhiban_session=' + 'a'.repeat(43) }),
    );
    expect(r.status).toBe(503);
    expect(e.application.logout).not.toHaveBeenCalled();
  });
  it('trusted stale logout completes without revocation', async () => {
    const e = setup();
    e.security.authenticate.mockImplementation(async () => refuse('SESSION_REJECTED'));
    const r = await e.facade.handle(
      request('logout', 'POST', {}, { Cookie: '__Host-zhiban_session=' + 'a'.repeat(43) }),
    );
    expect(r.status).toBe(204);
    expect(e.application.logout).not.toHaveBeenCalled();
  });
  it('missing cookie logout clears with exact policy', async () => {
    const e = setup();
    const r = await e.facade.handle(request('logout', 'POST', {}));
    expect(r.status).toBe(204);
    expect(r.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(await r.text()).toBe('');
  });
  it('private registry shared between login/me/csrf/password routes', async () => {
    const e = setup(),
      h = await login(e);
    expect((await e.facade.handle(request('me', 'GET', undefined, h))).status).toBe(200);
    const r = await e.facade.handle(request('password', 'GET', undefined, h));
    expect(await r.json()).toEqual({ credentialRevision: '1' });
    expect(e.load).toHaveBeenCalledTimes(1);
  });
  it.each(['missing', 'wrong'])('unsafe CSRF %s does not invoke mutation', async (p) => {
    const e = setup(),
      h = await login(e);
    const headers = {
      Cookie: h.Cookie,
      ...(p === 'wrong' ? { 'X-Zhiban-CSRF': 'a'.repeat(43) } : {}),
    };
    const r = await e.facade.handle(request('logout-all', 'POST', { password: secret }, headers));
    expect(r.status).toBe(403);
    expect(e.application.logoutAll).not.toHaveBeenCalled();
  });
  it('account switch revokes old before issuing and failure clears', async () => {
    const e = setup(),
      h = await login(e);
    const r = await e.facade.handle(request('login', 'POST', { userId: id, password: 'wrong' }, h));
    expect(r.status).toBe(401);
    expect(e.application.logout.mock.invocationCallOrder[0]).toBeLessThan(
      e.security.login.mock.invocationCallOrder[1],
    );
    expect(e.live.size).toBe(0);
    expect(r.headers.get('Set-Cookie')).toContain('Max-Age=0');
  });
  it('stale cookie login never silently retries anonymous', async () => {
    const e = setup();
    const r = await e.facade.handle(
      request(
        'login',
        'POST',
        { userId: id, password: secret },
        { Cookie: '__Host-zhiban_session=' + 'a'.repeat(43) },
      ),
    );
    expect(r.status).toBe(401);
    expect(e.security.login).not.toHaveBeenCalled();
  });
  it('password commit clears cookie and old identity cannot authenticate', async () => {
    const e = setup(),
      h = await login(e);
    const r = await e.facade.handle(
      request(
        'password',
        'POST',
        {
          password: secret,
          newPassword: 'Synthetic-replacement-password!',
          expectedCredentialRevision: '1',
        },
        h,
      ),
    );
    expect(r.status).toBe(204);
    expect((await e.facade.handle(request('me', 'GET', undefined, h))).status).toBe(401);
  });
  it('stale password is sanitized 409', async () => {
    const e = setup(),
      h = await login(e);
    const r = await e.facade.handle(
      request(
        'password',
        'POST',
        {
          password: secret,
          newPassword: 'Synthetic-replacement-password!',
          expectedCredentialRevision: '2',
        },
        h,
      ),
    );
    expect(r.status).toBe(409);
    expect((await r.json()).error.code).toBe('CONFLICT');
  });
  it.each([false, 1, null, ''])('invalid new password shape %# before hash', async (p) => {
    const e = setup(),
      h = await login(e);
    const r = await e.facade.handle(
      request(
        'password',
        'POST',
        { password: secret, newPassword: p, expectedCredentialRevision: '1' },
        h,
      ),
    );
    expect(r.status).toBe(400);
    expect(e.application.changePassword).not.toHaveBeenCalled();
  });
  it('only canonical proxy address: XFF is never fallback', async () => {
    const e = setup(),
      r = request('me', 'GET', undefined, { 'X-Forwarded-For': '127.0.0.1' });
    r.headers.delete('X-Zhiban-Client-IP');
    expect((await e.facade.handle(r)).status).toBe(503);
    expect(e.security.authenticate).not.toHaveBeenCalled();
  });
  it('hostile cause/custom code cannot fabricate classification or leak', async () => {
    const e = setup();
    const hostile = {
      code: 'ADMISSION_DENIED',
      cause: secret,
      get message() {
        throw Error(secret);
      },
    };
    e.security.login.mockRejectedValue(hostile);
    const r = await e.facade.handle(request('login', 'POST', { userId: id, password: secret }));
    expect(r.status).toBe(503);
    expect((await r.text()).includes(secret)).toBe(false);
  });
  it('request scopes isolated and caught earlier refusal never classifies new error', async () => {
    const a = observeOperation(async () => {
        try {
          refuse('ADMISSION_DENIED');
        } catch {}
        throw new IdentityPortError('UNAVAILABLE');
      }),
      b = observeOperation(async () => refuse('TARGET_HIDDEN'));
    expect(await a).toEqual({ ok: false, refusal: null });
    expect(await b).toEqual({ ok: false, refusal: 'TARGET_HIDDEN' });
  });
  it('finite capacity refuses BEFORE reading secret body, releases permits', async () => {
    const e = setup();
    let finish!: () => void;
    const blocked = new Promise<void>((r) => {
      finish = r;
    });
    e.security.login.mockImplementation(async () => {
      await blocked;
      return { status: 'REJECTED' };
    });
    const facade = createIdentityHttp(
      async () =>
        ({
          security: e.security,
          application: e.application,
          queries: e.queries,
          members: e.members,
        }) as never,
      { ...policy, concurrentRequests: 1 },
    );
    const first = facade.handle(request('login', 'POST', { userId: id, password: secret }));
    await vi.waitFor(() => expect(e.security.login).toHaveBeenCalled());
    const r = request('login', 'POST', { userId: id, password: secret });
    const rejected = await facade.handle(r);
    expect(rejected.status).toBe(429);
    expect(r.bodyUsed).toBe(false);
    finish();
    await first;
    expect(
      (await facade.handle(request('login', 'POST', { userId: id, password: secret }))).status,
    ).toBe(401);
  });
  it('telemetry failure cannot reinterpret committed logout', async () => {
    const e = setup(),
      h = await login(e);
    e.telemetry.mockImplementation(() => {
      throw Error(secret);
    });
    expect((await e.facade.handle(request('logout', 'POST', {}, h))).status).toBe(204);
  });
  it('manager hidden refusal has no locator or version body', async () => {
    const e = setup(),
      h = await login(e);
    const r = await e.facade.handle(
      request(`tenants/${tid}/memberships/${mid}?actorMembershipId=${mid}`, 'GET', undefined, h),
    );
    expect(r.status).toBe(404);
    const text = await r.text();
    expect(text).not.toContain(tid);
    expect(text).not.toContain(mid);
  });
  it('FIRST helper collapsed error conservatively returns503', async () => {
    const e = setup(),
      h = await login(e);
    expect(
      (
        await e.facade.handle(
          request(
            `tenants/${tid}/consent-context?onboardingRef=synthetic.ref`,
            'GET',
            undefined,
            h,
          ),
        )
      ).status,
    ).toBe(503);
  });
});
