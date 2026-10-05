import { describe, expect, it, vi } from 'vitest';
import { provisionNative } from '@/lib/zhiban/infrastructure/openmaic/provision';
import { BridgeError } from '@/lib/zhiban/infrastructure/openmaic/validation';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';

// Exercise the actual public ensure* providers against a connection contract.
// Schema resolution and DDL parsing still require the native real PG16 suite.
function maintenance(failAt?: string) {
  const calls: string[] = [],
    creates: string[] = [];
  const release = vi.fn();
  let owner = false,
    creationPath = false;
  const pool = {
    connect: async () => ({
      query: async (sql: string) => {
        calls.push(sql);
        if (sql === 'SET LOCAL ROLE zhiban_openmaic_owner') owner = true;
        if (sql.startsWith('SET LOCAL search_path='))
          creationPath = sql === 'SET LOCAL search_path=public,pg_catalog,pg_temp';
        if (/^\s*CREATE (?:TABLE|INDEX|(?:OR REPLACE )?FUNCTION)/i.test(sql)) {
          if (!owner || !creationPath) throw new Error('DDL attempted outside maintenance public');
          creates.push(sql);
        }
        if (failAt && sql.includes(failAt))
          throw Object.assign(new Error('synthetic private SQL detail'), { code: '42501' });
        if (sql === 'SELECT session_user,current_database() AS db')
          return { rows: [{ session_user: 'zhiban_openmaic_migrator', db: 'synthetic_native' }] };
        if (sql.startsWith('SELECT count(*)::integer')) return { rows: [{ n: 0 }] };
        if (sql.startsWith('SELECT jsonb_build_object('))
          return { rows: [{ catalog: 'synthetic-public-catalog' }] };
        return { rows: [], command: sql === 'COMMIT' ? 'COMMIT' : 'SELECT' };
      },
      release,
    }),
  } as unknown as TransactionPool;
  return { pool, calls, creates, release };
}

describe('native maintenance provisioning transaction', () => {
  it('runs public asset/document DDL in owner-only public, then restores catalog-first before ACL', async () => {
    const fixture = maintenance();
    const receipt = await provisionNative(fixture.pool, 'synthetic_native', 'synthetic-approval');
    expect(receipt.database).toBe('synthetic_native');
    expect(
      fixture.creates.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS asset_blobs')),
    ).toBe(true);
    expect(
      fixture.creates.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS document_stages')),
    ).toBe(true);
    const restore = fixture.calls.indexOf('SET LOCAL search_path=pg_catalog,public,pg_temp');
    expect(restore).toBeGreaterThan(fixture.calls.indexOf(fixture.creates.at(-1)!));
    expect(restore).toBeLessThan(fixture.calls.findIndex((sql) => sql.startsWith('REVOKE ALL')));
    expect(fixture.calls.at(-1)).toBe('COMMIT');
    expect(fixture.release).toHaveBeenCalledExactlyOnceWith(false);
    expect(fixture.calls).not.toContain(
      'GRANT CREATE ON SCHEMA pg_catalog TO zhiban_openmaic_owner',
    );
  });

  it('failed public provisioning rolls back without ACL grants, receipt, or crypto/SQL cause leakage', async () => {
    const fixture = maintenance('CREATE TABLE IF NOT EXISTS asset_entries');
    await expect(
      provisionNative(fixture.pool, 'synthetic_native', 'synthetic-approval'),
    ).rejects.toEqual(new BridgeError());
    expect(fixture.calls.at(-1)).toBe('ROLLBACK');
    expect(fixture.calls).not.toContain('COMMIT');
    expect(fixture.calls.some((sql) => sql.startsWith('GRANT '))).toBe(false);
    expect(fixture.release).toHaveBeenCalledExactlyOnceWith(false);
  });
});
