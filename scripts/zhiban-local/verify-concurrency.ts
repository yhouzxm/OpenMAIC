import { request } from 'node:https';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { privateFile, trustedDevelopmentCa, origin, directory, digest } from './config';

/** Focused, read-only academic burst; no courses, members or enrollments are seeded. */
async function main() {
  const ca = await trustedDevelopmentCa();
  const account = JSON.parse((await privateFile('accounts.json')).toString()).accounts[0];
  async function http(path: string, cookie?: string, body?: unknown) {
    const started = performance.now();
    return new Promise<{ status: number; code?: string; cookie?: string; elapsedMs: number }>(
      (done, reject) => {
        const req = request(
          origin + path,
          {
            ca,
            servername: '',
            method: body ? 'POST' : 'GET',
            headers: {
              'x-zhiban-request': 'identity-v1',
              ...(cookie ? { Cookie: cookie } : {}),
              ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}),
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (b) => chunks.push(b));
            response.on('end', () => {
              const data = JSON.parse(Buffer.concat(chunks).toString());
              done({
                status: response.statusCode!,
                code: data.error?.code,
                cookie: response.headers['set-cookie']?.[0]?.split(';')[0],
                elapsedMs: Math.round(performance.now() - started),
              });
            });
          },
        );
        req.on('error', reject);
        req.setTimeout(10000, () => req.destroy(new Error('HTTPS timeout')));
        req.end(body ? JSON.stringify(body) : undefined);
      },
    );
  }
  const session = await http('/api/zhiban/identity/login', undefined, {
    userId: account.userId,
    password: account.password,
  });
  assert.equal(session.status, 200);
  let failures = 0;
  const rounds = [];
  for (let round = 1; round <= 4; round++) {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        http(`/api/zhiban/academic/${account.tenantId}`, session.cookie),
      ),
    );
    const measured = {
      mode: 'LOCAL',
      round,
      results: results.map(({ status, code, elapsedMs }) => ({ status, code, elapsedMs })),
    };
    rounds.push(measured);
    console.log(JSON.stringify(measured));
    failures += results.filter((r) => r.status !== 200).length;
  }
  const files = [
    'scripts/zhiban-local/verify-concurrency.ts',
    'scripts/zhiban-local/academic.ts',
    'scripts/zhiban-local/server.ts',
    'lib/zhiban/infrastructure/academic/http.ts',
    'lib/zhiban/infrastructure/academic/session-authentication.ts',
    'lib/zhiban/infrastructure/academic/postgres/store.ts',
    'tests/zhiban/academic/session-authentication.test.ts',
  ];
  const sourceHashes = Object.fromEntries(
    await Promise.all(files.map(async (f) => [f, digest(await readFile(resolve(f), 'utf8'))])),
  );
  await writeFile(
    join(directory, 'm2-concurrency-verification.json'),
    JSON.stringify(
      {
        mode: 'LOCAL',
        status: failures ? 'FAIL' : 'PASS',
        scope: 'same-session academic reads only; no business writes or production/CI signoff',
        verifiedAt: new Date().toISOString(),
        baseHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        sourceHashes,
        rounds,
        failures,
      },
      null,
      2,
    ) + '\n',
    { mode: 0o600 },
  );
  assert.equal(
    failures,
    0,
    'Concurrent academic reads must authenticate independently without stale Session touches.',
  );
  console.log('LOCAL same-session burst 32/32 PASS. No business writes.');
}
void main().catch((error) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : 'Focused concurrency verification failed.',
  );
  process.exitCode = 1;
});
