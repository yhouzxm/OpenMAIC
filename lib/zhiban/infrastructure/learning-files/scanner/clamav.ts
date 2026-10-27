/** Host-supplied, digest-pinned ClamAV profile. Never accepts a client command or shell. */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, open, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { spawn } from 'node:child_process';
import type { SubmissionFileClearance } from '../../../application/learning/attachment-assets';
export interface ClamAvProfile {
  version: 1;
  evidenceOrigin: 'LOCAL';
  binary: string;
  libraryPath: string;
  database: string;
  certificates: string;
  engineVersion: string;
  files: Record<string, string>;
}
export const clamAvArgs = (p: ClamAvProfile) => [
  `--database=${p.database}`,
  `--cvdcertsdir=${p.certificates}`,
  '--official-db-only=yes',
  '--fail-if-cvd-older-than=7',
  '--alert-encrypted=yes',
  '--alert-exceeds-max=yes',
  '--max-filesize=2M',
  '--max-scansize=16M',
  '--max-recursion=8',
  '--max-files=100',
  '-',
];
export async function fileHash(path: string) {
  const hash = createHash('sha256');
  for await (const part of createReadStream(path)) hash.update(part);
  return hash.digest('hex');
}
async function owned(path: string, directory = false) {
  const s = await lstat(path);
  if (
    s.isSymbolicLink() ||
    s.uid !== process.getuid?.() ||
    s.mode & 0o022 ||
    (directory ? !s.isDirectory() : !s.isFile())
  )
    throw Error('Scanner ownership rejected');
}
function run(p: ClamAvProfile, args: string[], input?: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(p.binary, args, {
      shell: false,
      env: {
        PATH: '/usr/bin:/bin',
        NODE_ENV: 'production',
        LANG: 'C',
        LD_LIBRARY_PATH: p.libraryPath,
        CVD_CERTS_DIR: p.certificates,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 60000);
    let out = '',
      err = '',
      exceeded = false;
    child.stdout.on('data', (data: Buffer) => {
      out += data.toString();
      if (out.length > 65536) {
        exceeded = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (data: Buffer) => {
      err += data.toString();
      if (err.length > 65536) {
        exceeded = true;
        child.kill('SIGKILL');
      }
    });
    child.on('error', reject);
    child.stdin.on('error', () => {});
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || exceeded || err.trim()) reject(Error('ClamAV did not clear file'));
      else resolve(out);
    });
    child.stdin.end(input);
  });
}
export async function loadClamAv(
  path: string,
  expectedHash: string,
): Promise<SubmissionFileClearance> {
  if (!isAbsolute(path) || !/^[a-f0-9]{64}$/.test(expectedHash))
    throw Error('Scanner profile pin required');
  await owned(path);
  const raw = await readFile(path);
  if (createHash('sha256').update(raw).digest('hex') !== expectedHash)
    throw Error('Scanner profile hash rejected');
  const p = JSON.parse(raw.toString()) as ClamAvProfile;
  if (
    p.version !== 1 ||
    p.evidenceOrigin !== 'LOCAL' ||
    !/^ClamAV 1\./.test(p.engineVersion) ||
    !p.files ||
    Object.keys(p).sort().join(',') !==
      'binary,certificates,database,engineVersion,evidenceOrigin,files,libraryPath,version'
  )
    throw Error('Scanner profile rejected');
  for (const dir of [p.libraryPath, p.database, p.certificates]) {
    if (!isAbsolute(dir)) throw Error('Scanner path rejected');
    await owned(dir, true);
  }
  const verify = async () => {
    const db = (await readdir(p.database)).sort();
    if (
      !['main', 'daily', 'bytecode'].every(
        (f) => db.filter((n) => n === f + '.cvd' || n === f + '.cld').length === 1,
      ) ||
      db.some((f) => !/^(main|daily|bytecode)(-[0-9]+)?\.(cvd|cld)(\.sign)?$/.test(f))
    )
      throw Error('Scanner database closure rejected');
    const handle = await open(
      join(p.database, db.includes('daily.cvd') ? 'daily.cvd' : 'daily.cld'),
      'r',
    );
    const header = Buffer.alloc(512);
    try {
      await handle.read(header, 0, 512, 0);
    } finally {
      await handle.close();
    }
    const stamp = Number(header.toString().trim().split(':').at(-1)) * 1000;
    if (
      !Number.isFinite(stamp) ||
      stamp > Date.now() + 3600000 ||
      Date.now() - stamp > 7 * 86400000
    )
      throw Error('Scanner database stale');
    // Pin the actual dynamic-link targets, including symlink retargeting and added plugins.
    for (const name of await readdir(p.libraryPath)) {
      const target = await realpath(join(p.libraryPath, name));
      if (!p.files[target]) throw Error('Scanner library closure rejected');
    }
    const required = [
      p.binary,
      ...db.map((f) => join(p.database, f)),
      ...(await readdir(p.certificates)).map((f) => join(p.certificates, f)),
    ];
    if (required.some((f) => !p.files[f])) throw Error('Scanner manifest incomplete');
    for (const [file, hash] of Object.entries(p.files)) {
      if (!isAbsolute(file) || !/^[a-f0-9]{64}$/.test(hash))
        throw Error('Scanner manifest rejected');
      // System dynamic libraries are root owned; all pinned files must be non-writable by other users.
      const s = await lstat(file);
      if (
        !s.isFile() ||
        s.isSymbolicLink() ||
        s.mode & 0o022 ||
        ![0, process.getuid?.()].includes(s.uid) ||
        (await fileHash(file)) !== hash
      )
        throw Error('Scanner file pin rejected');
    }
  };
  await verify();
  if ((await run(p, ['--version'])).trim().split('/')[0] !== p.engineVersion)
    throw Error('Scanner version rejected');
  // Require a real loaded database and one completed clean scan before enabling the capability.
  const selftest = await run(p, clamAvArgs(p), Buffer.from('Zhiban ClamAV startup check\n'));
  if (!/Scanned files:\s+[1-9][0-9]*\b/.test(selftest) || !/Infected files:\s+0\b/.test(selftest))
    throw Error('Scanner selftest rejected');
  let busy = false;
  const cache = new Map<string, { reference: string; time: number }>();
  const checked = async (
    file: Parameters<SubmissionFileClearance['check']>[0],
    archive = false,
  ): ReturnType<SubmissionFileClearance['check']> => {
    if (busy) return null; // bounded CPU/memory; caller can retry without a partial submission
    busy = true;
    try {
      await verify();
      const bytes = Buffer.from(file.base64, 'base64');
      const digest = createHash('sha256').update(bytes).digest('hex');
      const cacheKey = (archive ? 'archive:' : '') + digest;
      const prior = cache.get(cacheKey);
      if (prior && Date.now() - prior.time < 300000)
        return { mode: 'TRUSTED_SCANNER', digest, reference: prior.reference };
      const args = archive
        ? clamAvArgs(p).map((a) =>
            a === '--max-filesize=2M'
              ? '--max-filesize=64M'
              : a === '--max-scansize=16M'
                ? '--max-scansize=256M'
                : a === '--max-files=100'
                  ? '--max-files=512'
                  : a,
          )
        : clamAvArgs(p);
      const output = await run(p, args, bytes);
      if (!/Scanned files:\s+[1-9][0-9]*\b/.test(output) || !/Infected files:\s+0\b/.test(output))
        return null;
      await verify();
      const time = Date.now();
      const reference = archive
        ? `clamav-archive-sha256:${expectedHash}:${createHash('sha256').update(JSON.stringify(args)).digest('hex')}:${digest}:${time}`
        : `clamav-sha256:${expectedHash}:${digest}:${time}`;
      if (cache.size >= 64) cache.delete(cache.keys().next().value!);
      cache.set(cacheKey, { reference, time });
      return { mode: 'TRUSTED_SCANNER', digest, reference };
    } catch {
      return null;
    } finally {
      busy = false;
    }
  };
  return {
    mode: 'TRUSTED_SCANNER',
    check: (file) => checked(file),
    checkArchive: (file) => checked(file, true),
  };
}
