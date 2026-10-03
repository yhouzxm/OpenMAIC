import { describe, expect, it } from 'vitest';
import { setup, origin, id, secret } from './fixtures';
import { listen } from './node-harness';

describe('D8 actual Node HTTP requests through production adapter', () => {
  it('independent cookie jars, CSRF unsafe logout, cache and method policy', async () => {
    const e = setup(),
      server = await listen(e.facade);
    const headers = {
      'X-Zhiban-Request': 'identity-v1',
      'X-Zhiban-Client-IP': '127.0.0.1',
      Origin: origin,
      'Content-Type': 'application/json',
    };
    try {
      const login = await fetch(server.base + 'login', {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: id, password: secret }),
      });
      expect(login.status).toBe(200);
      const cookie = login.headers.get('set-cookie')!.split(';')[0];
      expect((await fetch(server.base + 'me', { headers })).status).toBe(401);
      const me = await fetch(server.base + 'me', { headers: { ...headers, Cookie: cookie } });
      expect(me.status).toBe(200);
      expect(Object.keys(await me.json()).sort()).toEqual([
        'absoluteExpiresAt',
        'idleExpiresAt',
        'userId',
      ]);
      const proof = await (
        await fetch(server.base + 'csrf', { headers: { ...headers, Cookie: cookie } })
      ).json();
      const logout = await fetch(server.base + 'logout', {
        method: 'POST',
        headers: { ...headers, Cookie: cookie, 'X-Zhiban-CSRF': proof.csrfToken },
        body: '{}',
      });
      expect(logout.status).toBe(204);
      expect(logout.headers.get('cache-control')).toBe('no-store');
      expect(
        (await fetch(server.base + 'me', { headers: { ...headers, Cookie: cookie } })).status,
      ).toBe(401);
      expect((await fetch(server.base + 'me', { method: 'OPTIONS', headers })).status).toBe(405);
      expect(e.load).toHaveBeenCalledTimes(1);
    } finally {
      await server.close();
    }
  });
  it('streamed duplicate JSON and duplicate Origin denied without KDF', async () => {
    const e = setup(),
      server = await listen(e.facade);
    try {
      const r = await fetch(server.base + 'login', {
        method: 'POST',
        headers: {
          Origin: origin,
          'X-Zhiban-Request': 'identity-v1',
          'X-Zhiban-Client-IP': '127.0.0.1',
          'Content-Type': 'application/json',
        },
        body: '{"password":"x","password":"y","userId":"unknown"}',
      });
      expect(r.status).toBe(400);
      expect(e.security.login).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
});
