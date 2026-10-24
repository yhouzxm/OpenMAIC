/** Hermetic controller checks: all file/process access is mocked; no live PID is signalled. */
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import packageJson from '../../../package.json';

const fs = vi.hoisted(() => ({ readFile: vi.fn(), lstat: vi.fn() }));
vi.mock('node:fs/promises', () => fs);
const originalArgv = process.argv;
const originalExitCode = process.exitCode;
const pid = 432100;
const bundle = resolve('.zhiban-catalog-run-fixture/verify.mjs');
const body = 'fixture build';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
let files: Map<string, string>;
let metadata: ReturnType<typeof fixture>;
let log: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;
let kill: ReturnType<typeof vi.spyOn>;

function fixture(content: boolean) {
  const root = join(tmpdir(), content ? 'zhiban-trial-content-fixture' : 'zhiban-trial-fixture');
  return {
    evidenceOrigin: 'LOCAL',
    githubActions: false,
    origin: `https://127.0.0.1:${content ? 3461 : 3459}`,
    port: content ? 56517 : 56515,
    database: content ? 'zhiban_trial_content_disposable' : 'zhiban_trial_disposable',
    pid,
    processStart: '123',
    root,
    accountsPath: join(root, 'accounts.json'),
    baselineHead: 'fixture',
    sourceHashes: { [bundle]: digest(body) },
    trial: { urls: { workspace: `https://127.0.0.1:${content ? 3461 : 3459}/zhiban` } },
  };
}
function seed(content: boolean) {
  metadata = fixture(content);
  files.set(
    resolve(`docs/v2/evidence/zhiban-trial${content ? '-content' : ''}-demo-local.json`),
    JSON.stringify(metadata),
  );
  files.set(
    `/proc/${pid}/cmdline`,
    ['node', bundle, '--serve', content ? '--trial-content' : '--trial'].join('\0'),
  );
  files.set(`/proc/${pid}/stat`, `${pid} (fixture) ` + [...Array(19).fill('0'), '123'].join(' '));
  files.set(bundle, body);
  files.set(
    metadata.accountsPath,
    JSON.stringify({
      accounts: [
        { label: 'fixture', role: 'STUDENT', userId: 'fixture', password: 'NEVER_PRINT_PASSWORD' },
      ],
    }),
  );
}
function updateMetadata(content: boolean) {
  files.set(
    resolve(`docs/v2/evidence/zhiban-trial${content ? '-content' : ''}-demo-local.json`),
    JSON.stringify(metadata),
  );
}
async function run(args: string[]) {
  process.argv = ['node', resolve('scripts/zhiban-local/trial-control.ts'), ...args];
  await import('../../../scripts/zhiban-local/trial-control');
  await vi.waitFor(() =>
    expect(log.mock.calls.length + error.mock.calls.length).toBeGreaterThan(0),
  );
}
beforeEach(() => {
  vi.resetModules();
  process.exitCode = undefined;
  files = new Map();
  fs.readFile.mockReset().mockImplementation(async (path: string) => {
    if (!files.has(path)) throw Object.assign(new Error('fixture missing'), { code: 'ENOENT' });
    return files.get(path);
  });
  fs.lstat.mockReset().mockImplementation(async (path: string) => ({
    uid: process.getuid?.(),
    mode: path === metadata.root ? 0o700 : 0o600,
    isSymbolicLink: () => false,
    isDirectory: () => path === metadata.root,
    isFile: () => path === metadata.accountsPath,
  }));
  log = vi.spyOn(console, 'log').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  kill = vi.spyOn(process, 'kill').mockImplementation(() => true);
});
afterEach(() => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
});
it('maps the product default to unified teaching and retains directed content/legacy commands', () => {
  const s = packageJson.scripts;
  expect(s['trial:zhiban']).toBe(
    'tsx scripts/zhiban-local/run-m6-catalog.ts --unified-trial --serve',
  );
  expect(s['trial:zhiban:info']).toBe(
    'tsx scripts/zhiban-local/trial-control.ts info --unified-trial',
  );
  expect(s['trial:zhiban:stop']).toBe(
    'tsx scripts/zhiban-local/trial-control.ts stop --unified-trial',
  );
  expect(s['verify:zhiban:trial']).toBe(
    'tsx scripts/zhiban-local/run-m6-catalog.ts --unified-trial',
  );
  expect(s['trial:zhiban:legacy']).toBe(
    'tsx scripts/zhiban-local/run-m6-catalog.ts --trial --serve',
  );
  expect(s['trial:zhiban:legacy:info']).toBe(
    'tsx scripts/zhiban-local/trial-control.ts info --legacy',
  );
  expect(s['trial:zhiban:legacy:stop']).toBe(
    'tsx scripts/zhiban-local/trial-control.ts stop --legacy',
  );
  expect(s['verify:zhiban:trial:legacy']).toBe(
    'tsx scripts/zhiban-local/run-m6-catalog.ts --trial',
  );
});
it.each<string[]>([['--content'], ['--legacy'], []])(
  'selects only its bound info target for flags %j',
  async (...flags) => {
    const content = flags.includes('--content');
    seed(content);
    await run(['info', ...flags]);
    const result = JSON.parse(String(log.mock.calls[0][0]));
    expect(result.urls.workspace).toContain(content ? ':3461/' : ':3459/');
    expect(result.stop).toBe(`pnpm trial:zhiban:${content ? 'content' : 'legacy'}:stop`);
    expect(JSON.stringify(result)).not.toContain('NEVER_PRINT_PASSWORD');
    expect(error).not.toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  },
);
it.each([
  [],
  ['start'],
  ['info', '--unknown'],
  ['stop', '--unknown'],
  ['stop', '--content', '--legacy'],
  ['stop', '--legacy', '--content'],
  ['stop', '--content', '--content'],
  ['stop', '--legacy', '--legacy'],
  ['--content', 'stop'],
  ['info', '--legacy', 'extra'],
])('rejects malformed arguments %j before any file access or signal', async (...args) => {
  await run(args);
  expect(error).toHaveBeenCalledWith(expect.stringContaining('Use trial:zhiban:content:info'));
  expect(process.exitCode).toBe(1);
  expect(fs.readFile).not.toHaveBeenCalled();
  expect(fs.lstat).not.toHaveBeenCalled();
  expect(kill).not.toHaveBeenCalled();
});
it('legacy stopped-process help never recommends the new default start', async () => {
  seed(false);
  files.delete(`/proc/${pid}/cmdline`);
  await run(['info', '--legacy']);
  expect(log).toHaveBeenCalledWith(expect.stringContaining('pnpm trial:zhiban:legacy.'));
  expect(kill).not.toHaveBeenCalled();
});
it.each(['origin', 'port', 'database'] as const)(
  'rejects cross-target %s before signalling',
  async (field) => {
    seed(true);
    Object.assign(metadata, { [field]: fixture(false)[field] });
    updateMetadata(true);
    await run(['stop', '--content']);
    expect(error).toHaveBeenCalledWith('Trial endpoint identity rejected.');
    expect(kill).not.toHaveBeenCalled();
  },
);
it.each(['start', 'argv', 'build', 'permissions'])(
  'rejects invalid %s binding without signalling',
  async (fault) => {
    seed(true);
    if (fault === 'start') {
      metadata.processStart = '999';
      updateMetadata(true);
    }
    if (fault === 'argv')
      files.set(`/proc/${pid}/cmdline`, ['node', bundle, '--serve', '--trial'].join('\0'));
    if (fault === 'build') files.set(bundle, body + 'tampered');
    if (fault === 'permissions')
      fs.lstat.mockImplementation(async () => ({ isSymbolicLink: () => true }));
    await run(['stop', '--content']);
    expect(error).toHaveBeenCalled();
    expect(kill).not.toHaveBeenCalled();
  },
);
it.each([true, false])(
  'valid fixture stop targets only its recorded PID, content=%s (mock signals)',
  async (content) => {
    seed(content);
    kill.mockImplementation((_pid: number, signal?: string | number) => {
      if (signal === 0) throw Object.assign(new Error('fixture exited'), { code: 'ESRCH' });
      return true;
    });
    await run(['stop', content ? '--content' : '--legacy']);
    expect(kill.mock.calls).toEqual([
      [pid, 'SIGTERM'],
      [pid, 0],
    ]);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining(
        content
          ? 'zhiban-trial-content-demo-close-local.json'
          : 'zhiban-trial-demo-close-local.json',
      ),
    );
    expect(error).not.toHaveBeenCalled();
  },
);

it('unified info binds the canonical content target without exposing passwords or signalling', async () => {
  seed(true);
  files.set(`/proc/${pid}/cmdline`, ['node', bundle, '--serve', '--unified-trial'].join('\0'));
  await run(['info', '--unified-trial']);
  const output = log.mock.calls.map((c: unknown[]) => c[0]).join('');
  expect(output).toContain('RUNNING_LOCAL_DISPOSABLE');
  expect(output).toContain('pnpm trial:zhiban:stop');
  expect(output).not.toContain('NEVER_PRINT_PASSWORD');
  expect(error).not.toHaveBeenCalled();
  expect(kill).not.toHaveBeenCalled();
});
it('unified stop refuses a historical content process before signalling', async () => {
  seed(true);
  await run(['stop', '--unified-trial']);
  expect(error).toHaveBeenCalledWith('Refused: PID is not the recorded trial process.');
  expect(kill).not.toHaveBeenCalled();
});
