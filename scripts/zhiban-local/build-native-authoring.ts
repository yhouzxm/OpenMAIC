/** Build the unchanged upstream workspace/editor into the dedicated course host. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import type { PluginBuild, BuildOptions } from 'esbuild';
import { createRequire } from 'node:module';
export async function buildNativeAuthoring() {
  const receiptPath = 'docs/v2/evidence/native-authoring-build-local.json';
  const digest = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
  const files = execFileSync(
    'rg',
    [
      '--files',
      'app',
      'components',
      'lib',
      'scripts/zhiban-local/build-native-authoring.ts',
      'package.json',
      'pnpm-lock.yaml',
    ],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .sort();
  const sourceHashes: Record<string, string> = {};
  for (const file of files) sourceHashes[file] = digest(await readFile(file));
  try {
    const previous = JSON.parse(await readFile(receiptPath, 'utf8'));
    if (
      previous.evidenceOrigin === 'LOCAL' &&
      previous.githubActions === false &&
      previous.node === process.version &&
      JSON.stringify(previous.sourceHashes) === JSON.stringify(sourceHashes)
    ) {
      let matches = true;
      for (const [file, hash] of Object.entries({ ...previous.importHashes, ...previous.outputs }))
        if (digest(await readFile(file)) !== hash) {
          matches = false;
          break;
        }
      if (matches) return;
    }
  } catch {}
  const importHashes: Record<string, string> = {},
    outputs: Record<string, string> = {};
  const { build } = createRequire(require.resolve('tsx'))('esbuild');
  const theme = await postcss([
    tailwindcss({ optimize: true }) as unknown as postcss.AcceptedPlugin,
  ]).process(await readFile('app/globals.css', 'utf8'), { from: resolve('app/globals.css') });
  await writeFile('app/zhiban/local/native-theme.css', theme.css);
  const actionBridge = {
    name: 'zhiban-server-action-transport',
    setup(b: PluginBuild) {
      b.onResolve({ filter: /^node:crypto$/ }, () => ({
        path: 'web-crypto-random',
        namespace: 'native-web-crypto',
      }));
      b.onLoad({ filter: /.*/, namespace: 'native-web-crypto' }, () => ({
        contents: 'export const randomBytes=(n)=>crypto.getRandomValues(new Uint8Array(n));',
        loader: 'js',
      }));
      b.onLoad({ filter: /lib\/workbench\/workspace-actions\.ts$/ }, () => ({
        loader: 'js',
        contents: `export async function deleteWorkspaceSession(id){const u=new URL(location.href);const r=await fetch('/api/zhiban/authoring/'+u.searchParams.get('tenant')+'/offerings/'+u.searchParams.get('offering')+'/delete-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});if(!r.ok)throw Error('会话删除未完成');return r.json();}`,
      }));
    },
  };
  const common: BuildOptions = {
    plugins: [actionBridge],
    external: ['undici'],
    metafile: true,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    minify: true,
    define: {
      'process.env': '{}',
      'process.env.NODE_ENV': '"production"',
      'process.env.NEXT_PUBLIC_PRO_WORKBENCH_ENABLED': '"true"',
      'process.env.NEXT_PUBLIC_MAIC_EDITOR_ENABLED': '"true"',
      'process.env.NEXT_PUBLIC_MAIC_EDITOR_RENDERER_ENABLED': '"true"',
      'process.env.NEXT_PUBLIC_MAIC_PLAYBACK_RENDERER_ENABLED': '"true"',
      'process.env.NEXT_PUBLIC_COURSEWARE_REFERENCE_ENABLED': '"true"',
    },
    loader: { '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.png': 'file', '.svg': 'file' },
    assetNames: 'native-assets/[name]-[hash]',
    logLevel: 'silent',
  };
  const workspace = await build({
    ...common,
    entryPoints: ['app/zhiban/local/native-workbench.tsx'],
    outfile: 'app/zhiban/local/native-workbench.bundle.js',
  });
  const results = [workspace];
  results.push(await build({...common,entryPoints:['app/zhiban/local/course-results.tsx'],outfile:'app/zhiban/local/course-results.bundle.js'}));
  results.push(await build({...common, entryPoints:['app/zhiban/local/admin-services.tsx'],outfile:'app/zhiban/local/admin-services.bundle.js'}));
  results.push(
    await build({
      ...common,
      entryPoints: ['app/zhiban/local/native-services.tsx'],
      outfile: 'app/zhiban/local/native-services.bundle.js',
    }),
  );
  results.push(
    await build({
      ...common,
      entryPoints: ['app/zhiban/local/native-archive.tsx'],
      outfile: 'app/zhiban/local/native-archive.bundle.js',
    }),
  );
  results.push(
    await build({
      ...common,
      entryPoints: ['app/zhiban/local/native-classroom.tsx'],
      outfile: 'app/zhiban/local/native-classroom.bundle.js',
    }),
  );
  for (const name of ['native-review', 'native-published'])
    results.push(
      await build({
        ...common,
        entryPoints: [`app/zhiban/local/${name}.tsx`],
        outfile: `app/zhiban/local/${name}.js`,
      }),
    );
  for (const result of results) {
    for (const file of Object.keys(result.metafile.inputs))
      if (
        !file.startsWith('native-web-crypto:') &&
        !file.startsWith('<') &&
        !file.startsWith('(disabled):')
      )
        importHashes[file] = digest(await readFile(file));
    for (const file of Object.keys(result.metafile.outputs))
      outputs[file] = digest(await readFile(file));
  }
  outputs['app/zhiban/local/native-theme.css'] = digest(theme.css);
  await writeFile(
    receiptPath,
    JSON.stringify(
      {
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        scope: 'BUILD_CACHE_ONLY_NOT_PRODUCT_EVIDENCE',
        node: process.version,
        sourceHashes,
        importHashes,
        outputs,
      },
      null,
      2,
    ) + '\n',
  );
}
if (process.argv[1]?.endsWith('build-native-authoring.ts')) void buildNativeAuthoring();
