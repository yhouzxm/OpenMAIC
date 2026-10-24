import { buildQuizCss } from './quiz-css';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { chmod, symlink, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { directory, loadRuntime, digest } from './config';
import { implementationBindings } from './content-receipt';
const dependencyRequire = createRequire(require.resolve('tsx'));
const { build } = dependencyRequire('esbuild');
async function main() {
  await loadRuntime();
  const dependencyPath = join(directory, 'node_modules');
  try {
    await symlink(resolve('node_modules'), dependencyPath);
  } catch (e) {
    if ((e as any).code !== 'EEXIST') throw e;
  }
  if ((await realpath(dependencyPath)) !== (await realpath(resolve('node_modules'))))
    throw new Error('Local bundle dependency path rejected');
  if (!process.argv.includes('--bundle-only'))
    for (const name of ['dsl', 'storage', 'renderer', 'editor'])
      execFileSync('pnpm', ['--filter', `@openmaic/${name}`, 'build'], { stdio: 'inherit' });
  await build({
    entryPoints: ['app/zhiban/local/content-client.tsx'],
    outfile: 'app/zhiban/local/content-client.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info',
  });
  await buildQuizCss();
  await build({
    entryPoints: ['app/zhiban/local/quiz-client.tsx'],
    outfile: 'app/zhiban/local/quiz-client.js',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    minify: true,
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'info',
  });
  for (const [entry, name] of [
    ['server.ts', 'm5-server.mjs'],
    ['setup-m5.ts', 'm5-installer.mjs'],
    ['inspect-m5.ts', 'm5-inspector.mjs'],
  ]) {
    const target = join(directory, name);
    await build({
      entryPoints: [`scripts/zhiban-local/${entry}`],
      outfile: target,
      bundle: true,
      platform: 'node',
      format: 'esm',
      packages: 'external',
      banner: {
        js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
      },
      logLevel: 'info',
    });
    await chmod(target, 0o600);
  }
  await writeFile(
    join(directory, 'm5-build-manifest.json'),
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        builtAt: new Date().toISOString(),
        bindingHash: digest(JSON.stringify(await implementationBindings())),
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'M5 build failed');
  process.exitCode = 1;
});
