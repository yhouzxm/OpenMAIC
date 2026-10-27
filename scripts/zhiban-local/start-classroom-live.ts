/** Opt-in combined product entry. Normal startup does not run rendering or acceptance suites. */
import { spawn, type ChildProcess } from 'node:child_process';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function health() {
  try {
    const r = await fetch('http://127.0.0.1:9016/health', { signal: AbortSignal.timeout(1500) });
    if (!r.ok || r.headers.get('x-openmaic-render-owner-bound') !== '1')
      throw Error('Port 9016 is not a compatible private renderer');
    return true;
  } catch (e) {
    if (e instanceof TypeError) return false;
    throw e;
  }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => a !== '--upgrade-local')) throw Error('Only --upgrade-local is supported');
  let render: ChildProcess | undefined, host: ChildProcess | undefined;
  const exited = (c: ChildProcess) =>
    new Promise<number>((resolve) => c.once('exit', (code) => resolve(code ?? 1)));
  try {
    if (!(await health())) {
      render = spawn(
        process.execPath,
        ['--import', 'tsx', 'scripts/zhiban-local/start-render-service.ts'],
        { stdio: 'inherit' },
      );
      render.once('error', (e) => console.error(e.message));
      let ready = false;
      for (let i = 0; i < 60; i++) {
        if (render.exitCode !== null) throw Error('Renderer stopped before readiness');
        if (await health()) {
          ready = true;
          break;
        }
        await sleep(500);
      }
      if (!ready) throw Error('Renderer readiness timeout');
    }
    host = spawn(
      process.execPath,
      ['--import', 'tsx', 'scripts/zhiban-local/start-persistent.ts', ...args],
      { stdio: 'inherit', env: { ...process.env, RENDER_SERVICE_URL: 'http://127.0.0.1:9016' } },
    );
    const stop = () => host?.kill('SIGTERM');
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    render?.once('exit', () => host?.kill('SIGTERM'));
    process.exitCode = await exited(host);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  } finally {
    if (render && render.exitCode === null) {
      const done = exited(render);
      render.kill('SIGTERM');
      await done;
    }
  }
}
void main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
