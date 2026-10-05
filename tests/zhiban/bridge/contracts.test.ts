import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { loadMigrationFiles } from '@/lib/zhiban/infrastructure/identity/postgres/migrate';
import {
  bridgeTransaction,
  Deadline,
  type BridgePgClient,
} from '@/lib/zhiban/infrastructure/openmaic/transactions';
import { BridgeError } from '@/lib/zhiban/infrastructure/openmaic/validation';
import {
  slotRecord,
  slotColumns,
  generationRecord,
  generationColumns,
} from '@/lib/zhiban/infrastructure/openmaic/records';
import { BridgeSessionSecurity } from '@/lib/zhiban/infrastructure/openmaic/security';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { tenantId, membershipId } from '@/lib/zhiban/domain/identity';
import type { AuthenticatedRequestHandle } from '@/lib/zhiban/application/identity/use-cases/authentication';
import { UnavailableBridgeResourceFacts } from '@/lib/zhiban/application/openmaic/bridge';
import { canonicalJson } from '@/lib/zhiban/infrastructure/openmaic/content';

const root = 'lib/zhiban/infrastructure/identity/postgres/migrations',
  sql = readFileSync(`${root}/0012_openmaic_bridge_foundation.sql`, 'utf8');
const id = '00000000-0000-7000-8000-000000000001',
  other = '00000000-0000-7000-8000-000000000002';
