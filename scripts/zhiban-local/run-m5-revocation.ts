import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { chmod, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { directory, loadRuntime } from './config';
async function main() {
  await loadRuntime();
  const { build } = createRequire(require.resolve('tsx'))('esbuild');
  const target = join(directory, 'm5-revocation-verifier.mjs');
  try {
    await build({
      entryPoints: ['scripts/zhiban-local/verify-m5-revocation.mts'],
      outfile: target,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      banner: {
        js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
      },
    });
    await chmod(target, 0o600);
    execFileSync(process.execPath, [target], { stdio: 'inherit' });
  } finally {
    await unlink(target).catch(() => {});
  }
}
void main().catch(() => {
  console.error('LOCAL M5 revocation verification failed');
  process.exitCode = 1;
});
