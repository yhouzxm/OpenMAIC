import { randomUUID } from 'node:crypto';

export class ProtocolRefusal extends Error {
  constructor(readonly status: 400 | 403 | 404 | 405 | 413 | 415 | 431) {
    super('Identity protocol rejected.');
  }
}
export function invalid(): never {
  throw new ProtocolRefusal(400);
}
export function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).sort().join(',') !== [...keys].sort().join(',')
  )
    invalid();
  return value as Record<string, unknown>;
}
export function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) invalid();
  return value;
}
export function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum)
    invalid();
  return value;
}
const securityHeaders = [
  'origin',
  'x-zhiban-request',
  'x-zhiban-csrf',
  'x-zhiban-client-ip',
  'content-type',
  'content-length',
  'sec-fetch-site',
  'idempotency-key',
];
export function headers(request: Request, origin: string, unsafe: boolean) {
  let size = 0;
  for (const [name, value] of request.headers) size += Buffer.byteLength(name + value) + 4;
  if (size > 8192) throw new ProtocolRefusal(431);
  for (const name of securityHeaders) if (request.headers.get(name)?.includes(',')) invalid();
  if (request.headers.get('authorization') !== null) invalid();
  if (request.headers.get('x-zhiban-request') !== 'identity-v1') throw new ProtocolRefusal(403);
  const received = request.headers.get('origin');
  if (
    (unsafe && received !== origin) ||
    (received !== null && received !== origin) ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new ProtocolRefusal(403);
  if (
    request.headers.has('content-encoding') ||
    (unsafe &&
      !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
        request.headers.get('content-type') ?? '',
      ))
  )
    throw new ProtocolRefusal(415);
}
export function cookie(request: Request) {
  const input = request.headers.get('cookie');
  if (input === null) return null;
  if (input.includes(',') || /[^\x20-\x7e]/.test(input)) invalid();
  let found: string | null = null;
  for (const pair of input.split(';')) {
    const p = pair.trim(),
      at = p.indexOf('=');
    if (at <= 0) invalid();
    const name = p.slice(0, at),
      value = p.slice(at + 1);
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || /[\s"\\]/.test(value)) invalid();
    if (name === '__Host-zhiban_session') {
      if (found !== null || !/^[A-Za-z0-9_-]{43}$/.test(value)) invalid();
      found = value;
    }
  }
  return found;
}
export function query(request: Request, allowed: readonly string[]) {
  const url = new URL(request.url);
  if (Buffer.byteLength(url.pathname + url.search) > 2048 || /%2f|%5c|%00|%25/i.test(url.pathname))
    invalid();
  const result: Record<string, string> = {};
  for (const [k, v] of url.searchParams) {
    if (!allowed.includes(k) || Object.hasOwn(result, k)) invalid();
    result[k] = v;
  }
  return result;
}
/** Bounded recursive JSON grammar: duplicate decoded keys are rejected before materialization. */
export function decodeJson(input: string): unknown {
  let at = 0;
  const space = () => {
    while (/\s/.test(input[at] ?? '') && at < input.length) {
      if (!/[\x20\t\r\n]/.test(input[at])) invalid();
      at++;
    }
  };
  const string = (): string => {
    const start = at++;
    let escaped = false;
    while (at < input.length) {
      const c = input[at++];
      if (c === '"' && !escaped) {
        try {
          return JSON.parse(input.slice(start, at));
        } catch {
          invalid();
        }
      }
      if (c === '\\' && !escaped) escaped = true;
      else escaped = false;
    }
    return invalid();
  };
  const value = (depth: number): unknown => {
    if (depth > 8) invalid();
    space();
    const c = input[at];
    if (c === '"') return string();
    if (c === '{') {
      at++;
      space();
      const result: Record<string, unknown> = {};
      const keys = new Set<string>();
      if (input[at] === '}') {
        at++;
        return result;
      }
      while (true) {
        space();
        if (input[at] !== '"') invalid();
        const key = string();
        if (keys.has(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) invalid();
        keys.add(key);
        space();
        if (input[at++] !== ':') invalid();
        result[key] = value(depth + 1);
        space();
        const sep = input[at++];
        if (sep === '}') return result;
        if (sep !== ',') invalid();
      }
    }
    if (c === '[') {
      at++;
      space();
      const result: unknown[] = [];
      if (input[at] === ']') {
        at++;
        return result;
      }
      while (true) {
        result.push(value(depth + 1));
        space();
        const sep = input[at++];
        if (sep === ']') return result;
        if (sep !== ',') invalid();
      }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(
      input.slice(at),
    );
    if (!token) invalid();
    at += token[0].length;
    const result: unknown = JSON.parse(token[0]);
    if (typeof result === 'number' && !Number.isFinite(result)) invalid();
    return result;
  };
  const result = value(0);
  space();
  if (at !== input.length) invalid();
  return result;
}
export async function body(request: Request, limit: number, timeoutMs: number) {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || BigInt(length) > BigInt(limit)))
    throw new ProtocolRefusal(413);
  const reader = request.body?.getReader();
  if (!reader) invalid();
  let bytes = 0,
    expired = false;
  const chunks: Uint8Array[] = [];
  const timer = setTimeout(() => {
    expired = true;
    void reader.cancel().catch(() => {});
  }, timeoutMs);
  try {
    while (true) {
      if (request.signal.aborted) invalid();
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > limit) throw new ProtocolRefusal(413);
      chunks.push(part.value);
    }
    if (expired || request.signal.aborted || (length !== null && BigInt(length) !== BigInt(bytes)))
      invalid();
    const buffer = Buffer.concat(chunks, bytes);
    let decoded: string;
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      return invalid();
    }
    return decodeJson(decoded);
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export const requestId = () => randomUUID();
export function response(id: string, status: number, value?: unknown, extra?: HeadersInit) {
  const h = new Headers(extra);
  h.set('Cache-Control', 'no-store');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('X-Request-Id', id);
  if (status !== 204) {
    h.set('Content-Type', 'application/json');
    h.set('Cross-Origin-Resource-Policy', 'same-origin');
  }
  return new Response(status === 204 ? null : JSON.stringify(value), { status, headers: h });
}
export function failure(id: string, status: number, code: string, extra?: HeadersInit) {
  return response(id, status, { error: { code, requestId: id } }, extra);
}
export const clearCookie =
  '__Host-zhiban_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
