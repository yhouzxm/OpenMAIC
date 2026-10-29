/** Synthetic legacy-original fixture on an actual disposable PG16. No model, external DSN or existing state. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { getServerPersistenceProvider } from '../../lib/persistence/server-provider';
import {
  configureMaterialByteStore,
  LocalMaterialByteStore,
} from '../../lib/server/materials/bytes';
import { upgradeMaterialPointers130 } from './material-upgrade-130';
import { assetPrincipalForOwner } from '../../lib/persistence/owner-assets';
const bin = '/usr/lib/postgresql/16/bin';
async function main() {
  assert.ok(!process.env.DATABASE_URL, 'External DSN refused');
  const root = await mkdtemp(join(tmpdir(), 'zhiban-material-upgrade-130-')),
    data = join(root, 'data'),
    socket = join(root, 'socket');
  const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: 'pipe' });
  let started = false;
  let pool: Pool | undefined;
  try {
    await mkdir(socket, { mode: 0o700 });
    run(join(bin, 'initdb'), [
      '-D',
      data,
      '-U',
      'postgres',
      '--auth-local=trust',
      '--auth-host=reject',
      '--encoding=UTF8',
      '--no-locale',
    ]);
    run(join(bin, 'pg_ctl'), [
      '-D',
      data,
      '-l',
      join(root, 'postgres.log'),
      '-o',
      `-p 56542 -k ${socket} -c listen_addresses=''`,
      '-w',
      'start',
    ]);
    started = true;
    const url = `postgresql:///postgres?host=${encodeURIComponent(socket)}&port=56542&user=postgres`;
    process.env.DATABASE_URL = url;
    const provider = await getServerPersistenceProvider(url);
    pool = provider.pool;
    const store = new LocalMaterialByteStore(join(root, 'originals'));
    configureMaterialByteStore(store);
    const bytes = Buffer.from('v1.2 original retained through v1.3 owner-pool migration'),
      sha = createHash('sha256').update(bytes).digest('hex');
    for (const [id, digest] of [
      ['mat_good', sha],
      ['mat_bad', '0'.repeat(64)],
    ]) {
      await store.put(id, bytes);
      await pool.query(
        "INSERT INTO owner_material(id,owner_id,kind,mime,bytes,original_name,oss_key,sha256,status,extraction,created_at) VALUES($1,'course-author:fixture','source','text/plain',$2,'original.txt',$1,$3,'ready','{\"status\":\"done\"}',1)",
        [id, bytes.length, digest],
      );
    }
    await assert.rejects(upgradeMaterialPointers130(provider), /skippedDigest/);
    assert.deepEqual(await store.get('mat_bad'), bytes);
    const good = (
      await pool.query("SELECT asset_id,oss_key FROM owner_material WHERE id='mat_good'")
    ).rows[0];
    assert.ok(good.asset_id);
    assert.equal(good.oss_key, '');
    assert.equal(
      await provider.assetStore.resolve(assetPrincipalForOwner('another-owner'), good.asset_id),
      null,
    );
    await pool.query("UPDATE owner_material SET sha256=$1 WHERE id='mat_bad'", [sha]);
    const retry = await upgradeMaterialPointers130(provider);
    assert.equal(retry.migrated, 1);
    const idempotent = await upgradeMaterialPointers130(provider);
    assert.equal(idempotent.scanned, 0);
    for (const row of (await pool.query('SELECT asset_id FROM owner_material')).rows) {
      const read = await provider.assetStore.resolve(
        assetPrincipalForOwner('course-author:fixture'),
        row.asset_id,
      );
      assert.ok(read);
      assert.deepEqual(Buffer.from(read.bytes), bytes);
    }
    await assert.rejects(readFile(join(root, 'originals/mat_good')));
    await assert.rejects(readFile(join(root, 'originals/mat_bad')));
    console.log(
      JSON.stringify({
        status: 'PASS',
        evidenceOrigin: 'LOCAL',
        githubActions: false,
        scope: 'SYNTHETIC_LEGACY_ORIGINALS_REAL_PG16_OWNER_ROOT_BYTE_HASH_RETRY_AND_IDEMPOTENCE',
        realSnapshotBackfilled: false,
        modelCalled: false,
      }),
    );
  } finally {
    await pool?.end();
    if (started) run(join(bin, 'pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
