import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { setup, request, policy } from './fixtures';
import type { ApprovedIdentityHttpLoader } from '@/lib/zhiban/infrastructure/identity/http/root';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  pools: [] as { options: Record<string, unknown>; end: ReturnType<typeof vi.fn> }[],
}));
vi.mock('pg', () => ({
  Pool: class {
    options: Record<string, unknown>;
    end = vi.fn(async () => {});
    constructor(options: Record<string, unknown>) {
      this.options = options;
      mocks.pools.push(this);
    }
  },
}));
vi.mock('@/lib/zhiban/infrastructure/identity/composition/root', () => ({
  createIdentityComposition: mocks.create,
}));
const symbol = Symbol.for('zhiban.identity.http.process-facade.v1');
const globals = globalThis as typeof globalThis & { [key: symbol]: unknown };
beforeEach(() => {
  delete globals[symbol];
  vi.resetModules();
  mocks.pools.length = 0;
  mocks.create.mockReset();
});
afterEach(() => {
  delete globals[symbol];
});
async function fixture() {
  const e = setup();
  mocks.create.mockResolvedValue(await e.load());
  const data = {
    manifest: {
      approvalRef: 'approved',
      networkApprovalRef: 'network',
      migrationPreflightRef: 'migration',
      operationalAcceptanceRef: 'operations',
      backendPrivate: true,
      fixedOverwritingProxy: true,
      endpoint: { hostname: 'db.example', port: 5432, database: 'synthetic' },
      runtimeSecrets: { auth: 'auth', tenant: 'tenant', control: 'control' },
      poolMax: 2,
      connectionTimeoutMs: 1000,
      statementTimeoutMs: 1000,
      policy: { ...policy },
    },
    composition: { deployment: 'SINGLE_PROCESS_HTTPS', origin: policy.origin },
  };
  const loader = {
    load: vi.fn(async () => data),
    secret: vi.fn(
      async (role: string) =>
        `postgresql:${'//'}${{ auth: 'zhiban_auth_runtime', tenant: 'zhiban_runtime', control: 'zhiban_control_runtime' }[role]}:synthetic@db.example:5432/synthetic`,
    ),
    record: vi.fn(),
  };
  const entrypoint = await import('@/lib/zhiban/infrastructure/identity/http/root');
  return { module: entrypoint, loader, data };
}
describe('D8 process singleton and explicit deployment gate', () => {
  it('default CLOSED with no env/test/owner fallback; methods/unknown do not initialize', async () => {
    const e = await fixture();
    expect((await e.module.identityHttp(request('reset'))).status).toBe(404);
    expect((await e.module.identityHttp(request('me', 'HEAD'))).status).toBe(405);
    expect((await e.module.identityHttp(request('me'))).status).toBe(503);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(() =>
      e.module.installApprovedIdentityHttp(e.loader as unknown as ApprovedIdentityHttpLoader),
    ).toThrow();
  });
  it('one immutable facade, exact same endpoint and three minimal runtime pools only', async () => {
    const e = await fixture();
    e.module.installApprovedIdentityHttp(e.loader as unknown as ApprovedIdentityHttpLoader);
    const results = await Promise.all([
      e.module.identityHttp(request('me')),
      e.module.identityHttp(request('csrf')),
    ]);
    expect(results.map((r) => r.status)).toEqual([401, 401]);
    expect(e.loader.load).toHaveBeenCalledTimes(1);
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.pools).toHaveLength(3);
    expect(mocks.pools.map((p) => new URL(p.options.connectionString as string).username)).toEqual([
      'zhiban_auth_runtime',
      'zhiban_runtime',
      'zhiban_control_runtime',
    ]);
    expect(
      mocks.pools.every(
        (p) => p.options.statement_timeout === 1000 && p.options.connectionTimeoutMillis === 1000,
      ),
    ).toBe(true);
    expect(() =>
      e.module.installApprovedIdentityHttp(e.loader as unknown as ApprovedIdentityHttpLoader),
    ).toThrow();
  });
  it.each(['owner', 'foreign-db', 'foreign-host', 'query-options'])(
    'unapproved DSN %s closes and cleans prior pools',
    async (kind) => {
      const e = await fixture();
      e.loader.secret.mockImplementation(async (role) =>
        role === 'auth'
          ? 'postgresql://zhiban_auth_runtime:synthetic@db.example/synthetic'
          : {
              owner: 'postgresql://owner:synthetic@db.example/synthetic',
              'foreign-db': 'postgresql://zhiban_runtime:synthetic@db.example/other',
              'foreign-host': 'postgresql://zhiban_runtime:synthetic@other.example/synthetic',
              'query-options':
                'postgresql://zhiban_runtime:synthetic@db.example/synthetic?options=unsafe',
            }[kind]!,
      );
      e.module.installApprovedIdentityHttp(e.loader as unknown as ApprovedIdentityHttpLoader);
      expect((await e.module.identityHttp(request('me'))).status).toBe(503);
      expect(mocks.create).not.toHaveBeenCalled();
      expect(mocks.pools).toHaveLength(1);
      expect(mocks.pools[0].end).toHaveBeenCalledTimes(1);
    },
  );
  it('composition/corpus/catalog/budget validation failure sanitizes and closes every pool', async () => {
    const e = await fixture();
    mocks.create.mockRejectedValue({ secret: 'synthetic-do-not-forward' });
    e.module.installApprovedIdentityHttp(e.loader as unknown as ApprovedIdentityHttpLoader);
    const response = await e.module.identityHttp(request('me'));
    expect(response.status).toBe(503);
    expect((await response.text()).includes('synthetic-do-not-forward')).toBe(false);
    expect(mocks.pools).toHaveLength(3);
    expect(mocks.pools.every((p) => p.end.mock.calls.length === 1)).toBe(true);
  });
  it('unapproved direct network manifest fails before any secret load', async () => {
    const e = await fixture();
    e.data.manifest.backendPrivate = false;
    e.module.installApprovedIdentityHttp(e.loader as unknown as ApprovedIdentityHttpLoader);
    expect((await e.module.identityHttp(request('me'))).status).toBe(503);
    expect(e.loader.secret).not.toHaveBeenCalled();
  });
});
