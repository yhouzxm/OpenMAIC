/** Injected failure/authorization tests. Scanner and store doubles do not establish real clearance or PG success. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { makeDocument, makeSlideScene } from '../../agent-runtime/_stage-fixtures';
import type { ContentService } from '@/lib/zhiban/infrastructure/content/service';
import { ContentError } from '@/lib/zhiban/infrastructure/content/model';
const io = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/server/agent-runtime/owner-scoped-documents', () => ({
  getOwnerScopedDocumentStore: async () => ({ loadDocument: io.load, saveDocument: io.save }),
}));
vi.mock('@/lib/persistence/server-provider', () => ({
  getServerPersistenceProvider: async () => ({ assetStore: { put: io.put } }),
}));
import { NativeArchiveService } from '@/lib/zhiban/infrastructure/authoring/archive/service';
import type { SubmissionFileClearance } from '@/lib/zhiban/application/learning/attachment-assets';
function setup() {
  let allowed = true,
    stored: unknown = null;
  const query = vi.fn(async (sql: string) => ({
    rows: sql.includes('pg_try_advisory_lock') ? [{ held: true }] : [],
  }));
  const pool = { connect: async () => ({ query, release: vi.fn() }) } as unknown as Pool;
  const content = {
    authoring: async (_x: unknown, work: () => Promise<unknown>) => {
      if (!allowed) throw new ContentError('FORBIDDEN', 403);
      return work();
    },
  } as ContentService;
  const bytes = Buffer.from('injected bounded input'),
    digest = createHash('sha256').update(bytes).digest('hex');
  const clear = vi.fn(async () => ({
    mode: 'TRUSTED_SCANNER' as const,
    digest,
    reference: 'INJECTED_NOT_REAL_CLEARANCE',
  }));
  const service = new NativeArchiveService(content, pool, {
    mode: 'TRUSTED_SCANNER',
    check: vi.fn(),
    checkArchive: clear,
  } as SubmissionFileClearance);
  const doc = makeDocument('source', 'test', [makeSlideScene('scene', 'source', 0)]);
  const parse = vi
    .spyOn(service, 'parse')
    .mockResolvedValue({ document: doc, assets: [], digest, kind: 'maic' });
  io.load.mockImplementation(async () => stored);
  io.save.mockImplementation(async (d: unknown) => {
    stored = structuredClone(d);
  });
  const restore = (signal = new AbortController().signal) =>
    service.restore({} as never, bytes, 'maic', digest, 'fixed-key', signal);
  return {
    service,
    clear,
    parse,
    restore,
    digest,
    bytes,
    query,
    revoke: () => {
      allowed = false;
    },
    get: () => stored,
  };
}
beforeEach(() => {
  io.load.mockReset();
  io.save.mockReset();
  io.put.mockReset();
});
describe('native archive restore commit boundaries (injected)', () => {
  it('refuses to export a file that its own restore entry limit would reject', async () => {
    const s = setup();
    const doc = makeDocument('source', 'limit', [makeSlideScene('scene', 'source', 0)]);
    const bytes = Buffer.alloc(32 * 1024 * 1024 + 1);
    await expect(
      s.service.encode(
        doc,
        [
          {
            ref: 'owned',
            path: 'media/asset-0',
            mime: 'image/png',
            digest: 'bounded',
            size: bytes.length,
            bytes,
          },
        ],
        'source',
      ),
    ).rejects.toMatchObject({ code: 'ARCHIVE_TOO_LARGE', status: 413 });
  });
  it('rejects authorization before parsing or scanning attacker bytes', async () => {
    const s = setup();
    s.revoke();
    await expect(s.restore()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(s.parse).not.toHaveBeenCalled();
    expect(s.clear).not.toHaveBeenCalled();
  });
  it('refuses a changed archive before scanner or store effects', async () => {
    const s = setup();
    await expect(
      s.service.restore(
        {} as never,
        s.bytes,
        'maic',
        '0'.repeat(64),
        'key',
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'ARCHIVE_CHANGED' });
    expect(s.clear).not.toHaveBeenCalled();
    expect(io.save).not.toHaveBeenCalled();
  });
  it('rechecks the original request authorization after scanning', async () => {
    const s = setup();
    s.clear.mockImplementation(async () => {
      s.revoke();
      return {
        mode: 'TRUSTED_SCANNER',
        digest: s.digest,
        reference: 'INJECTED_NOT_REAL_CLEARANCE',
      };
    });
    await expect(s.restore()).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(io.save).not.toHaveBeenCalled();
    expect(s.query.mock.calls.some(([sql]) => sql.includes('pg_advisory_unlock'))).toBe(true);
  });
  it('cancellation after scanner completion prevents the atomic write', async () => {
    const s = setup(),
      abort = new AbortController();
    s.clear.mockImplementation(async () => {
      abort.abort();
      return {
        mode: 'TRUSTED_SCANNER',
        digest: s.digest,
        reference: 'INJECTED_NOT_REAL_CLEARANCE',
      };
    });
    await expect(s.restore(abort.signal)).rejects.toMatchObject({ code: 'ARCHIVE_CANCELLED' });
    expect(io.save).not.toHaveBeenCalled();
  });
  it('a lost save ACK is reconciled without deleting or overwriting another stage', async () => {
    const s = setup();
    const original = io.save.getMockImplementation()!;
    io.save.mockImplementation(async (doc) => {
      await original(doc);
      throw Error('lost response after commit');
    });
    const first = await s.restore();
    expect(first.alreadyExists).toBe(false);
    const retry = await s.restore();
    expect(retry.stageId).toBe(first.stageId);
    expect(retry.alreadyExists).toBe(true);
    expect(io.save).toHaveBeenCalledTimes(1);
    expect(s.clear).toHaveBeenCalledTimes(1);
  });
});
