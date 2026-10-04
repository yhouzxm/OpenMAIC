import { Pool } from 'pg';
import {
  PgDocumentStore,
  PgAssetStore,
  PgAssetByteStore,
  ensureDocumentSchema,
  ensureAssetSchema,
} from '@openmaic/storage';
import {
  PgRuntimeStore,
  ensureSchema,
  type Queryable,
  type WithTransaction,
} from '@openmaic/storage/runtime/pg';
import { DiagnosticBoundary } from './boundary';
import { authorityFixture, document, PNG, wav, WEBM, slide } from './fixtures';

export function validateDiagnosticDatabase(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DIAGNOSTIC_DATABASE_REJECTED');
  }
  if (
    url.protocol !== 'postgresql:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/zhiban_0b_capability_test' ||
    url.search ||
    url.hash ||
    process.env.B0_DISPOSABLE !== '1'
  )
    throw new Error('DIAGNOSTIC_DATABASE_REJECTED');
  return url;
}

export async function createPgFixture() {
  const connectionString = process.env.B0_PG16_URL;
  if (!connectionString) throw new Error('DIAGNOSTIC_DATABASE_REQUIRED');
  validateDiagnosticDatabase(connectionString);
  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 1000,
    query_timeout: 5000,
  });
  const withTransaction: WithTransaction = async (body) => {
    const client = await pool.connect();
    let discard = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '5s'");
      await client.query("SET LOCAL lock_timeout = '3s'");
      const result = await body(client as Queryable);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        discard = true;
      }
      throw error;
    } finally {
      client.release(discard);
    }
  };
  try {
    const version = await pool.query<{ version: string }>(
      "SELECT current_setting('server_version') AS version",
    );
    if (!version.rows[0].version.startsWith('16.')) throw new Error('DIAGNOSTIC_PG16_REQUIRED');
    await withTransaction(async (queryable) => {
      await ensureAssetSchema(queryable);
      await ensureDocumentSchema(queryable);
      await ensureSchema(queryable);
    });
    const fixture = authorityFixture();
    const asset = new PgAssetStore(pool as Queryable, {
      withTransaction,
      byteStore: new PgAssetByteStore(pool as Queryable),
      quotaBytes: 32 * 1024 * 1024,
    });
    const runtime = new PgRuntimeStore(pool as Queryable, { withTransaction });
    const stores = new Map<string, PgDocumentStore>();
    const media = new Map<
      string,
      { image: string; audio: string; video: string; hidden: string }
    >();
    for (const stage of Object.values(fixture.stages)) {
      const mapping = fixture.authority.mappings.get(stage)!;
      const principal = { key: mapping.owner };
      const image = await asset.put(principal, new Blob([PNG], { type: 'image/png' }));
      const audio = await asset.put(
        principal,
        new Blob([Uint8Array.from(wav())], { type: 'audio/wav' }),
      );
      const video = await asset.put(principal, new Blob([WEBM], { type: 'video/webm' }));
      const hidden = await asset.put(principal, new Blob([PNG], { type: 'image/png' }));
      media.set(stage, { image, audio, video, hidden });
      mapping.assets = new Set([image, audio, video]);
      const store = new PgDocumentStore(pool as Queryable, {
        withTransaction,
        ownerId: mapping.owner,
        trackAssetReferences: true,
      });
      stores.set(mapping.owner, store);
      await store.saveDocument(document(stage, slide({ image, audio, video })));
    }
    for (const [id, binding] of fixture.authority.bindings)
      await runtime.createSession({
        id,
        stageId: binding.stage,
        learnerKey: binding.learner,
        kind: 'chat',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    const boundary = new DiagnosticBoundary(fixture.authority, {
      document: (owner) => {
        const store = stores.get(owner);
        if (!store) throw new Error('DIAGNOSTIC_REJECTED');
        return store;
      },
      asset,
      runtime,
      runtimeMutation: (check) =>
        new PgRuntimeStore(pool as Queryable, {
          withTransaction: (body) =>
            withTransaction(async (client) => {
              check();
              const result = await body(client);
              check();
              return result;
            }),
        }),
    });
    return {
      ...fixture,
      pool,
      stores,
      asset,
      runtime,
      boundary,
      media,
      withTransaction,
      version: version.rows[0].version,
      close: () => pool.end(),
    };
  } catch {
    await pool.end();
    throw new Error('DIAGNOSTIC_PG_SETUP_FAILED');
  }
}
