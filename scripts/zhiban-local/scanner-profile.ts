import { homedir } from 'node:os';
/** Freeze a locally installed Ubuntu ClamAV runtime and official CVD snapshot; never downloads on requests. */
import { execFileSync } from 'node:child_process';
import { mkdir, readdir, copyFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  fileHash,
  loadClamAv,
  type ClamAvProfile,
} from '../../lib/zhiban/infrastructure/learning-files/scanner/clamav';
async function main() {
  const root = resolve(process.argv[2] ?? join(homedir(), '.local/share/zhiban-scanner'));
  const binary = join(root, 'runtime/usr/bin/clamscan');
  const libraryPath = join(root, 'runtime/usr/lib/x86_64-linux-gnu');
  const certificates = join(root, 'runtime/etc/clamav/certs');
  const env = {
    PATH: '/usr/bin:/bin',
    NODE_ENV: 'production' as const,
    LANG: 'C',
    LD_LIBRARY_PATH: libraryPath,
    CVD_CERTS_DIR: certificates,
  };
  const snapshot = join(root, 'snapshots', new Date().toISOString().replaceAll(':', '-'));
  await mkdir(snapshot, { recursive: true, mode: 0o700 });
  const database = join(snapshot, 'db');
  await mkdir(database, { mode: 0o700 });
  for (const name of await readdir(join(root, 'db'))) {
    if (/^(main|daily|bytecode)(-[0-9]+)?\.(cvd|cld)(\.sign)?$/.test(name))
      await copyFile(join(root, 'db', name), join(database, name));
  }
  const dependencies = execFileSync('/usr/bin/ldd', [binary], { env, encoding: 'utf8' });
  if (dependencies.includes('not found')) throw Error('Scanner library missing');
  const paths = new Set(
    [binary, ...dependencies.matchAll(/(?:=>\s+|^\s*)(\/[^\s()]+)/gm)].map((v) =>
      typeof v === 'string' ? v : v[1],
    ),
  );
  for (const dir of [database, certificates, libraryPath])
    for (const name of await readdir(dir)) paths.add(join(dir, name));
  const files: Record<string, string> = {};
  for (const path of paths) {
    const target = await realpath(path);
    files[target] = await fileHash(target);
  }
  const profile: ClamAvProfile = {
    version: 1,
    evidenceOrigin: 'LOCAL',
    binary,
    libraryPath,
    database,
    certificates,
    engineVersion: execFileSync(binary, ['--version'], { env, encoding: 'utf8' })
      .trim()
      .split('/')[0],
    files,
  };
  const raw = JSON.stringify(profile, null, 2) + '\n';
  const path = join(snapshot, 'profile.json');
  const hash = createHash('sha256').update(raw).digest('hex');
  await writeFile(path, raw, { mode: 0o600 });
  await loadClamAv(path, hash);
  console.log(
    JSON.stringify(
      { profile: path, sha256: hash, evidenceOrigin: 'LOCAL', engine: profile.engineVersion },
      null,
      2,
    ),
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
