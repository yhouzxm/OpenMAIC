/** LOCAL offline upgrade has its own ESM process; never imports private deployment configuration. */
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
async function main() {
  const materialFixture = process.argv[2] === 'verify-material-fixture';
  const { build } = createRequire(require.resolve('tsx'))('esbuild');
  const root = await mkdtemp(resolve('.zhiban-upgrade-130-run-'));
  try {
    const entry = join(root, 'upgrade.mjs');
    await build({
      entryPoints: [
        materialFixture
          ? 'scripts/zhiban-deploy/verify-material-upgrade-130.ts'
          : 'scripts/zhiban-deploy/upgrade-snapshot-130.ts',
      ],
      outfile: entry,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      alias: {
        lodash: createRequire(require.resolve('tsx')).resolve('lodash'),
        'lodash/isEqual': createRequire(require.resolve('tsx')).resolve('lodash/isEqual.js'),
        'next/server': 'next/server.js',
        'next/headers': 'next/headers.js',
        '@openmaic/dsl/schema/scene.schema.json': resolve(
          'packages/@openmaic/dsl/dist/schema/scene.schema.json',
        ),
      },
      logLevel: 'silent',
      banner: {
        js: 'import { createRequire as externalCreateRequire } from "node:module"; const require = externalCreateRequire(import.meta.url);',
      },
    });
    const child = spawn(
      process.execPath,
      [entry, ...process.argv.slice(materialFixture ? 3 : 2), '--unified-trial'],
      {
        stdio: 'inherit',
      },
    );
    const stop = () => child.kill('SIGTERM');
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    try {
      process.exitCode = await new Promise<number>((done, reject) => {
        child.once('error', reject);
        child.once('exit', (c) => done(c ?? 1));
      });
    } finally {
      process.removeListener('SIGTERM', stop);
      process.removeListener('SIGINT', stop);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
