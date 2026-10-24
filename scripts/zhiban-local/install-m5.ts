import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const { acquire } = createRequire(import.meta.url)(
  '../../docs/v2/candidates/m5-terminal/maintenance-lock.cjs',
);
import { directory, privateFile } from './config';
async function main() {
  await privateFile('m5-installer.mjs');
  const png = process.argv.includes('--png');
  const lock = png ? acquire(directory, 'installer') : null;
  try {
    execFileSync(
      process.execPath,
      [join(directory, 'm5-installer.mjs'), ...(png ? ['--png'] : [])],
      { stdio: lock ? ['inherit', 'inherit', 'inherit', lock.fd] : 'inherit' },
    );
  } finally {
    lock?.release();
  } // PNG flag stays blocked until independent CLOSED/clear protocol.
}
void main().catch((e) => {
  console.error(e instanceof Error ? e.message : 'Local M5 install failed');
  process.exitCode = 1;
});
