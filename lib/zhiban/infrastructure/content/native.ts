import { checkInteractiveDocument, type interactiveDocument } from './interactive';
import { documentOwnership } from '../openmaic/document-ownership';
import { bridgeTransaction, Deadline } from '../openmaic/transactions';
import { PgDocumentStore } from '@openmaic/storage/document/pg';
import type { Pool } from 'pg';
import { hash, canonical, requireContent } from './model';
import type { MaicDocument } from '@openmaic/storage';
import type { AssetExpectations } from '../openmaic/content';
import { pngStorageDocument, validatePngDocument } from './png';
// Private infrastructure adapter. Each public store operation gets a fresh native transaction.
export class TextNative {
  constructor(private readonly pool: Pool) {}
  private store(owner: string, finalCheck: () => Promise<void>, deadline: Deadline) {
    const withTransaction = async (body: any) =>
      bridgeTransaction(
        this.pool,
        null,
        deadline,
        async (c) => {
          await c.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
          return body({
            query: async (sql: string, p?: any[]) => ({ rows: (await c.query(sql, p)).rows }),
          });
        },
        finalCheck,
      );
    return new PgDocumentStore(
      { query: (sql, p) => withTransaction((q: any) => q.query(sql, p)) },
      { ownerId: owner, documentOwnership, trackAssetReferences: true, withTransaction },
    );
  }

  async save(owner: string, doc: any, finalCheck: () => Promise<void>, deadline: Deadline) {
    const store = this.store(owner, finalCheck, deadline);
    requireContent((await store.loadDocument(doc.stage.id)) === null, 'CONFLICT', 409);
    await store.saveDocument(doc);
  }
  async read(
    owner: string,
    stage: string,
    expected: string,
    finalCheck: () => Promise<void>,
    deadline: Deadline,
  ) {
    const store = this.store(owner, finalCheck, deadline);
    requireContent((await store.readFreshnessManifest(stage)) !== null, 'UNAVAILABLE', 503);
    const doc = await store.loadDocument(stage);
    requireContent(doc && hash(canonical(doc)) === expected, 'UNAVAILABLE', 503);
    return doc!;
  }
  async saveInteractive(
    owner: string,
    doc: ReturnType<typeof interactiveDocument>,
    expected: string,
    finalCheck: () => Promise<void>,
    deadline: Deadline,
  ) {
    requireContent(
      checkInteractiveDocument(doc, doc.stage.id).digest === expected,
      'UNAVAILABLE',
      503,
    );
    await this.save(owner, doc, finalCheck, deadline);
  }
  async readInteractive(
    owner: string,
    stage: string,
    expected: string,
    finalCheck: () => Promise<void>,
    deadline: Deadline,
  ) {
    const doc = await this.read(owner, stage, expected, finalCheck, deadline);
    requireContent(checkInteractiveDocument(doc, stage).digest === expected, 'UNAVAILABLE', 503);
    return checkInteractiveDocument(doc, stage).document;
  }
  async savePng(
    owner: string,
    doc: MaicDocument,
    refs: AssetExpectations,
    expected: string,
    finalCheck: () => Promise<void>,
    deadline: Deadline,
  ) {
    requireContent(
      validatePngDocument(doc, doc.stage.id, refs).digest === expected,
      'UNAVAILABLE',
      503,
    );
    await this.save(owner, pngStorageDocument(doc, 'WRITE'), finalCheck, deadline);
  }
  async readPng(
    owner: string,
    stage: string,
    refs: AssetExpectations,
    expected: string,
    finalCheck: () => Promise<void>,
    deadline: Deadline,
  ) {
    const store = this.store(owner, finalCheck, deadline);
    requireContent(await store.readFreshnessManifest(stage), 'UNAVAILABLE', 503);
    const stored = await store.loadDocument(stage);
    requireContent(stored, 'UNAVAILABLE', 503);
    const doc = pngStorageDocument(stored, 'READ');
    requireContent(validatePngDocument(doc, stage, refs).digest === expected, 'UNAVAILABLE', 503);
    return doc;
  }
}
