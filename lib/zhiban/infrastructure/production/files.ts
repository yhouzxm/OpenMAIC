/** Private deployment files. Never follow links or accept group/world-writable inputs. */
import { open, lstat, readFile, rename, mkdir, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, isAbsolute, dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
export const digest = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
export function check(v: unknown, message: string): asserts v {
  if (!v) throw Error(message);
}
export async function privateBytes(path: string, ownerUid = process.getuid?.()) {
  check(isAbsolute(path) && resolve(path) === path, 'Canonical absolute deployment file required');
  let dir = '/';
  for (const p of dirname(path).split('/').filter(Boolean)) {
    dir = join(dir, p);
    const s = await lstat(dir);
    check(s.isDirectory() && !s.isSymbolicLink(), 'Deployment path link rejected');
  }
  const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const a = await f.stat();
    check(
      a.isFile() &&
        a.nlink === 1 &&
        [0, ownerUid].includes(a.uid) &&
        !(a.mode & 0o027) &&
        a.size <= 16 * 1024 * 1024,
      'Private deployment file required',
    );
    const bytes = await f.readFile();
    const b = await f.stat();
    check(
      a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs,
      'Deployment input changed',
    );
    return bytes;
  } finally {
    await f.close();
  }
}
export async function privateJson<T = unknown>(
  path: string,
  ownerUid = process.getuid?.(),
): Promise<T> {
  return JSON.parse((await privateBytes(path, ownerUid)).toString());
}
export async function saveJson(path: string, value: unknown, exclusive = false) {
  const bytes = JSON.stringify(value, null, 2) + '\n',
    output = exclusive ? path : path + '.' + randomUUID();
  const file = await open(
    output,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(bytes);
    await file.sync();
  } catch (e) {
    await unlink(output).catch(() => {});
    throw e;
  } finally {
    await file.close();
  }
  if (!exclusive) await rename(output, path);
  const directory = await open(
    dirname(path),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
export async function privateDirectory(
  path: string,
  create = false,
  ownerUid = process.getuid?.(),
) {
  check(
    isAbsolute(path) && resolve(path) === path && path !== '/',
    'Absolute private directory required',
  );
  let parent = '/';
  for (const p of dirname(path).split('/').filter(Boolean)) {
    parent = join(parent, p);
    const st = await lstat(parent);
    check(st.isDirectory() && !st.isSymbolicLink(), 'Deployment directory path link rejected');
  }
  if (create) await mkdir(path, { mode: 0o700 });
  const s = await lstat(path);
  check(
    s.isDirectory() && !s.isSymbolicLink() && s.uid === ownerUid && !(s.mode & 0o077),
    'Private owned deployment directory required',
  );
}
export async function sourceClosure(hashes: Readonly<Record<string, string>>) {
  for (const [p, h] of Object.entries(hashes)) {
    check(
      !isAbsolute(p) &&
        resolve(p).startsWith(process.cwd() + '/') &&
        p.split('/').every((v) => v && v !== '.' && v !== '..') &&
        /^[a-f0-9]{64}$/.test(h),
      'Deployment source path rejected',
    );
    check(digest(await readFile(p)) === h, 'Deployment source drift: ' + p);
  }
}
