/** Native-format archives and fresh owner-bound editing copies. Never grants publication or learning facts. */
import JSZip from 'jszip';
import { randomUUID, createHash } from 'node:crypto';
import { isSlideContent } from '@openmaic/dsl';
import type { Pool } from 'pg';
import type { AppDocument } from '@/lib/document-store/persistence-types';
import type { ClassroomManifest, MediaIndexEntry } from '@/lib/export/classroom-zip-types';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { assetPrincipalForOwner } from '@/lib/persistence/owner-assets';
import {
  parsePptxIsolated,
  slidesToScenes,
  toArrayBuffer,
  MAX_IMPORT_BYTES,
} from '@/lib/server/agent-runtime/import-pptx';
import type { SubmissionFileClearance } from '../../../application/learning/attachment-assets';
import type { ContentService, ContentContext } from '../../content/service';
import { requireContent, hash, ContentError, id } from '../../content/model';
import { AuthoringSnapshots, closedDocument } from '../snapshot';
import { authoringOwner, authoringBindings, withNativeOwner } from '../host';
import { readBoundedZip, ARCHIVE_LIMITS } from './zip';
import {
  designOnly,
  designRefs,
  mapDesignRefs,
  nativeManifest,
  fromNativeManifest,
} from './design';
export type PortableAsset = {
  ref: string;
  path: string;
  mime: string;
  digest: string;
  size: number;
  bytes: Buffer;
};
type Package = {
  document: AppDocument;
  assets: PortableAsset[];
  digest: string;
  kind: 'maic' | 'pptx';
};
const mimeOK = (m: string) =>
  /^(image\/(png|jpeg|webp|gif|svg\+xml)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/octet-stream)$/.test(
    m,
  );
