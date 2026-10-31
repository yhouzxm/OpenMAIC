/** Build once in the release tree; the service only reads the resulting artifact. */
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { digest, saveJson, check } from '@/lib/zhiban/infrastructure/production/files';
export async function buildHost() {
  const folder = resolve('.zhiban-host');
  await mkdir(folder, { recursive: true, mode: 0o755 });
  const r = await build({
    entryPoints: ['scripts/zhiban-deploy/production-host.ts'],
    outfile: join(folder, 'host.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    metafile: true,
    logLevel: 'silent',
    define: { 'process.env.ZHIBAN_BUILT_HOST_ENTRY': '"true"' },
    alias: {
      '@openmaic/dsl/schema/scene.schema.json': resolve(
        'packages/@openmaic/dsl/dist/schema/scene.schema.json',
      ),
      'next/server': 'next/server.js',
      'next/headers': 'next/headers.js',
      lodash: resolve('node_modules/lodash/lodash.js'),
      'lodash/isEqual': resolve('node_modules/lodash/isEqual.js'),
    },
    banner: {
      js: 'import {createRequire as externalCreateRequire} from "node:module";const require=externalCreateRequire(import.meta.url);',
    },
  });
  const ops = await build({
    entryPoints: ['scripts/zhiban-deploy/production-cli.ts'],
    outfile: join(folder, 'ops.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    metafile: true,
    logLevel: 'silent',
    define: { 'process.env.ZHIBAN_BUILT_HOST_ENTRY': '"false"' },
    alias: {
      '@openmaic/dsl/schema/scene.schema.json': resolve(
        'packages/@openmaic/dsl/dist/schema/scene.schema.json',
      ),
      'next/server': 'next/server.js',
      'next/headers': 'next/headers.js',
      lodash: resolve('node_modules/lodash/lodash.js'),
      'lodash/isEqual': resolve('node_modules/lodash/isEqual.js'),
    },
    banner: {
      js: 'import {createRequire as externalCreateRequire} from "node:module";const require=externalCreateRequire(import.meta.url);',
    },
  });
  const inputs: Record<string, string> = {};
  for (const p of new Set([
    ...Object.keys(r.metafile.inputs),
    ...Object.keys(ops.metafile.inputs),
  ])) {
    check(!p.startsWith('<'), 'HOST_BUILD_VIRTUAL_SOURCE_REJECTED');
    inputs[p] = digest(await readFile(p));
  }
  await saveJson(join(folder, 'artifact.json'), {
    kind: 'ZHIBAN_HOST_ARTIFACT_V1',
    nodeMajor: Number(process.versions.node.split('.')[0]),
    inputs,
    output: digest(await readFile(join(folder, 'host.mjs'))),
    operations: digest(await readFile(join(folder, 'ops.mjs'))),
  });
  await chmod(join(folder, 'artifact.json'), 0o644);
  // Root-owned read-only release handoff is performed by the Ubuntu installer.
  await writeFile(
    join(folder, '.keep'),
    'Prebuilt service artifact; rebuild before constructing a new source profile.\n',
    { mode: 0o644 },
  );
  return { status: 'BUILT', entry: join(folder, 'host.mjs') };
}
