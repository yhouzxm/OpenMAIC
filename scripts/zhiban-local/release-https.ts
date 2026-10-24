// Immutable ordinary HTTPS child. No signer, installer, migration or maintenance credentials.
import { createServer } from 'node:https';
import { fstatSync } from 'node:fs';
import { join } from 'node:path';
const {
  bytes,
  config,
  insist,
} = require('../../docs/v2/candidates/m5-handoff/release-contract.cjs');
const tlsLib = require('../../docs/v2/candidates/m5-handoff/release-tls.cjs');
const product = require('./product.cjs');
const root = process.argv[3];
const pools: any = {};
let phase = 'BOOTSTRAP';
let server: any,
  stopping = false;
const pending = new Map<string, { resolve: () => void; reject: (e: Error) => void; timer: any }>();
let seq = 0;
async function stop() {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(1), 2000).unref();
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(Error('Host stopped'));
  }
  pending.clear();
  server?.closeAllConnections();
  server?.close();
  await Promise.allSettled(Object.values(pools).map((p: any) => p.end()));
  process.exit(0);
}
function authorize(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stopping || !process.connected) return reject(Error('Supervisor unavailable'));
    if (pending.size >= 32) return reject(Error('Admission limit'));
    const id = String(++seq),
      timer = setTimeout(() => {
        pending.delete(id);
        reject(Error('Gate timeout'));
        void stop();
      }, 8000);
    pending.set(id, { resolve, reject, timer });
    process.send!({ type: 'CHECK', id });
  });
}
process.on('message', (m: any) => {
  if (m?.type === 'STOP') return void stop();
  if (m?.type !== 'CHECKED') return void stop();
  const p = pending.get(m.id);
  if (!p) return void stop();
  clearTimeout(p.timer);
  pending.delete(m.id);
  if (m.ok === true) p.resolve();
  else {
    p.reject(Error('Gate closed'));
    void stop();
  }
});
process.on('disconnect', () => void stop());
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void stop());
async function main() {
  insist(
    process.argv[2] === '--ordinary-handoff' && process.connected && fstatSync(4).isFile(),
    'Private supervisor and shared lock required',
  );
  const cfg0 = JSON.parse(bytes(join(root, 'ordinary.json'))),
    cfg = config(cfg0, cfg0.releaseId, cfg0.credentialGenerationId);
  const origin = cfg.target.origin,
    tls = tlsLib.load(root),
    certificate = tls.cert;
  await authorize();
  for (const x of cfg.connections) {
    const p = new product.Pool({
      host: '127.0.0.1',
      port: cfg.target.port,
      database: x.database,
      user: x.role,
      password: x.password,
      max: 3,
      connectionTimeoutMillis: 3000,
      statement_timeout: 5000,
      idle_in_transaction_session_timeout: 10000,
    });
    p.on('error', () => void stop());
    pools[x.role] = p;
  }
  cfg.identity.composition.admission.hmacKey = Buffer.from(
    cfg.identity.composition.admission.hmacKey,
    'hex',
  );
  phase = 'COMPOSITION';
  const composition = await product.createProduct(pools, cfg.identity, cfg.deploymentId);
  const identityHttp = (r: Request) => composition.identity.handle(r),
    academicHttp: any = composition.academic;
  academicHttp.learning = composition.learning;
  academicHttp.assessment = composition.assessment;
  const contentHttp = composition.content;
  phase = 'ASSETS';
  const assets = new Map<string, { type: string; content: Buffer }>();
  for (const [path, name, type] of [
    ['/zhiban/content', 'content.html', 'text/html; charset=utf-8'],
    ['/zhiban/content-client.js', 'content-client.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/content.css', 'content.css', 'text/css; charset=utf-8'],
    ['/zhiban', 'index.html', 'text/html; charset=utf-8'],
    ['/zhiban/client.js', 'client.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/style.css', 'style.css', 'text/css; charset=utf-8'],
    ['/zhiban/academic.js', 'academic.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/assessment.js', 'assessment.js', 'text/javascript; charset=utf-8'],
    ['/zhiban/learning.js', 'learning.js', 'text/javascript; charset=utf-8'],
  ]) {
    assets.set(path, { type, content: bytes(join(root, 'assets', name)) });
  }
  const cspEvidence = JSON.parse(bytes(join(root, 'assets/content-csp.json')).toString());
  const contentCsp = cspEvidence.policy;
  if (typeof contentCsp !== 'string' || contentCsp.includes('unsafe-inline'))
    throw new Error('Content CSP binding rejected');
  server = createServer(
    { cert: certificate, key: tls.key, minVersion: 'TLSv1.2', maxHeaderSize: 8192 },
    async (incoming, outgoing) => {
      const security = {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy':
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
      };
      const finish = (status: number, body = '') => {
        outgoing.writeHead(status, security);
        outgoing.end(body);
      };
      try {
        await authorize();
        // Direct TLS is the single ingress. Reject duplicate security headers before Headers coalesces them.
        const counts = new Map<string, number>();
        for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
          const key = incoming.rawHeaders[i].toLowerCase();
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        if (
          [...counts].some(
            ([key, count]) =>
              count > 1 &&
              [
                'host',
                'cookie',
                'origin',
                'content-type',
                'content-length',
                'authorization',
                'x-zhiban-request',
                'x-zhiban-csrf',
                'x-zhiban-command',
              ].includes(key),
          )
        )
          return finish(400);
        if (
          incoming.headers.host !== '127.0.0.1:3443' ||
          incoming.socket.remoteAddress !== '127.0.0.1'
        )
          return finish(403);
        const raw = incoming.url ?? '';
        if (
          !raw.startsWith('/') ||
          raw.includes('\\') ||
          raw.includes('%') ||
          raw.includes('//') ||
          raw.split('?')[0].split('/').includes('..')
        )
          return finish(400);
        const url = new URL(raw, origin);
        if (url.pathname === '/' && incoming.method === 'GET') {
          outgoing.writeHead(302, { ...security, Location: '/zhiban' });
          return outgoing.end();
        }
        const asset = assets.get(url.pathname);
        if (asset) {
          if (!['GET', 'HEAD'].includes(incoming.method ?? '')) return finish(405);
          const policy =
            url.pathname === '/zhiban/content'
              ? { ...security, 'Content-Security-Policy': contentCsp }
              : security;
          outgoing.writeHead(200, { ...policy, 'Content-Type': asset.type });
          return outgoing.end(incoming.method === 'HEAD' ? undefined : asset.content);
        }
        const contentRoute =
          /^\/api\/zhiban\/content\/[^/]+\/offerings\/[^/]+(?:\/resources\/[^/]+\/preview)?$/.test(
            url.pathname,
          );
        const learningRoute = /^\/api\/zhiban\/learning\/[^/]+\/offerings\/[^/]+$/.test(
          url.pathname,
        );
        const assessmentRoute = /^\/api\/zhiban\/assessment\/[^/]+\/offerings\/[^/]+$/.test(
          url.pathname,
        );
        const academicRoute = /^\/api\/zhiban\/academic\/[^/]+$/.test(url.pathname);
        if (
          !contentRoute &&
          !academicRoute &&
          !learningRoute &&
          !assessmentRoute &&
          !/^\/api\/zhiban\/identity\/(login|logout|me|csrf|spaces)$/.test(url.pathname)
        )
          return finish(404);
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (
            value !== undefined &&
            !['host', 'connection', 'transfer-encoding', 'content-length', 'forwarded'].includes(
              key,
            ) &&
            !key.startsWith('x-forwarded-') &&
            key !== 'x-zhiban-client-ip'
          )
            headers.set(key, Array.isArray(value) ? value.join(',') : value);
        }
        headers.set('x-zhiban-client-ip', incoming.socket.remoteAddress);
        const chunks: Buffer[] = [];
        let bytes = 0;
        const timeout = setTimeout(() => incoming.destroy(), 3000);
        try {
          for await (const chunk of incoming) {
            bytes += chunk.length;
            if (bytes > (contentRoute ? 262144 : learningRoute || assessmentRoute ? 32768 : 4096)) {
              finish(413);
              incoming.destroy();
              return;
            }
            chunks.push(Buffer.from(chunk));
          }
        } finally {
          clearTimeout(timeout);
        }
        const body = Buffer.concat(chunks);
        if (['GET', 'HEAD'].includes(incoming.method ?? '') && bytes > 0) return finish(400);
        await authorize();
        const forwarded = new Request(url, {
          method: incoming.method,
          headers,
          ...(!['GET', 'HEAD'].includes(incoming.method ?? '') ? { body } : {}),
        });
        const businessHttp = contentRoute
          ? contentHttp
          : assessmentRoute
            ? academicHttp?.assessment
            : learningRoute
              ? academicHttp?.learning
              : academicHttp;
        const response =
          contentRoute || academicRoute || learningRoute || assessmentRoute
            ? businessHttp
              ? await businessHttp(forwarded)
              : new Response(JSON.stringify({ error: { code: 'SERVICE_UNAVAILABLE' } }), {
                  status: 503,
                  headers: { 'Content-Type': 'application/json' },
                })
            : await identityHttp(forwarded);
        outgoing.writeHead(response.status, {
          ...Object.fromEntries(response.headers),
          ...security,
        });
        outgoing.end(Buffer.from(await response.arrayBuffer()));
      } catch {
        if (!outgoing.headersSent) finish(503);
        else outgoing.end();
      }
    },
  );
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxConnections = 32;
  await authorize();
  phase = 'LISTEN';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(3443, '127.0.0.1', resolve);
  });
  server.on('error', () => void stop());
  process.send!({
    type: 'LISTENING',
    releaseId: cfg.releaseId,
    credentialGenerationId: cfg.credentialGenerationId,
  });
}
void main().catch((error) => {
  process.send?.({
    type: 'FAILED',
    phase,
    code: /^[A-Z_]+$/.test(error?.code || '') ? error.code : 'REJECTED',
  });
  void stop();
});
