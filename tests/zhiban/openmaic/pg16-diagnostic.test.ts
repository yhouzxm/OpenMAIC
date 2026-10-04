import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { PgRuntimeStore, type Queryable } from '@openmaic/storage/runtime/pg';
import { DiagnosticBoundary, DiagnosticRejected } from './boundary';
import { createPgFixture } from './pg-harness';
import { document } from './fixtures';
import { startHost } from './host';
import { installEgressFence } from './egress';

if (process.env.B0_PG16_REQUIRED === '1' && !process.env.B0_PG16_URL) {
  throw new Error('DIAGNOSTIC_PG16_REQUIRED');
}
const enabled = Boolean(process.env.B0_PG16_URL);
describe.skipIf(!enabled)('D01-D07 real PG16 package boundary proof', () => {
  let f: Awaited<ReturnType<typeof createPgFixture>>;
  let releaseFixture: (() => Promise<void>) | undefined;
  const closers: (() => Promise<void>)[] = [];
  beforeEach(async () => {
    // A failed fixture setup must not leave the previous (already ended) pool as cleanup target.
    releaseFixture = undefined;
    f = await createPgFixture();
    releaseFixture = f.close;
  });
  afterEach(async () => {
    try {
      for (const close of closers.splice(0)) await close();
    } finally {
      await releaseFixture?.();
    }
  });
  test('B0-PG01 exact disposable PG16 and private pool budget', async () => {
    expect(f.version.startsWith('16.')).toBe(true);
    const database = await f.pool.query<{ current_database: string }>('SELECT current_database()');
    expect(database.rows[0].current_database).toBe('zhiban_0b_capability_test');
    expect(f.pool.options.max).toBe(2);
  });
  test('B0-PG02 published schemas are idempotent; document/asset/runtime controls round-trip', async () => {
    const doc = await f.boundary.document('studentA1', f.stages.A);
    expect(doc.scenes.length).toBe(1);
    expect((await f.boundary.runtime('studentA1', f.sessions.A)).id).toBe(f.sessions.A);
    const id = f.media.get(f.stages.A)!.image;
    expect((await f.boundary.bytes('studentA1', f.stages.A, id)).bytes.length).toBeGreaterThan(8);
  });
  test('B0-PG03 document owner binding is not a read gate; wrapper denies foreign id before call', async () => {
    const storeA = f.stores.get(f.authority.mappings.get(f.stages.A)!.owner)!;
    expect((await storeA.loadDocument(f.stages.B))?.stage.id).toBe(f.stages.B);
    await expect(f.boundary.document('studentA1', f.stages.B)).rejects.toThrow(DiagnosticRejected);
    expect(f.boundary.calls.document).toBe(0);
  });
  test('B0-PG04 registry principal rejects foreign bytes; wrapper also denies cross-tenant', async () => {
    const assetB = f.media.get(f.stages.B)!.image;
    const principal = { key: f.authority.mappings.get(f.stages.A)!.owner };
    expect(await f.asset.resolve(principal, assetB)).toBeNull();
    await expect(f.boundary.bytes('studentA1', f.stages.B, assetB)).rejects.toThrow(
      DiagnosticRejected,
    );
    expect(f.boundary.calls.asset).toBe(0);
  });
  test('B0-PG05 unrelated asset in same partition and tenant-admin lack read permission', async () => {
    await expect(
      f.boundary.bytes('studentA1', f.stages.A, f.media.get(f.stages.A)!.hidden),
    ).rejects.toThrow(DiagnosticRejected);
    await expect(f.boundary.document('adminA', f.stages.A)).rejects.toThrow(DiagnosticRejected);
    expect(f.boundary.calls.asset + f.boundary.calls.document).toBe(0);
  });
  test('B0-PG06 copied URL/range/HEAD/cache cannot bypass current mapping', async () => {
    const host = await startHost(f.boundary);
    closers.push(host.close);
    const url = `${host.origin}/diag/assets/${f.stages.A}/${f.media.get(f.stages.A)!.image}`;
    const headers = { authorization: `Bearer ${f.credential.studentA1}` };
    expect((await fetch(url)).status).toBe(403);
    const range = await fetch(url, { headers: { ...headers, range: 'bytes=0-7' } });
    expect(range.status).toBe(206);
    expect((await range.arrayBuffer()).byteLength).toBe(8);
    expect(range.headers.get('cache-control')).toBe('private, no-store');
    expect((await fetch(url, { method: 'HEAD', headers })).status).toBe(200);
    f.authority.mappings.get(f.stages.A)!.state = 'REVOKED';
    expect((await fetch(url, { headers })).status).toBe(403);
  });
  test('B0-PG07 active and spoofed media remain unreadable through real asset registry', async () => {
    const mapping = f.authority.mappings.get(f.stages.A)!;
    for (const mime of ['text/html', 'image/svg+xml', 'image/png']) {
      const id = await f.asset.put(
        { key: mapping.owner },
        new Blob(['<script>hostile</script>'], { type: mime }),
      );
      mapping.assets.add(id);
      await expect(f.boundary.bytes('studentA1', f.stages.A, id)).rejects.toThrow(
        DiagnosticRejected,
      );
    }
  });
  test('B0-PG08 same-tenant learner/session forgery denied before runtime fetch', async () => {
    for (const alias of ['studentA2', 'studentB', 'teacherA']) {
      await expect(f.boundary.runtime(alias, f.sessions.A)).rejects.toThrow(DiagnosticRejected);
    }
    expect(f.boundary.calls.runtime).toBe(0);
  });
  test('B0-PG09 stage/attempt binding mismatch and missing session fail closed', async () => {
    f.authority.bindings.get(f.sessions.A)!.attempt = '';
    await expect(f.boundary.runtime('studentA1', f.sessions.A)).rejects.toThrow(DiagnosticRejected);
    f.authority.bindings.get(f.sessions.A)!.attempt = 'fixture-attempt';
    await f.runtime.deleteSession(f.sessions.A);
    await expect(f.boundary.runtime('studentA1', f.sessions.A)).rejects.toThrow(DiagnosticRejected);
  });
  test('B0-PG10 append tail CAS and stale rejection preserve one persisted record', async () => {
    expect((await f.boundary.append('studentA1', f.sessions.A, null, 'fixture')).seq).toBe(0);
    await expect(f.boundary.append('studentA1', f.sessions.A, null, 'stale')).rejects.toThrow(
      DiagnosticRejected,
    );
    expect((await f.runtime.listRecords(f.sessions.A)).length).toBe(1);
  });
  test('B0-PG11 concurrent append uses acknowledged independent PG connections; exactly one succeeds', async () => {
    let entered = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pids = new Set<number>();
    const runtime = new PgRuntimeStore(f.pool as Queryable, {
      withTransaction: (body) =>
        f.withTransaction(async (client) => {
          if (entered < 2) {
            const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
            pids.add(result.rows[0].pid);
            entered++;
            if (entered === 2) release();
            await barrier;
          }
          return body(client);
        }),
    });
    const boundary = new DiagnosticBoundary(f.authority, {
      document: (owner) => f.stores.get(owner)!,
      asset: f.asset,
      runtime,
    });
    const outcomes = await Promise.allSettled([
      boundary.append('studentA1', f.sessions.A, null, 'one'),
      boundary.append('studentA1', f.sessions.A, null, 'two'),
    ]);
    expect(pids.size).toBe(2);
    expect(outcomes.filter((row) => row.status === 'fulfilled').length).toBe(1);
    expect(outcomes.filter((row) => row.status === 'rejected').length).toBe(1);
    expect((await f.runtime.listRecords(f.sessions.A)).length).toBe(1);
  });
  test('B0-PG12 terminal runtime rejects read/append', async () => {
    await f.runtime.setSessionStatus(f.sessions.A, 'completed', new Date().toISOString());
    await expect(f.boundary.append('studentA1', f.sessions.A, null, 'fixture')).rejects.toThrow(
      DiagnosticRejected,
    );
    expect((await f.runtime.listRecords(f.sessions.A)).length).toBe(0);
  });
  test.each(['PENDING', 'ORPHAN', 'TRANSFERRING', 'REVOKED'] as const)(
    'B0-PG13 %s mapping blocks document before SQL',
    async (state) => {
      f.authority.mappings.get(f.stages.A)!.state = state;
      await expect(f.boundary.document('studentA1', f.stages.A)).rejects.toThrow(
        DiagnosticRejected,
      );
      expect(f.boundary.calls.document).toBe(0);
    },
  );
  test('B0-PG14 batch/listing never disclose foreign document', async () => {
    expect((await f.boundary.list('studentA1')).map((doc) => doc.stage.id)).toEqual([f.stages.A]);
    const count = f.boundary.calls.document;
    await expect(f.boundary.batch('studentA1', [f.stages.A, f.stages.B])).rejects.toThrow(
      DiagnosticRejected,
    );
    expect(f.boundary.calls.document).toBe(count);
  });
  test('B0-PG15 controlled save advances fixture CAS and public document freshness; stale write denied', async () => {
    const store = f.stores.get(f.authority.mappings.get(f.stages.A)!.owner)!;
    const before = await store.readFreshnessManifest(f.stages.A);
    const doc = await f.boundary.document('teacherA', f.stages.A);
    doc.stage.name = 'Updated synthetic name';
    await f.boundary.save('teacherA', f.stages.A, '1', doc);
    expect(f.authority.mappings.get(f.stages.A)!.revision).toBe('2');
    const after = await store.readFreshnessManifest(f.stages.A);
    expect(after!.rev).toBeGreaterThan(before!.rev);
    await expect(f.boundary.save('teacherA', f.stages.A, '1', doc)).rejects.toThrow(
      DiagnosticRejected,
    );
    expect((await store.loadDocument(f.stages.A))?.stage.name).toBe('Updated synthetic name');
  });
  test('B0-PG16 invalid external write cannot activate pending mapping or alter persisted document', async () => {
    const invalid = document(f.stages.A);
    invalid.stage.name = '';
    await expect(f.boundary.save('teacherA', f.stages.A, '1', invalid)).rejects.toThrow(
      DiagnosticRejected,
    );
    expect(f.authority.mappings.get(f.stages.A)!.state).toBe('ORPHAN');
    const store = f.stores.get(f.authority.mappings.get(f.stages.A)!.owner)!;
    expect((await store.loadDocument(f.stages.A))?.stage.name).toBe('Duplicate fixture name');
  });
  test('B0-PG17 disabled subject and foreign deployment fail before package call', async () => {
    f.authority.subjects.get('studentA1')!.active = false;
    await expect(f.boundary.document('studentA1', f.stages.A)).rejects.toThrow(DiagnosticRejected);
    f.authority.subjects.get('studentA1')!.active = true;
    f.authority.mappings.get(f.stages.A)!.deployment = 'foreign-deployment';
    await expect(f.boundary.document('studentA1', f.stages.A)).rejects.toThrow(DiagnosticRejected);
    expect(f.boundary.calls.document).toBe(0);
  });
  test('B0-PG18 API-level egress fence permits actual PG and denies external fetch', async () => {
    const port = Number(new URL(process.env.B0_PG16_URL!).port || 5432);
    const fence = installEgressFence([port]);
    try {
      expect((await f.boundary.document('studentA1', f.stages.A)).stage.id).toBe(f.stages.A);
      await expect(fetch('https://outside.invalid')).rejects.toThrow('DIAGNOSTIC_EGRESS_DENIED');
      expect(fence.denied).toBe(1);
    } finally {
      fence.close();
    }
  });
  test('B0-PG19 closed native/admin/iframe/stream paths never dispatch a package call', async () => {
    const host = await startHost(f.boundary);
    closers.push(host.close);
    for (const path of [
      '/api/stages',
      '/api/agent/runtime',
      '/diag/iframe',
      '/diag/stream',
      '/diag/runtime/admin/merge',
    ]) {
      const response = await fetch(`${host.origin}${path}`, {
        headers: { authorization: `Bearer ${f.credential.studentA1}` },
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ outcome: 'DIAGNOSTIC_REJECTED' });
    }
    expect(Object.values(f.boundary.calls).reduce((sum, count) => sum + count, 0)).toBe(0);
  });
  test('B0-PG20 pool releases all checked-out clients and ends cleanly', async () => {
    await f.boundary.document('studentA1', f.stages.A);
    expect(f.pool.totalCount - f.pool.idleCount).toBe(0);
    expect(f.pool.waitingCount).toBe(0);
  });
  test('B0-PG21 authority revoked after SQL but before COMMIT rolls back runtime append', async () => {
    const boundary = new DiagnosticBoundary(f.authority, {
      document: (owner) => f.stores.get(owner)!,
      asset: f.asset,
      runtime: f.runtime,
      runtimeMutation: (check) =>
        new PgRuntimeStore(f.pool as Queryable, {
          withTransaction: (body) =>
            f.withTransaction(async (client) => {
              check();
              const result = await body(client);
              f.authority.mappings.get(f.stages.A)!.state = 'REVOKED';
              check();
              return result;
            }),
        }),
    });
    await expect(boundary.append('studentA1', f.sessions.A, null, 'fixture')).rejects.toThrow(
      DiagnosticRejected,
    );
    expect((await f.runtime.listRecords(f.sessions.A)).length).toBe(0);
    expect(f.pool.totalCount - f.pool.idleCount).toBe(0);
  });
  test('B0-PG22 persisted runtime identity corruption is not repaired or accepted', async () => {
    await f.pool.query('UPDATE runtime_sessions SET learner_key = $1 WHERE id = $2', [
      'foreign-learner',
      f.sessions.A,
    ]);
    await expect(f.boundary.runtime('studentA1', f.sessions.A)).rejects.toThrow(DiagnosticRejected);
    const persisted = await f.pool.query<{ learner_key: string }>(
      'SELECT learner_key FROM runtime_sessions WHERE id = $1',
      [f.sessions.A],
    );
    expect(persisted.rows[0].learner_key).toBe('foreign-learner');
  });
});
