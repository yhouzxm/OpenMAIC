import { configureUsageStorageDirectory } from '@/lib/server/usage-storage';
import { join, dirname } from 'node:path';
import { configureMaterialByteStore, LocalMaterialByteStore } from '@/lib/server/materials/bytes';
import { startOwnerMaterialExtractor } from '@/lib/server/materials/extraction';
import {
  configureAuthoringHost,
  initializeAuthoringStorage,
  stopAuthoringHost,
  authoringBindings,
  isAuthoringOwner,
} from '../authoring/host';
import type { QuizService } from '../../application/quiz/service';
import { AcademicError } from '../../domain/academic/model';
import { QUIZ_PROJECTION_VERSION, quizProjection } from './quiz-projection';
/** Thin host over the upstream durable run engine. No second generation scheduler. */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Pool } from 'pg';
import type { ContentContext, ContentService } from '../content/service';
import { ContentError, requireContent, canonical, hash, exact } from '../content/model';
import { configureGenerationRunHooks } from '@/lib/server/generation-run-hooks/registry';
import { defaultRunStepServices, type RunStepServices } from '@/lib/server/generation/run/services';
import { startGenerationRunner, wakeGenerationRunner } from '@/lib/server/generation/run/runner';
import { startGenerationRun, startRefusal } from '@/lib/server/generation/run/start';
import {
  readGenerationRun,
  runSnapshot,
  confirmGenerationRunOutline,
  retryGenerationRun,
  discardGenerationRun,
  RunCommandConflictError,
} from '@/lib/server/generation/run/store';
import { getOwnerScopedDocumentStore } from '@/lib/server/agent-runtime/owner-scoped-documents';
import { resolveModel } from '@/lib/server/resolve-model';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { ensureGenerationRunSchema } from '@/lib/persistence/generation-runs';
import { handoutProjection } from './projection';
import type { GenerationRunInput } from '@/lib/server/generation/run/types';
function safeRun(run: Parameters<typeof runSnapshot>[0]) {
  return {
    ...runSnapshot(run),
    error: run.error ? { errorCode: run.error.errorCode ?? 'GENERATION_FAILED' } : null,
  };
}
export const lessonSchema = `CREATE TABLE zhiban_lesson_runs (
 owner_id text NOT NULL, command_key text NOT NULL, intent_digest text NOT NULL,
 run_id text NOT NULL UNIQUE, tenant_id uuid NOT NULL, offering_id uuid NOT NULL, member_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,command_key)
)`;
export class LessonService {
  private readonly bindings = new Map<string, ContentContext>();
  private readonly execution = new AsyncLocalStorage<ContentContext>();
  private runner: ReturnType<typeof startGenerationRunner> | null = null;
  private native!: Pool;
  private materialExtractor: ReturnType<typeof startOwnerMaterialExtractor> | null = null;
  constructor(
    private readonly content: ContentService,
    private readonly quizzes?: QuizService,
  ) {}
  private owner(x: ContentContext, quiz = false) {
    return `${quiz ? 'quiz' : 'lesson'}:${hash(`${x.tenant}:${x.offering}:${x.member}`)}`;
  }
  private live(x: ContentContext) {
    return { ...x, deadline: undefined };
  }
  async initialize(databaseUrl: string, resume = false, materialRoot?: string) {
    // Standalone LOCAL host only. Never replace an existing native provider or inherit its receipt.
    requireContent(!process.env.DATABASE_URL, 'GENERATION_DATABASE_ALREADY_CONFIGURED', 503);
    process.env.DATABASE_URL = databaseUrl;
    if (materialRoot) {
      configureMaterialByteStore(new LocalMaterialByteStore(materialRoot));
      configureUsageStorageDirectory(join(dirname(materialRoot), 'native-usage'));
    }
    configureAuthoringHost(this.content);
    this.native = (await getServerPersistenceProvider(databaseUrl)).pool;
    await ensureGenerationRunSchema(this.native);
    if (resume) {
      const columns = (
        await this.native.query(
          `SELECT attname,format_type(atttypid,atttypmod) AS type,attnotnull FROM pg_attribute WHERE attrelid='public.zhiban_lesson_runs'::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum`,
        )
      ).rows;
      const expected = [
        'owner_id:text',
        'command_key:text',
        'intent_digest:text',
        'run_id:text',
        'tenant_id:uuid',
        'offering_id:uuid',
        'member_id:uuid',
        'created_at:timestamp with time zone',
      ];
      requireContent(
        JSON.stringify(columns.map((r) => `${r.attname}:${r.type}`)) === JSON.stringify(expected) &&
          columns.every((r) => r.attnotnull),
        'RESTORED_LESSON_SCHEMA_REJECTED',
        503,
      );
      const constraints = (
        await this.native.query(
          `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid='public.zhiban_lesson_runs'::regclass ORDER BY contype`,
        )
      ).rows
        .map((r) => r.def)
        .sort();
      requireContent(
        JSON.stringify(constraints) ===
          JSON.stringify(['PRIMARY KEY (owner_id, command_key)', 'UNIQUE (run_id)']),
        'RESTORED_LESSON_CONSTRAINTS_REJECTED',
        503,
      );
    } else await this.native.query(lessonSchema);
    await initializeAuthoringStorage(this.native);
    configureGenerationRunHooks({
      name: 'zhiban-course-lesson',
      authorizeStart: async (c) => {
        const x = this.bindings.get(c.ownerId) ?? authoringBindings.get(c.ownerId);
        requireContent(
          x &&
            (isAuthoringOwner(c.ownerId) || c.request.headers.get('x-lesson-owner') === c.ownerId),
          'FORBIDDEN',
          403,
        );
        const key = c.request.headers.get('x-lesson-command') ?? c.runId;
        const intent = c.request.headers.get('x-lesson-intent') ?? hash(canonical(c.input));
        await c.tx.query(
          'INSERT INTO zhiban_lesson_runs(owner_id,command_key,intent_digest,run_id,tenant_id,offering_id,member_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [c.ownerId, key, intent, c.runId, x.tenant, x.offering, x.member],
        );
        return {
          allow: true,
          attributes: { tenant: x.tenant, offering: x.offering, member: x.member },
        };
      },
      wrapExecution: async (c, execute) => {
        const x = this.bindings.get(c.ownerId) ?? authoringBindings.get(c.ownerId);
        requireContent(
          c.currentOwnerId === c.ownerId &&
            x &&
            (c.kind === 'material-extraction'
              ? isAuthoringOwner(c.ownerId)
              : c.attributes.tenant === x.tenant &&
                c.attributes.offering === x.offering &&
                c.attributes.member === x.member),
          'TEACHER_AUTHORIZATION_REQUIRED',
          403,
        );
        await this.content.authoring(this.live(x), async () => {});
        return this.execution.run(this.live(x), execute);
      },
      classifyFailure: (e) =>
        e instanceof ContentError
          ? { errorCode: e.code, retryable: false, statusCode: e.status }
          : undefined,
    });
    // Re-check at each upstream service boundary. In-flight provider calls may finish into private staging;
    // revocation prevents the next call and all adoption/publication through current Identity guards.
    const services = new Proxy(defaultRunStepServices, {
      get: (target, name: keyof RunStepServices) => {
        const fn = target[name];
        if (typeof fn !== 'function' || name === 'parallelSceneConcurrency') return fn;
        return async (...args: unknown[]) => {
          const x = this.execution.getStore();
          requireContent(x, 'TEACHER_AUTHORIZATION_REQUIRED', 403);
          await this.content.authoring(this.live(x), async () => {});
          return Reflect.apply(fn, target, args);
        };
      },
    }) as RunStepServices;
    this.runner = startGenerationRunner({ services, config: { maxConcurrent: 1 } });
    if (materialRoot) this.materialExtractor = startOwnerMaterialExtractor({ concurrency: 1 });
  }
  async close() {
    await this.materialExtractor?.stop({ timeoutMs: 5000 });
    await stopAuthoringHost();
    await this.runner?.stop({ timeoutMs: 5000 });
    if (this.native) await this.native.end();
  }
  get authoringPool() {
    return this.native;
  }
  private async capability(owner: string, quiz = false) {
    try {
      const models = await Promise.all(
        (
          [
            'scene-outlines-stream',
            quiz ? 'scene-content:quiz' : 'scene-content:slide',
            'scene-actions',
          ] as const
        ).map((stage) => resolveModel({ stage, workspaceId: owner })),
      );
      return {
        ready: true,
        models: models.map((m) => ({ provider: m.providerId, model: m.modelId })),
      };
    } catch {
      return { ready: false, models: [], reason: 'MODEL_CONFIGURATION_REQUIRED' };
    }
  }
  async handle(x: ContentContext, request: Request, value?: unknown) {
    const url = new URL(request.url);
    const quiz = url.searchParams.get('kind') === 'quiz';
    requireContent(!url.search || url.search === '?kind=quiz');
    const owner = this.owner(x, quiz);
    // All reads are teacher-only too; no native capability-by-id read is public here.
    await this.content.authoring(x, async () => {});
    requireContent(this.bindings.has(owner) || this.bindings.size < 100, 'UNAVAILABLE', 503);
    this.bindings.set(owner, this.live(x));

    const body = (request.method === 'POST' ? value : null) as Record<string, unknown> | null;
    if (request.method === 'GET') {
      const rows = (
        await this.native.query(
          'SELECT run_id FROM zhiban_lesson_runs WHERE owner_id=$1 ORDER BY created_at DESC,run_id DESC LIMIT 20',
          [owner],
        )
      ).rows;
      const runs = [];
      for (const row of rows) {
        const run = await readGenerationRun(row.run_id, owner);
        if (run)
          runs.push({
            ...runSnapshot(run),
            error: run.error ? { errorCode: run.error.errorCode ?? 'GENERATION_FAILED' } : null,
          });
      }
      return { capability: await this.capability(owner, quiz), runs };
    }
    requireContent(body && typeof body.type === 'string');
    const key = request.headers.get('x-zhiban-command') ?? '';
    requireContent(/^[A-Za-z0-9_-]{16,80}$/.test(key));
    if (body.type === 'START') {
      exact(body, ['type', 'requirement']);
      requireContent(
        typeof body.requirement === 'string' &&
          body.requirement.trim().length >= 5 &&
          body.requirement.length <= 8000 &&
          body.requirement.isWellFormed(),
      );
      const input: GenerationRunInput = {
        requirement:
          (quiz
            ? '为教师生成可审阅的中文测验，只生成quiz场景，合计最多8题，限single、multiple、short_answer，选择题必须包含正确选项值和解析，简答题提供评分指引。不生成slide、互动、媒体或外部链接。\n教师要求：\n'
            : '为教师起草可审阅的中文纯文字讲义，最多12页。只生成slide场景，正文用文本，不使用图片、视频、互动、测验或外部链接。\n教师要求：\n') +
          body.requirement.trim(),
        materialIds: [],
        interactive: false,
        taskEngine: false,
        agents: { mode: 'preset', agentIds: ['default-1'] },
        outlineReview: 'wait',
      };
      const intent = hash(canonical(input));
      const replay = async () => {
        const row = (
          await this.native.query(
            'SELECT run_id,intent_digest FROM zhiban_lesson_runs WHERE owner_id=$1 AND command_key=$2',
            [owner, key],
          )
        ).rows[0];
        if (!row) return null;
        requireContent(row.intent_digest === intent, 'CONFLICT', 409);
        const run = await readGenerationRun(row.run_id, owner);
        requireContent(run, 'UNAVAILABLE', 503);
        return { run: safeRun(run) };
      };
      const old = await replay();
      if (old) return old;
      requireContent(
        (await this.capability(owner, quiz)).ready,
        'MODEL_CONFIGURATION_REQUIRED',
        503,
      );
      try {
        return await this.content.authoring(x, async () => {
          try {
            const run = await startGenerationRun(owner, input, {
              principal: {
                ownerId: owner,
                kind: 'user',
                assurance: 'verified',
                roles: new Set(),
                channel: 'zhiban-lesson',
              },
              origin: 'generation-runs',
              request: new Request('https://localhost/internal', {
                headers: {
                  'x-lesson-owner': owner,
                  'x-lesson-command': key,
                  'x-lesson-intent': intent,
                },
              }),
            });
            return { run: safeRun(run) };
          } catch (e) {
            if ((e as { code?: string }).code === '23505') {
              const old = await replay();
              if (old) return old;
            }
            const refusal = startRefusal(e);
            if (refusal) throw new ContentError(refusal.code, refusal.status);
            throw e;
          }
        });
      } catch (e) {
        // Native hook insert and run are one transaction. A concurrent replay creates no orphan.
        if ((e as { code?: string }).code === '23505') {
          const result = await replay();
          if (result) return result;
        }
        const refusal = startRefusal(e);
        if (refusal) throw new ContentError(refusal.code, refusal.status);
        throw e;
      }
    }
    requireContent(typeof body.runId === 'string' && body.runId.length <= 128);
    const runId = body.runId;
    const binding = (
      await this.native.query('SELECT 1 FROM zhiban_lesson_runs WHERE owner_id=$1 AND run_id=$2', [
        owner,
        runId,
      ])
    ).rowCount;
    requireContent(binding, 'NOT_FOUND', 404);
    if (quiz && body.type === 'ADOPT') {
      exact(body, ['type', 'runId', 'sourceHash']);
      requireContent(this.quizzes, 'SERVICE_UNAVAILABLE', 503);
      requireContent(typeof body.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(body.sourceHash));
      const source = { runId, sourceHash: body.sourceHash, adapter: QUIZ_PROJECTION_VERSION };
      try {
        return await this.quizzes.adoptGenerated(
          { handle: x.handle, tenantId: x.tenant, actorMembershipId: x.member },
          x.offering,
          hash(`quiz-adopt:${owner}:${runId}`),
          source,
          async () => {
            // Cross the Academic transaction boundary using its typed errors;
            // otherwise a source conflict would be collapsed into UNAVAILABLE.
            try {
              const current = await readGenerationRun(runId, owner);
              requireContent(
                current?.state === 'completed' && !current.mediaPending && current.stageId,
                'GENERATION_NOT_COMPLETE',
                409,
              );
              const doc = await (
                await getOwnerScopedDocumentStore(owner)
              ).loadDocument(current.stageId);
              const projection = quizProjection(runId, doc);
              requireContent(projection.sourceHash === source.sourceHash, 'CONFLICT', 409);
              return { ...projection, source };
            } catch (error) {
              if (error instanceof ContentError)
                throw new AcademicError(
                  error.status === 404
                    ? 'NOT_FOUND'
                    : error.status === 403
                      ? 'FORBIDDEN'
                      : error.status === 503
                        ? 'UNAVAILABLE'
                        : 'CONFLICT',
                );
              throw error;
            }
          },
        );
      } catch (e) {
        if (e instanceof AcademicError)
          throw new ContentError(
            e.code,
            e.code === 'FORBIDDEN'
              ? 403
              : e.code === 'NOT_FOUND'
                ? 404
                : e.code === 'UNAVAILABLE'
                  ? 503
                  : e.code === 'INVALID_INPUT'
                    ? 400
                    : 409,
          );
        throw e;
      }
    }
    const run = await readGenerationRun(runId, owner);
    requireContent(run, 'NOT_FOUND', 404);
    try {
      if (body.type === 'CONFIRM') {
        exact(body, ['type', 'runId', 'outlineRevision']);
        requireContent(
          (await this.capability(owner, quiz)).ready,
          'MODEL_CONFIGURATION_REQUIRED',
          503,
        );
        requireContent(
          typeof body.outlineRevision === 'number' &&
            Number.isSafeInteger(body.outlineRevision) &&
            body.outlineRevision > 0,
        );
        if (quiz)
          requireContent(
            run.outline?.outlines?.length &&
              run.outline.outlines.length <= 12 &&
              run.outline.outlines.every((o) => o.type === 'quiz'),
            'QUIZ_OUTLINE_REQUIRED',
            409,
          );
        const outlineRevision = body.outlineRevision;
        await this.content.authoring(x, () =>
          confirmGenerationRunOutline(
            runId,
            owner,
            { commandId: key, outlineRevision },
            { maxActiveRunsPerOwner: 2 },
          ),
        );
        wakeGenerationRunner();
        return { accepted: true };
      }
      if (body.type === 'RETRY') {
        exact(body, ['type', 'runId']);
        requireContent(
          (await this.capability(owner, quiz)).ready,
          'MODEL_CONFIGURATION_REQUIRED',
          503,
        );
        await this.content.authoring(x, () => retryGenerationRun(runId, owner, { commandId: key }));
        wakeGenerationRunner();
        return { accepted: true };
      }
      if (body.type === 'CANCEL') {
        exact(body, ['type', 'runId']);
        await this.content.authoring(x, async () => {
          if (!run.stageId) await discardGenerationRun(run.id, owner);
          else await (await getOwnerScopedDocumentStore(owner)).deleteDocument(run.stageId);
        });
        return { accepted: true };
      }
      requireContent(['PREVIEW', 'ADOPT'].includes(body.type));
      exact(
        body,
        quiz && body.type === 'ADOPT' ? ['type', 'runId', 'sourceHash'] : ['type', 'runId'],
      );
      requireContent(
        run.state === 'completed' && !run.mediaPending && run.stageId,
        'GENERATION_NOT_COMPLETE',
        409,
      );
      if (quiz)
        return await this.content.authoring(x, async () =>
          quizProjection(
            runId,
            await (await getOwnerScopedDocumentStore(owner)).loadDocument(run.stageId!),
          ),
        );
      const doc = await (await getOwnerScopedDocumentStore(owner)).loadDocument(run.stageId);
      const projection = handoutProjection(run.id, doc);
      if (body.type === 'PREVIEW') return projection;
      // Existing transaction, audit, idempotency and publication chain; never publish implicitly.
      return this.content.adoptGenerated(x, run.id, projection.draft);
    } catch (e) {
      if (e instanceof AcademicError)
        throw new ContentError(
          e.code,
          e.code === 'FORBIDDEN'
            ? 403
            : e.code === 'NOT_FOUND'
              ? 404
              : e.code === 'UNAVAILABLE'
                ? 503
                : e.code === 'INVALID_INPUT'
                  ? 400
                  : 409,
        );
      if (e instanceof RunCommandConflictError) throw new ContentError('CONFLICT', 409);
      throw e;
    }
  }
}
