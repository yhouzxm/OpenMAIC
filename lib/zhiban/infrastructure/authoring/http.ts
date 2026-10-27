import { configureLegacyOfficeScanner } from '@/lib/document/legacy-office';
import { AuthoringMediaService } from './media/service';
import { NativeArchiveService } from './archive/service';
import { CourseVideoService } from './video';
import { createHash } from 'node:crypto';
import { rewritePublishedSlideMedia } from './published-media';
import { isSlideContent } from '@openmaic/dsl';
import { actionsToManifest } from '@/lib/export/manifest-actions';
import { manifestAgentFromConfig } from '@/lib/export/classroom-zip-types';
import type { SubmissionFileClearance } from '../../application/learning/attachment-assets';
import type { Pool } from 'pg';
import type { IdentityAuthentication } from '../identity/composition/authentication';
import { academicSessionAuthentication } from '../academic/session-authentication';
import {
  cookie,
  headers,
  body,
  response,
  failure,
  requestId,
  ProtocolRefusal,
} from '../identity/http/protocol';
import { ContentError, requireContent, id, revision } from '../content/model';
import type { ContentContext, ContentService } from '../content/service';
import { nativeAuthoringRequest, authoringOwner } from './host';
import { AuthoringSnapshots } from './snapshot';
import { getAgentSessionStore } from '@/lib/server/agent-runtime/store';
import { assetPrincipalForOwner } from '@/lib/persistence/owner-assets';
export function authoringHttp(
  content: ContentService,
  pool: Pool,
  security: IdentityAuthentication,
  origin: string,
  clearance?: SubmissionFileClearance | null,
) {
  const authenticate = academicSessionAuthentication((t) => security.authenticate(t));
  if (clearance?.mode === 'TRUSTED_SCANNER')
    configureLegacyOfficeScanner(async (bytes, mime) => {
      const result = await (clearance.checkArchive ?? clearance.check)({
        name: 'converted-office',
        mime,
        base64: bytes.toString('base64'),
      });
      requireContent(
        result?.mode === 'TRUSTED_SCANNER' &&
          result.digest === createHash('sha256').update(bytes).digest('hex'),
        'FILE_NOT_CLEARED',
        503,
      );
    });
  const snapshots = new AuthoringSnapshots(pool, content);
  const archives = new NativeArchiveService(content, pool, clearance);
  const video = new CourseVideoService(content, pool);
  const media = new AuthoringMediaService(content, pool, clearance);
  let active = 0,
    streams = 0;
  const streamsByOwner = new Map<string, number>();
  return async (request: Request) => {
    const trace = requestId();
    if (active >= 12) return failure(trace, 503, 'UNAVAILABLE');
    active++;
    try {
      const url = new URL(request.url),
        m = /^\/api\/zhiban\/authoring\/([^/]+)\/offerings\/([^/]+)(?:\/(.*))?$/.exec(url.pathname);
      requireContent(m, 'NOT_FOUND', 404);
      const tenant = id(m[1]),
        offering = id(m[2]),
        tail = m[3] ?? '';
      const h = new Headers(request.headers);
      const asset = /^(?:published|draft)\/([0-9a-f-]+)\/asset$/.exec(tail),
        frame = /^(?:published|draft)\/([0-9a-f-]+)\/frame$/.exec(tail);
      if (
        (asset || frame || tail.startsWith('native/')) &&
        request.method === 'GET' &&
        !h.has('x-zhiban-request')
      ) {
        requireContent(
          h.get('sec-fetch-site') === 'same-origin' &&
            ['image', 'video', 'audio', 'iframe', 'empty'].includes(h.get('sec-fetch-dest') ?? ''),
          'FORBIDDEN',
          403,
        );
        const referer = h.get('referer');
        requireContent(referer && new URL(referer).origin === origin, 'FORBIDDEN', 403);
        h.set('x-zhiban-request', 'identity-v1');
      }
      const unsafe = !['GET', 'HEAD'].includes(request.method);
      const protocol = new Headers(h);
      if (
        unsafe &&
        (tail.startsWith('native/') || tail.startsWith('archive/') || tail.startsWith('video/') || tail === 'media/upload')
      )
        protocol.set('content-type', 'application/json'); // native upload bodies are checked by their original handlers
      headers(new Request(request.url, { headers: protocol }), origin, unsafe);
      requireContent(!request.headers.has('content-encoding'));
      const token = cookie(request),
        handle = token ? await authenticate(token) : null;
      requireContent(handle, 'UNAUTHENTICATED', 401);
      let space = null,
        cursor = null;
      do {
        const page = await security.spaces(handle, cursor, 50);
        space = page.find((s) => s.tenantId === tenant) ?? space;
        cursor = page.length === 50 ? page.at(-1)!.membershipId : null;
      } while (!space && cursor);
      requireContent(space, 'FORBIDDEN', 403);
      if (unsafe) {
        const csrf = request.headers.get('x-zhiban-csrf');
        requireContent(csrf && /^[A-Za-z0-9_-]{43}$/.test(csrf), 'FORBIDDEN', 403);
        await security.assertUnsafe(handle, origin, csrf);
      }
      const x: ContentContext = { handle, tenant, offering, member: space.membershipId };
      if(tail==='video/capability'&&request.method==='GET')
        return response(trace,200,await video.capability(x,url.searchParams));
      if(tail==='video/jobs'&&request.method==='GET')
        return response(trace,200,await video.list(x,url.searchParams));
      if(tail==='video/jobs'&&request.method==='POST')
        return response(trace,202,await video.submit(x,url.searchParams,request));
      const videoJob=/^video\/jobs\/([^/]+)(?:\/(download))?$/.exec(tail);
      if(videoJob&&['GET','POST'].includes(request.method)){
        requireContent(!videoJob[2]||request.method==='GET');
        const result=await video.job(x,videoJob[1],videoJob[2]?'download':request.method==='POST'?'cancel':'status');
        return result instanceof Response?result:response(trace,200,result);
      }
      if (tail === 'media/upload' && request.method === 'POST')
        return response(trace, 200, await media.upload(x, request));
      if (tail === 'media/jobs' && request.method === 'GET') {
        requireContent(url.searchParams.size === 0);
        return response(trace, 200, await media.jobs(x));
      }
      if (tail === 'media/job' && request.method === 'GET') {
        requireContent(url.searchParams.size === 1 && url.searchParams.has('id'));
        return response(trace, 200, await media.jobs(x, url.searchParams.get('id')!));
      }
      if (tail === 'media/status' && request.method === 'GET')
        return response(trace, 200, await media.status(x));
      if (tail === 'media/material-result' && request.method === 'GET') {
        requireContent(url.searchParams.size === 1 && url.searchParams.has('id'));
        return response(trace, 200, await media.materialResult(x, url.searchParams.get('id')!));
      }
      if (tail === 'media/adopt' && request.method === 'POST')
        return response(
          trace,
          200,
          await media.adopt(
            x,
            (await body(request, 16384, 3000)) as Record<string, unknown>,
            id(request.headers.get('x-zhiban-command')),
          ),
        );
      const mediaKind = /^native\/api\/(?:generate\/(image|video|tts)|(transcription))$/.exec(tail);
      if (mediaKind && request.method === 'POST')
        return response(
          trace,
          200,
          await media.execute(
            x,
            (mediaKind[1] ?? 'asr') as 'image' | 'video' | 'tts' | 'asr',
            request,
          ),
        );
      if (tail === 'archive/access' && request.method === 'GET') {
        await archives.access(x, url.searchParams);
        return response(trace, 200, { allowed: true });
      }
      if (tail === 'archive/export' && request.method === 'GET') {
        const data = await archives.export(x, url.searchParams);
        return new Response(new Uint8Array(data.bytes), {
          headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': 'attachment; filename=course.maic.zip',
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
            'X-Zhiban-Source-Digest': data.digest,
          },
        });
      }
      if (['archive/inspect', 'archive/restore'].includes(tail) && request.method === 'POST') {
        requireContent(
          request.headers.get('content-type') === 'application/zip' &&
            url.searchParams.size === 1 &&
            ['maic', 'pptx'].includes(url.searchParams.get('kind') ?? ''),
        );
        const bytes = Buffer.from(await request.arrayBuffer());
        requireContent(
          bytes.length > 0 && bytes.length <= 64 * 1024 * 1024,
          'ARCHIVE_TOO_LARGE',
          413,
        );
        if (tail === 'archive/inspect')
          return response(
            trace,
            200,
            await archives.inspect(x, bytes, url.searchParams.get('kind')!),
          );
        const digest = request.headers.get('x-zhiban-archive-digest');
        requireContent(digest && /^[a-f0-9]{64}$/.test(digest));
        return response(
          trace,
          200,
          await archives.restore(
            x,
            bytes,
            url.searchParams.get('kind')!,
            digest,
            id(request.headers.get('x-zhiban-command')),
            request.signal,
          ),
        );
      }
      if (tail === 'review' && request.method === 'POST') {
        const v = (await body(request, 4096, 3000)) as {
          type: string;
          id: string;
          revision: string;
        };
        requireContent(
          Object.keys(v).length === 3 && ['PUBLISH_CONTENT', 'WITHDRAW_CONTENT'].includes(v.type),
        );
        id(v.id);
        revision(v.revision);
        if (v.type === 'PUBLISH_CONTENT') {
          const draft = await snapshots.draftDocument(x, v.id, v.revision);
          for (const asset of draft.assets)
            await snapshots.draftAsset(x, v.id, v.revision, asset.ref);
        }
        return response(
          trace,
          200,
          await content.execute(
            { ...x, deadline: undefined },
            v,
            request.headers.get('x-zhiban-command') ?? '',
          ),
        );
      }
      if (tail === 'delete-session' && request.method === 'POST') {
        const v = (await body(request, 4096, 3000)) as { id: unknown };
        requireContent(
          Object.keys(v).length === 1 &&
            typeof v.id === 'string' &&
            v.id.length > 0 &&
            v.id.length <= 128,
        );
        return response(
          trace,
          200,
          await content.authoring(x, async () => ({
            deleted: await (
              await getAgentSessionStore()
            ).softDeleteSession(v.id as string, authoringOwner(x)),
          })),
        );
      }
      const draft = /^draft\/([0-9a-f-]+)$/.exec(tail);
      if (draft && request.method === 'GET')
        return response(trace, 200, await snapshots.draftInfo(x, id(draft[1])));
      if (tail.startsWith('native/')) {
        const upstream = tail.slice(7);
        if (upstream === 'api/materials' && request.method === 'POST') {
          await content.authoring(x, async () => {});
          const available = await media.status(x);
          requireContent(
            available.materials.mimes.includes(
              request.headers.get('content-type')?.split(';')[0] ?? '',
            ),
            'MATERIAL_SERVICE_UNAVAILABLE',
            503,
          );
          requireContent(clearance?.mode === 'TRUSTED_SCANNER', 'SCANNER_REQUIRED', 503);
          const bytes = Buffer.from(await request.clone().arrayBuffer());
          requireContent(bytes.length > 0 && bytes.length <= 1048576, 'TOO_LARGE', 413);
          const checked = await clearance.check({
            name: 'native-material',
            mime: request.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream',
            base64: bytes.toString('base64'),
          });
          requireContent(
            checked?.mode === 'TRUSTED_SCANNER' &&
              checked.digest === createHash('sha256').update(bytes).digest('hex'),
            'FILE_NOT_CLEARED',
            503,
          );
        }

        const retry = /^api\/materials\/([^/]+)\/extraction$/.exec(upstream);
        if (retry && request.method === 'POST') {
          const { getOwnerMaterial } = await import('@/lib/persistence/owner-materials');
          const material = await content.authoring(x, () =>
            getOwnerMaterial(pool, authoringOwner(x), retry[1]),
          );
          requireContent(material, 'NOT_FOUND', 404);
          const available = await media.status(x);
          requireContent(
            typeof material.mime === 'string' && available.materials.mimes.includes(material.mime),
            'MATERIAL_SERVICE_UNAVAILABLE',
            503,
          );
        }
        // Core assets are capability-by-id too; private authoring refuses foreign entries.
        const assetId = /^api\/persistence\/assets\/([^/]+)/.exec(upstream)?.[1];
        if (assetId) {
          const entry = await pool.query(
            'SELECT 1 FROM asset_entries WHERE id=$1 AND principal=$2',
            [decodeURIComponent(assetId), assetPrincipalForOwner(authoringOwner(x)).key],
          );
          requireContent(entry.rowCount, 'NOT_FOUND', 404);
        }
        const r = await nativeAuthoringRequest(content, x, request, '/' + upstream);
        r.headers.set(
          'Content-Security-Policy',
          "default-src 'none'; frame-ancestors 'none'; sandbox",
        );
        if (r.headers.get('content-type')?.includes('text/event-stream') && r.body) {
          const owner = authoringOwner(x),
            count = streamsByOwner.get(owner) ?? 0;
          if (streams >= 24 || count >= 8) {
            await r.body.cancel();
            throw new ContentError('UNAVAILABLE', 503);
          }
          streams++;
          streamsByOwner.set(owner, count + 1);
          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            streams--;
            const current = (streamsByOwner.get(owner) ?? 1) - 1;
            if (current) streamsByOwner.set(owner, current);
            else streamsByOwner.delete(owner);
          };
          const reader = r.body.getReader();
          return new Response(
            new ReadableStream({
              async pull(controller) {
                try {
                  const n = await reader.read();
                  if (n.done) {
                    release();
                    controller.close();
                  } else controller.enqueue(n.value);
                } catch (e) {
                  release();
                  controller.error(e);
                }
              },
              async cancel() {
                release();
                await reader.cancel();
              },
            }),
            { status: r.status, headers: r.headers },
          );
        }
        return r;
      }
      if (tail === '' && request.method === 'GET') {
        await content.authoring(x, async () => {});
        return response(trace, 200, { enabled: true, ownerBoundToCurrentCourse: true });
      }
      const draftRead = /^draft\/([0-9a-f-]+)\/document$/.exec(tail);
      const published = /^published\/([0-9a-f-]+)$/.exec(tail);
      if (request.method === 'GET' && (published || draftRead || asset || frame)) {
        const resource = id((published ?? draftRead ?? asset ?? frame)![1]);
        const isDraft = tail.startsWith('draft/'),
          versionKey = isDraft ? 'revision' : 'publication';
        const publication = isDraft
          ? revision(url.searchParams.get('revision'))
          : id(url.searchParams.get('publication'));
        requireContent(
          url.searchParams.size === (asset || frame ? 2 : 1) &&
            [...url.searchParams.keys()].every((k) =>
              [versionKey, asset ? 'ref' : frame ? 'scene' : ''].includes(k),
            ),
          'INVALID_INPUT',
          400,
        );
        if (asset) {
          requireContent(url.searchParams.size === 2, 'INVALID_INPUT');
          const data = await (
            isDraft ? snapshots.draftAsset.bind(snapshots) : snapshots.asset.bind(snapshots)
          )(x, resource, publication, url.searchParams.get('ref') ?? '');
          const range = request.headers.get('range');
          if (range) {
            const m = /^bytes=(\d+)-(\d*)$/.exec(range);
            if (!m)
              return new Response(null, {
                status: 416,
                headers: { 'Content-Range': `bytes */${data.bytes.length}` },
              });
            const start = Number(m[1]),
              end = m[2] ? Math.min(Number(m[2]), data.bytes.length - 1) : data.bytes.length - 1;
            if (
              !Number.isSafeInteger(start) ||
              start < 0 ||
              start > end ||
              start >= data.bytes.length
            )
              return new Response(null, {
                status: 416,
                headers: { 'Content-Range': `bytes */${data.bytes.length}` },
              });
            return new Response(new Uint8Array(data.bytes.subarray(start, end + 1)), {
              status: 206,
              headers: {
                'Content-Type': data.mime,
                'Content-Length': String(end - start + 1),
                'Content-Range': `bytes ${start}-${end}/${data.bytes.length}`,
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'private, no-store',
                'Content-Security-Policy':
                  "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
                'X-Content-Type-Options': 'nosniff',
              },
            });
          }
          return new Response(new Uint8Array(data.bytes), {
            headers: {
              'Content-Type': data.mime,
              'Accept-Ranges': 'bytes',
              'Content-Length': String(data.bytes.length),
              'Cache-Control': 'private, no-store',
              'X-Content-Type-Options': 'nosniff',
              'Content-Security-Policy':
                "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
            },
          });
        }
        const p = isDraft
          ? await snapshots.draftDocument(x, resource, publication)
          : await snapshots.published(x, resource, publication);
        if (frame) {
          const order = Number(url.searchParams.get('scene'));
          requireContent(
            Number.isSafeInteger(order) && order >= 0 && order <= 10000,
            'NOT_FOUND',
            404,
          );
          const scene = p.document.scenes.find((s) => s.order === order);
          requireContent(scene, 'NOT_FOUND', 404);
          requireContent(scene.type === 'interactive', 'NOT_FOUND', 404);
          return new Response(scene.content.html, {
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'private, no-store',
              'Content-Security-Policy':
                "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; sandbox allow-scripts",
              'X-Content-Type-Options': 'nosniff',
            },
          });
        }
        const base = url.origin + url.pathname.replace(/\/document$/, '');
        const refs = new Map(
          p.assets.map((a) => [
            a.ref,
            `${base}/asset?${versionKey}=${publication}&ref=${encodeURIComponent(a.ref)}`,
          ]),
        );
        const doc = structuredClone(p.document);
        const videoRefs = new Set(
          p.assets.filter((a) => a.mime.startsWith('video/')).map((a) => a.ref),
        );
        const rewriteSlide = (slide: Parameters<typeof rewritePublishedSlideMedia>[0]) =>
          rewritePublishedSlideMedia(slide, refs, videoRefs);
        for (const slide of doc.stage.whiteboard ?? []) rewriteSlide(slide);
        for (const scene of doc.scenes) {
          if (isSlideContent(scene.content)) rewriteSlide(scene.content.canvas);
          for (const slide of scene.whiteboards ?? []) rewriteSlide(slide);
        }
        if (doc.stage.videoManifest)
          doc.stage.videoManifest = Object.fromEntries(
            Object.entries(doc.stage.videoManifest).map(([ref, value]) => [
              refs.get(ref) ?? ref,
              value,
            ]),
          );
        const configs = p.document.stage.generatedAgentConfigs ?? [];
        const agentIndices = new Map<string, number>(configs.map((a, i) => [a.id, i]));
        const scenes = doc.scenes.map((s) => ({
          ...s,
          actions: s.actions
            ? actionsToManifest(
                s.actions,
                new Map(p.assets.map((a) => [a.ref, a.ref])),
                agentIndices,
              )
            : undefined,
          ...(s.multiAgent?.enabled
            ? {
                multiAgent: {
                  enabled: true,
                  agentIndices: s.multiAgent.agentIds
                    .map((id: string) => agentIndices.get(id))
                    .filter((i: unknown) => typeof i === 'number'),
                },
              }
            : {}),
        }));
        const mediaTable = Object.fromEntries(
          p.assets
            .filter((a) => a.mime.startsWith('audio/') || a.mime.startsWith('video/'))
            .flatMap((a) => [
              [a.ref, { src: refs.get(a.ref), mimeType: a.mime }],
              [refs.get(a.ref)!, { src: refs.get(a.ref), mimeType: a.mime }],
            ]),
        );
        return response(trace, 200, {
          publicationId: isDraft ? null : publication,
          publicationNo: p.publicationNo,
          sourceDigest: p.sourceDigest,
          manifest: {
            formatVersion: 1,
            exportedAt: new Date(0).toISOString(),
            appVersion: 'zhiban-native-published-v1',
            stage: doc.stage,
            agents: configs.map(manifestAgentFromConfig),
            mediaIndex: {},
            scenes,
          },
          mediaTable,
          frameUrl: base + '/frame?' + versionKey + '=' + publication + '&scene={sceneOrder}',
        });
      }
      requireContent(tail === 'snapshot' && request.method === 'POST', 'NOT_FOUND', 404);
      const v = (await body(request, 4096, 3000)) as {
        type: string;
        stageId: string;
        sourceDigest?: string;
      };
      requireContent(
        Object.keys(v).every((k) => ['type', 'stageId', 'sourceDigest'].includes(k)) &&
          typeof v.stageId === 'string' &&
          v.stageId.length <= 128,
      );
      if (v.type === 'PREVIEW') return response(trace, 200, await snapshots.preview(x, v.stageId));
      requireContent(
        v.type === 'ADOPT' &&
          typeof v.sourceDigest === 'string' &&
          /^[a-f0-9]{64}$/.test(v.sourceDigest),
      );
      return response(trace, 200, await snapshots.adopt(x, v.stageId, v.sourceDigest));
    } catch (e) {
      return failure(
        trace,
        e instanceof ContentError || e instanceof ProtocolRefusal ? e.status : 503,
        e instanceof ContentError
          ? e.code
          : e instanceof ProtocolRefusal
            ? 'PROTOCOL_REJECTED'
            : 'UNAVAILABLE',
      );
    } finally {
      active--;
    }
  };
}
