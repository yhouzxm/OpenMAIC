/** Immutable full-document/asset adoption; visibility stays with existing Content publication guards. */
import type { AppDocument } from '@/lib/document-store/persistence-types';
import { createHash } from 'node:crypto';
import { v7 } from 'uuid';
import type { Pool } from 'pg';
import { enumerateAssetManifest } from '@openmaic/dsl';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { assetPrincipalForOwner } from '@/lib/persistence/owner-assets';
import { validateAppScene, validateAppStage } from '@/lib/document-store/validators';
import { interactiveHtml } from '../content/interactive';
import { canonical, hash, requireContent, draft, id, revision } from '../content/model';
import type { ContentContext, ContentService } from '../content/service';
import { authoringBindings, authoringOwner } from './host';
const byteHash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const PREFIX = '原生完整课件 · 来源 SHA256 ';
export type Asset = { ref: string; mime: string; digest: string; bytes: Buffer };
export function marker(snapshot: string, digest: string, title: string) {
  return draft({
    title: title.slice(0, 120),
    slides: [
      {
        id: snapshot,
        elements: [
          {
            id: snapshot.slice(0, -1) + (snapshot.endsWith('0') ? '1' : '0'),
            text: PREFIX + digest,
            x: 20,
            y: 20,
            width: 920,
            height: 80,
          },
        ],
      },
    ],
  });
}
export function parseMarker(value: { slides?: { id: string; elements: { text?: string }[] }[] }) {
  requireContent(
    value.slides?.length === 1 && value.slides[0].elements.length === 1,
    'NOT_FOUND',
    404,
  );
  const text = value.slides[0].elements[0].text ?? '';
  requireContent(
    text.startsWith(PREFIX) && /^[a-f0-9]{64}$/.test(text.slice(PREFIX.length)),
    'NOT_FOUND',
    404,
  );
  return { snapshot: id(value.slides[0].id), digest: text.slice(PREFIX.length) };
}
export function closedDocument(candidate: unknown): AppDocument {
  const value = candidate as AppDocument | null;
  requireContent(
    value?.stage &&
      Array.isArray(value.scenes) &&
      value.scenes.length > 0 &&
      value.scenes.length <= 128,
  );
  requireContent(
    validateAppStage(value.stage).valid && value.scenes.every((s) => validateAppScene(s).valid),
    'INVALID_NATIVE_DOCUMENT',
  );
  requireContent(Buffer.byteLength(canonical(value)) <= 8 * 1024 * 1024, 'TOO_LARGE', 413);
  for (const scene of value.scenes) {
    if (scene.type === 'interactive') {
      // Preserve self-contained HTML; remote executable scenes are not made publishable by adoption.
      requireContent(
        !scene.content.url && typeof scene.content.html === 'string',
        'UNSUPPORTED_REMOTE_SCENE',
        409,
      );
      interactiveHtml(scene.content.html);
    }
  }
  return value;
}
export class AuthoringSnapshots {
  constructor(
    private pool: Pool,
    private content: ContentService,
  ) {}
  private async source(x: ContentContext, stage: string) {
    const owner = authoringOwner(x);
    authoringBindings.set(owner, { ...x, deadline: undefined });
    const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
    const doc = closedDocument(
      await (await getOwnerScopedDocumentStore(owner)).loadDocument(stage),
    );
    const assets: Asset[] = [];
    const refs = new Set(enumerateAssetManifest(doc).entries.map((e) => e.ref));
    requireContent(refs.size <= 256, 'TOO_LARGE', 413);
    for (const ref of refs) {
      const data = await provider.assetStore.resolve(assetPrincipalForOwner(owner), ref);
      requireContent(data, 'ASSET_NOT_READY', 409);
      requireContent(
        /^(image\/(png|jpeg|webp|gif|svg\+xml)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/octet-stream)$/.test(
          data.mime,
        ),
        'UNSUPPORTED_MEDIA_TYPE',
        415,
      );
      const bytes = Buffer.from(data.bytes);
      requireContent(bytes.length > 0 && bytes.length <= 32 * 1024 * 1024, 'TOO_LARGE', 413);
      assets.push({ ref, mime: data.mime, bytes, digest: byteHash(bytes) });
      requireContent(
        assets.reduce((s, a) => s + a.bytes.length, 0) <= 128 * 1024 * 1024,
        'TOO_LARGE',
        413,
      );
    }
    const assetManifest = assets
      .map(({ ref, mime, digest, bytes }) => ({ ref, mime, digest, size: bytes.length }))
      .sort((a, b) => a.ref.localeCompare(b.ref));
    return {
      owner,
      doc,
      assets,
      assetManifest,
      digest: hash(canonical({ document: doc, assets: assetManifest })),
    };
  }
  async preview(x: ContentContext, stage: string) {
    await this.content.authoring(x, async () => {});
    const source = await this.source(x, stage);
    await this.content.authoring({ ...x, deadline: undefined }, async () => {});
    return {
      sourceDigest: source.digest,
      title: source.doc.stage.name,
      scenes: source.doc.scenes.map((s) => ({ id: s.id, type: s.type, title: s.title })),
      assets: source.assetManifest,
    };
  }
  async adopt(x: ContentContext, stage: string, expected: string) {
    await this.content.authoring(x, async () => {});
    const source = await this.source(x, stage);
    requireContent(source.digest === expected, 'CONFLICT', 409);
    const client = await this.pool.connect();
    let snapshot: string;
    try {
      await client.query('BEGIN');
      const inserted = await client.query(
        'INSERT INTO zhiban_authoring_snapshots(id,tenant_id,offering_id,owner_id,stage_id,document,digest,assets) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(owner_id,stage_id,digest) DO NOTHING RETURNING id',
        [
          v7(),
          x.tenant,
          x.offering,
          source.owner,
          stage,
          source.doc,
          source.digest,
          JSON.stringify(source.assetManifest),
        ],
      );
      snapshot = inserted.rows[0]?.id;
      if (snapshot)
        for (const a of source.assets)
          await client.query(
            'INSERT INTO zhiban_authoring_snapshot_bytes(snapshot_id,asset_id,mime,digest,bytes) VALUES($1,$2,$3,$4,$5)',
            [snapshot, a.ref, a.mime, a.digest, a.bytes],
          );
      else
        snapshot = (
          await client.query(
            'SELECT id FROM zhiban_authoring_snapshots WHERE owner_id=$1 AND stage_id=$2 AND digest=$3',
            [source.owner, stage, source.digest],
          )
        ).rows[0].id;
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    // A prepared private snapshot alone is never visible. The business transaction
    // creates/audits the course draft only after current teacher authorization.
    const resource = await this.content.adoptGenerated(
      { ...x, deadline: undefined },
      `native:${source.owner}:${stage}:${expected}`,
      marker(snapshot, expected, source.doc.stage.name),
    );
    return { ...resource, sourceDigest: expected, snapshot };
  }
  async draftInfo(x: ContentContext, resource: string) {
    const draft = await this.content.preview(x, resource, 'draft');
    const pin = parseMarker(draft);
    const row = (
      await this.pool.query(
        'SELECT owner_id,stage_id,document,assets,digest FROM zhiban_authoring_snapshots WHERE id=$1 AND tenant_id=$2 AND offering_id=$3',
        [pin.snapshot, x.tenant, x.offering],
      )
    ).rows[0];
    requireContent(row && row.digest === pin.digest, 'UNAVAILABLE', 503);
    return {
      title: draft.title,
      revision: draft.revision,
      sourceDigest: pin.digest,
      scenes: (row.document as AppDocument).scenes.map((s) => ({ type: s.type, title: s.title })),
      assets: row.assets,
      stageId: row.owner_id === authoringOwner(x) ? row.stage_id : null,
    };
  }
  async draftDocument(x: ContentContext, resource: string, expectedRevision: string) {
    revision(expectedRevision);
    const d = await this.content.preview(x, resource, 'draft');
    requireContent(d.revision === expectedRevision, 'CONFLICT', 409);
    const pin = parseMarker(d),
      row = (
        await this.pool.query(
          'SELECT document,assets,digest FROM zhiban_authoring_snapshots WHERE id=$1 AND tenant_id=$2 AND offering_id=$3',
          [pin.snapshot, x.tenant, x.offering],
        )
      ).rows[0];
    requireContent(
      row &&
        row.digest === pin.digest &&
        hash(canonical({ document: row.document, assets: row.assets })) === pin.digest,
      'UNAVAILABLE',
      503,
    );
    return {
      document: row.document as AppDocument,
      assets: row.assets as { ref: string; mime: string; digest: string; size: number }[],
      snapshot: pin.snapshot,
      sourceDigest: pin.digest,
      publicationId: null,
      publicationNo: null,
    };
  }
  async published(x: ContentContext, resource: string, publication: string) {
    const p = await this.content.preview(x, resource, 'published', undefined, publication);
    const pin = parseMarker(p);
    const result = await this.pool.query(
      'SELECT document,assets,digest FROM zhiban_authoring_snapshots WHERE id=$1 AND tenant_id=$2 AND offering_id=$3',
      [pin.snapshot, x.tenant, x.offering],
    );
    const s = result.rows[0];
    requireContent(
      s &&
        s.digest === pin.digest &&
        hash(canonical({ document: s.document as AppDocument, assets: s.assets })) === pin.digest,
      'UNAVAILABLE',
      503,
    );
    return {
      document: s.document as AppDocument,
      assets: s.assets as { ref: string; mime: string; digest: string; size: number }[],
      publicationId: p.publicationId,
      publicationNo: p.publicationNo,
      snapshot: pin.snapshot,
      sourceDigest: pin.digest,
    };
  }
  async asset(x: ContentContext, resource: string, publication: string, ref: string) {
    const p = await this.published(x, resource, publication);
    return this.bytes(p, ref);
  }
  async draftAsset(x: ContentContext, resource: string, expectedRevision: string, ref: string) {
    return this.bytes(await this.draftDocument(x, resource, expectedRevision), ref);
  }
  private async bytes(
    p: { snapshot: string; assets: { ref: string; mime: string; digest: string; size: number }[] },
    ref: string,
  ) {
    const expected = p.assets.find((a) => a.ref === ref);
    requireContent(expected, 'NOT_FOUND', 404);
    const row = (
      await this.pool.query(
        'SELECT mime,digest,bytes FROM zhiban_authoring_snapshot_bytes WHERE snapshot_id=$1 AND asset_id=$2',
        [p.snapshot, ref],
      )
    ).rows[0];
    requireContent(
      row &&
        row.digest === expected.digest &&
        row.mime === expected.mime &&
        byteHash(row.bytes) === expected.digest &&
        row.bytes.length === expected.size,
      'UNAVAILABLE',
      503,
    );
    return row as { mime: string; digest: string; bytes: Buffer };
  }
}
