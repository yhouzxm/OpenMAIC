import { IDBFactory } from 'fake-indexeddb';
import 'fake-indexeddb/auto';
import { BrowserDocumentStore, BrowserRuntimeStore } from '@openmaic/storage';
import { DiagnosticBoundary } from './boundary';
import { authorityFixture, document, PNG, wav, WEBM } from './fixtures';

// Public browser backends in fake IndexedDB are local contract evidence, never PG evidence.
export async function createMemoryFixture() {
  const fixture = authorityFixture();
  const docs = new BrowserDocumentStore({ indexedDB: new IDBFactory(), dbName: 'diagnostic-docs' });
  const runtime = new BrowserRuntimeStore({
    indexedDB: new IDBFactory(),
    dbName: 'diagnostic-runtime',
  });
  for (const stage of Object.values(fixture.stages)) await docs.saveDocument(document(stage));
  for (const [id, binding] of fixture.authority.bindings)
    await runtime.createSession({
      id,
      stageId: binding.stage,
      learnerKey: binding.learner,
      kind: 'chat',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  const media = new Map([
    ['png', { bytes: PNG, mime: 'image/png', revision: 1 }],
    ['wav', { bytes: wav(), mime: 'audio/wav', revision: 1 }],
    ['webm', { bytes: WEBM, mime: 'video/webm', revision: 1 }],
  ]);
  const boundary = new DiagnosticBoundary(fixture.authority, {
    document: () => docs,
    runtime,
    asset: { resolve: async (_principal, ref) => media.get(ref) ?? null },
  });
  return { ...fixture, docs, runtime, boundary };
}