export class NativeArchiveService {
  readonly snapshots: AuthoringSnapshots;
  private active = 0;
  constructor(
    readonly content: ContentService,
    readonly pool: Pool,
    readonly clearance?: SubmissionFileClearance | null,
  ) {
    this.snapshots = new AuthoringSnapshots(pool, content);
  }
  async access(x: ContentContext, q: URLSearchParams) {
    await this.content.authoring(x, async () => {});
    if (q.has('stage')) {
      requireContent(q.size === 1);
      requireContent(
        (
          await this.pool.query(
            'SELECT 1 FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 AND deleted_at IS NULL',
            [q.get('stage'), authoringOwner(x)],
          )
        ).rowCount,
        'NOT_FOUND',
        404,
      );
      return;
    }
    requireContent(q.size === 2 && q.has('resource') && q.has('publication'));
    return this.content.withPublishedAccess(
      x,
      id(q.get('resource')),
      id(q.get('publication')),
      async () => {},
    );
  }
  async encode(document: AppDocument, assets: PortableAsset[], sourceDigest: string) {
    const design = designOnly(document),
      zip = new JSZip();
    const index: Record<string, MediaIndexEntry> = {};
    for (const asset of assets) {
      index[asset.path] = {
        type: asset.mime.startsWith('audio/') ? 'audio' : 'generated',
        sourceRef: asset.ref,
        mimeType: asset.mime,
        size: asset.size,
      };
      zip.file(asset.path, asset.bytes);
    }
    const manifest = Buffer.from(JSON.stringify(nativeManifest(design, index)));
    zip.file('manifest.json', manifest);
    const doc = Buffer.from(JSON.stringify(design));
    zip.file('zhiban-document.json', doc);
    const metadata = Buffer.from(
      JSON.stringify({
        version: 1,
        documentSha256: hashRaw(doc),
        sourceDigest,
        assets: assets.map(({ bytes: _bytes, ...a }) => a),
      }),
    );
    requireContent(
      assets.every((a) => a.bytes.length <= ARCHIVE_LIMITS.entry) &&
        manifest.length +
          doc.length +
          metadata.length +
          assets.reduce((n, a) => n + a.bytes.length, 0) <=
          ARCHIVE_LIMITS.expanded,
      'ARCHIVE_TOO_LARGE',
      413,
    );
    zip.file('zhiban-archive.json', metadata);
    const bytes = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    requireContent(bytes.length <= ARCHIVE_LIMITS.compressed, 'ARCHIVE_TOO_LARGE', 413);
    return bytes;
  }
  async export(x: ContentContext, query: URLSearchParams) {
    requireContent(this.active < 2, 'ARCHIVE_BUSY', 503);
    this.active++;
    try {
      await this.content.authoring(x, async () => {});
      let document: AppDocument,
        assets: PortableAsset[],
        digest: string,
        guard: <T>(w: () => Promise<T>) => Promise<T>;
      if (query.has('stage')) {
        requireContent(query.size === 1);
        const stage = query.get('stage')!;
        requireContent(
          (
            await this.pool.query(
              'SELECT 1 FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 AND deleted_at IS NULL',
              [stage, authoringOwner(x)],
            )
          ).rowCount,
          'NOT_FOUND',
          404,
        );
        requireContent(stage.length > 0 && stage.length <= 128);
        const source = await this.content.authoring({ ...x, deadline: undefined }, () =>
          this.snapshots.source(x, stage),
        );
        document = source.doc;
        digest = source.digest;
        assets = source.assets.map((a, i) => ({
          ...a,
          path: `media/asset-${i}`,
          size: a.bytes.length,
        }));
        guard = (w) => this.content.authoring({ ...x, deadline: undefined }, w);
      } else {
        requireContent(query.size === 2 && query.has('resource') && query.has('publication'));
        const r = id(query.get('resource')),
          p = id(query.get('publication'));
        const source = await this.snapshots.published(x, r, p);
        document = source.document;
        digest = source.sourceDigest;
        assets = [];
        for (const [i, a] of source.assets.entries()) {
          const data = await this.snapshots.asset(x, r, p, a.ref);
          assets.push({ ...a, path: `media/asset-${i}`, bytes: data.bytes });
        }
        guard = (w) =>
          this.content.authoring({ ...x, deadline: undefined }, () =>
            this.content.withPublishedAccess(x, r, p, w),
          );
      }
      const title = document.stage.name;
      const bytes = await this.encode(document, assets, digest);
      return await guard(async () => ({ bytes, title, digest }));
    } finally {
      this.active--;
    }
  }
  async parse(bytes: Buffer, kind: string): Promise<Package> {
    try {
      return await this.parseArchive(bytes, kind);
    } catch (error) {
      if (error instanceof ContentError) throw error;
      throw new ContentError('INVALID_ARCHIVE');
    }
  }
  private async parseArchive(bytes: Buffer, kind: string): Promise<Package> {
    const files = await readBoundedZip(bytes);
    if (kind === 'pptx') {
      requireContent(
        bytes.length <= MAX_IMPORT_BYTES &&
          files.has('[Content_Types].xml') &&
          files.has('ppt/presentation.xml'),
        'INVALID_PPTX',
      );
      return {
        document: null as unknown as AppDocument,
        assets: [],
        digest: hashRaw(bytes),
        kind: 'pptx',
      };
    }
    requireContent(kind === 'maic' && files.has('manifest.json'), 'INVALID_ARCHIVE');
    const manifestBytes = files.get('manifest.json')!;
    requireContent(manifestBytes.length <= 8 * 1024 * 1024, 'ARCHIVE_TOO_LARGE', 413);
    const m = JSON.parse(manifestBytes.toString()) as ClassroomManifest;
    requireContent(
      m.formatVersion === 1 &&
        m.stage &&
        Array.isArray(m.scenes) &&
        m.scenes.length > 0 &&
        m.scenes.length <= 128 &&
        Array.isArray(m.agents) &&
        m.agents.length <= 32 &&
        m.mediaIndex &&
        typeof m.mediaIndex === 'object',
      'INVALID_ARCHIVE',
    );
    let document = fromNativeManifest(m);
    const assets: PortableAsset[] = [];
    const refs = new Set<string>();
    for (const [path, meta] of Object.entries(m.mediaIndex)) {
      requireContent(
        meta && typeof meta === 'object' && !meta.missing && files.has(path),
        'ARCHIVE_MISSING_ASSET',
      );
      const data = files.get(path)!,
        mime =
          meta.mimeType ??
          (meta.type === 'audio' ? `audio/${meta.format ?? 'mpeg'}` : 'image/jpeg');
      const ref = meta.sourceRef ?? path.replace(/^(media|audio)\//, '').replace(/\.[^.\/]+$/, '');
      requireContent(
        typeof ref === 'string' &&
          ref.length <= 2048 &&
          !refs.has(ref) &&
          mimeOK(mime) &&
          data.length > 0,
        'INVALID_ARCHIVE',
      );
      refs.add(ref);
      assets.push({ ref, path, mime, digest: hashRaw(data), size: data.length, bytes: data });
    }
    if (files.has('zhiban-archive.json')) {
      const extra = JSON.parse(files.get('zhiban-archive.json')!.toString());
      const doc = files.get('zhiban-document.json');
      requireContent(
        extra.version === 1 &&
          doc &&
          doc.length <= 8 * 1024 * 1024 &&
          hashRaw(doc) === extra.documentSha256 &&
          Array.isArray(extra.assets) &&
          extra.assets.length === assets.length,
        'INVALID_ARCHIVE',
      );
      for (const a of assets) {
        const expected = extra.assets.find(
          (e: PortableAsset) => e.path === a.path && e.ref === a.ref,
        );
        requireContent(
          expected &&
            expected.mime === a.mime &&
            expected.size === a.size &&
            expected.digest === hashRaw(a.bytes),
          'ARCHIVE_HASH_MISMATCH',
        );
      }
      document = designOnly(closedDocument(JSON.parse(doc.toString())));
    }
    const posterPaths = new Set<string>();
    if (!files.has('zhiban-archive.json'))
      for (const asset of [...assets])
        if (asset.mime.startsWith('video/')) {
          const path = asset.path.replace(/\.[^/.]+$/, '.poster.jpg');
          if (files.has(path)) {
            posterPaths.add(path);
            const data = files.get(path)!;
            for (const scene of document.scenes) {
              const canvases = [
                ...(isSlideContent(scene.content) ? [scene.content.canvas] : []),
                ...(scene.whiteboards ?? []),
              ];
              for (const canvas of canvases)
                for (const element of canvas.elements)
                  if (
                    element.type === 'video' &&
                    (element.src === asset.ref || element.mediaRef === asset.ref)
                  ) {
                    const ref = element.poster ?? 'archive-poster-' + hashRaw(data);
                    element.poster = ref;
                    if (!refs.has(ref)) {
                      assets.push({
                        ref,
                        path,
                        mime: 'image/jpeg',
                        digest: hashRaw(data),
                        size: data.length,
                        bytes: data,
                      });
                      refs.add(ref);
                    }
                  }
            }
          }
        }
    closedDocument(document);
    requireContent(
      designRefs(document).every((ref) => refs.has(ref)),
      'ARCHIVE_MISSING_ASSET',
    );
    const allowed = new Set([
      'manifest.json',
      'zhiban-archive.json',
      'zhiban-document.json',
      ...assets.map((a) => a.path),
      ...posterPaths,
    ]);
    requireContent(
      [...files.keys()].every((path) => allowed.has(path)),
      'ARCHIVE_EXTRA_ENTRY',
    );
    return { document, assets, digest: hashRaw(bytes), kind: 'maic' };
  }
  async inspect(x: ContentContext, bytes: Buffer, kind: string) {
    await this.content.authoring(x, async () => {});
    const parsed = await this.parse(bytes, kind);
    return this.content.authoring(x, async () => ({
      digest: parsed.digest,
      kind,
      title: parsed.document?.stage.name ?? 'PowerPoint 编辑副本',
      scenes: parsed.document?.scenes.map((s) => ({ type: s.type, title: s.title })) ?? [],
      assets: parsed.assets.length,
      compressedBytes: bytes.length,
      scannerAvailable: !!this.clearance?.checkArchive,
      publicationEnabled: false,
      limits: ARCHIVE_LIMITS,
    }));
  }
  async restore(
    x: ContentContext,
    bytes: Buffer,
    kind: string,
    expected: string,
    command: string,
    signal: AbortSignal,
  ) {
    requireContent(this.active < 2, 'ARCHIVE_BUSY', 503);
    this.active++;
    try {
      await this.content.authoring(x, async () => {});
      const parsed = await this.parse(bytes, kind);
      requireContent(parsed.digest === expected, 'ARCHIVE_CHANGED', 409);
      requireContent(
        this.clearance?.mode === 'TRUSTED_SCANNER' && this.clearance.checkArchive,
        'ARCHIVE_SCANNER_REQUIRED',
        503,
      );
      const owner = authoringOwner(x),
        stage = 'archive-' + hash(`${owner}:${parsed.digest}:${command}`).slice(0, 48),
        lock = 'archive:' + owner + ':' + stage,
        c = await this.pool.connect();
      let held = false;
      authoringBindings.set(owner, { ...x, deadline: undefined });
      const authorized = <T>(work: () => Promise<T>) =>
        this.content.authoring({ ...x, deadline: undefined }, () => withNativeOwner(owner, work));
      try {
        held = (
          await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS held', [lock])
        ).rows[0].held;
        requireContent(held, 'ARCHIVE_BUSY', 409);
        const store = await getOwnerScopedDocumentStore(owner);
        if (await authorized(() => store.loadDocument(stage)))
          return { stageId: stage, alreadyExists: true, digest: parsed.digest, published: false };
        const clear = await this.clearance.checkArchive({
          name: kind === 'pptx' ? 'course.pptx' : 'course.maic.zip',
          mime:
            kind === 'pptx'
              ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
              : 'application/zip',
          base64: bytes.toString('base64'),
        });
        requireContent(
          clear?.mode === 'TRUSTED_SCANNER' && clear.digest === hashRaw(bytes),
          'ARCHIVE_NOT_CLEARED',
          503,
        );
        requireContent(!signal.aborted, 'ARCHIVE_CANCELLED', 409);
        const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? ''),
          principal = assetPrincipalForOwner(owner);
        const put = async (data: Buffer, mime: string) => {
          requireContent(!signal.aborted, 'ARCHIVE_CANCELLED', 409);
          return authorized(() =>
            provider.assetStore.put(principal, new Blob([new Uint8Array(data)], { type: mime }), {
              contentType: mime,
            }),
          );
        };
        let document = parsed.document;
        if (parsed.kind === 'pptx') {
          const slides = await parsePptxIsolated(toArrayBuffer(bytes), {
            offline: true,
            signal,
            upload: async (blob) =>
              put(Buffer.from(await blob.arrayBuffer()), blob.type || 'application/octet-stream'),
          });
          requireContent(slides.length > 0 && slides.length <= 80, 'INVALID_PPTX');
          document = {
            stage: {
              id: stage,
              name: 'PowerPoint 编辑副本',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            scenes: slidesToScenes(slides, stage).scenes,
          };
        } else {
          document = structuredClone(document);
          const map = new Map<string, string>();
          for (const a of parsed.assets) map.set(a.ref, await put(a.bytes, a.mime));
          mapDesignRefs(document, map);
        }
        document = designOnly(document);
        document.stage.id = stage;
        document.stage.createdAt = document.stage.updatedAt = Date.now();
        const agents = new Map(
          (document.stage.generatedAgentConfigs ?? []).map((a) => [a.id, 'agent-' + randomUUID()]),
        );
        for (const a of document.stage.generatedAgentConfigs ?? []) a.id = agents.get(a.id)!;
        document.stage.agentIds = (document.stage.agentIds ?? []).flatMap((id) =>
          agents.has(id) ? [agents.get(id)!] : [],
        );
        for (const scene of document.scenes) {
          scene.id = 'scene-' + randomUUID();
          scene.stageId = stage;
          for (const a of scene.actions ?? [])
            if (a.type === 'discussion' && a.agentId) a.agentId = agents.get(a.agentId);
          if (scene.multiAgent)
            scene.multiAgent.agentIds = scene.multiAgent.agentIds.flatMap((id) =>
              agents.has(id) ? [agents.get(id)!] : [],
            );
        }
        const now = Date.now();
        document.outline = {
          outlines: document.scenes.map((s) => ({
            id: s.id,
            type: s.type,
            title: s.title,
            order: s.order,
            description: s.title,
            keyPoints: [],
          })),
          generationComplete: true,
          producer: 'client',
          restoredFrom: {
            kind: parsed.kind,
            archiveSha256: parsed.digest,
            restoredAt: now,
            clearanceReference: clear.reference,
          },
          createdAt: now,
          updatedAt: now,
        };
        closedDocument(document);
        requireContent(!signal.aborted, 'ARCHIVE_CANCELLED', 409);
        await authorized(async () => {
          requireContent(!signal.aborted, 'ARCHIVE_CANCELLED', 409);
          try {
            await store.saveDocument(document);
          } catch (error) {
            if (!(await store.loadDocument(stage))) throw error;
          }
        });
        return authorized(async () => ({
          stageId: stage,
          alreadyExists: false,
          digest: parsed.digest,
          published: false,
          scenes: document.scenes.length,
          clearance: clear.reference,
        }));
      } finally {
        try {
          if (held) await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]);
          c.release();
        } catch {
          c.release(true);
        }
      }
    } finally {
      this.active--;
    }
  }
}
const hashRaw = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
