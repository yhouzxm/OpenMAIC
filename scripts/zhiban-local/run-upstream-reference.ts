/** Build the ESM-only storage adapter into an isolated LOCAL reference constructor. */
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
async function main() {
  const { build } = createRequire(require.resolve('tsx'))('esbuild');
  const root = await mkdtemp(resolve('.zhiban-reference-run-'));
  try {
    const output = join(root, 'reference.mjs');
    await build({
      entryPoints: ['scripts/zhiban-deploy/build-openmaic-130-reference.ts'],
      outfile: output,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      logLevel: 'silent',
      banner: {
        js: 'import { createRequire as externalCreateRequire } from "node:module"; const require = externalCreateRequire(import.meta.url);',
      },
    });
    const child = spawn(process.execPath, [output, ...process.argv.slice(2)], { stdio: 'inherit' });
    const stop = () => child.kill('SIGTERM');
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    process.exitCode = await new Promise<number>((done, reject) => {
      child.once('error', reject);
      child.once('exit', (c) => done(c ?? 1));
    });
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
