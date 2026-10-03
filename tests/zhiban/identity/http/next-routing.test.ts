import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { join, resolve, basename, dirname } from 'node:path';
import { createServer } from 'node:net';

const require = createRequire(import.meta.url),
  vitestRequire = createRequire(require.resolve('vitest/package.json')),
  viteRequire = createRequire(vitestRequire.resolve('vite'));
const build = viteRequire('esbuild').build as (options: unknown) => Promise<unknown>;
let process: ChildProcess | undefined, temporary: string | undefined;
const temporaryParent = dirname(resolve('.'));
afterEach(async () => {
  if (process) {
    if (globalThis.process.platform === 'win32' && process.pid && process.exitCode === null) {
      // Next CLI forks its server. Kill only this test's acknowledged child tree.
      const killer = spawn('taskkill', ['/PID', String(process.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      await new Promise<void>((r) => killer.once('exit', () => r()));
    } else process.kill();
    await new Promise<void>((r) => {
      if (process!.exitCode !== null) r();
      else {
        process!.once('exit', () => r());
        setTimeout(r, 5000).unref();
      }
    });
  }
  if (temporary) {
    if (
      dirname(resolve(temporary)) !== temporaryParent ||
      !basename(temporary).startsWith('zhiban-http-next-')
    )
      throw new Error('Invalid temporary cleanup target.');
    await rm(temporary, { recursive: true, force: true });
  }
  process = undefined;
  temporary = undefined;
});
describe('D8 installed Next router and actual route/middleware exports', () => {
  it('real Next routes share one private facade across login/me/csrf/unsafe and preserve native gate', async () => {
    // Same-volume isolation: Next's webpack entries cannot relativize a Windows cross-drive path.
    temporary = await mkdtemp(join(temporaryParent, 'zhiban-http-next-'));
    await symlink(
      resolve('node_modules'),
      join(temporary, 'node_modules'),
      globalThis.process.platform === 'win32' ? 'junction' : 'dir',
    );
    const entry = join(temporary, 'bootstrap.cjs');
    await build({
      entryPoints: [resolve('tests/zhiban/identity/http/next-bootstrap.ts')],
      outfile: entry,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      tsconfig: resolve('tsconfig.json'),
    });
    const rootBundle = join(temporary, 'root.cjs');
    await build({
      entryPoints: [resolve('lib/zhiban/infrastructure/identity/http/root.ts')],
      outfile: rootBundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      tsconfig: resolve('tsconfig.json'),
    });
    const protocolBundle = join(temporary, 'protocol.cjs');
    await build({
      entryPoints: [resolve('lib/zhiban/infrastructure/identity/http/protocol.ts')],
      outfile: protocolBundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      tsconfig: resolve('tsconfig.json'),
    });
    // Copy exact production route exports into an isolated app; no production test switch/config edits.
    await mkdir(join(temporary, 'app'), { recursive: true });
    await writeFile(
      join(temporary, 'app/layout.js'),
      'export default function Layout({children}) {return <html><body>{children}</body></html>}',
    );
    await writeFile(join(temporary, 'package.json'), JSON.stringify({ private: true }));
    await writeFile(join(temporary, 'next.config.js'), 'module.exports={};');
    const production = [
      'login',
      'me',
      'csrf',
      'logout',
      'logout-all',
      'spaces',
      'password',
      'tenants/[tenantId]/consent-context',
      'tenants/[tenantId]/consents',
      'tenants/[tenantId]/invitations',
      'tenants/[tenantId]/admin-transfer',
      'tenants/[tenantId]/memberships/[membershipId]',
      'tenants/[tenantId]/memberships/[membershipId]/[command]',
      '[[...unknown]]',
    ];
    for (const route of production) {
      const dir = join(temporary, 'app/api/zhiban/identity', route);
      await mkdir(dir, { recursive: true });
      let content = await readFile(resolve(`app/api/zhiban/identity/${route}/route.ts`), 'utf8');
      content = content.replace(
        "'@/lib/zhiban/infrastructure/identity/http/root'",
        JSON.stringify(rootBundle),
      );
      content = content.replace(
        "'@/lib/zhiban/infrastructure/identity/http/protocol'",
        JSON.stringify(protocolBundle),
      );
      await writeFile(join(dir, 'route.js'), content);
    }
    const middlewareBundle = join(temporary, 'middleware.cjs');
    await build({
      entryPoints: [resolve('middleware.ts')],
      outfile: middlewareBundle,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      tsconfig: resolve('tsconfig.json'),
    });
    await writeFile(
      join(temporary, 'middleware.js'),
      `import {middleware as actual} from ${JSON.stringify(middlewareBundle)};export async function middleware(request){return actual(request)};export const config={matcher:['/api/:path*'],runtime:'nodejs'};`,
    );
    const server = createServer();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>((r) => server.close(() => r()));
    const env = {
      ...globalThis.process.env,
      ACCESS_CODE: 'synthetic-native-access',
      NODE_PATH: resolve('node_modules'),
      NODE_OPTIONS: `--require=${entry}`,
      NEXT_TELEMETRY_DISABLED: '1',
    };
    process = spawn(
      globalThis.process.execPath,
      [
        require.resolve('next/dist/bin/next'),
        'dev',
        '--webpack',
        '--hostname',
        '127.0.0.1',
        '--port',
        String(port),
        temporary,
      ],
      { cwd: resolve('.'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    // Capture no application output/headers/secrets. Startup/compiler failure is a closed test failure.
    let compilerDiagnostic = '';
    const compilerLines = (chunk: Buffer) => {
      const selected = chunk
        .toString()
        .split('\n')
        .filter((line) =>
          /Module not found|Cannot find module|Error:|Can't resolve|is not a function|Unexpected|runtime|not allowed/.test(
            line,
          ),
        );
      compilerDiagnostic = (compilerDiagnostic + selected.join('\n')).slice(0, 4000);
    };
    process.stdout?.on('data', compilerLines);
    process.stderr?.on('data', compilerLines);
    const base = `http://127.0.0.1:${port}/api/`,
      headers = {
        'X-Zhiban-Request': 'identity-v1',
        'X-Zhiban-Client-IP': '127.0.0.1',
        Origin: 'https://synthetic.example',
        'Content-Type': 'application/json',
      };
    await expect
      .poll(
        async () => {
          try {
            const result = await fetch(base + 'zhiban/identity/me', { headers });
            if (result.status === 500 && compilerDiagnostic)
              throw new Error('Next test compiler: ' + compilerDiagnostic);
            return result.status;
          } catch (error) {
            if (error instanceof Error && error.message.startsWith('Next test compiler:'))
              throw error;
            return 0;
          }
        },
        { timeout: 45000, interval: 500 },
      )
      .toBe(401);
    const login = await fetch(base + 'zhiban/identity/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        userId: '01960000-0000-7000-8000-000000000001',
        password: 'Synthetic-only-http-input!',
      }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const me = await fetch(base + 'zhiban/identity/me', {
      headers: { ...headers, Cookie: cookie },
    });
    expect(me.status).toBe(200);
    expect(me.headers.get('X-Synthetic-Root-Initializations')).toBe('1');
    const csrf = await fetch(base + 'zhiban/identity/csrf', {
      headers: { ...headers, Cookie: cookie },
    });
    expect(csrf.status).toBe(200);
    const proof = (await csrf.json()).csrfToken;
    const logout = await fetch(base + 'zhiban/identity/logout', {
      method: 'POST',
      headers: { ...headers, Cookie: cookie, 'X-Zhiban-CSRF': proof },
      body: '{}',
    });
    expect(logout.status).toBe(204);
    expect(logout.headers.get('X-Synthetic-Root-Initializations')).toBe('1');
    expect((await fetch(base + 'zhiban/identity/me', { method: 'HEAD', headers })).status).toBe(
      405,
    );
    expect((await fetch(base + 'zhiban/identity/me', { method: 'OPTIONS', headers })).status).toBe(
      405,
    );
    expect((await fetch(base + 'zhiban/identity-neighbor', { headers })).status).toBe(401);
    expect((await fetch(base + 'native-unlisted', { headers })).status).toBe(401);
    for (const path of [
      'spaces',
      'password',
      'tenants/01960000-0000-7000-8000-000000000002/consent-context',
      'tenants/01960000-0000-7000-8000-000000000002/memberships/01960000-0000-7000-8000-000000000003',
    ]) {
      expect((await fetch(base + 'zhiban/identity/' + path, { headers })).status).toBe(401);
    }
    for (const path of [
      'logout-all',
      'tenants/01960000-0000-7000-8000-000000000002/consents',
      'tenants/01960000-0000-7000-8000-000000000002/invitations',
      'tenants/01960000-0000-7000-8000-000000000002/admin-transfer',
      ...[
        'activate',
        'disable',
        'leave',
        'reactivate',
        'rejoin',
        'grant',
        'revoke-grant',
        'replace-grants',
      ].map(
        (command) =>
          'tenants/01960000-0000-7000-8000-000000000002/memberships/01960000-0000-7000-8000-000000000003/' +
          command,
      ),
    ]) {
      expect(
        (await fetch(base + 'zhiban/identity/' + path, { method: 'POST', headers, body: '{}' }))
          .status,
      ).toBe(401);
      expect(
        (await fetch(base + 'zhiban/identity/' + path, { method: 'HEAD', headers })).status,
      ).toBe(405);
    }
    expect((await fetch(base + 'zhiban/identity/control', { headers })).status).toBe(404);
    expect((await fetch(base + 'zhiban/identity', { headers })).status).toBe(404);
  }, 180000);
});
