import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it, vi } from 'vitest';
import { DSL_VERSION, type Slide } from '@openmaic/dsl';
import { ensureAssetSchema } from '@openmaic/storage/asset/pg';
import { ensureDocumentSchema, PgDocumentStore } from '@openmaic/storage/document/pg';
import type { MaicDocument } from '@openmaic/storage';
import type { TransactionPool } from '@/lib/zhiban/infrastructure/identity/postgres/transactions';
import { Deadline } from '@/lib/zhiban/infrastructure/openmaic/transactions';
import { NativeStorage } from '@/lib/zhiban/infrastructure/openmaic/native-storage';
import { preview, validateDocument } from '@/lib/zhiban/infrastructure/openmaic/content';
import { BridgeError, newPrincipal } from '@/lib/zhiban/infrastructure/openmaic/validation';
import { official } from '@/lib/zhiban/infrastructure/openmaic/catalog';

// Real public providers and SQL in an in-memory engine. This is protocol/storage
// regression evidence, not a substitute for the independent PG16 ACL suite.
describe('Bridge document protocol with real public providers', () => {
  it('round-trips the official document stamp, tracks assets, and rejects package-version stamps before storage', async () => {
    const db = new PGlite();
    try {
      const queryable = {
        query: <R extends Record<string, unknown>>(sql: string, params?: unknown[]) =>
          db.query<R>(sql, params),
      };
      await ensureAssetSchema(queryable);
      await ensureDocumentSchema(queryable);
      const release = vi.fn();
      const connect = vi.fn(async () => ({
        query: async <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
          const result = await db.query<R>(sql, params);
          return {
            rows: result.rows,
            rowCount: result.affectedRows ?? result.rows.length,
            command: sql.split(' ')[0],
            fields: [],
            oid: 0,
          };
        },
        release,
      }));
      // PGlite supplies the bounded string-query surface used by NativeStorage;
      // node-postgres stream/callback overloads are not part of this adapter.
      const pool = { connect } as unknown as TransactionPool;
      const storage = new NativeStorage(pool);
      const owner = newPrincipal();
      const asset = await storage.put(
        owner,
        'image/png',
        Uint8Array.from(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l5sAAAAASUVORK5CYII=',
            'base64',
          ),
        ),
        new Deadline(),
        async () => {},
      );
      const stage = 'synthetic-provider-stage';
      const doc: MaicDocument = {
        dslVersion: DSL_VERSION,
        stage: { id: stage, name: 'Synthetic', createdAt: 1000, updatedAt: 1000 },
        scenes: [
          {
            id: 'scene',
            stageId: stage,
            title: 'Synthetic',
            order: 0,
            type: 'slide',
            content: {
              type: 'slide',
              canvas: preview(
                {
                  id: 'slide',
                  viewportSize: 960,
                  viewportRatio: 0.5625,
                  elements: [
                    {
                      id: 'image',
                      type: 'image',
                      left: 0,
                      top: 0,
                      width: 80,
                      height: 80,
                      rotate: 0,
                      src: `asset:${asset.ref}`,
                      fixedRatio: true,
                    },
                  ],
                } as Slide,
                (id) => `asset:${id}`,
              ),
            },
          },
        ],
      };
      const refs = new Map([
        [asset.ref, { byteDigest: asset.byteDigest, sceneRef: 'scene', purpose: 'IMAGE' as const }],
      ]);
      const digest = validateDocument(doc, stage, refs).digest;
      const finalCheck = vi.fn(async () => {});
      await storage.saveCandidate(owner, stage, doc, refs, new Deadline(), finalCheck, digest);
      expect(finalCheck).toHaveBeenCalled();
      expect(
        await storage.load(owner, stage, refs, new Deadline(), async () => {}, digest),
      ).toEqual(doc);
      expect(await storage.manifest(owner, stage, new Deadline(), async () => {})).toEqual({
        rev: 2, // Stage insert and scene insert each advance the public provider's stage revision.
        scenes: [{ id: 'scene', order: 0, rev: 1 }],
      });
      expect(
        (
          await db.query<{ data: { dslVersion: string } }>(
            'SELECT data FROM document_stages WHERE id=$1',
            [stage],
          )
        ).rows[0].data.dslVersion,
      ).toBe(DSL_VERSION);
      expect(
        (
          await db.query('SELECT scene_id,asset_id FROM document_asset_refs WHERE stage_id=$1', [
            stage,
          ])
        ).rows,
      ).toEqual([{ scene_id: 'scene', asset_id: asset.ref }]);
      expect(official.dsl).toBe('0.11.2');
      expect(DSL_VERSION).toBe('0.3.0');
      connect.mockClear();
      const invalid = { ...doc, dslVersion: official.dsl };
      await expect(
        storage.saveCandidate(owner, stage, invalid, refs, new Deadline(), async () => {}, digest),
      ).rejects.toEqual(new BridgeError());
      expect(connect).not.toHaveBeenCalled();
      // The real public provider independently rejects the package version as a future stamp.
      const provider = new PgDocumentStore(queryable, {
        ownerId: owner,
        withTransaction: (body) => db.transaction((tx) => body(tx)),
      });
      await expect(provider.saveDocument(invalid)).rejects.toMatchObject({
        name: 'DocumentVersionError',
        kind: 'future',
        storedVersion: official.dsl,
      });
      expect((await db.query('SELECT count(*)::int AS n FROM document_stages')).rows).toEqual([
        { n: 1 },
      ]);
      expect(release.mock.calls.every(([discard]) => discard === false)).toBe(true);
    } finally {
      await db.close();
    }
  }, 15000);
});