function connection(commit = 'COMMIT') {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const release = vi.fn();
  const client = {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return {
        rows: [],
        rowCount: 0,
        command: sql === 'COMMIT' ? commit : sql === 'ROLLBACK' ? 'ROLLBACK' : 'SELECT',
      };
    }),
    release,
  } as unknown as BridgePgClient;
  return { calls, release, client, pool: { connect: async () => client } };
}
describe('Bridge migration and composition contracts', () => {
  it('adds only 0012 and preserves every applied migration byte-for-byte', async () => {
    const migrations = await loadMigrationFiles();
    expect(migrations).toHaveLength(12);
    for (const file of migrations.slice(0, 11)) {
      const expected = execFileSync('git', ['show', `HEAD:${root}/${file.name}`], {
        maxBuffer: 1024 * 1024,
      });
      expect(file.sql.replaceAll('\r\n', '\n')).toBe(
        expected.toString('utf8').replaceAll('\r\n', '\n'),
      );
    }
    expect(migrations[11].name).toBe('0012_openmaic_bridge_foundation.sql');
  });
  it('keeps shipped business gate false without environment/GUC override', () => {
    const gate = sql.slice(
      sql.indexOf('CREATE FUNCTION zhiban_bridge.business_resource_ready'),
      sql.indexOf('CREATE FUNCTION zhiban_bridge.resource_gate_guard'),
    );
    expect(gate).toContain('SELECT FALSE');
    expect(gate).not.toMatch(/current_setting|EXECUTE|enabled/i);
  });
  it('has seven tables, six guards, FORCE RLS and global asset uniqueness', () => {
    expect(sql.match(/CREATE TABLE zhiban_bridge\./g)).toHaveLength(7);
    expect(sql.match(/CREATE FUNCTION zhiban_bridge\.[a-z_]+\(\) RETURNS trigger/g)).toHaveLength(
      6,
    );
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain('UNIQUE(deployment_id,asset_ref)');
    expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
  });
  it('identity exception is narrow; lock policies cannot mutate', () => {
    expect(sql).toContain('WITH CHECK(false)');
    expect(sql.match(/CREATE POLICY [a-z_]+ ON zhiban_identity/g)).toHaveLength(2);
    expect(sql).not.toMatch(/GRANT\s+(SELECT|INSERT|UPDATE|DELETE|ALL)[^;]+ON zhiban_identity/);
    const signature = sql.slice(
      sql.indexOf('RETURNS TABLE(membership_id'),
      sql.indexOf('LANGUAGE plpgsql VOLATILE'),
    );
    expect(signature).not.toMatch(/token|digest|verifier|session_id/);
  });
  it('helper lock order is Tenant, complete Users, Session barrier, slot, Session, members, grants', () => {
    const helper = sql.slice(
      sql.indexOf('CREATE FUNCTION zhiban_identity.bridge_identity_context'),
    );
    const markers = [
      'FROM zhiban_identity.tenants AS t',
      'FROM zhiban_identity.users AS u',
      'pg_advisory_xact_lock_shared',
      'FROM zhiban_identity.credential_slots AS c',
      'FROM zhiban_identity.sessions AS s',
      'FOR v_member IN',
      'FOR v_grant IN',
    ];
    const offsets = markers.map((m) => helper.indexOf(m));
    expect(offsets.every((i) => i >= 0)).toBe(true);
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(helper).toContain('ORDER BY g.grant_id FOR SHARE');
  });
  it('production root cannot import provisioning or expose generic storage', () => {
    const source = readFileSync('lib/zhiban/infrastructure/openmaic/root.ts', 'utf8');
    expect(source).not.toMatch(
      /from ['"].*provision|ensureAssetSchema|ensureDocumentSchema|return.*nativeStore/,
    );
    expect(source).toContain('UnavailableBridgeResourceFacts');
    expect(source).not.toMatch(/enabled\s*[=:]/);
  });
  it('public provider imports never use upstream private storage internals', () => {
    for (const name of readdirSync('lib/zhiban/infrastructure/openmaic').filter((n) =>
      n.endsWith('.ts'),
    )) {
      const source = readFileSync(`lib/zhiban/infrastructure/openmaic/${name}`, 'utf8');
      expect(source).not.toMatch(/storage\/(asset\/references|.*\/internal)|packages\/@openmaic/);
    }
  });
  it('unavailable facts never turn a client relationship boolean into authority', async () => {
    expect(await new UnavailableBridgeResourceFacts().load({ relationship: true }, id)).toEqual({
      status: 'UNAVAILABLE',
    });
  });
  it('same-client transaction validates COMMIT and always releases', async () => {
    const c = connection();
    expect(
      await bridgeTransaction(c.pool, null, new Deadline(), async (client) => {
        await client.query('SELECT $1', [id]);
        return 'done';
      }),
    ).toBe('done');
    expect(c.calls[0].sql).toBe('BEGIN ISOLATION LEVEL READ COMMITTED');
    expect(c.calls.at(-1)?.sql).toBe('COMMIT');
    expect(c.calls.find((call) => call.sql === 'SELECT $1')?.values).toEqual([id]);
    expect(c.release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('aborted COMMIT cannot mint successful local outcome', async () => {
    const c = connection('ROLLBACK');
    await expect(
      bridgeTransaction(c.pool, null, new Deadline(), async () => undefined),
    ).rejects.toThrow(BridgeError);
    expect(c.calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(c.release).toHaveBeenCalledExactlyOnceWith(true);
  });
  it('provider custom code/cause are never propagated on rollback', async () => {
    const c = connection();
    const failure = Object.assign(new Error('private'), {
      code: '40001',
      cause: { material: 'private' },
    });
    await expect(
      bridgeTransaction(c.pool, null, new Deadline(), async () => {
        throw failure;
      }),
    ).rejects.toEqual(new BridgeError());
    expect(c.calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(c.release).toHaveBeenCalledExactlyOnceWith(false);
  });
  it('deadline destroys uncertain connection and prevents late callback queries', async () => {
    vi.useFakeTimers();
    try {
      const c = connection();
      let late!: () => void, retained: BridgePgClient | undefined;
      const wait = new Promise<void>((r) => {
        late = r;
      });
      const running = bridgeTransaction(c.pool, null, new Deadline(), async (client) => {
        retained = client;
        await wait;
        await client.query('SELECT late');
      });
      const rejection = expect(running).rejects.toThrow(BridgeError);
      await vi.advanceTimersByTimeAsync(10001);
      await rejection;
      expect(c.release).toHaveBeenCalledExactlyOnceWith(true);
      late();
      await Promise.resolve();
      await expect(retained!.query('SELECT late')).rejects.toThrow(BridgeError);
      expect(c.calls.some((call) => call.sql === 'SELECT late')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
  it('connection initialization is bounded too; a hung BEGIN cannot leak a checked-out client', async () => {
    vi.useFakeTimers();
    try {
      const c = connection();
      c.client.query = (async () => new Promise(() => {})) as BridgePgClient['query'];
      const pending = bridgeTransaction(c.pool, null, new Deadline(), async () => 'never');
      const failure = expect(pending).rejects.toThrow(BridgeError);
      await vi.advanceTimersByTimeAsync(10001);
      await failure;
      expect(c.release).toHaveBeenCalledExactlyOnceWith(true);
    } finally {
      vi.useRealTimers();
    }
  });
  it('a late pool connection is discarded after deadline without issuing SQL', async () => {
    vi.useFakeTimers();
    try {
      const c = connection();
      let connect!: (client: BridgePgClient) => void;
      const pool = {
        connect: () =>
          new Promise<BridgePgClient>((resolve) => {
            connect = resolve;
          }),
      };
      const pending = bridgeTransaction(pool, null, new Deadline(), async () => 'never');
      const failure = expect(pending).rejects.toThrow(BridgeError);
      await vi.advanceTimersByTimeAsync(10001);
      await failure;
      connect(c.client);
      await Promise.resolve();
      await Promise.resolve();
      expect(c.release).toHaveBeenCalledExactlyOnceWith(true);
      expect(c.calls).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
  it('copied handle rejects before digest-bearing SQL', async () => {
    const handle = Object.freeze({}) as AuthenticatedRequestHandle;
    const real = new WeakMap([[handle, { digest: 'a'.repeat(64), user: id, session: 'internal' }]]);
    const security = new BridgeSessionSecurity((h) => {
      const value = real.get(h);
      if (!value) throw new Error('private');
      return value;
    });
    const c = connection();
    await expect(
      security.assertCurrent(
        c.client,
        { ...handle },
        tenantScopeContext(tenantId(id)),
        membershipId(id),
        [],
      ),
    ).rejects.toThrow(BridgeError);
    expect(c.calls).toEqual([]);
  });
  it('canonical content identity ignores property order, not field changes', () => {
    expect(canonicalJson({ a: 1, b: { c: 2 } })).toBe(canonicalJson({ b: { c: 2 }, a: 1 }));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });
  it('slot mapper rejects foreign tenant, numeric revision, unexpected material and invalid state', () => {
    const row = Object.fromEntries(slotColumns.split(',').map((k) => [k, null]));
    Object.assign(row, {
      tenant_id: id,
      slot_id: id,
      activity_id: id,
      deployment_id: id,
      owner_membership_id: id,
      state: 'SUSPENDED',
      last_generation: '0',
      repository_revision: '1',
      created_at: '1000',
      updated_at: '1000',
    });
    expect(slotRecord(row, id).revision).toBe('1');
    for (const change of [
      { tenant_id: other },
      { repository_revision: 1 },
      { verifier: 'unwanted' },
      { state: 'UNKNOWN' },
    ])
      expect(() => slotRecord({ ...row, ...change }, id)).toThrow(BridgeError);
  });
  it('generation mapper rejects terminal revival and invalid principal encoding', () => {
    const row = Object.fromEntries(generationColumns.split(',').map((k) => [k, null]));
    Object.assign(row, {
      tenant_id: id,
      generation_id: id,
      slot_id: id,
      deployment_id: id,
      owner_membership_id: id,
      generation: '1',
      owner_handle: 'A'.repeat(43),
      stage_ref: 'stage',
      content_digest: 'a'.repeat(64),
      dsl_version: '0.11.2',
      state: 'PENDING',
      repository_revision: '1',
      created_at: '1000',
      updated_at: '1000',
    });
    expect(generationRecord(row, id).revision).toBe('1');
    expect(() => generationRecord({ ...row, state: 'ACTIVE' }, id)).toThrow(BridgeError);
    expect(() => generationRecord({ ...row, owner_handle: '!'.repeat(43) }, id)).toThrow(
      BridgeError,
    );
  });
});
