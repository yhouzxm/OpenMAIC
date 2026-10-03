import { describe, expect, it } from 'vitest';
import { setup, origin, id, secret } from './fixtures';
import { listen, requestHeaders } from './node-harness';

describe('D8 actual Node HTTP requests through production adapter', () => {
  it.each(['replacement', 'empty', 'omitted'] as const)(
    'fixture proxy header %s reaches the intended real HTTP path',
    async (mode) => {
      const e = setup(),
        server = await listen(e.facade);
      const defaults = {
        'X-Zhiban-Request': 'identity-v1',
        'X-Zhiban-Client-IP': '127.0.0.1',
        Origin: origin,
        'Content-Type': 'application/json',
      };
      const headers = requestHeaders(
        defaults,
        { 'x-zhiban-client-ip': mode === 'replacement' ? '127.0.0.2' : '' },
        mode === 'omitted' ? ['X-ZHIBAN-CLIENT-IP'] : [],
      );
      expect(headers.get('X-Zhiban-Client-IP')).toBe(
        mode === 'omitted' ? null : mode === 'empty' ? '' : '127.0.0.2',
      );
      expect(defaults['X-Zhiban-Client-IP']).toBe('127.0.0.1');
      try {
        const response = await fetch(server.base + 'login', {
          method: 'POST',
          headers,
          body: JSON.stringify({ userId: id, password: secret }),
        });
        expect(response.status).toBe(mode === 'replacement' ? 200 : 503);
        expect(e.security.authenticate).not.toHaveBeenCalled();
        if (mode === 'replacement') expect(e.security.login).toHaveBeenCalledTimes(1);
        else {
          expect(e.security.login).not.toHaveBeenCalled();
          expect(response.headers.has('set-cookie')).toBe(false);
          expect((await response.json()).error.code).toBe('SERVICE_UNAVAILABLE');
        }
      } finally {
        await server.close();
      }
    },
  );
  it('actual combined proxy header remains rejected before authentication', async () => {
    const e = setup(),
      server = await listen(e.facade);
    const headers = requestHeaders({
      'X-Zhiban-Request': 'identity-v1',
      'X-Zhiban-Client-IP': '127.0.0.1',
      Origin: origin,
      'Content-Type': 'application/json',
    });
    headers.append('x-zhiban-client-ip', '127.0.0.2');
    try {
      const response = await fetch(server.base + 'login', {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: id, password: secret }),
      });
      expect(response.status).toBe(400);
      expect(e.security.authenticate).not.toHaveBeenCalled();
      expect(e.security.login).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
  it('missing Cookie permits anonymous login; empty Cookie is rejected before authentication', async () => {
    const e = setup(),
      server = await listen(e.facade);
    const headers = {
      'X-Zhiban-Request': 'identity-v1',
      'X-Zhiban-Client-IP': '127.0.0.1',
      Origin: origin,
      'Content-Type': 'application/json',
    };
    try {
      const malformed = await fetch(server.base + 'login', {
        method: 'POST',
        headers: { ...headers, Cookie: '' },
        body: JSON.stringify({ userId: id, password: secret }),
      });
      expect(malformed.status).toBe(400);
      expect(malformed.headers.has('set-cookie')).toBe(false);
      expect(e.security.authenticate).not.toHaveBeenCalled();
      expect(e.security.login).not.toHaveBeenCalled();
      const anonymous = await fetch(server.base + 'login', {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId: id, password: secret }),
      });
      expect(anonymous.status).toBe(200);
      expect(anonymous.headers.has('set-cookie')).toBe(true);
      expect(e.security.login).toHaveBeenCalledTimes(1);
      expect(e.security.authenticate).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });
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
