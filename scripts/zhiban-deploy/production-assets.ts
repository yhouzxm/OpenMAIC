/** Explicit build step; never invoked by server startup. Reuses the native course asset builders. */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { buildNativeAuthoring } from '../zhiban-local/build-native-authoring';
import { buildQuizCss } from '../zhiban-local/quiz-css';
export async function buildProductionAssets() {
  execFileSync(process.execPath, ['scripts/sync-interactive-assets.mjs'], { stdio: 'pipe' });
  execFileSync(process.execPath, ['scripts/build-standalone-player.mjs'], { stdio: 'pipe' });
  await buildNativeAuthoring();
  await buildQuizCss();
  const { build } = createRequire(require.resolve('tsx'))('esbuild');
  for (const [entry, out] of [
    ['quiz-client', 'quiz-client'],
    ['published-player', 'published-player'],
    ['attempt-runtime-page', 'attempt-runtime-page'],
    ['content-client', 'content-client'],
  ])
    await build({
      entryPoints: [`app/zhiban/local/${entry}.tsx`],
      outfile: `app/zhiban/local/${out}.js`,
      bundle: true,
      platform: 'browser',
      format: 'iife',
      minify: true,
      define: { 'process.env.NODE_ENV': '"production"' },
      logLevel: 'silent',
    });
}
