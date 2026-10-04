import { createRequire, syncBuiltinESMExports } from 'node:module';

// Process API fence for the controlled test host. Not an arbitrary-code/OS sandbox.
// Installed before probes; browser runs outside this fence with its own request gate.
export function installEgressFence(ports: readonly number[]) {
  if (
    ports.length > 3 ||
    ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)
  ) {
    throw new Error('DIAGNOSTIC_EGRESS_CONFIGURATION');
  }
  const allowed = new Set(ports);
  const require = createRequire(import.meta.url);
  const net = require('node:net') as typeof import('node:net');
  const dns = require('node:dns') as typeof import('node:dns');
  const dgram = require('node:dgram') as typeof import('node:dgram');
  const child = require('node:child_process') as typeof import('node:child_process');
  const workers = require('node:worker_threads') as typeof import('node:worker_threads');
  let denied = 0;
  const reject = (): never => {
    denied++;
    throw new Error('DIAGNOSTIC_EGRESS_DENIED');
  };
  const check = (host: unknown, port: unknown) => {
    if ((host !== '127.0.0.1' && host !== '::1') || !allowed.has(Number(port))) reject();
  };
  const restore: (() => void)[] = [];
  function patch(target: object, key: string, replacement: unknown) {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    if (!descriptor) throw new Error('DIAGNOSTIC_EGRESS_CONFIGURATION');
    Object.defineProperty(target, key, { ...descriptor, value: replacement });
    restore.push(() => Object.defineProperty(target, key, descriptor));
  }
  try {
    const connect = net.Socket.prototype.connect;
    patch(
      net.Socket.prototype,
      'connect',
      function (this: import('node:net').Socket, ...args: unknown[]) {
        let options = args[0];
        if (Array.isArray(options)) options = options[0];
        if (options && typeof options === 'object') {
          const value = options as { host?: unknown; port?: unknown; path?: unknown };
          if (value.path) reject();
          check(value.host ?? '127.0.0.1', value.port);
        } else check(typeof args[1] === 'string' ? args[1] : '127.0.0.1', options);
        return Reflect.apply(connect, this, args);
      },
    );
    for (const key of [
      'lookup',
      'resolve',
      'resolve4',
      'resolve6',
      'resolveAny',
      'resolveCname',
      'resolveMx',
      'resolveNaptr',
      'resolveNs',
      'resolvePtr',
      'resolveSoa',
      'resolveSrv',
      'resolveTxt',
      'reverse',
    ])
      patch(dns, key, reject);
    patch(dns, 'Resolver', function () {
      return reject();
    });
    for (const key of [
      'lookup',
      'resolve',
      'resolve4',
      'resolve6',
      'resolveAny',
      'resolveCname',
      'resolveMx',
      'resolveNaptr',
      'resolveNs',
      'resolvePtr',
      'resolveSoa',
      'resolveSrv',
      'resolveTxt',
      'reverse',
    ])
      patch(dns.promises, key, reject);
    patch(dns.promises, 'Resolver', function () {
      return reject();
    });
    patch(dgram, 'createSocket', reject);
    for (const key of [
      'spawn',
      'spawnSync',
      'exec',
      'execSync',
      'execFile',
      'execFileSync',
      'fork',
    ])
      patch(child, key, reject);
    patch(workers, 'Worker', function () {
      return reject();
    });
    const fetch = globalThis.fetch;
    patch(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.protocol !== 'http:' && url.protocol !== 'https:') reject();
      check(
        url.hostname.replace(/^\[|\]$/g, ''),
        url.port || (url.protocol === 'https:' ? 443 : 80),
      );
      return fetch(input, { ...init, redirect: 'error' });
    });
    syncBuiltinESMExports();
  } catch {
    for (const undo of restore.reverse()) undo();
    syncBuiltinESMExports();
    throw new Error('DIAGNOSTIC_EGRESS_CONFIGURATION');
  }
  let closed = false;
  return {
    get denied() {
      return denied;
    },
    close() {
      if (closed) return;
      closed = true;
      for (const undo of restore.reverse()) undo();
      syncBuiltinESMExports();
    },
  };
}
