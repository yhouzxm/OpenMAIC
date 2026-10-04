import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { request, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';
import {
  PrivateRecoveryTransport,
  parsePrivateBody,
  type RecoveryTransportConfig,
} from '@/lib/zhiban/infrastructure/identity/recovery/private-transport';
import { privateRecoveryServer } from '@/lib/zhiban/infrastructure/identity/recovery/root';
import type { ManualRecovery } from '@/lib/zhiban/infrastructure/identity/recovery/composition';
import { RecoveryRegistry } from '@/lib/zhiban/infrastructure/identity/recovery/registry';
import { randomLocator } from '@/lib/zhiban/infrastructure/identity/recovery/material';
import { must } from '@/lib/zhiban/infrastructure/identity/recovery/values';
import { budgets, ids } from './fixtures';
let directory: string,
  cert: Buffer,
  key: Buffer,
  server: Server,
  port: number,
  service: ReturnType<typeof fixture>;
const terminal = (byte: string) => Array(32).fill(byte).join(':'),
  operator = terminal('11'),
  subject = terminal('22');
let config: RecoveryTransportConfig;
function fixture() {
  const registry = new RecoveryRegistry(4, 600000, 300000);
  return {
    policy: { ...budgets, body_timeout_ms: 100, max_process_requests: 2 },
    registry,
    reserve: vi.fn(async () => {}),
    admitOperator: vi.fn(async () => {}),
    bounded: async <T>(fn: () => Promise<T>) => fn(),
    security: {
      context: vi.fn(async (raw: unknown) => {
        must(raw === 'synthetic-session');
        return { csrf: 'operator-csrf' };
      }),
      stepUp: vi.fn(async (raw: unknown, csrf: unknown, _password: string) => {
        must(raw === 'synthetic-session' && csrf === 'operator-csrf');
        return { kind: 'RECOVERY_REQUEST_PROOF' };
      }),
    },
    register: vi.fn(async () => ({ state: 'REGISTERED' })),
    ready: vi.fn(async () => ({ state: 'APPROVED' })),
    subjectTicket: vi.fn(async (cookie: string) => registry.takeTicket(cookie)),
    submit: vi.fn(async () => ({ status: 'READY' })),
    complete: vi.fn(async () => {
      throw Object.assign(new Error('Synthetic private provider detail'), {
        cause: 'Synthetic cause',
        code: 'PRIVATE_CODE',
      });
    }),
  };
}
async function send(
  path = 'operator/context',
  body = '{}',
  extra: Record<string, string> = {},
  options: { method?: string; duplicates?: string[]; stall?: boolean; clientCert?: boolean } = {},
) {
  return new Promise<{ status: number; body: string; headers: IncomingHttpHeaders }>(
    (done, reject) => {
      const headers: Record<string, string> = {
        Origin: config.origin,
        'Content-Type': 'application/json',
        'Sec-Fetch-Site': 'same-origin',
        'X-Zhiban-Request': 'manual-recovery-v1',
        'X-Zhiban-Terminal-Cert': operator,
        'X-Zhiban-Recovery-Lane': 'OPERATOR',
        'X-Zhiban-Recovery-Site': 'site-a',
        'X-Zhiban-Recovery-Environment': 'synthetic',
        Cookie: '__Host-zhiban_session=synthetic-session',
        'Content-Length': (options.stall ? 8192 : Buffer.byteLength(body)).toString(),
        ...extra,
      };
      const req = request(
        {
          hostname: '127.0.0.1',
          port,
          servername: 'localhost',
          ca: cert,
          ...(options.clientCert === false ? {} : { cert, key }),
          method: options.method ?? 'POST',
          path: '/_zhiban_recovery/v1/' + path,
          headers: options.duplicates
            ? [...Object.entries(headers).flat(), ...options.duplicates]
            : headers,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            done({
              status: res.statusCode!,
              body: Buffer.concat(chunks).toString(),
              headers: res.headers,
            });
            req.destroy();
          });
        },
      );
      req.on('error', reject);
      if (options.stall) {
        req.write('{');
      } else req.end(body);
    },
  );
}
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'zhiban-private-recovery-'));
  let openssl = 'openssl';
  if (process.platform === 'win32') {
    const git = execFileSync('where.exe', ['git'], { encoding: 'utf8' }).trim().split(/\r?\n/)[0];
    const candidate = resolve(dirname(git), '../usr/bin/openssl.exe');
    if (existsSync(candidate)) openssl = candidate;
  }
  execFileSync(
    openssl,
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-sha256',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-addext',
      'basicConstraints=critical,CA:TRUE',
      '-keyout',
      join(directory, 'key.pem'),
      '-out',
      join(directory, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  );
  cert = readFileSync(join(directory, 'cert.pem'));
  key = readFileSync(join(directory, 'key.pem'));
  config = {
    origin: 'https://staff.synthetic.invalid',
    environment: 'synthetic',
    deploymentApprovalRef: 'synthetic-approved',
    proxyCertificate: new X509Certificate(cert).fingerprint256,
    terminals: [
      {
        id: 'staff',
        site: 'site-a',
        lane: 'OPERATOR',
        certificate: operator,
        pairedTerminal: 'person',
      },
      {
        id: 'person',
        site: 'site-a',
        lane: 'SUBJECT',
        certificate: subject,
        pairedTerminal: 'staff',
      },
    ],
  };
});
beforeEach(async () => {
  service = fixture();
  server = privateRecoveryServer(
    new PrivateRecoveryTransport(service as unknown as ManualRecovery, config, () => {}),
    { key, cert, ca: cert },
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
  vi.restoreAllMocks();
});
afterAll(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});
describe('actual private Node HTTPS receiver', () => {
  it('authenticates approved proxy certificate and bootstrap current operator Session', async () => {
    const r = await send();
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ csrf: 'operator-csrf' });
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
  it('no client certificate cannot reach handler', async () => {
    await expect(send(undefined, undefined, {}, { clientCert: false })).rejects.toThrow();
    expect(service.reserve).not.toHaveBeenCalled();
  });
  it('wrong configured proxy peer cannot establish transport from headers', async () => {
    await new Promise<void>((r) => server.close(() => r()));
    server = privateRecoveryServer(
      new PrivateRecoveryTransport(
        service as unknown as ManualRecovery,
        {
          ...config,
          proxyCertificate: terminal('FF'),
        },
        () => {},
      ),
      { key, cert, ca: cert },
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
    expect((await send()).status).toBe(400);
    expect(service.reserve).not.toHaveBeenCalled();
  });
  it.each([
    { Origin: 'https://foreign.invalid' },
    { 'X-Zhiban-Recovery-Lane': 'SUBJECT' },
    { 'X-Zhiban-Recovery-Site': 'foreign' },
    { 'X-Zhiban-Terminal-Cert': terminal('33') },
    { 'X-Zhiban-Recovery-Environment': 'foreign' },
    { 'Sec-Fetch-Site': 'cross-site' },
    { 'Content-Type': 'text/plain' },
    { 'Content-Encoding': 'gzip' },
    { Authorization: 'Bearer synthetic' },
  ])('foreign/malformed transport assertion rejects %#', async (h) => {
    const overrides = Object.fromEntries(
      Object.entries(h).filter(([, v]) => typeof v === 'string'),
    );
    expect((await send('operator/context', '{}', overrides)).status).toBe(400);
    expect(service.reserve).not.toHaveBeenCalled();
  });
  it.each(['Origin', 'Cookie', 'X-Zhiban-Terminal-Cert', 'X-Zhiban-CSRF'])(
    'duplicate %s is never silently merged',
    async (name) => {
      const d = name === 'X-Zhiban-CSRF' ? [name, 'first', name, 'second'] : [name, 'duplicate'];
      expect((await send('operator/context', '{}', {}, { duplicates: d })).status).toBe(400);
      expect(service.security.context).not.toHaveBeenCalled();
    },
  );
  it.each(['{}', '{"currentPassword":"synthetic"}'])(
    'missing cookie and missing synchronizer proof cannot register %#',
    async (body) => {
      const payload =
        body === '{}'
          ? '{}'
          : JSON.stringify({
              enrollmentRef: 'enrollment',
              appointmentRef: 'appointment',
              contactRef: 'contact',
              approvalRef: 'approval',
              currentPassword: 'synthetic',
            });
      expect((await send('operator/register', payload, { Cookie: '' })).status).toBe(400);
      expect(service.register).not.toHaveBeenCalled();
    },
  );
  it('all post-context operator actions require synchronizer proof', async () => {
    const payload = JSON.stringify({ caseId: ids.nextCommandId(), currentPassword: 'synthetic' });
    expect((await send('operator/ready', payload)).status).toBe(400);
    expect(service.ready).not.toHaveBeenCalled();
    expect(
      (await send('operator/ready', payload, { 'X-Zhiban-CSRF': 'operator-csrf' })).status,
    ).toBe(200);
  });
  it.each([
    'operator/context?token=synthetic',
    'operator/context#synthetic',
    'public/login',
    'subject/ticket',
  ])('unknown/query/fragment/foreign lane refuses %s', async (path) => {
    expect((await send(path)).status).toBe(400);
    expect(service.security.context).not.toHaveBeenCalled();
  });
  it('rejects GET, encoded body, oversized body/header, finite body timeout', async () => {
    expect((await send(undefined, undefined, {}, { method: 'GET' })).status).toBe(400);
    expect((await send('operator/context', JSON.stringify({ x: 'a'.repeat(8200) }))).status).toBe(
      400,
    );
    await expect(
      send('operator/context', '{}', { 'X-Oversize': 'a'.repeat(9000) }),
    ).rejects.toThrow();
    const timeout = await send('operator/context', '{}', {}, { stall: true });
    expect(timeout.status).toBe(503);
    expect(timeout.body).toBe('{"error":"RECOVERY_UNAVAILABLE"}');
  });
  it('subject context is single-use/assigned-terminal and ignores normal staff Session authority', async () => {
    const id = ids.nextCommandId(),
      pair = service.registry.pair({
        caseId: id,
        actor: ids.nextUserId(),
        subject: ids.nextUserId(),
        site: 'site-a',
        operatorTerminal: 'staff',
        subjectTerminal: 'person',
        caseRevision: '3',
        deadline: Date.now() + 600000,
      });
    const h = {
      'X-Zhiban-Terminal-Cert': subject,
      'X-Zhiban-Recovery-Lane': 'SUBJECT',
      Cookie: '',
    };
    const opened = await send('subject/context', JSON.stringify({ pairingCode: pair }), h);
    expect(opened.status).toBe(200);
    const c = opened.headers['set-cookie']![0];
    expect(c.includes('; Secure; HttpOnly; SameSite=Strict')).toBe(true);
    expect(c.includes('Domain=')).toBe(false);
    expect((await send('subject/context', JSON.stringify({ pairingCode: pair }), h)).status).toBe(
      400,
    );
    const missing = await send('subject/ticket', '{}', h);
    expect(missing.status).toBe(400);
    expect(missing.headers['set-cookie']![0]).toContain('Max-Age=0');
    const cookie = c.split(';')[0],
      csrf = JSON.parse(opened.body).csrf;
    expect(
      (await send('subject/ticket', '{}', { ...h, Cookie: cookie, 'X-Zhiban-CSRF': csrf })).status,
    ).toBe(200);
    expect(service.security.context).not.toHaveBeenCalled();
  });
  it('operator body cannot contain target password/verifier and failures expose no cause/code', async () => {
    const payload = {
      caseId: ids.nextCommandId(),
      expectedRevision: '4',
      submissionRef: randomLocator('msub1_'),
      currentPassword: 'synthetic',
    };
    expect(
      (
        await send('operator/complete', JSON.stringify({ ...payload, newPassword: 'synthetic' }), {
          'X-Zhiban-CSRF': 'operator-csrf',
        })
      ).status,
    ).toBe(400);
    const r = await send('operator/complete', JSON.stringify(payload), {
      'X-Zhiban-CSRF': 'operator-csrf',
    });
    expect(r.status).toBe(503);
    expect(r.body).toBe('{"error":"RECOVERY_UNAVAILABLE"}');
  });
  it('duplicate and escaped-duplicate body keys reject before KDF', async () => {
    expect(
      (await send('operator/ready', '{"caseId":"a","caseId":"b","currentPassword":"synthetic"}'))
        .status,
    ).toBe(400);
    expect(service.security.stepUp).not.toHaveBeenCalled();
  });
  it('canonical subject admission precedes staff password KDF and denial skips it', async () => {
    const id = ids.nextCommandId();
    const result = await send(
      'operator/ready',
      JSON.stringify({ caseId: id, currentPassword: 'synthetic' }),
      { 'X-Zhiban-CSRF': 'operator-csrf' },
    );
    expect(result.status).toBe(200);
    expect(service.admitOperator).toHaveBeenCalledWith('READ', 'site-a', id);
    expect(service.admitOperator.mock.invocationCallOrder[0]).toBeLessThan(
      service.security.stepUp.mock.invocationCallOrder[0],
    );
    service.security.stepUp.mockClear();
    service.admitOperator.mockRejectedValueOnce(new Error('Synthetic admission denial'));
    expect(
      (
        await send('operator/ready', JSON.stringify({ caseId: id, currentPassword: 'synthetic' }), {
          'X-Zhiban-CSRF': 'operator-csrf',
        })
      ).status,
    ).toBe(503);
    expect(service.security.stepUp).not.toHaveBeenCalled();
  });
});
describe('bounded flat JSON parser', () => {
  it('supports whitespace and properly escaped string values', () => {
    expect(parsePrivateBody(' { "x" : "a\\n\\\"b" } ')).toEqual({ x: 'a\n"b' });
  });
  it.each([
    '{"x":"a","x":"b"}',
    '{"x":"a","\\u0078":"b"}',
    '{"x":true}',
    '{"x":null}',
    '{"x":{}}',
    '[]',
    '{}x',
    '{"x":"a",}',
  ])('rejects ambiguity/non-string/trailing data %#', (text) => {
    expect(() => parsePrivateBody(text)).toThrow();
  });
});
