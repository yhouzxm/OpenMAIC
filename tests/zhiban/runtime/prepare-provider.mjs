import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { RUNTIME_DSL_VERSION } from '@openmaic/dsl';
import { PgRuntimeStore } from '@openmaic/storage/runtime/pg';
const official = '1f05a70ac93e09c67fb4d3aafb9c2b068d14fcce';
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (
  process.env.GITHUB_ACTIONS !== 'true' ||
  head !== process.env.GITHUB_SHA ||
  !process.version.startsWith('v22.') ||
  process.platform !== 'linux' ||
  process.arch !== 'x64' ||
  RUNTIME_DSL_VERSION !== '0.1.0' ||
  typeof PgRuntimeStore !== 'function'
)
  throw Error('C9 provider provenance rejected');
execFileSync('git', ['diff', '--exit-code', official, 'HEAD', '--', 'packages/@openmaic']);
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--receipt') throw Error('C9 receipt path required');
const artifact = new URL(import.meta.resolve('@openmaic/storage/runtime/pg'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const source = execFileSync('git', ['rev-parse', 'HEAD:packages/@openmaic']);
writeFileSync(
  args[1],
  JSON.stringify({
    head,
    official,
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    runtimeProtocol: RUNTIME_DSL_VERSION,
    sourceDigest: hash(source),
    lockDigest: hash(readFileSync('pnpm-lock.yaml')),
    artifactDigest: hash(readFileSync(artifact)),
  }),
);
