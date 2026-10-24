import { describe, expect, it, vi } from 'vitest';
import {
  expectedSchemaState,
  verifyNativeSchemaState,
} from '@/lib/zhiban/infrastructure/openmaic/schema-state';
import type { MigrationQueryable } from '@openmaic/storage/pg-migrations';

describe('Native receipt schema ledger acceptance', () => {
  it('accepts the complete immutable provider ledger using only a SELECT', async () => {
    const rows = await expectedSchemaState();
    const query = vi.fn(async () => ({ rows }));
    await verifyNativeSchemaState({ query } as MigrationQueryable);
    expect(query).toHaveBeenCalledExactlyOnceWith(
      'SELECT store,version,name,checksum FROM public.openmaic_schema_migrations ORDER BY store,version',
    );
  });
  it('rejects absent, incomplete, unknown, ahead and changed ledgers even in production', async () => {
    const rows = await expectedSchemaState();
    vi.stubEnv('NODE_ENV', 'production');
    try {
      const candidates = [
        [],
        rows.slice(1),
        [...rows, { ...rows[0], store: 'unknown' }],
        rows.map((row, i) => (i === 0 ? { ...row, version: 99 } : row)),
        rows.map((row, i) => (i === 0 ? { ...row, checksum: '0'.repeat(64) } : row)),
      ];
      for (const candidate of candidates)
        await expect(
          verifyNativeSchemaState({
            query: async () => ({ rows: candidate }),
          } as MigrationQueryable),
        ).rejects.toThrow('Native schema ledger rejected');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
