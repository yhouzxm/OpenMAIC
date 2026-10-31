import { describe, it, expect } from 'vitest';
import { setup, id, secret } from './fixtures';
import { cookie } from '@/lib/zhiban/infrastructure/identity/http/protocol';

describe('HTTP session compatibility', () => {
  it('logs in, keeps host-only session, requires CSRF, logs out and separates HTTPS cookies', async () => {
    const origin = 'http://127.0.0.1:3488',
      e = setup(origin);
    const req = (
      path: string,
      method = 'GET',
      value?: unknown,
      extra: Record<string, string> = {},
    ) =>
      new Request(origin + '/api/zhiban/identity/' + path, {
        method,
        headers: {
          'x-zhiban-request': 'identity-v1',
          'x-zhiban-client-ip': '127.0.0.1',
          ...(method === 'POST' ? { origin, 'content-type': 'application/json' } : {}),
          ...extra,
        },
        ...(value === undefined ? {} : { body: JSON.stringify(value) }),
      });
    const login = await e.facade.handle(req('login', 'POST', { userId: id, password: secret }));
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie')!;
    expect(setCookie).toMatch(
      /^zhiban_session_http=[A-Za-z0-9_-]{43}; HttpOnly; SameSite=Lax; Path=\//,
    );
    expect(setCookie).not.toContain('Secure');
    const value = setCookie.split(';')[0];
    expect((await e.facade.handle(req('me', 'GET', undefined, { cookie: value }))).status).toBe(
      200,
    );
    const csrf = await (
      await e.facade.handle(req('csrf', 'GET', undefined, { cookie: value }))
    ).json();
    expect(
      (
        await e.facade.handle(
          req(
            'logout',
            'POST',
            {},
            { cookie: value, origin: 'http://attacker.example', 'x-zhiban-csrf': csrf.csrfToken },
          ),
        )
      ).status,
    ).toBe(403);
    expect((await e.facade.handle(req('logout', 'POST', {}, { cookie: value }))).status).toBe(403);
    const logout = await e.facade.handle(
      req('logout', 'POST', {}, { cookie: value, 'x-zhiban-csrf': csrf.csrfToken }),
    );
    expect(logout.status).toBe(204);
    expect(logout.headers.get('set-cookie')).toContain(
      'zhiban_session_http=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
    );
    expect((await e.facade.handle(req('me', 'GET', undefined, { cookie: value }))).status).toBe(
      401,
    );
    expect(cookie(new Request('https://example.com/', { headers: { cookie: value } }))).toBeNull();
    expect(
      cookie(req('me', 'GET', undefined, { cookie: '__Host-zhiban_session=' + 'a'.repeat(43) })),
    ).toBeNull();
  });
});
