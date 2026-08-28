import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const projectDirectory = process.cwd();
const standaloneDirectory = path.join(projectDirectory, '.next', 'standalone');

if (!existsSync(path.join(standaloneDirectory, 'server.js'))) {
  throw new Error('Standalone build not found. Run `next build` before preparing assets.');
}

function copyRuntimeAssets(source, destination) {
  if (!existsSync(source)) return;
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, force: true });
}

copyRuntimeAssets(
  path.join(projectDirectory, '.next', 'static'),
  path.join(standaloneDirectory, '.next', 'static'),
);
copyRuntimeAssets(
  path.join(projectDirectory, 'public'),
  path.join(standaloneDirectory, 'public'),
);

console.log('[prepare-standalone] copied .next/static and public runtime assets');
