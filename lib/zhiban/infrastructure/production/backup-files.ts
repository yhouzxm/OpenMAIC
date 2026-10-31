/** Private regular-file closure; no links, devices, sparse extraction, or implicit merge. */
import { lstat, readdir, mkdir, copyFile, open, chmod, chown } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, isAbsolute, dirname } from 'node:path';
import { check } from './files';
export type FileFacts = Record<string, { sha256: string; bytes: number }>;
export function relativeFile(p: string) {
  check(
    !isAbsolute(p) &&
      p.split('/').every((x) => x && x !== '.' && x !== '..') &&
      !p.includes('\\') &&
      !p.includes('\0'),
    'BACKUP_RELATIVE_PATH_REJECTED',
  );
  return p;
}
export async function fileFact(p: string) {
  const before = await lstat(p);
  check(
    before.isFile() && !before.isSymbolicLink() && before.nlink === 1,
    'BACKUP_REGULAR_FILE_REQUIRED',
  );
  const h = createHash('sha256');
  for await (const b of createReadStream(p)) h.update(b);
  const after = await lstat(p);
  check(
    before.ino === after.ino && before.size === after.size && before.mtimeMs === after.mtimeMs,
    'BACKUP_FILE_CHANGED',
  );
  return { sha256: h.digest('hex'), bytes: after.size };
}
export async function fileTree(root: string, skip = new Set<string>()): Promise<FileFacts> {
  const out: FileFacts = {};
  async function walk(folder: string, prefix: string) {
    const d = await lstat(folder);
    check(d.isDirectory() && !d.isSymbolicLink(), 'BACKUP_DIRECTORY_REQUIRED');
    for (const n of (await readdir(folder)).sort()) {
      const rel = prefix + n;
      if (skip.has(rel)) continue;
      relativeFile(rel);
      const p = join(folder, n),
        s = await lstat(p);
      if (s.isDirectory()) await walk(p, rel + '/');
      else {
        check(Object.keys(out).length < 100000, 'BACKUP_FILE_CAPACITY');
        out[rel] = await fileFact(p);
      }
    }
  }
  await walk(root, '');
  return out;
}
export async function copyTree(source: string, target: string) {
  await mkdir(target, { mode: 0o700 });
  const before = await fileTree(source);
  for (const [rel, f] of Object.entries(before)) {
    const to = join(target, relativeFile(rel));
    await mkdir(dirname(to), { recursive: true, mode: 0o700 });
    await copyFile(join(source, rel), to);
    await chmod(to, 0o600);
    check(JSON.stringify(await fileFact(to)) === JSON.stringify(f), 'BACKUP_COPY_HASH_REJECTED');
  }
  check(
    JSON.stringify(await fileTree(source)) === JSON.stringify(before),
    'BACKUP_SOURCE_TREE_CHANGED',
  );
  return before;
}
export async function verifyTree(root: string, expected: FileFacts, skip = new Set<string>()) {
  check(
    JSON.stringify(await fileTree(root, skip)) === JSON.stringify(expected),
    'BACKUP_FILE_CLOSURE_REJECTED',
  );
}
export async function ownTree(root: string, uid: number, gid: number) {
  const s = await lstat(root);
  check(!s.isSymbolicLink(), 'HANDOFF_LINK_REJECTED');
  if (s.isDirectory()) {
    for (const n of await readdir(root)) await ownTree(join(root, n), uid, gid);
    await chmod(root, 0o700);
  } else {
    check(s.isFile() && s.nlink === 1, 'HANDOFF_REGULAR_FILE_REQUIRED');
    await chmod(root, 0o600);
  }
  if (s.uid !== uid || s.gid !== gid) await chown(root, uid, gid);
}
export async function durableFile(path: string) {
  const f = await open(path, 'r');
  try {
    await f.sync();
  } finally {
    await f.close();
  }
}
