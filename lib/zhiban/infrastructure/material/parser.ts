import { parserFor, type MaterialParserProfile } from './config';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import type { MaterialFile } from '../../domain/material/model';
import { requireAcademic } from '../../domain/academic/model';
export type ParsedMaterial = { text: string; parser: string; empty: boolean };
export async function parseMaterial(
  file: MaterialFile,
  profile: MaterialParserProfile = {},
): Promise<ParsedMaterial> {
  const config = parserFor(file.mime, profile);
  requireAcademic(!!config, 'UNAVAILABLE');
  const require = createRequire(resolve('package.json'));
  return new Promise((yes, no) => {
    const child = spawn(
      process.execPath,
      [
        '--max-old-space-size=256',
        '--import',
        require.resolve('tsx'),
        'scripts/zhiban-local/material-parser-child.ts',
      ],
      {
        cwd: process.cwd(),
        shell: false,
        detached: true,
        env: { PATH: '/usr/bin:/bin', NODE_ENV: 'production', LANG: 'C.UTF-8' },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let out = '',
      settled = false;
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      no(Error('MATERIAL_PARSE_FAILED'));
    };
    const timer = setTimeout(fail, 30000);
    child.on('error', fail);
    child.stdin.on('error', fail);
    child.stdout.on('data', (b) => {
      out += b.toString();
      if (out.length > 800000) fail();
    });
    child.stderr.on('data', () => {});
    child.on('close', (code) => {
      if (settled) return;
      clearTimeout(timer);
      if (code !== 0) {
        fail();
        return;
      }
      try {
        const v = JSON.parse(out);
        requireAcademic(
          typeof v.empty === 'boolean' &&
            v.parser?.startsWith(config!.providerId + ':') &&
            typeof v.text === 'string' &&
            v.text.length <= 100000 &&
            v.text.isWellFormed() &&
            !v.text.includes('\u0000') &&
            /^[A-Za-z0-9._-]{1,40}:[A-Za-z0-9._-]{1,40}$/.test(v.parser),
        );
        settled = true;
        yes(v);
      } catch {
        fail();
      }
    });
    child.stdin.end(JSON.stringify({ ...file, config }));
  });
}
