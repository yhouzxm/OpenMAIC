import { LEGACY_OFFICE, legacyOfficeAvailable } from '@/lib/document/legacy-office';
/* eslint-disable @typescript-eslint/no-explicit-any -- original native media envelopes are validated at this host boundary */
import { getMaterialByteStore } from '@/lib/server/materials/bytes';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import * as image from '@/app/api/generate/image/route';
import * as video from '@/app/api/generate/video/route';
import * as tts from '@/app/api/generate/tts/route';
import * as asr from '@/app/api/transcription/route';
import { serverMediaConnection } from '@/lib/server/model-config/media';
import { resolveExtractionServices } from '@/lib/server/material-extraction/services';
import {
  getDocumentExtractorManifestEntry,
  getMediaExtractorManifestEntry,
} from '@/lib/document/extractors/manifest';
import type { AppDocumentOutline } from '@/lib/document-store/persistence-types';
import { localMediaExtractorProvider } from '@/lib/document/extractors/local-media';
import { getOwnerMaterial } from '@/lib/persistence/owner-materials';
import { readMaterialExtractionResult } from '@/lib/server/materials/extraction';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { assetPrincipalForOwner } from '@/lib/persistence/owner-assets';
import type { ContentService, ContentContext } from '../../content/service';
import { ContentError, requireContent, hash } from '../../content/model';
import type { SubmissionFileClearance } from '../../../application/learning/attachment-assets';
import { withAuthoringRequest, authoringOwner } from '../host';
import {
  boundedBytes,
  mediaInput,
  mediaContainer,
  generatedMime,
  MEDIA_BYTES,
  type MediaKind,
} from './policy';
import { generatedBytes } from './transport';
import { normalizeGlmImage } from './glm-image-normalization';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
export class AuthoringMediaService {
  private active = new Set<string>();
  private runningIds = new Map<string, string>();
  constructor(
    readonly content: ContentService,
    readonly pool: Pool,
    readonly clearance?: SubmissionFileClearance | null,
  ) {}
  private guard<T>(x: ContentContext, work: () => Promise<T>) {
    return this.content.authoring({ ...x, deadline: undefined }, () =>
      withAuthoringRequest(x, work),
    );
  }
  async status(x: ContentContext) {
    await this.guard(x, async () => {});
    const result = await withAuthoringRequest(x, async () => {
      const services = await resolveExtractionServices(authoringOwner(x), { forward: false });
      const document = getDocumentExtractorManifestEntry(services.document?.providerId ?? '');
      const media = getMediaExtractorManifestEntry(services.document?.providerId ?? '');
      const localMedia =
        !!services.asr &&
        (
          await localMediaExtractorProvider.availability!({
            buffer: Buffer.alloc(0),
            mimeType: 'audio/wav',
            config: { providerId: 'local-ffmpeg', asr: services.asr },
          })
        ).available;
      const kinds = {} as Record<
        MediaKind,
        {
          state: string;
          available: boolean;
          provider?: string;
          verified: false;
          audioInput?: { mimes: string[]; maxSeconds: number };
        }
      >;
      for (const k of ['image', 'video', 'tts', 'asr'] as const) {
        const c = await serverMediaConnection(k, authoringOwner(x), { forward: false });
        const available =
          !!c &&
          c !== 'off' &&
          (c.managed || c.origin === 'configuration') &&
          !c.providerId.startsWith('browser-');
        kinds[k] = {
          state:
            c === 'off'
              ? 'DISABLED'
              : !c
                ? 'UNCONFIGURED'
                : available
                  ? 'CONFIGURED_NOT_VERIFIED'
                  : 'UNSUPPORTED_HOST_PROVIDER',
          available,
          ...(c && c !== 'off' ? { provider: c.providerId } : {}),
          ...(k === 'asr' && c && c !== 'off' && c.modelId === 'glm-asr-2512'
            ? { audioInput: { mimes: ['audio/wav', 'audio/mpeg'], maxSeconds: 30 } }
            : {}),
          verified: false,
        };
      }
      return {
        kinds,
        materials: {
          maxBytes: 1048576,
          mimes: [
            ...new Set([
              ...(services.document?.providerId === 'alidocmind' && (await legacyOfficeAvailable())
                ? Object.keys(LEGACY_OFFICE)
                : []),
              'text/plain',
              'text/markdown',
              'text/csv',
              'application/pdf',
              ...(document?.supportedMimeTypes ?? []),
              ...(media?.supportedMimeTypes ?? []),
              ...(localMedia
                ? getMediaExtractorManifestEntry('local-ffmpeg')!.supportedMimeTypes
                : []),
            ]),
          ],
          documentState: services.documentStatus ?? 'unassigned',
          documentProvider: document?.id ?? null,
          externalProcessing: !!document,
        },
        scanner: !!this.clearance && this.clearance.mode === 'TRUSTED_SCANNER',
        generatedMaxBytes: MEDIA_BYTES,
        formalResults: false,
      };
    });
    return this.guard(x, async () => result);
  }
  async materialResult(x: ContentContext, id: string) {
    return this.guard(x, async () => {
      const material = await getOwnerMaterial(this.pool, authoringOwner(x), id);
      requireContent(material, 'NOT_FOUND', 404);
      const value = await readMaterialExtractionResult(material);
      return {
        text: value.text.slice(0, 100000),
        images: value.images.length,
        ...(value.legacyConversion ? { legacyConversion: value.legacyConversion } : {}),
        truncated: value.text.length > 100000,
      };
    });
  }
  async scan(bytes: Buffer, mime: string, name: string) {
    requireContent(this.clearance?.mode === 'TRUSTED_SCANNER', 'SCANNER_REQUIRED', 503);
    const check = this.clearance.checkArchive ?? this.clearance.check;
    const r = await check({ name, mime, base64: bytes.toString('base64') });
    requireContent(
      r?.mode === 'TRUSTED_SCANNER' && r.digest === sha(bytes),
      'FILE_NOT_CLEARED',
      503,
    );
    return r.reference;
  }
  private async savedResult(x: ContentContext, saved: any) {
    return this.guard(x, async () => {
      if (saved.assetId) {
        const p = await getServerPersistenceProvider(process.env.DATABASE_URL ?? ''),
          a = await p.assetStore.resolve(assetPrincipalForOwner(authoringOwner(x)), saved.assetId);
        requireContent(
          a && sha(Buffer.from(a.bytes)) === saved.sha256 && a.mime === saved.mime,
          'MEDIA_RESULT_EXPIRED',
          410,
        );
        if (saved.audioId)
          return { ...saved, reused: true, base64: Buffer.from(a.bytes).toString('base64') };
      }
      return { ...saved, reused: true };
    });
  }
  async jobs(x: ContentContext, id?: string) {
    await this.guard(x, async () => {});
    const prefix = 'media-jobs/' + hash(authoringOwner(x)) + '/',
      store = getMaterialByteStore();
    if (id) {
      requireContent(/^[a-f0-9]{64}$/.test(id));
      let job: any;
      try {
        job = JSON.parse((await store.get(prefix + id + '.json')).toString());
      } catch {
        throw new ContentError('NOT_FOUND', 404);
      }
      requireContent(job.status === 'READY', 'MEDIA_OUTCOME_UNKNOWN', 409);
      return this.savedResult(x, job.result);
    }
    const files = (await store.list(prefix)).slice(0, 100),
      items: Array<{
        id: string;
        kind: MediaKind;
        status: string;
        startedAt?: number;
        completedAt?: number;
      }> = [];
    for (const file of files) {
      const name = file.key.slice(prefix.length);
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const job = JSON.parse((await store.get(file.key)).toString());
      items.push({
        id: name.slice(0, -5),
        kind: job.kind,
        status:
          job.status === 'RUNNING' && this.runningIds.get(authoringOwner(x)) !== name.slice(0, -5)
            ? 'UNKNOWN'
            : job.status,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      });
    }
    items.sort((a, b) => (b.completedAt ?? b.startedAt ?? 0) - (a.completedAt ?? a.startedAt ?? 0));
    return this.guard(x, async () => ({ items }));
  }
  async execute(x: ContentContext, kind: MediaKind, request: Request) {
    await this.guard(x, async () => {});
    const owner = authoringOwner(x);
    requireContent(this.active.size < 2 && !this.active.has(owner), 'MEDIA_BUSY', 409);
    const status = await this.status(x);
    requireContent(status.kinds[kind].available, 'MEDIA_SERVICE_UNAVAILABLE', 503);
    let canonicalInput = '';
    let payload: ArrayBuffer | string,
      headers = new Headers({ 'content-type': 'application/json' });
    if (kind === 'asr') {
      requireContent(
        Number(request.headers.get('content-length') ?? 0) <= 5242880,
        'TOO_LARGE',
        413,
      );
      const raw = await boundedBytes(new Response(request.body), 5242880);
      const form = await new Request(request.url, {
        method: 'POST',
        headers: request.headers,
        body: new Uint8Array(raw),
      }).formData();
      requireContent(
        [...form.keys()].every((k) => ['audio', 'language'].includes(k)) &&
          form.getAll('audio').length === 1,
      );
      const audio = form.get('audio'),
        language = form.get('language');
      requireContent(
        audio instanceof File &&
          audio.size > 0 &&
          /^audio\/(webm|wav|x-wav|mpeg|mp4|ogg)(;.*)?$/.test(audio.type),
      );
      requireContent(
        language === null || (typeof language === 'string' && /^[a-zA-Z-]{2,16}$/.test(language)),
      );
      const audioBytes = Buffer.from(await audio.arrayBuffer());
      const inputMime = audio.type
        .split(';')[0]
        .replace('audio/x-wav', 'audio/wav')
        .replace('audio/webm', 'video/webm')
        .replace('audio/mp4', 'video/mp4');
      requireContent(mediaContainer(audioBytes, inputMime), 'MEDIA_INVALID_CONTAINER', 400);
      requireContent(
        !status.kinds.asr.audioInput || status.kinds.asr.audioInput.mimes.includes(inputMime),
        'UNSUPPORTED_MEDIA_TYPE',
        415,
      );
      canonicalInput = sha(audioBytes) + ':' + audio.type + ':' + String(language ?? '');
      await this.scan(audioBytes, audio.type, 'course-asr');
      const clean = new FormData();
      clean.set('audio', audio, 'recording');
      if (language) clean.set('language', language);
      const encoded = new Request(request.url, { method: 'POST', body: clean });
      headers = new Headers({ 'content-type': encoded.headers.get('content-type')! });
      payload = await encoded.arrayBuffer();
    } else {
      const raw = await boundedBytes(new Response(request.body), 32768);
      const input = mediaInput(kind, JSON.parse(raw.toString()));
      if (input.stageId)
        await this.guard(x, async () => {
          requireContent(
            (
              await this.pool.query(
                'SELECT 1 FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 AND deleted_at IS NULL',
                [input.stageId, owner],
              )
            ).rowCount,
            'NOT_FOUND',
            404,
          );
        });
      payload = JSON.stringify(input);
      canonicalInput = payload;
    }
    await this.guard(x, async () => {});
    requireContent(!request.signal.aborted, 'MEDIA_CANCELLED', 409);
    // Keep the slot until the underlying native producer actually settles, even if the caller cancels.
    requireContent(this.active.size < 2 && !this.active.has(owner), 'MEDIA_BUSY', 409);
    this.active.add(owner);
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), kind === 'video' ? 300000 : 120000);
    timer.unref();
    const cancel = () => abort.abort();
    request.signal.addEventListener('abort', cancel, { once: true });
    const pending = withAuthoringRequest(x, async () => {
      const command = request.headers.get('x-zhiban-command') ?? hash(canonicalInput);
      requireContent(/^[a-zA-Z0-9-]{1,128}$/.test(command));
      const inputDigest = hash(canonicalInput),
        store = getMaterialByteStore(),
        prefix = 'media-jobs/' + hash(owner) + '/',
        key = prefix + hash(kind + ':' + command) + '.json',
        startedAt = Date.now(),
        lock = await this.pool.connect();
      let held = false;
      try {
        held = (
          await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS held', [
            'media-execution:' + owner,
          ])
        ).rows[0].held;
        requireContent(held, 'MEDIA_BUSY', 409);
        this.runningIds.set(owner, hash(kind + ':' + command));
        let existing: any = null;
        try {
          existing = JSON.parse((await store.get(key)).toString());
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        if (existing) {
          requireContent(
            existing.inputDigest === inputDigest && existing.kind === kind,
            'COMMAND_CONFLICT',
            409,
          );
          requireContent(existing.status === 'READY', 'MEDIA_OUTCOME_UNKNOWN', 409);
          return this.savedResult(x, existing.result);
        }
        requireContent((await store.list(prefix)).length < 100, 'MEDIA_JOB_LIMIT', 429);
        await this.guard(x, () =>
          store.put(
            key,
            Buffer.from(
              JSON.stringify({
                version: 1,
                kind,
                inputDigest,
                status: 'RUNNING',
                startedAt,
              }),
            ),
            'application/json',
          ),
        );
        try {
          const value = await (async () => {
            const path = kind === 'asr' ? '/api/transcription' : '/api/generate/' + kind;
            const req = new NextRequest(new URL(path, request.url), {
              method: 'POST',
              headers,
              body: payload,
              signal: abort.signal,
            });
            const handler =
              kind === 'image'
                ? image.POST
                : kind === 'video'
                  ? video.POST
                  : kind === 'tts'
                    ? tts.POST
                    : asr.POST;
            const r = await handler(req);
            requireContent(r.ok, 'MEDIA_PROVIDER_FAILED', 502);
            const data = JSON.parse((await boundedBytes(r, 36 * 1024 * 1024)).toString());
            requireContent(data.success === true, 'MEDIA_PROVIDER_FAILED', 502);
            requireContent(!abort.signal.aborted, 'MEDIA_CANCELLED', 409);
            if (kind === 'asr') {
              requireContent(
                typeof data.text === 'string' && data.text.length <= 100000,
                'MEDIA_PROVIDER_FAILED',
                502,
              );
              return this.guard(x, async () => ({ success: true, text: data.text }));
            }
            let bytes: Buffer, mime: string;
            if (kind === 'tts') {
              requireContent(
                typeof data.base64 === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(data.base64),
                'MEDIA_PROVIDER_FAILED',
                502,
              );
              bytes = Buffer.from(data.base64, 'base64');
              mime = (
                {
                  mp3: 'audio/mpeg',
                  wav: 'audio/wav',
                  ogg: 'audio/ogg',
                  opus: 'audio/ogg',
                } as Record<string, string>
              )[data.format];
            } else {
              requireContent(
                data.result && typeof data.result === 'object',
                'MEDIA_PROVIDER_FAILED',
                502,
              );
              const result = data.result;
              if (result.base64) {
                requireContent(
                  typeof result.base64 === 'string' && /^[A-Za-z0-9+/]*={0,2}$/.test(result.base64),
                  'MEDIA_PROVIDER_FAILED',
                  502,
                );
                bytes = Buffer.from(result.base64, 'base64');
                mime = result.mimeType;
              } else {
                requireContent(typeof result.url === 'string', 'MEDIA_PROVIDER_FAILED', 502);
                ({ bytes, mime } = await generatedBytes(result.url, abort.signal));
              }
            }
            requireContent(bytes.length > 0 && bytes.length <= MEDIA_BYTES, 'MEDIA_TOO_LARGE', 413);
            let normalization: Awaited<ReturnType<typeof normalizeGlmImage>>['normalization'];
            if (kind === 'image') {
              const canonical = await normalizeGlmImage(status.kinds.image.provider, bytes, mime);
              bytes = canonical.bytes;
              mime = canonical.mime;
              normalization = canonical.normalization;
            }
            mime = generatedMime(bytes, kind, mime);
            if (kind === 'tts')
              data.format = mime === 'audio/wav' ? 'wav' : mime === 'audio/mpeg' ? 'mp3' : 'ogg';
            const clearance = await this.scan(bytes, mime, 'course-generated-' + kind);
            requireContent(!abort.signal.aborted, 'MEDIA_CANCELLED', 409);
            return this.guard(x, async () => {
              requireContent(!abort.signal.aborted, 'MEDIA_CANCELLED', 409);
              const p = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
              const assetId = await p.assetStore.put(
                assetPrincipalForOwner(owner),
                new Blob([new Uint8Array(bytes)], { type: mime }),
                { contentType: mime },
              );
              const url = `/api/zhiban/authoring/${x.tenant}/offerings/${x.offering}/native/api/persistence/assets/${encodeURIComponent(assetId)}/content`;
              return {
                success: true,
                ...(kind === 'tts'
                  ? {
                      audioId: data.audioId,
                      base64: data.base64,
                      format: data.format,
                      speechText: JSON.parse(payload as string).text,
                    }
                  : {
                      result: {
                        url,
                        width: Number(data.result.width) || 960,
                        height: Number(data.result.height) || 540,
                        ...(kind === 'video'
                          ? { duration: Number(data.result.duration) || 0 }
                          : {}),
                      },
                    }),
                assetId,
                mime,
                sha256: sha(bytes),
                clearance,
                ...(normalization ? { normalization } : {}),
              };
            });
          })();
          const saved = { ...value } as any;
          delete saved.base64;
          await this.guard(x, () =>
            store.put(
              key,
              Buffer.from(
                JSON.stringify({
                  version: 1,
                  kind,
                  inputDigest,
                  status: 'READY',
                  startedAt,
                  completedAt: Date.now(),
                  result: saved,
                }),
              ),
              'application/json',
            ),
          );
          return value;
        } catch (error) {
          await this.guard(x, () =>
            store.put(
              key,
              Buffer.from(
                JSON.stringify({
                  version: 1,
                  kind,
                  inputDigest,
                  status: 'UNKNOWN',
                  startedAt,
                  failedAt: Date.now(),
                }),
              ),
              'application/json',
            ),
          ).catch(() => {});
          throw error;
        }
      } finally {
        try {
          if (held)
            await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
              'media-execution:' + owner,
            ]);
          lock.release();
        } catch {
          lock.release(true);
        }
      }
    }).finally(() => {
      clearTimeout(timer);
      request.signal.removeEventListener('abort', cancel);
      this.active.delete(owner);
      this.runningIds.delete(owner);
    });
    const cancelled = new Promise<never>((_resolve, reject) => {
      const refuse = () => reject(new ContentError('MEDIA_CANCELLED', 409));
      if (abort.signal.aborted) refuse();
      else abort.signal.addEventListener('abort', refuse, { once: true });
    });
    return Promise.race([pending, cancelled]);
  }
  async upload(x: ContentContext, request: Request) {
    await this.guard(x, async () => {});
    const owner = authoringOwner(x);
    requireContent(this.active.size < 2 && !this.active.has(owner), 'MEDIA_BUSY', 409);
    this.active.add(owner);
    try {
      const bytes = await boundedBytes(new Response(request.body)),
        mime = request.headers.get('content-type')?.split(';')[0] ?? '';
      requireContent(mediaContainer(bytes, mime), 'UNSUPPORTED_MEDIA_TYPE', 415);
      let width = 960,
        height = 540;
      if (mime.startsWith('image/')) {
        const sharp = (await import('sharp')).default;
        const m = await sharp(bytes, { limitInputPixels: 16777216 }).metadata();
        requireContent(m.width && m.height, 'MEDIA_INVALID_CONTAINER', 400);
        width = m.width;
        height = m.height;
      }
      const clearance = await this.scan(bytes, mime, 'course-local-media');
      requireContent(!request.signal.aborted, 'MEDIA_CANCELLED', 409);
      return this.guard(x, async () => {
        requireContent(!request.signal.aborted, 'MEDIA_CANCELLED', 409);
        const p = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
        const assetId = await p.assetStore.put(
          assetPrincipalForOwner(owner),
          new Blob([new Uint8Array(bytes)], { type: mime }),
          { contentType: mime },
        );
        return {
          success: true,
          source: 'LOCAL_UPLOAD',
          assetId,
          mime,
          sha256: sha(bytes),
          clearance,
          result: {
            url: `/api/zhiban/authoring/${x.tenant}/offerings/${x.offering}/native/api/persistence/assets/${encodeURIComponent(assetId)}/content`,
            width,
            height,
          },
        };
      });
    } finally {
      this.active.delete(owner);
    }
  }
  async adopt(x: ContentContext, v: Record<string, unknown>, command: string) {
    requireContent(
      Object.keys(v).every((k) => ['assetId', 'title', 'text'].includes(k)) &&
        typeof v.assetId === 'string' &&
        v.assetId.length <= 2048 &&
        typeof v.title === 'string' &&
        v.title.trim().length > 0 &&
        v.title.length <= 120 &&
        (v.text === undefined || (typeof v.text === 'string' && v.text.length <= 8000)),
    );
    const owner = authoringOwner(x),
      stage = 'media-' + hash(owner + ':' + command + ':' + v.assetId).slice(0, 48),
      c = await this.pool.connect();
    let held = false;
    try {
      held = (
        await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS held', [
          'media:' + owner + ':' + command,
        ])
      ).rows[0].held;
      requireContent(held, 'MEDIA_BUSY', 409);
      return await this.guard(x, async () => {
        const store = await getOwnerScopedDocumentStore(owner);
        const old = await store.loadDocument(stage);
        if (old) {
          requireContent(
            (old.outline as AppDocumentOutline | undefined)?.mediaSource?.commandDigest ===
              hash(JSON.stringify([v.assetId, v.title, v.text ?? ''])),
            'COMMAND_CONFLICT',
            409,
          );
          return { stageId: stage, alreadyExists: true };
        }
        const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? ''),
          asset = await provider.assetStore.resolve(
            assetPrincipalForOwner(owner),
            v.assetId as string,
          );
        requireContent(asset, 'NOT_FOUND', 404);
        const mime = asset.mime;
        requireContent(
          /^(image\/(png|jpeg|webp|gif)|audio\/(mpeg|wav|ogg)|video\/(mp4|webm|quicktime))$/.test(
            mime,
          ),
        );
        const type = mime.startsWith('image/')
            ? 'image'
            : mime.startsWith('video/')
              ? 'video'
              : 'audio',
          now = Date.now();
        const element: any = {
          id: 'media',
          type,
          left: 80,
          top: 80,
          width: type === 'audio' ? 80 : 800,
          height: type === 'audio' ? 80 : 400,
          rotate: 0,
          src: v.assetId,
          ...(type === 'image' ? { fixedRatio: true } : {}),
        };
        const doc: any = {
          stage: { id: stage, name: v.title, createdAt: now, updatedAt: now },
          scenes: [
            {
              id: stage + '-scene',
              stageId: stage,
              type: 'slide',
              title: v.title,
              order: 0,
              createdAt: now,
              updatedAt: now,
              content: {
                type: 'slide',
                canvas: {
                  id: stage + '-slide',
                  viewportSize: 960,
                  viewportRatio: 9 / 16,
                  background: { type: 'solid', color: '#ffffff' },
                  elements: [element],
                },
              },
              actions:
                type === 'audio' && v.text
                  ? [{ id: 'narration', type: 'speech', text: v.text, audioId: v.assetId }]
                  : [],
            },
          ],
          outline: {
            outlines: [],
            generationComplete: true,
            producer: 'client',
            createdAt: now,
            updatedAt: now,
          },
        };
        // This is a new editing document, never an overwrite of an open editor or a publication.
        doc.outline.mediaSource = {
          assetId: v.assetId,
          sha256: sha(Buffer.from(asset.bytes)),
          createdAt: now,
          commandDigest: hash(JSON.stringify([v.assetId, v.title, v.text ?? ''])),
        };
        try {
          await store.saveDocument(doc);
        } catch (error) {
          const saved = await store.loadDocument(stage);
          if (
            (saved?.outline as AppDocumentOutline | undefined)?.mediaSource?.commandDigest !==
            doc.outline.mediaSource.commandDigest
          )
            throw error;
        }
        return { stageId: stage, alreadyExists: false, published: false };
      });
    } finally {
      try {
        if (held)
          await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
            'media:' + owner + ':' + command,
          ]);
        c.release();
      } catch {
        c.release(true);
      }
    }
  }
}
