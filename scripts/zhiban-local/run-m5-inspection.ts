import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { directory, privateFile } from './config';
async function main() {
  await privateFile('m5-inspector.mjs');
  execFileSync(process.execPath, [join(directory, 'm5-inspector.mjs'), ...process.argv.slice(2)], {
    stdio: 'inherit',
  });
}
void main().catch(() => {
  console.error('LOCAL read-only inspection did not issue a report.');
  process.exitCode = 1;
});
