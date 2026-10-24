import { mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
async function main() {
  const { build } = createRequire(require.resolve('tsx'))('esbuild');
  const root = await mkdtemp(resolve('.zhiban-analytics-run-'));
  try {
    const path = join(root, 'verify.mjs');
    await build({
      entryPoints: ['scripts/zhiban-local/verify-m6.mts'],
      outfile: path,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      banner: {
        js: 'import { createRequire as externalCreateRequire } from "node:module"; const require = externalCreateRequire(import.meta.url);',
      },
      logLevel: 'silent',
    });
    const child = spawn(
      process.execPath,
      [path, ...(process.argv.includes('--serve') ? ['--serve'] : [])],
      { stdio: 'inherit' },
    );
    const signal = () => child.kill('SIGTERM');
    process.once('SIGINT', signal);
    process.once('SIGTERM', signal);
    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (c) => resolve(c ?? 1));
    });
    process.removeListener('SIGINT', signal);
    process.removeListener('SIGTERM', signal);
    if (code !== 0) process.exitCode = code;
  } finally {
    await rm(root, { recursive: true });
  }
}
void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
