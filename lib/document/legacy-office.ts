/** LOCAL legacy Office conversion. The cloud parser still receives only its supported OOXML. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

export const LEGACY_OFFICE = {
  'application/msword': {
    from: 'doc',
    to: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    filter: 'Office Open XML Text',
  },
  'application/vnd.ms-powerpoint': {
    from: 'ppt',
    to: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    filter: 'Impress MS PowerPoint 2007 XML',
  },
  'application/vnd.ms-excel': {
    from: 'xls',
    to: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    filter: 'Calc MS Excel 2007 XML',
  },
} as const;
export type LegacyOfficeReceipt = {
  kind: 'LOCAL_LEGACY_OFFICE_TO_OOXML';
  sourceSha256: string;
  outputSha256: string;
  sourceMime: string;
  outputMime: string;
  sourceBytes: number;
  outputBytes: number;
  converterVersion: string;
  converterBinarySha256: string;
  networkIsolated: true;
  outputScanned: true;
  sourceScanned: true;
  originalPreserved: true;
};
let scanner: ((bytes: Buffer, mime: string) => Promise<void>) | undefined;
export function configureLegacyOfficeScanner(scan: NonNullable<typeof scanner>) {
  scanner = scan;
}
export const legacyOfficeType = (mime: string) => LEGACY_OFFICE[mime as keyof typeof LEGACY_OFFICE];
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const env: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  PATH: '/usr/bin:/bin',
  HOME: '/home/worker',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
};

async function command(file: string, args: string[], signal?: AbortSignal, timeout = 90000) {
  signal?.throwIfAborted();
  return new Promise<string>((resolve, reject) => {
    const child = spawn(file, args, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '',
      failed: Error | undefined;
    const stop = (error: Error) => {
      failed ??= error;
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {}
    };
    const timer = setTimeout(() => stop(new Error('OFFICE_CONVERSION_TIMEOUT')), timeout);
    const abort = () => stop(new Error('OFFICE_CONVERSION_CANCELLED'));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    for (const stream of [child.stdout, child.stderr])
      stream.on('data', (chunk: Buffer) => {
        if (output.length + chunk.length > 65536) stop(new Error('OFFICE_CONVERSION_LOG_LIMIT'));
        else output += chunk.toString();
      });
    child.on('error', () => {
      failed ??= new Error('OFFICE_CONVERTER_UNAVAILABLE');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (failed || code !== 0) reject(failed ?? new Error('OFFICE_CONVERSION_FAILED'));
      else resolve(output.trim());
    });
  });
}
async function installation() {
  const path = await realpath(process.env.ZHIBAN_OFFICE_CONVERTER_PATH || '/usr/bin/libreoffice');
  if (dirname(path).split('/').at(-1) !== 'program') throw Error('OFFICE_CONVERTER_PATH_INVALID');
  await Promise.all([
    access(path, constants.X_OK),
    access('/usr/bin/bwrap', constants.X_OK),
    access('/usr/bin/prlimit', constants.X_OK),
  ]);
  const systemRoot = process.env.ZHIBAN_OFFICE_CONVERTER_ROOT;
  if (systemRoot && dirname(dirname(path)) !== join(systemRoot, 'usr/lib/libreoffice'))
    throw Error('OFFICE_CONVERTER_ROOT_INVALID');
  const registry = join(systemRoot || '/', 'etc/libreoffice');
  return {
    systemRoot,
    registry: await access(registry).then(
      () => registry,
      () => undefined,
    ),
    root: dirname(dirname(path)),
    binaryHash: hash(await readFile(join(dirname(path), 'soffice.bin'))),
  };
}
function sandbox(root: string, systemRoot?: string, registry?: string) {
  return [
    '--unshare-all',
    '--die-with-parent',
    '--new-session',
    '--cap-drop',
    'ALL',
    '--ro-bind',
    systemRoot ? join(systemRoot, 'usr') : '/usr',
    '/usr',
    ...(systemRoot ? ['--ro-bind', '/usr', '/host/usr'] : []),
    ...(registry ? ['--ro-bind', registry, '/etc/libreoffice'] : []),
    '--symlink',
    'usr/bin',
    '/bin',
    '--symlink',
    'usr/lib',
    '/lib',
    '--symlink',
    'usr/lib64',
    '/lib64',
    '--ro-bind',
    '/etc/fonts',
    '/etc/fonts',
    '--ro-bind',
    root,
    '/opt/office',
    '--proc',
    '/proc',
    '--dev',
    '/dev',
    '--tmpfs',
    '/tmp',
    '--dir',
    '/home/worker',
  ];
}
let cached:
  | {
      path: string;
      value: Promise<{
        root: string;
        systemRoot?: string;
        registry?: string;
        binaryHash: string;
        version: string;
      } | null>;
    }
  | undefined;
async function ready() {
  const path =
    (process.env.ZHIBAN_OFFICE_CONVERTER_PATH || '/usr/bin/libreoffice') +
    ':' +
    (process.env.ZHIBAN_OFFICE_CONVERTER_ROOT || '');
  if (!cached || cached.path !== path)
    cached = {
      path,
      value: (async () => {
        try {
          const i = await installation();
          const version = await command(
            '/usr/bin/bwrap',
            [
              ...sandbox(i.root, i.systemRoot, i.registry),
              '/opt/office/program/soffice',
              '--headless',
              '--version',
            ],
            undefined,
            10000,
          );
          return { ...i, version };
        } catch {
          return null;
        }
      })(),
    };
  return cached.value;
}
export async function legacyOfficeIdentity() {
  const i = await ready();
  return i ? hash(Buffer.from(i.version + ':' + i.binaryHash)) : 'unavailable';
}
export async function legacyOfficeAvailable() {
  return !!scanner && !!(await ready());
}
export async function convertLegacyOffice(
  source: { buffer: Buffer; mimeType: string; fileName?: string },
  signal?: AbortSignal,
) {
  const format = legacyOfficeType(source.mimeType);
  if (
    !format ||
    source.buffer.length === 0 ||
    source.buffer.length > 1048576 ||
    source.buffer.subarray(0, 8).toString('hex') !== 'd0cf11e0a1b11ae1'
  )
    throw Error('INVALID_LEGACY_OFFICE');
  const i = await ready(),
    scan = scanner;
  if (!i || !scan) throw Error('OFFICE_CONVERTER_UNAVAILABLE');
  await scan(source.buffer, source.mimeType);
  signal?.throwIfAborted();
  const root = await mkdtemp(join(tmpdir(), 'zhiban-office-'));
  try {
    await Promise.all(
      ['input', 'output', 'profile/user'].map((dir) =>
        mkdir(join(root, dir), { recursive: true, mode: 0o700 }),
      ),
    );
    await writeFile(join(root, 'input', 'source.' + format.from), source.buffer, { mode: 0o600 });
    await writeFile(
      join(root, 'profile/user/registrymodifications.xcu'),
      '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>',
      { mode: 0o600 },
    );
    await command(
      '/usr/bin/prlimit',
      [
        '--as=3221225472',
        '--cpu=60',
        '--fsize=33554432',
        '--nofile=128',
        '--',
        '/usr/bin/bwrap',
        ...sandbox(i.root, i.systemRoot, i.registry),
        '--ro-bind',
        join(root, 'input'),
        '/input',
        '--bind',
        join(root, 'output'),
        '/output',
        '--bind',
        join(root, 'profile'),
        '/profile',
        '/opt/office/program/soffice',
        '-env:UserInstallation=file:///profile',
        '--headless',
        '--nologo',
        '--nodefault',
        '--nolockcheck',
        '--norestore',
        '--convert-to',
        format.to + ':' + format.filter,
        '--outdir',
        '/output',
        '/input/source.' + format.from,
      ],
      signal,
    );
    signal?.throwIfAborted();
    const path = join(root, 'output', 'source.' + format.to),
      stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0 || stat.size > 16 * 1024 * 1024)
      throw Error('OFFICE_CONVERSION_OUTPUT_INVALID');
    const buffer = await readFile(path);
    if (buffer.subarray(0, 4).toString('hex') !== '504b0304')
      throw Error('OFFICE_CONVERSION_OUTPUT_INVALID');
    await scan(buffer, format.mime);
    signal?.throwIfAborted();
    const receipt: LegacyOfficeReceipt = {
      kind: 'LOCAL_LEGACY_OFFICE_TO_OOXML',
      sourceSha256: hash(source.buffer),
      outputSha256: hash(buffer),
      sourceMime: source.mimeType,
      outputMime: format.mime,
      sourceBytes: source.buffer.length,
      outputBytes: buffer.length,
      converterVersion: i.version,
      converterBinarySha256: i.binaryHash,
      networkIsolated: true,
      outputScanned: true,
      sourceScanned: true,
      originalPreserved: true,
    };
    return {
      buffer,
      fileName: 'converted.' + format.to,
      fileSize: buffer.length,
      mimeType: format.mime,
      receipt,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
