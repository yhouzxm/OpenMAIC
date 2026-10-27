/** Live PG18 application probes, without starting or weakening the frozen PG16 host. */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { createIdentityComposition } from '../../lib/zhiban/infrastructure/identity/composition/root';
import { createIdentityHttp } from '../../lib/zhiban/infrastructure/identity/http/adapter';
import { validateContentDatabaseState } from '../zhiban-local/content-receipt';
const require = createRequire(join(process.cwd(), 'scripts/zhiban-deploy/verify-pg18.ts'));
const transfer = require('./pg-transfer.cjs');
async function main() {
  const [target, bundle, pin, output] = process.argv.slice(2);
  const manifest = transfer.bundle(bundle, pin),
    instance = transfer.marker(target);
  assert.equal(instance.major, 18);
  assert.equal(JSON.parse(await readFile(join(target, 'RESTORED.json'), 'utf8')).pin, pin);
  const pools: Pool[] = [];
  const pool = (user: string, database = manifest.databases[0]) => {
    const p = new Pool({
      host: join(target, 'socket'),
      port: instance.port,
      user,
      database,
      max: 2,
      connectionTimeoutMillis: 1000,
      statement_timeout: 5000,
    });
    pools.push(p);
    return p;
  };
  try {
    const endpoint = (
      await pool('postgres').query(
        "SELECT current_setting('server_version_num')::int AS version,current_setting('data_directory') AS directory,current_setting('listen_addresses') AS tcp",
      )
    ).rows[0];
    assert.ok(endpoint.version >= 180000 && endpoint.version < 190000);
    assert.equal(endpoint.directory, join(target, 'data'));
    assert.equal(endpoint.tcp, '');
    const control = JSON.parse(
      await readFile(join(bundle, 'host-files/member-control.json'), 'utf8'),
    );
    const config = {
      ...control.composition,
      operator: null,
      membership: { ...control.composition.membership, operator: null },
      admission: {
        ...control.composition.admission,
        hmacKey: Buffer.from(control.composition.admission.hmacKey, 'hex'),
      },
    };
    const composition = await createIdentityComposition(
      {
        auth: pool('zhiban_auth_runtime'),
        tenant: pool('zhiban_runtime'),
        control: pool('zhiban_control_runtime'),
      },
      config,
    );
    assert.ok(composition.queries);
    const facade = createIdentityHttp(
      async () => ({ ...composition, queries: composition.queries! }),
      { origin: config.origin, concurrentRequests: 2, bodyTimeoutMs: 3000, retryAfterSeconds: 1 },
    );
    const request = (route: string, body?: unknown, cookie?: string, csrf?: string) =>
      new Request(config.origin + '/api/zhiban/identity/' + route, {
        method: body ? 'POST' : 'GET',
        headers: {
          'x-zhiban-request': 'identity-v1',
          'x-zhiban-client-ip': '127.0.0.1',
          ...(body ? { Origin: config.origin, 'content-type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(csrf ? { 'x-zhiban-csrf': csrf } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const accounts = JSON.parse(
      await readFile(join(bundle, 'host-files/accounts.json'), 'utf8'),
    ).accounts;
    const checks: { role: string; login: number; spaces: number; csrf: number; logout: number }[] =
      [];
    for (const role of ['ADMIN', 'TEACHER', 'STUDENT']) {
      const account = accounts.find((a: { role: string }) => a.role === role);
      assert.ok(account);
      const login = await facade.handle(
        request('login', { userId: account.userId, password: account.password }),
      );
      assert.equal(login.status, 200, role + ' PG18 login');
      const cookie = login.headers.get('set-cookie')!.split(';')[0];
      const me = await facade.handle(request('me', undefined, cookie));
      assert.equal(me.status, 200);
      assert.equal((await me.json()).userId, account.userId);
      const spaces = await facade.handle(request('spaces', undefined, cookie));
      assert.equal(spaces.status, 200);
      const csrf = await facade.handle(request('csrf', undefined, cookie));
      assert.equal(csrf.status, 200);
      const proof = (await csrf.json()).csrfToken;
      const denied = await facade.handle(request('logout', {}, cookie));
      assert.equal(denied.status, 403);
      const logout = await facade.handle(request('logout', {}, cookie, proof));
      assert.equal(logout.status, 204);
      assert.equal((await facade.handle(request('me', undefined, cookie))).status, 401);
      checks.push({
        role,
        login: login.status,
        spaces: spaces.status,
        csrf: csrf.status,
        logout: logout.status,
      });
    }
    const install = JSON.parse(
      await readFile(join(bundle, 'host-files/content-installation.json'), 'utf8'),
    );
    let fullHost: string;
    try {
      await validateContentDatabaseState(
        pool('zhiban_bridge_runtime'),
        pool('zhiban_openmaic_runtime', manifest.databases[1]),
        install,
      );
      fullHost = 'UNEXPECTED_ACCEPTANCE';
    } catch (e) {
      assert.match((e as Error).message, /Bridge endpoint rejected/);
      fullHost = 'BLOCKED_BY_FROZEN_PG16_PROVIDER_CONTRACT';
    }
    assert.notEqual(fullHost, 'UNEXPECTED_ACCEPTANCE');
    await writeFile(
      output,
      JSON.stringify(
        {
          evidenceOrigin: 'LOCAL',
          githubActions: false,
          postgres: endpoint.version,
          identity: 'PASS_REAL_PG18_COMPOSITION_AND_HTTP_FACADE',
          checks,
          csrfEnforced: true,
          loggedOutSessionDenied: true,
          fullHost,
          providerActivated: false,
          noNetworkPageOrFullClassroomClaim: true,
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600, flag: 'wx' },
    );
    console.log(
      'PG18 real Identity login/spaces/CSRF/logout passed; full host remains closed by frozen PG16 contract',
    );
  } finally {
    for (const p of pools) await p.end();
  }
}
void main().catch(async (e) => {
  if (process.env.ZHIBAN_DEPLOY_PRIVATE_DIAGNOSTIC)
    await writeFile(process.env.ZHIBAN_DEPLOY_PRIVATE_DIAGNOSTIC, String(e.stack ?? e), {
      mode: 0o600,
    });
  console.error('PG18 application probe failed; private diagnostic retained');
  process.exitCode = 1;
});
