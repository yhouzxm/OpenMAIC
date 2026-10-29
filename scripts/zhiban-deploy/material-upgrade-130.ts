/** Explicit offline copy operation; native publication/root/byte verification remains owner scoped. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { ServerPersistenceProvider } from '../../lib/persistence/server-provider';
import { assetPrincipalForOwner } from '../../lib/persistence/owner-assets';
import { CLASSIC_EXTRACTION_SQL } from '../../lib/persistence/material-extraction-format';
import { migrateOwnerMaterialsToPool } from '../../lib/server/materials/migrate-to-pool';
export async function upgradeMaterialPointers130(provider: ServerPersistenceProvider) {
  const before = (
    await provider.pool.query(`SELECT id,owner_id,asset_id,oss_key,sha256,bytes,
    (kind='source' AND status='ready' AND deleted_at IS NULL AND NOT COALESCE(${CLASSIC_EXTRACTION_SQL},false)) AS eligible
    FROM owner_material ORDER BY id`)
  ).rows;
  const report = await migrateOwnerMaterialsToPool({ pauseMs: 0 });
  for (const k of [
    'skippedMissing',
    'skippedDigest',
    'skippedQuota',
    'skippedLost',
    'failed',
  ] as const)
    assert.equal(report[k], 0, 'Incomplete material pool migration: ' + k);
  for (const old of before) {
    const row = (
      await provider.pool.query('SELECT asset_id,oss_key FROM owner_material WHERE id=$1', [old.id])
    ).rows[0];
    assert.ok(row, 'Material lost during upgrade');
    if (!old.eligible || (!old.oss_key && !old.asset_id)) {
      assert.equal(row.asset_id, old.asset_id);
      assert.equal(row.oss_key, old.oss_key);
      continue;
    }
    if (old.asset_id) assert.equal(row.asset_id, old.asset_id, 'Existing pointer replaced');
    assert.ok(row.asset_id, 'Ready original has no pool pointer');
    const read = await provider.assetStore.resolve(
      assetPrincipalForOwner(old.owner_id),
      row.asset_id,
    );
    assert.ok(read, 'Pool original unreadable for its owner');
    assert.equal(
      createHash('sha256').update(read.bytes).digest('hex'),
      old.sha256,
      'Original digest changed',
    );
    assert.equal(read.bytes.byteLength, Number(old.bytes), 'Original length changed');
    const roots = await provider.pool.query(
      "SELECT 1 FROM asset_root_refs WHERE root_kind='material' AND root_id=$1 AND asset_id=$2",
      [old.id, row.asset_id],
    );
    assert.equal(roots.rowCount, 1, 'Committed original is not rooted');
  }
  return report;
}
