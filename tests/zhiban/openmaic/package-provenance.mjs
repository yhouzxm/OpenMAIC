import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
export function verifyPackageDelta(delta, changed, read) {
  if (
    delta.official !== 'c0f296aa36096ec3d1e1e2b94a7a48e20075e0a1' ||
    JSON.stringify([...changed].sort()) !== JSON.stringify(Object.keys(delta.sha256).sort())
  )
    throw Error('DIAGNOSTIC_SOURCE_DELTA_REJECTED');
  for (const path of changed) {
    if (
      !path.startsWith('packages/@openmaic/') ||
      createHash('sha256').update(read(path)).digest('hex') !== delta.sha256[path]
    )
      throw Error('DIAGNOSTIC_SOURCE_DELTA_REJECTED');
  }
}
export function verifyGitPackages(source, head, delta) {
  const git = (args) => execFileSync('git', args, { cwd: source, maxBuffer: 8 * 1024 * 1024 });
  const changed = git(['diff', '--name-only', delta.official, head, '--', 'packages/@openmaic'])
    .toString()
    .trim()
    .split('\n')
    .filter(Boolean);
  verifyPackageDelta(delta, changed, (path) => git(['show', `${head}:${path}`]));
  git(['diff', '--exit-code', head, '--', 'packages/@openmaic', 'pnpm-lock.yaml']);
  if (git(['ls-files', '--others', '--exclude-standard', '--', 'packages/@openmaic']).length)
    throw Error('DIAGNOSTIC_UNTRACKED_SOURCE_REJECTED');
}
