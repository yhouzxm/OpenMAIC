import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { cookieSet, authenticateLocalByIdentifier } = vi.hoisted(() => ({
  cookieSet: vi.fn(),
  authenticateLocalByIdentifier: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: cookieSet })),
}));
vi.mock('@/lib/zhiban/db/connection', () => ({
  getZhibanPool: vi.fn(() => ({})),
}));
vi.mock('@/lib/zhiban/auth/service', () => ({ authenticateLocalByIdentifier }));

import { POST } from '@/app/api/zhiban/auth/login/route';

function loginRequest(body: unknown) {
  return new NextRequest('http://localhost/api/zhiban/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/zhiban/auth/login', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('is unavailable while the server-side auth feature is disabled', async () => {
    vi.stubEnv('ZHIBAN_AUTH_ENABLED', 'false');
    const response = await POST(loginRequest({}));
    expect(response.status).toBe(503);
    expect(authenticateLocalByIdentifier).not.toHaveBeenCalled();
  });

  it('returns one generic response for failed credentials', async () => {
    vi.stubEnv('ZHIBAN_AUTH_ENABLED', 'true');
    authenticateLocalByIdentifier.mockResolvedValue({ ok: false, reason: 'account_locked' });
    const response = await POST(
      loginRequest({
        identifier: '202600000001',
        password: 'wrong',
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Invalid login name or password' });
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('sets an HttpOnly session cookie after successful authentication', async () => {
    vi.stubEnv('ZHIBAN_AUTH_ENABLED', '1');
    const expiresAt = new Date('2026-08-05T00:00:00.000Z');
    authenticateLocalByIdentifier.mockResolvedValue({
      ok: true,
      account: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        loginName: '202600000001',
        displayName: '测试学生',
        accountType: 'student',
        mustChangePassword: true,
      },
      sessionCookie: 'opaque-session-cookie',
      expiresAt,
    });
    const response = await POST(
      loginRequest({
        identifier: '202600000001',
        password: 'AdultLearning2026!',
      }),
    );

    expect(response.status).toBe(200);
    expect(cookieSet).toHaveBeenCalledWith(
      'zhiban_session',
      'opaque-session-cookie',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: '/',
        expires: expiresAt,
      }),
    );
  });

  it('sets a Secure session cookie for HTTPS requests', async () => {
    vi.stubEnv('ZHIBAN_AUTH_ENABLED', 'true');
    const expiresAt = new Date('2026-08-05T00:00:00.000Z');
    authenticateLocalByIdentifier.mockResolvedValue({
      ok: true,
      account: {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        loginName: '202600000001',
        displayName: '测试学生',
        accountType: 'student',
        mustChangePassword: true,
      },
      sessionCookie: 'opaque-session-cookie',
      expiresAt,
    });

    const response = await POST(
      new NextRequest('https://learning.example.com/api/zhiban/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
        body: JSON.stringify({
          identifier: '202600000001',
          password: 'AdultLearning2026!',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(cookieSet).toHaveBeenCalledWith(
      'zhiban_session',
      'opaque-session-cookie',
      expect.objectContaining({ secure: true }),
    );
  });
});
