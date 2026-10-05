import { describe, it, expect } from 'vitest';
import { BridgeRepository } from '@/lib/zhiban/infrastructure/openmaic/repository';
import { BridgeError } from '@/lib/zhiban/infrastructure/openmaic/validation';
import {
  slotColumns,
  sceneColumns,
  sceneRecord,
  assetColumns,
  assetRecord,
} from '@/lib/zhiban/infrastructure/openmaic/records';
import type { BridgePgClient } from '@/lib/zhiban/infrastructure/openmaic/transactions';
const id = '00000000-0000-7000-8000-000000000001';
function repository(rev = '1', state = 'SUSPENDED') {
  const row = Object.fromEntries(slotColumns.split(',').map((key) => [key, null]));
  Object.assign(row, {
    tenant_id: id,
    slot_id: id,
    activity_id: id,
    deployment_id: id,
    owner_membership_id: id,
    state,
    last_generation: '0',
    repository_revision: rev,
    created_at: '1000',
    updated_at: '1000',
  });
  const calls: { sql: string; parameters?: unknown[] }[] = [];
  const query = async (sql: string, parameters?: unknown[]) => {
    calls.push({ sql, parameters });
    if (sql.startsWith('SELECT ' + slotColumns))
      return { rows: [row], rowCount: 1, command: 'SELECT' };
    if (sql.startsWith('SELECT coalesce(max(generation)'))
      return { rows: [{ maximum: '0', active: 0, current: 0 }], rowCount: 1, command: 'SELECT' };
    if (sql.startsWith('UPDATE')) return { rows: [], rowCount: 1, command: 'UPDATE' };
    throw new Error('Unexpected query in SQL ordering test');
  };
  return {
    calls,
    repo: new BridgeRepository({ query, release: () => {} } as unknown as BridgePgClient, id),
  };
}
describe('Bridge repository SQL and persisted boundaries', () => {
  it('stale is checked before an otherwise true SUSPEND no-op', async () => {
    const { repo, calls } = repository();
    await expect(repo.setState(id, '2', 'SUSPENDED', 1001)).rejects.toThrow(BridgeError);
    expect(calls.every((c) => c.sql.startsWith('SELECT'))).toBe(true);
    expect(calls[0].sql.endsWith('FOR UPDATE')).toBe(true);
    expect(calls[0].parameters).toEqual([id, id]);
  });
  it('true no-op preserves revision and issues no UPDATE or audit', async () => {
    const { repo, calls } = repository();
    expect(await repo.setState(id, '1', 'SUSPENDED', 1001)).toBe('1');
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.sql.startsWith('SELECT'))).toBe(true);
  });
  it('signed int8 mutation uses exact +1 decimal SQL CAS parameters, never Number', async () => {
    const { repo, calls } = repository('9007199254740993');
    expect(await repo.setState(id, '9007199254740993', 'TRANSFERRING', 1001)).toBe(
      '9007199254740994',
    );
    const change = calls.find((c) => c.sql.startsWith('UPDATE'))!;
    expect(change.sql).toContain('AND repository_revision=$8');
    expect(change.parameters).toEqual([
      'TRANSFERRING',
      null,
      null,
      '9007199254740994',
      '1001',
      id,
      id,
      '9007199254740993',
    ]);
  });
  it('max revision mutation fails before mutation SQL but max true no-op remains valid', async () => {
    const { repo, calls } = repository('9223372036854775807');
    await expect(repo.setState(id, '9223372036854775807', 'TRANSFERRING', 1001)).rejects.toThrow(
      BridgeError,
    );
    expect(calls.some((c) => c.sql.startsWith('UPDATE'))).toBe(false);
    expect(await repo.setState(id, '9223372036854775807', 'SUSPENDED', 1001)).toBe(
      '9223372036854775807',
    );
  });
  it('malformed aggregate facts reject even if the slot row is structurally valid', async () => {
    const { repo } = repository();
    const raw = repo.client.query;
    repo.client.query = (async (sql: string, params?: unknown[]) =>
      sql.startsWith('SELECT coalesce(max(generation)')
        ? { rows: [{ maximum: '1', active: 0, current: 0 }], rowCount: 1, command: 'SELECT' }
        : raw(sql, params)) as BridgePgClient['query'];
    await expect(repo.loadSlot(id, 'SHARE')).rejects.toThrow(BridgeError);
  });
  it('scene mapper closes UUID, ordinal, digest and timestamp shape', () => {
    const row = Object.fromEntries(sceneColumns.split(',').map((key) => [key, id]));
    Object.assign(row, {
      scene_ref: 'scene',
      scene_ordinal: '0',
      scene_digest: 'a'.repeat(64),
      created_at: '1000',
    });
    expect(sceneRecord(row, id).ordinal).toBe(0);
    for (const changes of [
      { scene_ordinal: '64' },
      { scene_ordinal: 0 },
      { scene_digest: 'broken' },
      { created_at: '-1' },
      { tenant_id: 'foreign' },
    ])
      expect(() => sceneRecord({ ...row, ...changes }, id)).toThrow(BridgeError);
  });
  it('asset mapper closes MIME/purpose, provider revision, bounded bytes and principal', () => {
    const row = Object.fromEntries(assetColumns.split(',').map((key) => [key, id]));
    Object.assign(row, {
      principal_handle: 'A'.repeat(43),
      asset_ref: 'public-ID',
      purpose: 'IMAGE',
      mime: 'image/png',
      byte_length: '1',
      byte_digest: 'a'.repeat(64),
      provider_revision: '1',
      created_at: '1000',
    });
    expect(assetRecord(row, id).length).toBe(1);
    for (const changes of [
      { mime: 'text/html' },
      { purpose: 'ARBITRARY' },
      { principal_handle: 'invalid' },
      { byte_length: '4194305' },
      { provider_revision: '01' },
    ])
      expect(() => assetRecord({ ...row, ...changes }, id)).toThrow(BridgeError);
  });
});
