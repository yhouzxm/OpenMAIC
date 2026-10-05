import { PgDocumentStore } from '@openmaic/storage/document/pg';
import { PgAssetStore, type Queryable, type WithTransaction } from '@openmaic/storage/asset/pg';
import { PgAssetByteStore } from '@openmaic/storage/asset/pg-bytes';
import type { MaicDocument } from '@openmaic/storage';
import type { AssetRef } from '@openmaic/dsl';
import type { TransactionPool } from '../identity/postgres/transactions';
import { bridgeTransaction, type Deadline } from './transactions';
import { check, opaque, principal, BridgeError, exact } from './validation';
import { boundedJson, validateBytes, validateDocument, type AssetExpectations } from './content';

/** Infrastructure-only. No generic store, folder/collector/replace/runtime methods. */
export class NativeStorage {
  constructor(private readonly pool: TransactionPool) {}
  private scope(owner: string, deadline: Deadline, finalCheck: () => Promise<void>) {
    const hook: WithTransaction = (body) =>
      bridgeTransaction(
        this.pool,
        null,
        deadline,
        async (client) => {
          await client.query('SET LOCAL search_path=pg_catalog,public,pg_temp');
          return body({
            query: async <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => ({
              rows: (await client.query<R>(sql, params)).rows,
            }),
          });
        },
        finalCheck,
      );
    const queryable: Queryable = {
      query: <R extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
        hook((q) => q.query<R>(sql, params)),
    };
    const documents = new PgDocumentStore(queryable, {
      ownerId: principal(owner),
      trackAssetReferences: true,
      withTransaction: hook,
    });
    const assets = new PgAssetStore(queryable, {
      byteStore: new PgAssetByteStore(queryable),
      quotaBytes: 33554432,
      withTransaction: hook,
    });
    return { documents, assets };
  }
  async saveCandidate(
    owner: string,
    stage: string,
    document: MaicDocument,
    refs: AssetExpectations,
    deadline: Deadline,
    finalCheck: () => Promise<void>,
    expectedDigest: string,
  ) {
    try {
      const snapshot = JSON.parse(boundedJson(document)) as MaicDocument;
      check(validateDocument(snapshot, opaque(stage), refs).digest === expectedDigest);
      const { documents } = this.scope(owner, deadline, finalCheck);
      // Public existence check plus one-use dispatch and unique reserved StageRef; never overwrite published data.
      check((await documents.loadDocument(stage)) === null);
      await documents.saveDocument(snapshot);
      deadline.assert();
    } catch {
      throw new BridgeError();
    }
  }
  async load(
    owner: string,
    stage: string,
    refs: AssetExpectations,
    deadline: Deadline,
    finalCheck: () => Promise<void>,
    expectedDigest: string,
  ) {
    try {
      const { documents } = this.scope(owner, deadline, finalCheck);
      check((await documents.readFreshnessManifest(opaque(stage))) !== null); // Public owner-scoped guard before the ID-capable load.
      const result = await documents.loadDocument(stage);
      check(result !== null);
      check(validateDocument(result, stage, refs).digest === expectedDigest);
      return result;
    } catch {
      throw new BridgeError();
    }
  }
  async put(
    owner: string,
    mime: string,
    bytes: Uint8Array,
    deadline: Deadline,
    finalCheck: () => Promise<void>,
  ) {
    try {
      check(bytes instanceof Uint8Array && bytes.byteLength <= 4194304);
      const copy = Uint8Array.from(bytes),
        byteDigest = validateBytes(mime, copy);
      const ref = await this.scope(owner, deadline, finalCheck).assets.put(
        { key: principal(owner) },
        { type: mime, size: copy.byteLength, arrayBuffer: async () => copy.buffer },
      );
      opaque(ref);
      return Object.freeze({
        ref,
        byteDigest,
        byteLength: copy.byteLength,
        providerRevision: '1',
      });
    } catch {
      throw new BridgeError();
    }
  }
  async read(
    owner: string,
    ref: string,
    expected: { mime: string; byteLength: number; digest: string; revision: string },
    deadline: Deadline,
    finalCheck: () => Promise<void>,
  ) {
    try {
      const result = await this.scope(owner, deadline, finalCheck).assets.resolve(
        { key: principal(owner) },
        opaque(ref) as AssetRef,
      );
      check(
        result !== null &&
          result.mime === expected.mime &&
          result.bytes.byteLength === expected.byteLength &&
          result.revision.toString() === expected.revision,
      );
      check(validateBytes(result.mime, result.bytes) === expected.digest);
      deadline.assert();
      return Uint8Array.from(result.bytes);
    } catch {
      throw new BridgeError();
    }
  }
  async manifest(
    owner: string,
    stage: string,
    deadline: Deadline,
    finalCheck: () => Promise<void>,
  ) {
    try {
      const result = await this.scope(owner, deadline, finalCheck).documents.readFreshnessManifest(
        opaque(stage),
      );
      check(result !== null);
      boundedJson(result);
      exact(result, ['rev', 'scenes']);
      check(
        Number.isSafeInteger(result.rev) &&
          Number(result.rev) >= 1 &&
          Array.isArray(result.scenes) &&
          result.scenes.length >= 1 &&
          result.scenes.length <= 64,
      );
      const scenes = result.scenes.map((scene, index) => {
        exact(scene, ['id', 'order', 'rev']);
        opaque(scene.id);
        check(scene.order === index && Number.isSafeInteger(scene.rev) && Number(scene.rev) >= 1);
        return Object.freeze({ ...scene });
      });
      check(new Set(scenes.map((s) => s.id)).size === scenes.length);
      return Object.freeze({ rev: Number(result.rev), scenes: Object.freeze(scenes) });
    } catch {
      throw new BridgeError();
    }
  }
}
