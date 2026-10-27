import { classroomImageTool } from './vision';
import { ClassroomLiveService } from '../classroom-live/service';
import { slideMediaReferenceSlots } from '@/lib/media/slide-media-slots';
import { isSlideContent } from '@openmaic/dsl';
import { serverMediaConnection } from '@/lib/server/model-config/media';
import { isGlmAsr, validateClassroomWav } from '@/lib/audio/asr-input-policy';
/** Published AI classroom adapter. Native execution/history is personal practice, never a grade source. */
import { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import * as persistence from '@/app/api/persistence/[...path]/route';
import * as chat from '@/app/api/chat/pi/route';
import * as visibility from '@/app/api/chat/pi/whiteboard-visibility/route';
import * as modelConfig from '@/app/api/model-config/route';
import * as providers from '@/app/api/server-providers/route';
import * as tts from '@/app/api/generate/tts/route';
import * as transcription from '@/app/api/transcription/route';
import * as quizGrade from '@/app/api/quiz-grade/route';
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
import { ContentError, requireContent, id } from '../content/model';
import type { ContentContext, ContentService } from '../content/service';
import type { MembershipId } from '../../domain/identity';
import { withNativeOwner } from '../authoring/host';
import { ClassroomAiService } from './service';
import { PublishedPblService } from './pbl';
import { SLIDE_ACTIONS, WHITEBOARD_ACTIONS } from '@/lib/orchestration/registry/types';
import type { StatelessChatRequest } from '@/lib/types/chat';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { guardedServerRuntimeStore } from '@/lib/persistence/runtime-tombstone-guard';
import { createWhiteboardRuntimeService } from '@/lib/whiteboard/runtime/store';

type Handler = (r: NextRequest, c?: { params: Promise<{ path: string[] }> }) => Promise<Response>;
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
  });
