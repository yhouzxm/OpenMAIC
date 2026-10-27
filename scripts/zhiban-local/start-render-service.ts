/** Private loopback renderer using the upstream service, Chromium and FFmpeg. */
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
async function main() {
  execFileSync('ffmpeg', ['-version'], { stdio: 'pipe' });
  let chrome = process.env.PRODUCER_HEADLESS_SHELL_PATH;
  const prepared = join(
    homedir(),
    '.local/share/zhiban-render/151.0.7922.138/chrome-headless-shell-linux64/chrome-headless-shell',
  );
  if (!chrome && (await lstat(prepared).catch(() => null))?.isFile()) chrome = prepared;
  if (!chrome) {
    const cache = join(homedir(), '.cache/ms-playwright');
    for (const name of (await readdir(cache))
      .filter((n) => /^chromium_headless_shell-\d+$/.test(n))
      .sort()
      .reverse()) {
      const candidate = join(cache, name, 'chrome-headless-shell-linux64/chrome-headless-shell');
      if (
        (await lstat(candidate).catch(() => null))?.isFile() &&
        /Chrome.*\s151\./.test(execFileSync(candidate, ['--version'], { encoding: 'utf8' }))
      ) {
        chrome = candidate;
        break;
      }
    }
  }
  if (!chrome) throw Error('Chromium headless shell required; set PRODUCER_HEADLESS_SHELL_PATH');
  if (!/Chrome.*\s151\./.test(execFileSync(chrome, ['--version'], { encoding: 'utf8' })))
    throw Error(
      'Renderer requires Chromium 151; run pnpm trial:zhiban:render:prepare or supply its headless shell',
    );
  const root = await mkdtemp(join(tmpdir(), 'zhiban-course-render-'));
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: join(process.cwd(), 'render-service'),
    detached: process.platform !== 'win32',
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: '9016',
      RENDER_BIND_HOST: '127.0.0.1',
      RENDER_RESOURCE_PROFILE: 'low-memory',
      RENDER_MAX_QUEUE: '4',
      RENDER_JOB_TTL_MS: '1800000',
      RENDER_JOB_DEADLINE_MS: '600000',
      PRODUCER_TMP_PROJECT_DIR: root,
      PRODUCER_HEADLESS_SHELL_PATH: chrome,
      PUPPETEER_EXECUTABLE_PATH: chrome,
      HF_STATIC_DEDUP: 'false',
    },
  });
  // The group contains only this owned renderer and its Chromium/FFmpeg children.
  const stop = () => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
      else child.kill('SIGTERM');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
    }
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  console.log(
    'LOCAL course renderer: http://127.0.0.1:9016; private temporary outputs; no public bind',
  );
  process.exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (c) => resolve(c ?? 1));
  });
}
void main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
