import { realpath, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, relative, isAbsolute, resolve } from 'node:path';

// Exact workspace returned by prepare-workspace; no glob, repository root or arbitrary target.
const workspace = resolve(process.argv[2] || '.');
const target = dirname(workspace);
const parent = await realpath(tmpdir());
const actual = await realpath(target);
const rel = relative(parent, actual);
if (
  basename(workspace) !== 'workspace' ||
  !basename(actual).startsWith('zhiban-0b-') ||
  !rel ||
  rel.startsWith('..') ||
  isAbsolute(rel) ||
  (await lstat(target)).isSymbolicLink() ||
  (await realpath(workspace)) !== workspace
)
  throw new Error('DIAGNOSTIC_CLEANUP_REJECTED');
await rm(actual, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
process.stdout.write('Exact job-created diagnostic workspace removed.\n');
