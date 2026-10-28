import { providerEnvironment } from '../../lib/zhiban/infrastructure/authoring/media/environment';
import { createStartupDiagnostics } from '../zhiban-ci/startup-diagnostics.cjs';
/** Default LOCAL launcher. An existing snapshot is resumed; absence means explicit first initialization. */
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import { snapshotHome, privateEntry } from './persistent-snapshot';
import { uiEnvironment } from './ui-presentation';
const startup = createStartupDiagnostics('PERSISTENT');
async function main() {
  startup.enter('PERSISTENT_CONFIG');
  if (process.argv.slice(2).some((x) => x !== '--upgrade-local'))
    throw Error('Unsupported launcher option');
  const envFile = '.env.local';
  if (await lstat(envFile).catch(() => null)) {
    await privateEntry(envFile);
    const config = parseEnv(await readFile(envFile, 'utf8'));
    if (
      process.env.ZHIBAN_UI_ENVIRONMENT === undefined &&
      config.ZHIBAN_UI_ENVIRONMENT !== undefined
    )
      process.env.ZHIBAN_UI_ENVIRONMENT = uiEnvironment(config.ZHIBAN_UI_ENVIRONMENT);
    for (const key of Object.keys(providerEnvironment(config)))
      if (!process.env[key] && config[key]) process.env[key] = config[key];
  }
  uiEnvironment(process.env.ZHIBAN_UI_ENVIRONMENT, 'local');
  startup.enter('RESTORE_POINTER');
  const pointer = join(snapshotHome, 'latest.json');
  const exists = await lstat(pointer).catch((e) => {
    if (e.code === 'ENOENT') return null;
    throw e;
  });
  if (process.env.ZHIBAN_LOCAL_STATE && !exists)
    throw Error('Portable restore pointer required; refusing accidental initialization');
  if (exists) await privateEntry(pointer);
  startup.enter('CATALOG_LAUNCH');
  const child = spawn(
    'pnpm',
    [
      'exec',
      'tsx',
      'scripts/zhiban-local/run-m6-catalog.ts',
      '--unified-trial',
      '--serve',
      '--persistent',
      ...(exists ? ['--resume'] : []),
      ...(process.argv.includes('--upgrade-local') ? ['--upgrade-local'] : []),
    ],
    { stdio: 'inherit' },
  );
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const code = await new Promise<number>((done, reject) => {
    child.once('error', reject);
    child.once('exit', (c) => done(c ?? 1));
  });
  process.exitCode = code;
}
void main().catch((error) => {
  startup.fail(error);
  console.error('Persistent startup failed; data retained. See the local launcher diagnostic.');
  process.exitCode = 1;
});
