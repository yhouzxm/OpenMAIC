import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { RUNTIME_DSL_VERSION } from '@openmaic/dsl';
import { PgRuntimeStore } from '@openmaic/storage/runtime/pg';
const official = '1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce';
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const executionMode = process.env.ZB_PG16_EXECUTION_MODE ?? 'GITHUB_ACTIONS';
const local = executionMode === 'LOCAL';
const originAccepted = local
  ? process.env.GITHUB_ACTIONS === undefined &&
    process.env.GITHUB_SHA === undefined &&
    head === process.env.ZB_PG16_EXPECTED_HEAD
  : executionMode === 'GITHUB_ACTIONS' &&
    process.env.GITHUB_ACTIONS === 'true' &&
    head === process.env.GITHUB_SHA;
if (
  !originAccepted ||
  !process.version.startsWith('v22.') ||
  process.platform !== 'linux' ||
  process.arch !== 'x64' ||
  RUNTIME_DSL_VERSION !== '0.1.0' ||
  typeof PgRuntimeStore !== 'function'
)
  throw Error('C9 provider provenance rejected');
execFileSync('git', ['diff', '--exit-code', official, 'HEAD', '--', 'packages/@openmaic']);
execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'packages/@openmaic', 'pnpm-lock.yaml']);
if (
  execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'packages/@openmaic'])
    .length
)
  throw Error('C9 untracked provider source rejected');
const args = process.argv.slice(2);
if (args.length !== 2 || !['--receipt', '--verify'].includes(args[0]))
  throw Error('C9 receipt path required');
const artifact = new URL(import.meta.resolve('@openmaic/storage/runtime/pg'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const source = execFileSync('git', ['rev-parse', 'HEAD:packages/@openmaic']);
// LOCAL evidence binds the uncommitted candidate too; hashes contain no source text.
const patch = createHash('sha256');
patch.update(execFileSync('git', ['diff', '--binary', 'HEAD']));
for (const path of execFileSync('git', [
  'ls-files',
  '--others',
  '--exclude-standard',
  '-z',
  '--',
  'tests/zhiban',
  'docs/v2/phase1',
])
  .toString()
  .split('\0')
  .filter(Boolean)
  .sort()) {
  patch.update(path + '\0');
  patch.update(readFileSync(path));
}
const receipt = {
  executionMode,
  head,
  official,
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  runtimeProtocol: RUNTIME_DSL_VERSION,
  sourceDigest: hash(source),
  lockDigest: hash(readFileSync('pnpm-lock.yaml')),
  artifactDigest: hash(readFileSync(artifact)),
  ...(local ? { candidatePatchDigest: patch.digest('hex') } : {}),
};
if (args[0] === '--verify') {
  if (!isDeepStrictEqual(JSON.parse(readFileSync(args[1], 'utf8')), receipt))
    throw Error('C9 receipt does not match the current execution/source/lock/artifact');
} else {
  writeFileSync(args[1], JSON.stringify(receipt), { mode: 0o600 });
}
