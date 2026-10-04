import { afterEach, describe, expect, test, vi } from 'vitest';
import { request } from 'node:http';
import { createMemoryFixture } from './memory-harness';
import { Admission, byteRange, startHost } from './host';
import { DiagnosticRejected } from './boundary';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
async function setup() {
  const f = await createMemoryFixture();
  const host = await startHost(f.boundary);
  cleanup.push(host.close);
  const headers = { authorization: `Bearer ${f.credential.studentA1}` };
  return { f, host, headers };
}
describe('D01/D02/D06/D07 real Node HTTP diagnostic host', () => {
  test('authorized GET/HEAD/range bytes are real and private/no-store', async () => {
    const { f, host, headers } = await setup();
    const url = `${host.origin}/diag/assets/${f.stages.A}/png`;
    const response = await fetch(url, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(8);
    const head = await fetch(url, { headers, method: 'HEAD' });
    expect(head.status).toBe(200);
    expect((await head.arrayBuffer()).byteLength).toBe(0);
    const range = await fetch(url, { headers: { ...headers, range: 'bytes=0-7' } });
    expect(range.status).toBe(206);
    expect((await range.arrayBuffer()).byteLength).toBe(8);
  });
  test('copied URL rejects without admission and after revoke despite cache request', async () => {
    const { f, host, headers } = await setup();
    const url = `${host.origin}/diag/assets/${f.stages.A}/png`;
    expect((await fetch(url)).status).toBe(403);
    expect((await fetch(url, { headers })).status).toBe(200);
    f.authority.mappings.get(f.stages.A)!.state = 'REVOKED';
    expect((await fetch(url, { headers: { ...headers, 'if-none-match': '*' } })).status).toBe(403);
  });
  test.each([
    '/api/stages/x',
    '/classroom/x',
    '/api/runtime/sessions',
    '/api/agent/runtime',
    '/api/agent/sessions/x/events',
    '/api/proxy-media',
    '/diag/iframe',
    '/diag/stream',
    '/diag/runtime/admin/merge',
    '/storage/asset',
  ])('native/action/iframe/stream/admin route absent: %s', async (path) => {
    const { host, headers } = await setup();
    const response = await fetch(`${host.origin}${path}`, { headers });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ outcome: 'DIAGNOSTIC_REJECTED' });
  });
  test('encoded path, forged Host/proxy/learner and action method are rejected', async () => {
    const { host, headers, f } = await setup();
    const hostileHeaders: Record<string, string>[] = [
      { 'x-learner-key': 'foreign' },
      { 'next-action': 'opaque' },
      { 'x-forwarded-host': 'outside.invalid' },
    ];
    for (const hostile of hostileHeaders) {
      expect(
        (
          await fetch(`${host.origin}/diag/document/${f.stages.A}`, {
            headers: { ...headers, ...hostile },
          })
        ).status,
      ).toBe(403);
    }
    expect((await fetch(`${host.origin}/diag/document/%41`, { headers })).status).toBe(403);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        `${host.origin}/diag/document/${f.stages.A}`,
        { headers: { ...headers, host: 'foreign.invalid' } },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      );
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
    expect(
      (await fetch(`${host.origin}/diag/document/${f.stages.A}`, { headers, method: 'POST' }))
        .status,
    ).toBe(403);
  });
  test('body cannot forge tenant/learner/role and storage error stays normalized', async () => {
    const { host, headers, f } = await setup();
    const response = await fetch(`${host.origin}/diag/runtime/${f.sessions.A}/append`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'fixture', expectedLastSeq: null, learnerKey: 'foreign' }),
    });
    expect(response.status).toBe(403);
    vi.spyOn(f.boundary, 'document').mockRejectedValue(
      Object.assign(new Error('sensitive-detail'), { code: '42501' }),
    );
    const failure = await fetch(`${host.origin}/diag/document/${f.stages.A}`, { headers });
    expect(await failure.json()).toEqual({ outcome: 'DIAGNOSTIC_REJECTED' });
  });
  test('oversized body is rejected, not queued', async () => {
    const { host, headers, f } = await setup();
    const result = await fetch(`${host.origin}/diag/runtime/${f.sessions.A}/append`, {
      method: 'POST',
      headers,
      body: 'x'.repeat(4 * 1024 * 1024 + 1),
    }).then(
      (response) => response.status,
      () => 403,
    );
    expect(result).toBe(403);
    expect(f.boundary.calls.runtime).toBe(0);
  });
  test('admission has no queue and releases permits on success/failure', async () => {
    const admission = new Admission();
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const one = admission.run(() => barrier);
    const two = admission.run(() => barrier);
    await expect(admission.run(async () => undefined)).rejects.toThrow(DiagnosticRejected);
    expect(admission.active).toBe(2);
    release();
    await Promise.all([one, two]);
    await expect(
      admission.run(async () => {
        throw new Error('provider');
      }),
    ).rejects.toThrow('provider');
    expect(admission.active).toBe(0);
  });
  test.each(['bytes=-8', 'bytes=0-1,3-4', 'bytes=999-', 'bytes=3-2', 'bytes=0-9007199254740992'])(
    'invalid range %s rejected',
    (value) => {
      expect(byteRange(value, 10)).toBeNull();
    },
  );
});
