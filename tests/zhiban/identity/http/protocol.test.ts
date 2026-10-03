import { describe, expect, it } from 'vitest';
import {
  body,
  decodeJson,
  cookie,
  headers,
  query,
} from '@/lib/zhiban/infrastructure/identity/http/protocol';
import { request, origin } from './fixtures';

describe('D8 bounded protocol before secret processing', () => {
  it.each([
    '{"x":1,"x":2}',
    '{"x":1,"\\u0078":2}',
    '{"__proto__":{}}',
    '{"constructor":{}}',
    '{"prototype":{}}',
    '[1,]',
    '1e999',
    '{"x":NaN}',
    '{"x":1} {}',
    '\u00a0{}',
    '[,,,,]',
    '"unterminated',
    '{"x":01}',
  ])('rejects malformed/duplicate/prototype/nonfinite input %#', (input) =>
    expect(() => decodeJson(input)).toThrow('Identity protocol rejected.'),
  );
  it('preserves secret Unicode bytes without normalization', () =>
    expect(decodeJson('{"x":" é ","y":[null,false,1e2]}')).toEqual({
      x: ' é ',
      y: [null, false, 100],
    }));
  it('bounds recursive depth', () =>
    expect(() => decodeJson('['.repeat(10) + '0' + ']'.repeat(10))).toThrow());
  it.each([
    'null',
    'https://evil.example',
    'http://synthetic.example',
    'https://sub.synthetic.example',
    'https://synthetic.example:444',
  ])('refuses foreign unsafe Origin %s', (o) =>
    expect(() => headers(request('login', 'POST', {}, { Origin: o }), origin, true)).toThrow(),
  );
  it('missing Origin never permits unsafe', () => {
    const r = request('login', 'POST', {});
    r.headers.delete('Origin');
    expect(() => headers(r, origin, true)).toThrow();
  });
  it('safe reads allow absent Origin only with required header', () => {
    expect(() => headers(request('me'), origin, false)).not.toThrow();
    const r = request('me');
    r.headers.delete('x-zhiban-request');
    expect(() => headers(r, origin, false)).toThrow();
  });
  it.each([
    'application/x-www-form-urlencoded',
    'multipart/form-data',
    'text/plain',
    'application/json;charset=latin1',
  ])('refuses media %s', (type) =>
    expect(() =>
      headers(request('login', 'POST', {}, { 'Content-Type': type }), origin, true),
    ).toThrow(),
  );
  it('refuses compressed input', () =>
    expect(() =>
      headers(request('login', 'POST', {}, { 'Content-Encoding': 'gzip' }), origin, true),
    ).toThrow());
  it('rejects combined security headers', () =>
    expect(() =>
      headers(request('login', 'POST', {}, { Origin: origin + ', ' + origin }), origin, true),
    ).toThrow());
  it('bounds headers', () =>
    expect(() =>
      headers(request('me', 'GET', undefined, { 'X-Large': 'a'.repeat(8192) }), origin, false),
    ).toThrow());
  it.each([
    '__Host-zhiban_session=a',
    '__Host-zhiban_session=' + 'a'.repeat(43) + '; __Host-zhiban_session=' + 'b'.repeat(43),
    'bad pair',
    'x="bad"',
    'x=y, z=a',
  ])('rejects malformed/duplicate cookies %#', (c) =>
    expect(() => cookie(request('me', 'GET', undefined, { Cookie: c }))).toThrow(),
  );
  it('does not authenticate native access cookie', () =>
    expect(
      cookie(request('me', 'GET', undefined, { Cookie: 'openmaic_access=synthetic' })),
    ).toBeNull());
  it.each(['me?x=1', 'spaces?limit=1&limit=2'])('rejects unknown/duplicate query %s', (p) =>
    expect(() => query(request(p), ['limit'])).toThrow(),
  );
  it('bounds undeclared streamed bytes', async () =>
    expect(body(request('login', 'POST', 'a'.repeat(100)), 20, 1000)).rejects.toMatchObject({
      status: 413,
    }));
  it('rejects lying Content-Length', async () =>
    expect(
      body(request('login', 'POST', '{}', { 'Content-Length': '1' }), 20, 1000),
    ).rejects.toThrow());
  it('rejects declared oversized input before reading', async () =>
    expect(
      body(request('login', 'POST', '{}', { 'Content-Length': '999' }), 20, 1000),
    ).rejects.toMatchObject({ status: 413 }));
  it('rejects invalid UTF8', async () => {
    const r = new Request(origin, { method: 'POST', body: new Uint8Array([0xff]) });
    await expect(body(r, 20, 1000)).rejects.toThrow();
  });
  it('cancels timed out body even with valid partial JSON', async () => {
    let canceled = false;
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{}'));
      },
      cancel() {
        canceled = true;
      },
    });
    const r = new Request(origin, { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    await expect(body(r, 20, 5)).rejects.toThrow();
    expect(canceled).toBe(true);
  });
});
