/** Private on-host lifecycle control. No public HTTP maintenance surface. */
import { createServer, request } from 'node:http';
import { readFile, rm, chmod, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { check, privateJson, saveJson } from './files';
export const fenceFile = 'MAINTENANCE.json';
export async function noMaintenance(state: string) {
  try {
    await lstat(join(state, fenceFile));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw e;
  }
  throw Error('INSTANCE_IN_MAINTENANCE');
}
export async function processIdentity(pid: number) {
  try {
    const s = await readFile(`/proc/${pid}/stat`, 'utf8');
    return s.slice(s.lastIndexOf(')') + 2).split(' ')[19];
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}
export interface HostStatus {
  kind: 'ZHIBAN_HOST_STATUS_V1';
  instanceId: string;
  pid: number;
  start: string;
  nonce: string;
  state: 'READY';
}
export async function hostControl(
  state: string,
  instanceId: string,
  stop: () => Promise<void>,
  healthy: () => Promise<boolean>,
) {
  const socket = join(state, 'control.sock');
  check(Buffer.byteLength(socket) < 100, 'HOST_SOCKET_PATH_TOO_LONG');
  try {
    await lstat(socket);
    throw Error('STALE_OR_LIVE_CONTROL_SOCKET_REQUIRES_INSPECTION');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const status: HostStatus = {
    kind: 'ZHIBAN_HOST_STATUS_V1',
    instanceId,
    pid: process.pid,
    start: (await processIdentity(process.pid))!,
    nonce: randomBytes(32).toString('hex'),
    state: 'READY',
  };
  let stopping = false;
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== 'Bearer ' + status.nonce) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url === '/ready') {
      res.writeHead(!stopping && (await healthy()) ? 200 : 503, {
        'Content-Type': 'application/json',
      });
      res.end(JSON.stringify({ state: stopping ? 'STOPPING' : 'READY', instanceId }));
      return;
    }
    if (req.method === 'POST' && req.url === '/stop' && !stopping) {
      stopping = true;
      try {
        await stop();
        res.writeHead(200);
        res.end();
      } catch {
        res.writeHead(503);
        res.end();
      }
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(socket, done);
  });
  await chmod(socket, 0o600);
  await saveJson(join(state, 'HOST.json'), status);
  return {
    status,
    close: async () => {
      server.closeIdleConnections();
      await new Promise<void>((done) => server.close(() => done()));
      await rm(join(state, 'HOST.json'), { force: true });
      await rm(socket, { force: true });
    },
  };
}
export async function hostRequest(
  state: string,
  operation: 'ready' | 'stop',
  ownerUid = process.getuid?.(),
  expectedInstanceId?: string,
) {
  const status = await privateJson<HostStatus>(join(state, 'HOST.json'), ownerUid);
  check(!expectedInstanceId || status.instanceId === expectedInstanceId, 'HOST_INSTANCE_REJECTED');
  check(
    status.kind === 'ZHIBAN_HOST_STATUS_V1' && status.start === (await processIdentity(status.pid)),
    'HOST_STATUS_STALE',
  );
  await new Promise<void>((done, reject) => {
    const q = request(
      {
        socketPath: join(state, 'control.sock'),
        path: operation === 'ready' ? '/ready' : '/stop',
        method: operation === 'ready' ? 'GET' : 'POST',
        headers: { authorization: 'Bearer ' + status.nonce },
      },
      (r) => {
        r.resume();
        r.once('end', () =>
          r.statusCode === 200 ? done() : reject(Error('HOST_CONTROL_REFUSED')),
        );
      },
    );
    q.setTimeout(operation === 'stop' ? 60000 : 5000, () =>
      q.destroy(Error('HOST_CONTROL_TIMEOUT')),
    );
    q.on('error', reject);
    q.end();
  });
  if (operation === 'stop') {
    const until = Date.now() + 60000;
    while ((await processIdentity(status.pid)) === status.start) {
      check(Date.now() < until, 'HOST_PROCESS_DID_NOT_EXIT');
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  return { status: 'READY', instanceId: status.instanceId };
}

/** Type=simple starts ExecStartPost before the host has published its socket. */
export async function waitHostReady(state: string, instanceId: string, timeoutMs = 120000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    await noMaintenance(state);
    try {
      return await hostRequest(state, 'ready', process.getuid?.(), instanceId);
    } catch (e) {
      const error = e as NodeJS.ErrnoException;
      if (
        Date.now() >= until ||
        !(
          ['ENOENT', 'ECONNREFUSED'].includes(error.code ?? '') ||
          error.message === 'HOST_CONTROL_REFUSED'
        )
      )
        throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}
