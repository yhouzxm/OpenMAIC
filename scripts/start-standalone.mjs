import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import nextEnv from '@next/env';

process.env.NODE_ENV ||= 'production';

const projectDirectory = process.cwd();
const standaloneServer = path.join(projectDirectory, '.next', 'standalone', 'server.js');

if (!existsSync(standaloneServer)) {
  throw new Error('Standalone build not found. Run `pnpm build` before `pnpm start`.');
}

// The generated standalone server intentionally does not load env files from the
// original project root. Load them before booting so local production validation
// behaves like `next dev`; real deployment environment variables still take precedence.
nextEnv.loadEnvConfig(projectDirectory, false);

await import(pathToFileURL(standaloneServer).href);
