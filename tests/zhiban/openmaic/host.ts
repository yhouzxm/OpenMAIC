import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { DiagnosticBoundary, DiagnosticRejected } from './boundary';

export class Admission {
  active = 0;
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= 2) throw new DiagnosticRejected();
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
    }
  }
}

const POLICY =
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self'; media-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const FORGED = [
  'next-action',
  'x-learner-key',
  'x-tenant-id',
  'x-owner-id',
  'x-forwarded-host',
  'forwarded',
];

export function byteRange(header: string | undefined, length: number): [number, number] | null {
  if (!header) return [0, length - 1];
  const match = /^bytes=(\d+)-(\d*)$/.exec(header);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : length - 1;
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    start <= end &&
    start < length &&
    end < length
    ? [start, end]
    : null;
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 4 * 1024 * 1024) throw new DiagnosticRejected();
    chunks.push(bytes);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new DiagnosticRejected();
  return parsed as Record<string, unknown>;
}

export async function startHost(boundary: DiagnosticBoundary, clientBundle = '') {
  const admission = new Admission();
  let origin = '';
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', POLICY);
    const timer = setTimeout(() => {
      response.destroy();
      request.destroy();
    }, 10_000);
    response.once('close', () => clearTimeout(timer));
    void admission
      .run(() => handle(request, response))
      .catch(() => {
        if (!response.headersSent && !response.destroyed) {
          response.writeHead(403, { 'Content-Type': 'application/json' });
          response.end('{"outcome":"DIAGNOSTIC_REJECTED"}');
        } else response.destroy();
      });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxConnections = 8;

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const raw = request.url ?? '';
    if (
      !raw.startsWith('/') ||
      /[%\\]|\.\.|\/\//.test(raw) ||
      raw.includes('?') ||
      request.headers.host !== new URL(origin).host ||
      FORGED.some((key) => key in request.headers)
    ) {
      throw new DiagnosticRejected();
    }
    const authorization = request.headers.authorization;
    if (
      request.rawHeaders.filter(
        (key, index) => index % 2 === 0 && key.toLowerCase() === 'authorization',
      ).length !== 1
    ) {
      throw new DiagnosticRejected();
    }
    const alias = boundary.authority.authenticate(authorization?.replace(/^Bearer /, ''));
    if (!boundary.authority.subjects.get(alias)?.active) throw new DiagnosticRejected();
    const parts = raw.split('/');
    if (request.method === 'GET' && raw === '/diag/client.js' && clientBundle) {
      response.writeHead(200, { 'Content-Type': 'text/javascript' });
      response.end(clientBundle);
      return;
    }
    if (
      request.method === 'GET' &&
      parts.length === 4 &&
      parts[1] === 'diag' &&
      parts[2] === 'preview'
    ) {
      const slide = await boundary.preview(alias, parts[3]);
      const encoded = Buffer.from(JSON.stringify(slide)).toString('base64');
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(
        `<html><body><main id="preview" data-slide="${encoded}"></main><script src="/diag/client.js"></script></body></html>`,
      );
      return;
    }
    if (
      parts.length === 5 &&
      parts[1] === 'diag' &&
      parts[2] === 'assets' &&
      (request.method === 'GET' || request.method === 'HEAD')
    ) {
      const asset = await boundary.bytes(alias, parts[3], parts[4]);
      const range = byteRange(request.headers.range, asset.bytes.length);
      if (!range) {
        response.writeHead(416);
        response.end();
        return;
      }
      const [start, end] = range;
      response.setHeader('Content-Type', asset.mime);
      response.setHeader('Content-Disposition', 'inline');
      response.setHeader('Content-Length', end - start + 1);
      if (request.headers.range)
        response.setHeader('Content-Range', `bytes ${start}-${end}/${asset.bytes.length}`);
      response.writeHead(request.headers.range ? 206 : 200);
      response.end(request.method === 'HEAD' ? undefined : asset.bytes.subarray(start, end + 1));
      return;
    }
    let result: unknown;
    if (request.method === 'GET' && parts.length === 4 && parts[1] === 'diag') {
      if (parts[2] === 'document') result = await boundary.document(alias, parts[3]);
      else if (parts[2] === 'runtime') result = await boundary.runtime(alias, parts[3]);
      else throw new DiagnosticRejected();
    } else if (
      request.method === 'POST' &&
      parts.length === 5 &&
      parts[1] === 'diag' &&
      parts[2] === 'runtime' &&
      parts[4] === 'append'
    ) {
      const body = await readBody(request);
      if (
        Object.keys(body).sort().join(',') !== 'content,expectedLastSeq' ||
        typeof body.content !== 'string' ||
        (body.expectedLastSeq !== null && typeof body.expectedLastSeq !== 'number')
      )
        throw new DiagnosticRejected();
      result = await boundary.append(
        alias,
        parts[3],
        body.expectedLastSeq as number | null,
        body.content,
      );
    } else throw new DiagnosticRejected();
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(result));
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new DiagnosticRejected();
    origin = `http://127.0.0.1:${address.port}`;
    return { origin, admission, server, close: () => closeServer(server) };
  } catch {
    await closeServer(server);
    throw new DiagnosticRejected();
  }
}

export async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
