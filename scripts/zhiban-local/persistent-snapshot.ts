import {
  localPgMajor,
  localPgBin,
  pg18Origin,
  executionEvidence,
  validInstallationEvidence,
} from './pg-version';
/** Owner-only LOCAL snapshots. A physical PG16 backup keeps all three databases at one WAL point. */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

const bin = localPgBin;
// A portable LOCAL instance owns its snapshot namespace; never redirect HOME.
const stateHome = process.env.ZHIBAN_LOCAL_STATE;
if (stateHome && (resolve(stateHome) !== stateHome || stateHome === '/'))
  throw Error('Absolute isolated LOCAL state path required');
export const snapshotHome = stateHome
  ? join(stateHome, 'snapshots')
  : join(
      homedir(),
      localPgMajor === 18
        ? '.local/share/zhiban-pg18-persistent'
        : '.local/share/zhiban-persistent',
    );
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
export async function privateEntry(path: string, directory = false) {
  const s = await lstat(path);
  if (
    s.isSymbolicLink() ||
    s.uid !== process.getuid?.() ||
    s.mode & 0o077 ||
    (directory ? !s.isDirectory() : !s.isFile())
  )
    throw Error('Private owned path required');
}
export function localRoot(root: string) {
  if (!/^\/tmp\/zhiban-trial-content-[a-zA-Z0-9]+$/.test(root))
    throw Error('Owned LOCAL target required');
}
async function treeHashes(root: string, base = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const e of await readdir(join(root, base), { withFileTypes: true })) {
    const rel = join(base, e.name);
    if (e.isSymbolicLink() || (!e.isFile() && !e.isDirectory()))
      throw Error('Snapshot links/devices rejected');
    if (e.isDirectory()) Object.assign(out, await treeHashes(root, rel));
    else out[rel] = hash(await readFile(join(root, rel)));
  }
  return out;
}
async function saveSnapshotUnlocked(root: string, live: boolean, metadata: unknown) {
  localRoot(root);
  await privateEntry(root, true);
  if ((await readFile(join(root, 'data/PG_VERSION'), 'utf8')).trim() !== String(localPgMajor))
    throw Error('Selected PG' + localPgMajor + ' required');
  await mkdir(snapshotHome, { recursive: true, mode: 0o700 });
  await privateEntry(snapshotHome, true);
  const id = new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID().slice(0, 8);
  const pending = join(snapshotHome, '.pending-' + id),
    final = join(snapshotHome, id);
  await mkdir(pending, { mode: 0o700 });
  try {
    const files = join(pending, 'root');
    await mkdir(files, { mode: 0o700 });
    if (live) {
      const actual = execFileSync(
        join(bin, 'psql'),
        [
          '-XAt',
          '-h',
          join(root, 'socket'),
          '-p',
          '56517',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '-c',
          "SELECT current_setting('data_directory') || '|' || current_setting('listen_addresses') || '|' || current_setting('server_version_num')",
        ],
        { encoding: 'utf8' },
      ).trim();
      if (!new RegExp('^' + root + '/data\\|\\|' + localPgMajor + '[0-9]{4}$').test(actual))
        throw Error('Snapshot target mismatch');
      execFileSync(
        join(bin, 'pg_basebackup'),
        [
          '-h',
          join(root, 'socket'),
          '-p',
          '56517',
          '-U',
          'postgres',
          '-D',
          join(files, 'data'),
          '-X',
          'stream',
          '-c',
          'fast',
        ],
        { stdio: 'pipe', timeout: 120000 },
      );
      execFileSync(join(bin, 'pg_verifybackup'), [join(files, 'data')], { stdio: 'pipe' });
    } else {
      if (await lstat(join(root, 'data/postmaster.pid')).catch(() => null))
        throw Error('Offline snapshot requires stopped PG');
      await cp(join(root, 'data'), join(files, 'data'), {
        recursive: true,
        errorOnExist: true,
        force: false,
        dereference: false,
      });
    }
    for (const e of await readdir(root, { withFileTypes: true })) {
      if (['data', 'socket', 'postgres.log'].includes(e.name)) continue;
      if (e.isSymbolicLink()) throw Error('Root symlink rejected');
      await cp(join(root, e.name), join(files, e.name), {
        recursive: e.isDirectory(),
        dereference: false,
        errorOnExist: true,
        force: false,
      });
    }
    const manifest = {
      kind:
        localPgMajor === 18
          ? 'SYNTHETIC_PG18_PERSISTENT_SNAPSHOT_V1'
          : 'LOCAL_PG16_PERSISTENT_SNAPSHOT_V1',
      ...executionEvidence(),
      createdAt: new Date().toISOString(),
      originalRoot: root,
      physicalBackup: live,
      metadata,
      files: await treeHashes(files),
    };
    await writeFile(join(pending, 'manifest.json'), JSON.stringify(manifest), {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(pending, final);
    // A failed snapshot never replaces the last complete generation.
    const pointer = join(snapshotHome, '.latest-' + randomUUID());
    await writeFile(
      pointer,
      JSON.stringify({
        path: final,
        manifestHash: hash(await readFile(join(final, 'manifest.json'))),
      }),
      { mode: 0o600, flag: 'wx' },
    );
    await rename(pointer, join(snapshotHome, 'latest.json'));
    return final;
  } catch (e) {
    await rm(pending, { recursive: true, force: true });
    throw e;
  }
}
export async function inspectSnapshot(path: string, expectedHash?: string) {
  if (dirname(path) !== snapshotHome || resolve(path) !== path)
    throw Error('Snapshot location rejected');
  await privateEntry(snapshotHome, true);
  await privateEntry(path, true);
  await privateEntry(join(path, 'root'), true);
  await privateEntry(join(path, 'manifest.json'));
  const bytes = await readFile(join(path, 'manifest.json'));
  if (expectedHash && hash(bytes) !== expectedHash) throw Error('Snapshot manifest hash mismatch');
  const m = JSON.parse(bytes.toString());
  if (
    m.kind !==
      (localPgMajor === 18
        ? 'SYNTHETIC_PG18_PERSISTENT_SNAPSHOT_V1'
        : 'LOCAL_PG16_PERSISTENT_SNAPSHOT_V1') ||
    !validInstallationEvidence(m)
  )
    throw Error('Snapshot kind rejected');
  localRoot(m.originalRoot);
  const files = await treeHashes(join(path, 'root'));
  const canonical = (v: Record<string, string>) =>
    JSON.stringify(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
  if (canonical(files) !== canonical(m.files)) throw Error('Snapshot file/hash closure mismatch');
  return m;
}
async function restoreLatestUnlocked() {
  await privateEntry(snapshotHome, true);
  await privateEntry(join(snapshotHome, 'latest.json'));
  const pointer = JSON.parse(await readFile(join(snapshotHome, 'latest.json'), 'utf8'));
  const m = await inspectSnapshot(pointer.path, pointer.manifestHash);
  if (await lstat(m.originalRoot).catch(() => null))
    throw Error('Restore target exists; refusing overwrite');
  // Copy only after complete validation; no database is started here.
  await cp(join(pointer.path, 'root'), m.originalRoot, {
    recursive: true,
    force: false,
    errorOnExist: true,
    dereference: false,
  });
  await mkdir(join(m.originalRoot, 'socket'), { mode: 0o700 });
  return { root: m.originalRoot as string, metadata: m.metadata, snapshot: pointer.path as string };
}
async function exclusiveSnapshot<T>(work: () => Promise<T>): Promise<T> {
  await mkdir(snapshotHome, { recursive: true, mode: 0o700 });
  await privateEntry(snapshotHome, true);
  const lock = join(snapshotHome, '.operation-lock');
  await mkdir(lock, { mode: 0o700 });
  try {
    return await work();
  } finally {
    await rm(lock, { recursive: true });
  }
}
export function saveSnapshot(root: string, live: boolean, metadata: unknown) {
  return exclusiveSnapshot(() => saveSnapshotUnlocked(root, live, metadata));
}
export function restoreLatest() {
  return exclusiveSnapshot(restoreLatestUnlocked);
}
if (process.argv[1]?.endsWith('/persistent-snapshot.ts')) {
  const action = process.argv[2];
  void (async () => {
    if (action === 'backup') {
      const metadata = JSON.parse(
        await readFile(
          localPgMajor === 18
            ? 'docs/v2/evidence/zhiban-pg18-demo-local.json'
            : 'docs/v2/evidence/zhiban-trial-content-demo-local.json',
          'utf8',
        ),
      );
      if (
        !validInstallationEvidence(metadata) ||
        (localPgMajor === 18 && metadata.stateRoot !== process.env.ZHIBAN_LOCAL_STATE) ||
        metadata.port !== 56517 ||
        metadata.origin !== (localPgMajor === 18 ? pg18Origin : 'https://127.0.0.1:3461')
      )
        throw Error('Trial identity mismatch');
      console.log(await saveSnapshot(metadata.root, true, metadata));
    } else if (action === 'recover') {
      const metadata = JSON.parse(
        await readFile(
          localPgMajor === 18
            ? 'docs/v2/evidence/zhiban-pg18-demo-local.json'
            : 'docs/v2/evidence/zhiban-trial-content-demo-local.json',
          'utf8',
        ),
      );
      if (
        !validInstallationEvidence(metadata) ||
        (localPgMajor === 18 && metadata.stateRoot !== process.env.ZHIBAN_LOCAL_STATE) ||
        metadata.port !== 56517 ||
        metadata.origin !== (localPgMajor === 18 ? pg18Origin : 'https://127.0.0.1:3461')
      )
        throw Error('Trial identity mismatch');
      localRoot(metadata.root);
      await privateEntry(metadata.root, true);
      const stat = await readFile(`/proc/${metadata.pid}/stat`, 'utf8').catch((e) => {
        if (e.code === 'ENOENT') return null;
        throw e;
      });
      if (stat && stat.split(') ')[1].trim().split(/\s+/)[19] === metadata.processStart)
        throw Error('Live HTTPS host must be stopped normally');
      let running = false;
      try {
        execFileSync(join(bin, 'pg_ctl'), ['-D', join(metadata.root, 'data'), 'status'], {
          stdio: 'pipe',
        });
        running = true;
      } catch {
        /* offline or stale PID: snapshot below still rejects a postmaster file */
      }
      if (running) {
        const actual = execFileSync(
          join(bin, 'psql'),
          [
            '-XAt',
            '-h',
            join(metadata.root, 'socket'),
            '-p',
            '56517',
            '-U',
            'postgres',
            '-d',
            'postgres',
            '-c',
            "SELECT current_setting('data_directory') || '|' || current_setting('listen_addresses')",
          ],
          { encoding: 'utf8' },
        ).trim();
        if (actual !== metadata.root + '/data|') throw Error('Recovery target mismatch');
        execFileSync(
          join(bin, 'pg_ctl'),
          ['-D', join(metadata.root, 'data'), '-m', 'fast', '-w', 'stop'],
          { stdio: 'pipe' },
        );
      }
      const saved = await saveSnapshot(metadata.root, false, metadata);
      await inspectSnapshot(saved);
      await rm(metadata.root, { recursive: true });
      console.log('LOCAL interrupted host saved; restart with pnpm trial:zhiban:', saved);
    } else if (action === 'select') {
      const path = process.argv[3];
      const m = await inspectSnapshot(path);
      if (await lstat(m.originalRoot).catch(() => null))
        throw Error('Working root exists; refusing snapshot switch');
      const pointer = join(snapshotHome, '.latest-' + randomUUID());
      await writeFile(
        pointer,
        JSON.stringify({ path, manifestHash: hash(await readFile(join(path, 'manifest.json'))) }),
        { mode: 0o600, flag: 'wx' },
      );
      await rename(pointer, join(snapshotHome, 'latest.json'));
      console.log('LOCAL snapshot selected; source/ACL checks still required at startup:', path);
    } else if (action === 'verify') {
      await privateEntry(join(snapshotHome, 'latest.json'));
      const p = JSON.parse(await readFile(join(snapshotHome, 'latest.json'), 'utf8'));
      const m = await inspectSnapshot(p.path, p.manifestHash);
      console.log(
        JSON.stringify({
          status: 'PASS',
          ...executionEvidence(),
          snapshot: p.path,
          files: Object.keys(m.files).length,
          scope: 'FILE_HASH_CLOSURE_ONLY',
        }),
      );
    } else throw Error('Use backup, verify, recover or select');
  })().catch(() => {
    console.error('LOCAL snapshot failed; prior generation retained.');
    process.exitCode = 1;
  });
}