export function classroomAiHttp(
  content: ContentService,
  pool: Pool,
  security: IdentityAuthentication,
  origin: string,
) {
  const authenticate = academicSessionAuthentication((t) => security.authenticate(t));
  const service = new ClassroomAiService(content, pool);
  const live = new ClassroomLiveService(service, pool);
  const pbl = new PublishedPblService(service);
  const activeOwners = new Set<string>();
  let active = 0;
  return async (request: Request) => {
    const trace = requestId();
    if (active >= 16) return failure(trace, 503, 'UNAVAILABLE');
    active++;
    try {
      const u = new URL(request.url),
        m =
          /^\/api\/zhiban\/classroom-ai\/([^/]+)\/offerings\/([^/]+)\/resources\/([^/]+)\/publications\/([^/]+)(?:\/(.*))?$/.exec(
            u.pathname,
          );
      requireContent(m, 'NOT_FOUND', 404);
      const [tenant, offering, resource, publication] = m.slice(1, 5).map(id),
        tail = m[5] ?? '';
      const unsafe = !['GET', 'HEAD'].includes(request.method),
        protocol = new Headers(request.headers);
      if (unsafe && tail.startsWith('native/')) protocol.set('content-type', 'application/json');
      headers(new Request(request.url, { headers: protocol }), origin, unsafe);
      requireContent(!request.headers.has('content-encoding'));
      const token = cookie(request),
        handle = token ? await authenticate(token) : null;
      requireContent(handle, 'UNAUTHENTICATED', 401);
      let member: string | undefined,
        cursor: MembershipId | null = null;
      do {
        const page = await security.spaces(handle, cursor, 50);
        member = page.find((s) => s.tenantId === tenant)?.membershipId ?? member;
        cursor = page.length === 50 ? page.at(-1)!.membershipId : null;
      } while (!member && cursor);
      requireContent(member, 'FORBIDDEN', 403);
      if (unsafe) {
        const csrf = request.headers.get('x-zhiban-csrf');
        requireContent(csrf && /^[A-Za-z0-9_-]{43}$/.test(csrf), 'FORBIDDEN', 403);
        await security.assertUnsafe(handle, origin, csrf);
      }
      const x: ContentContext = { handle, tenant, offering, member };
      if (tail === 'shared' && request.method === 'GET')
        return response(trace, 200, await live.read(x, resource, publication));
      if (tail === 'shared' && request.method === 'POST')
        return response(trace, 200, await live.write(x, resource, publication, await body(request, 65536, 3000)));
      if ((tail === 'policy' || tail === 'pbl-policy') && request.method === 'POST') {
        const v = (await body(request, 4096, 3000)) as { enabled: unknown; revision: unknown };
        requireContent(
          Object.keys(v).length === 2 &&
            typeof v.enabled === 'boolean' &&
            typeof v.revision === 'string' &&
            /^(0|[1-9][0-9]{0,14})$/.test(v.revision),
        );
        return response(
          trace,
          200,
          await (tail === 'pbl-policy' ? pbl : service).changePolicy(
            x,
            resource,
            publication,
            v.enabled,
            v.revision,
          ),
        );
      }
      const context = await service.context(x, resource, publication),
        { binding, doc, snapshot } = context;
      if (tail === '' && request.method === 'GET') {
        let teacher = false;
        try {
          await content.authoring(x, async () => {});
          teacher = true;
        } catch (e) {
          if (!(e instanceof ContentError) || e.status !== 403) throw e;
        }
        return response(trace, 200, {
          ...(await service.policy(x, resource, publication)),
          ...(await pbl.policy(x, resource, publication)),
          hasPbl: doc.scenes.some((s) => s.content.type === 'pbl'),
          teacher,
          stageId: binding.stage,
          owner: binding.owner,
          title: doc.stage.name,
          sourceDigest: snapshot.sourceDigest,
          personalHistory: true,
          formalResults: false,
          publicationId: publication,
        });
      }
      requireContent(tail.startsWith('native/api/'), 'NOT_FOUND', 404);
      await binding.guard(async () => {});
      const path = '/' + tail.slice(7);
      if (path.startsWith('/api/pbl/v2/'))
        return await pbl.handle(request, x, resource, publication, context, path);
      if (request.method === 'GET') {
        if (path === `/api/stage-meta/${binding.stage}`)
          return json({
            isOwner: false,
            isPublic: false,
            publishedAt: 0,
            generationComplete: true,
            source: 'zhiban-fixed-publication',
          });
        if (path === '/api/agent/runtime') return json({ enabled: false });
        if (path === '/api/agents') return json({ agents: [] }); // built-ins are in code; published generated agents hydrate from the fixed document
        if (
          path === `/api/persistence/documents/${binding.stage}` ||
          path === `/api/stages/${binding.stage}`
        ) {
          const browserDocument = structuredClone(doc);
          for (const scene of browserDocument.scenes)
            if (scene.type === 'interactive') {
              scene.content.url = `/api/zhiban/authoring/${tenant}/offerings/${offering}/published/${resource}/frame?publication=${publication}&scene=${scene.order}`;
              delete scene.content.html; // an opaque URL frame keeps inline executable HTML out of the host CSP
            }
          return binding.guard(async () => json(browserDocument));
        }
        if (path === '/api/persistence/documents')
          return json([
            {
              id: binding.stage,
              name: doc.stage.name,
              sceneCount: doc.scenes.length,
              createdAt: doc.stage.createdAt,
              updatedAt: doc.stage.updatedAt,
            },
          ]);
        const s = new RegExp(`^/api/persistence/documents/${binding.stage}/scenes/([^/]+)$`).exec(
          path,
        );
        if (s) {
          const scene = doc.scenes.find((scene) => scene.id === decodeURIComponent(s[1]));
          requireContent(scene, 'NOT_FOUND', 404);
          return json(scene);
        }
      }
      const a = /^\/api\/persistence\/assets\/([^/]+)\/content$/.exec(path);
      if (a && ['GET', 'HEAD'].includes(request.method)) {
        const ref = decodeURIComponent(a[1]);
        const bytes = await service.snapshots.asset(x, resource, publication, ref);
        return binding.guard(
          async () =>
            new Response(request.method === 'HEAD' ? null : new Uint8Array(bytes.bytes), {
              headers: {
                'Content-Type': bytes.mime,
                'Content-Length': String(bytes.bytes.length),
                'X-Asset-Revision': bytes.digest,
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff',
              },
            }),
        );
      }
      let handler: Handler | undefined, payload: ArrayBuffer | undefined;
      const forwarded = new Headers(request.headers);
      forwarded.delete('content-length'); // all forwarded bodies are reconstructed locally
      for (const key of [
        'authorization',
        'x-model-routes',
        'x-openmaic-legacy-import',
        'x-api-key',
        'x-lesson-owner',
        'x-lesson-command',
        'x-lesson-intent',
      ])
        forwarded.delete(key);
      if (path.startsWith('/api/persistence/runtime/') || path === '/api/persistence/learner-key') {
        const rt = path.slice('/api/persistence'.length);
        let permitted = rt === '/learner-key' && request.method === 'GET';
        const list = new RegExp(
          `^/runtime/stages/${binding.stage}/learners/${binding.owner}(?:/sessions)?$`,
        ).exec(rt);
        if (list)
          permitted =
            request.method === 'GET' || (request.method === 'DELETE' && !rt.endsWith('/sessions'));
        if (rt === '/runtime/sessions' && request.method === 'POST') {
          const v = (await body(request, 262144, 3000)) as {
            stageId: unknown;
            learnerKey: unknown;
            kind: unknown;
          };
          requireContent(
            v.stageId === binding.stage &&
              v.learnerKey === binding.owner &&
              ['chat', 'chat-deletion', 'quizAttempt', 'whiteboard'].includes(String(v.kind)),
            'FORBIDDEN',
            403,
          );
          payload = new TextEncoder().encode(JSON.stringify(v)).buffer;
          permitted = true;
        }
        const session = /^\/runtime\/sessions\/([^/]+)(?:\/(records|status))?$/.exec(rt);
        if (session) {
          const found = await pool.query(
            'SELECT 1 FROM runtime_sessions WHERE id=$1 AND stage_id=$2 AND learner_key=$3',
            [decodeURIComponent(session[1]), binding.stage, binding.owner],
          );
          // Match the native RuntimeStore miss contract, including a foreign id.
          // Quiz hydration treats SESSION_NOT_FOUND as absence and creates its own session.
          if (!found.rowCount) return json({ error: { code: 'SESSION_NOT_FOUND' } }, 404);
          permitted =
            session[2] === 'records'
              ? ['GET', 'POST'].includes(request.method)
              : session[2] === 'status'
                ? request.method === 'PATCH'
                : ['GET', 'DELETE'].includes(request.method);
        }
        requireContent(permitted, 'FORBIDDEN', 403);
        handler = (persistence as unknown as Record<string, Handler>)[request.method];
      } else if (path === '/api/model-config' && request.method === 'GET')
        handler = modelConfig.GET;
      else if (path === '/api/server-providers' && request.method === 'GET')
        handler = providers.GET;
      else if (path === '/api/chat/pi' && request.method === 'POST') {
        const v = (await body(request, 524288, 3000)) as StatelessChatRequest;
        requireContent(
          Array.isArray(v.messages) &&
            v.messages.length <= 60 &&
            JSON.stringify(v.messages).length <= 65536,
        );
        requireContent(v.storeState?.stage?.id === binding.stage, 'FORBIDDEN', 403);
        const current = doc.scenes.find((s) => s.id === v.storeState.currentSceneId);
        requireContent(current, 'INVALID_INPUT');
        const original = snapshot.document.scenes.find((s) => s.id === current.id);
        const refs =
          original && isSlideContent(original.content)
            ? [...slideMediaReferenceSlots(original.content.canvas)].map((s) => s.read())
            : [];
        const images = snapshot.assets
          .filter(
            (a) =>
              refs.includes(a.ref) && a.size <= 1048576 && /^image\/(png|jpeg|webp)$/.test(a.mime),
          )
          .slice(0, 2);
        binding.imageTool = classroomImageTool({
          count: images.length,
          sourceDigest: snapshot.sourceDigest,
          guard: (work) => binding.guard(work),
          load: (index) => service.snapshots.asset(x, resource, publication, images[index].ref),
        });
        const selected = v.config?.agentIds;
        requireContent(
          Array.isArray(selected) &&
            selected.length > 0 &&
            selected.length <= 6 &&
            selected.every((id) => context.agents.some((a) => a.id === id)),
          'FORBIDDEN',
          403,
        );
        const allowed = new Set([...SLIDE_ACTIONS, ...WHITEBOARD_ACTIONS]);
        v.storeState = {
          stage: doc.stage,
          scenes: doc.scenes,
          outlines: context.outline.outlines,
          currentSceneId: current.id,
          mode: 'playback',
          whiteboardOpen: v.storeState.whiteboardOpen === true,
          whiteboardManualVisibilityRevision: Number.isSafeInteger(
            v.storeState.whiteboardManualVisibilityRevision,
          )
            ? v.storeState.whiteboardManualVisibilityRevision
            : 0,
        };
        const provider = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
        const board = await withNativeOwner(
          binding.owner,
          () =>
            createWhiteboardRuntimeService({
              store: guardedServerRuntimeStore(provider.runtimeStore, provider.pool),
              resolveLearnerKey: () => binding.owner,
            }).read(binding.stage),
          binding,
        );
        if (board.whiteboard) v.storeState.stage = { ...doc.stage, whiteboard: [board.whiteboard] };
        v.config = {
          agentIds: selected,
          agentConfigs: context.agents
            .filter((a) => selected.includes(a.id))
            .map((a) => ({
              ...a,
              allowedActions: a.allowedActions.filter((action) => allowed.has(action)),
            })),
          sessionType: v.config.sessionType === 'discussion' ? 'discussion' : 'qa',
          discussionTopic: v.config.discussionTopic?.slice(0, 2000),
          discussionPrompt: v.config.discussionPrompt?.slice(0, 2000),
          triggerAgentId: selected.includes(v.config.triggerAgentId ?? '')
            ? v.config.triggerAgentId
            : undefined,
          piEnableWhiteboardTools: true,
          piMaxAgentTurns: 3,
          piMaxActionsPerAgent: 6,
        };
        for (const k of [
          'apiKey',
          'baseUrl',
          'model',
          'providerType',
          'webSearchApiKey',
          'webSearchBaseUrl',
          'webSearchProviderId',
          'webSearchModelId',
          'userProfile',
          'thinking',
          'thinkingConfig',
        ])
          delete (v as unknown as Record<string, unknown>)[k];
        v.apiKey = '';
        payload = new TextEncoder().encode(JSON.stringify(v)).buffer;
        handler = chat.POST;
      } else if (path === '/api/chat/pi/whiteboard-visibility' && request.method === 'POST') {
        const v = (await body(request, 4096, 3000)) as { stageId: unknown };
        requireContent(v.stageId === binding.stage, 'FORBIDDEN', 403);
        payload = new TextEncoder().encode(JSON.stringify(v)).buffer;
        handler = visibility.POST;
      } else if (path === '/api/quiz-grade' && request.method === 'POST') {
        const v = (await body(request, 32768, 3000)) as { question: string; userAnswer: string };
        const question = doc.scenes
          .flatMap((s) => (s.type === 'quiz' ? s.content.questions : []))
          .find((q) => q.question === v.question);
        requireContent(
          question &&
            question.type === 'short_answer' &&
            typeof v.userAnswer === 'string' &&
            v.userAnswer.length <= 8000,
        );
        payload = new TextEncoder().encode(
          JSON.stringify({
            question: question.question,
            userAnswer: v.userAnswer,
            points: question.points ?? 1,
            commentPrompt: question.commentPrompt,
            language: 'zh-CN',
          }),
        ).buffer;
        handler = quizGrade.POST;
      } else if (path === '/api/generate/tts' && request.method === 'POST') {
        const v = (await body(request, 32768, 3000)) as Record<string, unknown>;
        requireContent(
          typeof v.text === 'string' && v.text.length <= 8000 && typeof v.audioId === 'string',
        );
        payload = new TextEncoder().encode(
          JSON.stringify({ text: v.text, audioId: v.audioId }),
        ).buffer;
        handler = tts.POST;
      } else if (path === '/api/transcription' && request.method === 'POST') {
        const bytes = await request.arrayBuffer();
        requireContent(bytes.byteLength <= 5242880, 'TOO_LARGE', 413);
        const form = await new Request(request.url, {
          method: 'POST',
          headers: request.headers,
          body: bytes,
        }).formData();
        const audio = form.get('audio'),
          language = form.get('language');
        requireContent(
          audio instanceof File &&
            form.getAll('audio').length === 1 &&
            audio.size > 0 &&
            /^audio\/(?:webm|wav|x-wav|mpeg|mp4|ogg)(?:;.*)?$/.test(audio.type) &&
            (language === null ||
              (typeof language === 'string' && /^[a-zA-Z-]{2,16}$/.test(language))),
        );
        const connection = await serverMediaConnection('asr', binding.owner, { forward: false });
        const glm =
          connection && connection !== 'off' && isGlmAsr(connection.providerId, connection.modelId);
        if (glm) {
          requireContent(/^audio\/(?:wav|x-wav)$/.test(audio.type));
          try {
            validateClassroomWav(new Uint8Array(await audio.arrayBuffer()));
          } catch {
            throw new ContentError('INVALID_INPUT', 400);
          }
        }
        const clean = new FormData();
        clean.set('audio', audio, glm ? 'recording.wav' : 'recording');
        if (language) clean.set('language', language);
        // Provider/key/endpoint and saved-provider previews belong to operator settings.
        const encoded = new Request(request.url, { method: 'POST', body: clean });
        forwarded.set('content-type', encoded.headers.get('content-type')!);
        payload = await encoded.arrayBuffer();
        handler = transcription.POST;
      }
      requireContent(handler, 'FORBIDDEN', 403);
      if (unsafe && payload === undefined) {
        payload = await request.arrayBuffer();
        requireContent(payload.byteLength <= 5242880, 'TOO_LARGE', 413);
      }
      const abort = new AbortController();
      if (request.signal.aborted) abort.abort();
      else request.signal.addEventListener('abort', () => abort.abort(), { once: true });
      const native = new NextRequest(new URL(path + u.search, origin), {
        method: request.method,
        headers: forwarded,
        signal: abort.signal,
        ...(payload ? { body: payload } : {}),
      });
      // Reserve before starting the provider; rejected duplicate requests must never spend tokens.
      const streaming = path === '/api/chat/pi';
      if (streaming) {
        requireContent(
          !activeOwners.has(binding.owner) && activeOwners.size < 8,
          'UNAVAILABLE',
          503,
        );
        activeOwners.add(binding.owner);
      }
      let r: Response;
      try {
        r = await withNativeOwner(
          binding.owner,
          () =>
            handler!(native, {
              params: Promise.resolve({ path: path.slice('/api/persistence/'.length).split('/') }),
            }),
          binding,
        );
      } catch (e) {
        if (streaming) activeOwners.delete(binding.owner);
        abort.abort();
        throw e;
      }
      r.headers.delete('set-cookie');
      r.headers.set('Cache-Control', 'private, no-store');
      r.headers.set('X-Content-Type-Options', 'nosniff');
      if (r.headers.get('content-type')?.includes('text/event-stream') && r.body) {
        const reader = r.body.getReader();
        let done = false,
          checking = false;
        let refusal: string | undefined;
        const refused = (error: unknown) => {
          refusal = error instanceof ContentError ? error.code : 'UNAVAILABLE';
          console.warn('CLASSROOM_STREAM_GUARD_REFUSED', refusal);
          abort.abort();
        };
        const release = () => {
          if (done) return;
          done = true;
          clearInterval(timer);
          activeOwners.delete(binding.owner);
        };
        const timer = setInterval(() => {
          if (checking || done) return;
          checking = true;
          void binding
            .guard(async () => {})
            .catch(refused)
            .finally(() => {
              checking = false;
            });
        }, 2000);
        timer.unref();
        return new Response(
          new ReadableStream({
            async pull(controller) {
              if (done) return;
              try {
                const n = await reader.read();
                if (done) return;
                if (n.done) {
                  release();
                  if (refusal)
                    controller.enqueue(
                      new TextEncoder().encode(
                        `data: ${JSON.stringify({ type: 'error', data: { message: '课堂资格或启用状态已变化，请返回课程核对。' } })}\n\n`,
                      ),
                    );
                  controller.close();
                } else {
                  await binding.guard(async () => {});
                  if (done) return;
                  controller.enqueue(n.value);
                }
              } catch (e) {
                if (done) return; // cancellation may settle an already pending pull
                refused(e);
                release();
                await reader.cancel().catch(() => {});
                controller.error(e);
              }
            },
            async cancel() {
              abort.abort();
              release();
              await reader.cancel().catch(() => {});
            },
          }),
          { status: r.status, headers: r.headers },
        );
      }
      if (streaming) activeOwners.delete(binding.owner);
      if (r.body) {
        const bytes = await r.arrayBuffer();
        return binding.guard(
          async () => new Response(bytes, { status: r.status, headers: r.headers }),
        );
      }
      return r;
    } catch (e) {
      return failure(
        trace,
        e instanceof ContentError || e instanceof ProtocolRefusal ? e.status : 503,
        e instanceof ContentError ? e.code : 'CLASSROOM_UNAVAILABLE',
      );
    } finally {
      active--;
    }
  };
}
