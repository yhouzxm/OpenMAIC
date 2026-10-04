import { afterEach, describe, expect, test } from 'vitest';
import { connect } from 'node:net';
import { request as httpRequest, createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect as tlsConnect } from 'node:tls';
import { lookup } from 'node:dns/promises';
import { createSocket } from 'node:dgram';
import { spawn } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { installEgressFence } from './egress';
import { closeServer } from './host';

let fence: ReturnType<typeof installEgressFence> | undefined;
afterEach(() => {
  fence?.close();
  fence = undefined;
});
describe('D01 enforced controlled-host network API boundary', () => {
  test('approved loopback performs an actual request; fetch/http/https/TCP/TLS/DNS/UDP/subprocess/worker escape fail', async () => {
    const observer = createServer((_request, response) => response.end('synthetic observer'));
    await new Promise<void>((resolve) => observer.listen(0, '127.0.0.1', resolve));
    const address = observer.address();
    if (!address || typeof address === 'string') throw new Error('fixture');
    try {
      fence = installEgressFence([address.port]);
      const response = await fetch(`http://127.0.0.1:${address.port}`);
      expect(await response.text()).toBe('synthetic observer');
      await expect(fetch('https://outside.invalid/x')).rejects.toThrow('DIAGNOSTIC_EGRESS_DENIED');
      expect(() => httpRequest('http://192.0.2.1/x')).toThrow('DIAGNOSTIC_EGRESS_DENIED');
      expect(() => httpsRequest('https://192.0.2.1/x')).toThrow('DIAGNOSTIC_EGRESS_DENIED');
      expect(() => connect({ host: '192.0.2.1', port: 80 })).toThrow('DIAGNOSTIC_EGRESS_DENIED');
      expect(() => tlsConnect({ host: '192.0.2.1', port: 443 })).toThrow(
        'DIAGNOSTIC_EGRESS_DENIED',
      );
      expect(() => lookup('outside.invalid')).toThrow('DIAGNOSTIC_EGRESS_DENIED');
      expect(() => createSocket('udp4')).toThrow('DIAGNOSTIC_EGRESS_DENIED');
      expect(() => spawn('unapproved-child')).toThrow('DIAGNOSTIC_EGRESS_DENIED');
      expect(() => new Worker('unapproved-worker')).toThrow('DIAGNOSTIC_EGRESS_DENIED');
      expect(fence.denied).toBe(9);
    } finally {
      fence?.close();
      fence = undefined;
      await closeServer(observer);
    }
  });
  test('unregistered loopback port and Unix socket escape are denied', () => {
    fence = installEgressFence([12345]);
    expect(() => connect({ host: '127.0.0.1', port: 12346 })).toThrow('DIAGNOSTIC_EGRESS_DENIED');
    expect(() => connect({ path: '/unapproved/socket' })).toThrow('DIAGNOSTIC_EGRESS_DENIED');
  });
  test('fence configuration cannot authorize external addresses or unbounded ports', () => {
    expect(() => installEgressFence([0])).toThrow('DIAGNOSTIC_EGRESS_CONFIGURATION');
    expect(() => installEgressFence([1, 2, 3, 4])).toThrow('DIAGNOSTIC_EGRESS_CONFIGURATION');
  });
});
