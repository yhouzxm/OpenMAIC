/* eslint-disable @typescript-eslint/no-require-imports -- ESM adapter for installation tools. */
const fs = require('node:fs'),
  path = require('node:path'),
  cp = require('node:child_process');
const entry = {
  'verify-install': 'scripts/zhiban-deploy/verify-production-install.ts',
  production: 'scripts/zhiban-deploy/production-cli.ts',
  'verify-authoring': 'scripts/zhiban-deploy/verify-installed-authoring.ts',
  'verify-first-admin': 'scripts/zhiban-deploy/verify-first-admin.ts',
}[process.argv[2]];
if (!entry) throw Error('Use verify-authoring');
const root = fs.mkdtempSync(path.join(process.cwd(), '.zhiban-production-run-'));
try {
  const output = path.join(root, 'tool.mjs');
  require('esbuild').buildSync({
    entryPoints: [entry],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent',
    alias: {
      '@openmaic/dsl/schema/scene.schema.json': path.resolve(
        'packages/@openmaic/dsl/dist/schema/scene.schema.json',
      ),
      'next/server': 'next/server.js',
      'next/headers': 'next/headers.js',
      lodash: require.resolve('lodash'),
      'lodash/isEqual': require.resolve('lodash/isEqual.js'),
    },
    banner: {
      js: 'import {createRequire as externalCreateRequire} from "node:module";const require=externalCreateRequire(import.meta.url);',
    },
  });
  const child = cp.spawn(process.execPath, [output, ...process.argv.slice(3)], {
    stdio: 'inherit',
  });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  child.once('error', () => {
    process.exitCode = 1;
    fs.rmSync(root, { recursive: true, force: true });
  });
  child.once('exit', (code) => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    process.exitCode = code ?? 1;
    fs.rmSync(root, { recursive: true, force: true });
  });
} catch (error) {
  fs.rmSync(root, { recursive: true, force: true });
  throw error;
}
