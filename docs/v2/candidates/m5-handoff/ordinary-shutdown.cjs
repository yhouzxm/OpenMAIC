// Bound local teardown. Do not equate local socket close with remote backend drain.
const SHUTDOWN_MS = 5000,
  TERM_MS = 1500,
  PG_GRACE_MS = 750;
function bounded(promise, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), Math.max(1, ms));
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(timer);
        resolve(v !== false);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}
async function childExit(child, deadline) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  if (!Number.isInteger(child.pid)) return true; // spawn failure created no OS process.
  let confirm;
  const exited = new Promise((resolve) => {
    confirm = () => resolve(true);
    child.once('exit', confirm);
    child.once('close', confirm);
  });
  try {
    if (child.connected) child.send({ type: 'STOP' }, () => {});
    child.kill('SIGTERM');
    if (await bounded(exited, Math.min(TERM_MS, deadline - Date.now()))) return true;
    child.kill('SIGKILL');
    return await bounded(exited, Math.max(1, deadline - Date.now() - 1000));
  } catch {
    return child.exitCode !== null || child.signalCode !== null;
  } finally {
    child.off('exit', confirm);
    child.off('close', confirm);
  }
}
async function pgClose(client, deadline) {
  const socket = client.connection?.stream;
  let observe;
  const closed = new Promise((resolve) => {
    if (!socket || socket.closed || client._ended) return resolve(true);
    observe = () => resolve(true);
    socket.once('close', observe);
  });
  let ended;
  try {
    ended = Promise.resolve(client.end());
  } catch {
    ended = Promise.resolve(false);
  }
  ended.catch(() => {});
  try {
    if (await bounded(closed, Math.min(PG_GRACE_MS, Math.max(1, deadline - Date.now()))))
      return { closed: true, forced: false };
    // Waiting on end() alone does not close an idle half-open TCP connection.
    if (socket && !socket.destroyed) socket.destroy();
    const confirmed = await bounded(closed, Math.max(1, deadline - Date.now()));
    return { closed: confirmed, forced: true };
  } catch {
    return { closed: false, forced: true };
  } finally {
    if (observe) socket.off('close', observe);
  }
}
async function close(child, clients) {
  const started = Date.now(),
    deadline = started + SHUTDOWN_MS,
    childExitConfirmed = await childExit(child, deadline);
  const results = await Promise.all(clients.map((c) => pgClose(c, deadline)));
  return {
    childExitConfirmed,
    localPgClosed: results.every((x) => x.closed),
    forcedPgConnections: results.filter((x) => x.forced).length,
    elapsedMs: Date.now() - started,
    remoteBackendDrainConfirmed: false,
  };
}
module.exports = { close };
