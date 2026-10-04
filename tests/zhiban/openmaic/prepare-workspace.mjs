// Run from repository root. Fresh artifacts and local checks live only in an exact disposable workspace.
import { mkdtemp, mkdir, cp, writeFile, readFile, rm, lstat } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join, basename, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';

const source = process.cwd();
const root = await mkdtemp(join(tmpdir(), 'zhiban-0b-'));
const workspace = join(root, 'workspace');
await mkdir(workspace);
const lockDigest = createHash('sha256')
  .update(await readFile(join(source, 'pnpm-lock.yaml')))
  .digest('hex');
const env = {};
for (const key of [
  'PATH',
  'Path',
  'SystemRoot',
  'SYSTEMROOT',
  'COMSPEC',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'HOME',
]) {
  if (process.env[key]) env[key] = process.env[key];
}
env.npm_config_userconfig = join(root, 'empty.npmrc');
env.npm_config_registry = 'https://registry.npmjs.org';
await writeFile(env.npm_config_userconfig, '');
async function run(program, args, cwd = workspace) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(program, args, {
      cwd,
      env,
      stdio: 'inherit',
      detached: process.platform !== 'win32',
    });
    const timer = setTimeout(() => {
      try {
        if (process.platform === 'win32')
          execFileSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
            stdio: 'ignore',
          });
        else process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* Child already exited. */
      }
    }, 300_000);
    child.once('error', () => {
      clearTimeout(timer);
      rejectRun(new Error('DIAGNOSTIC_SETUP_FAILED'));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) resolveRun();
      else rejectRun(new Error('DIAGNOSTIC_SETUP_FAILED'));
    });
  });
}
function pnpm(command) {
  const scoped = '--config.manage-package-manager-versions=false';
  if (process.platform === 'win32')
    return run('cmd.exe', ['/d', '/s', '/c', `pnpm ${scoped} ${command}`]);
  return run('pnpm', [scoped, ...command.split(' ')]);
}
// Read the existing package cache location without changing any Git/pnpm config.
const store =
  process.platform === 'win32'
    ? execFileSync('cmd.exe', ['/d', '/s', '/c', 'pnpm store path'], {
        cwd: source,
        encoding: 'utf8',
      }).trim()
    : execFileSync('pnpm', ['store', 'path'], { cwd: source, encoding: 'utf8' }).trim();
env.npm_config_store_dir = dirname(store);
try {
  const expectedPnpm = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    .packageManager.split('+')[0]
    .replace('pnpm@', '');
  const actualPnpm =
    process.platform === 'win32'
      ? execFileSync(
          'cmd.exe',
          ['/d', '/s', '/c', 'pnpm --config.manage-package-manager-versions=false --version'],
          { cwd: source, encoding: 'utf8' },
        ).trim()
      : execFileSync('pnpm', ['--config.manage-package-manager-versions=false', '--version'], {
          cwd: source,
          encoding: 'utf8',
        }).trim();
  if (actualPnpm !== expectedPnpm) throw new Error('DIAGNOSTIC_PNPM_VERSION_REJECTED');
  const archive = join(root, 'source.tar');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  execFileSync(
    'git',
    [
      'diff',
      '--exit-code',
      '1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce',
      head,
      '--',
      'packages/@openmaic',
    ],
    {
      cwd: source,
      stdio: 'ignore',
    },
  );
  execFileSync(
    'git',
    [
      'archive',
      '--format=tar',
      `--output=${archive}`,
      head,
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      'packages/@openmaic',
      'packages/mathml2omml',
      'packages/pptxgenjs',
    ],
    { cwd: source },
  );
  await run('tar', ['-xf', archive, '-C', workspace]);
  await cp(join(source, 'tests/zhiban/openmaic'), join(workspace, 'tests/zhiban/openmaic'), {
    recursive: true,
  });
  await pnpm('install --frozen-lockfile --ignore-scripts');
  await pnpm('--filter mathml2omml build');
  await pnpm('--filter pptxgenjs build');
  for (const name of ['dsl', 'generation', 'storage', 'importer', 'renderer', 'editor']) {
    await pnpm(`--filter @openmaic/${name} build`);
  }
  if (
    createHash('sha256')
      .update(await readFile(join(workspace, 'pnpm-lock.yaml')))
      .digest('hex') !== lockDigest
  ) {
    throw new Error('DIAGNOSTIC_LOCKFILE_DRIFT');
  }
  await writeFile(
    join(workspace, 'tests/zhiban/openmaic/artifact-provenance.json'),
    JSON.stringify({
      baseHead: head,
      officialTag: '1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce',
      lockDigest,
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      freshBuild: true,
    }),
  );
  process.stdout.write(`DIAGNOSTIC_WORKSPACE=${workspace}\n`);
  process.stdout.write(
    'Cleanup this exact new workspace after checks using the approved cleanup helper.\n',
  );
} catch {
  await cleanup(root);
  process.stderr.write('DIAGNOSTIC_FRESH_BUILD_FAILED\n');
  process.exitCode = 1;
}

async function cleanup(path) {
  const parent = resolve(tmpdir());
  const target = resolve(path);
  const rel = relative(parent, target);
  if (
    !rel ||
    rel.startsWith('..') ||
    isAbsolute(rel) ||
    !basename(target).startsWith('zhiban-0b-') ||
    (await lstat(target)).isSymbolicLink()
  )
    throw new Error('DIAGNOSTIC_CLEANUP_REJECTED');
  await rm(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}
