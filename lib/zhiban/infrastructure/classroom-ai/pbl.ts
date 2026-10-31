import { verifyInstalledSchema } from '@/lib/persistence/installed-schema';
/** Course-bound native autonomous PBL. No formal Attempt, grade or group-submission writes. */
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { Pool, PoolClient } from 'pg';
import * as instructor from '@/app/api/pbl/v2/instructor/route';
import * as openTask from '@/app/api/pbl/v2/open-task/route';
import * as simulator from '@/app/api/pbl/v2/simulator/route';
import * as evaluate from '@/app/api/pbl/v2/evaluate/route';
import * as taskUpdate from '@/app/api/pbl/v2/task/update/route';
import { resolvePBLContent } from '@/lib/pbl/legacy/read';
import { stripToDesignTemplate } from '@/lib/pbl/v2/runtime/learner-state';
import { currentMicrotask, normalizeProjectRuntime } from '@/lib/pbl/v2/operations/kernel/progress';
import type { PBLProjectV2 } from '@/lib/pbl/v2/types';
import type { PBLSSEEvent } from '@/lib/pbl/v2/api/sse';
import { applyInstructorEvent } from '@/components/scene-renderers/pbl/v2/apply-instructor-event';
import { body } from '../identity/http/protocol';
import { ContentError, hash, requireContent } from '../content/model';
import type { ContentContext } from '../content/service';
import { withNativeOwner } from '../authoring/host';
import type { ClassroomAiService } from './service';
import { mergePblLearnerInput, preparePblTaskCompletion } from './pbl-state';

export async function initializePublishedPbl(pool: Pool) {
  if (await verifyInstalledSchema(pool)) {
    return;
  }
  const sql = await readFile('lib/zhiban/infrastructure/classroom-ai/pbl-schema.sql', 'utf8');
  const c = await pool.connect();
  const expected: Record<string, string[]> = {
    zhiban_published_pbl_policy: [
      'tenant_id:uuid',
      'offering_id:uuid',
      'resource_id:uuid',
      'publication_id:uuid',
      'enabled:boolean',
      'revision:bigint',
      'updated_by:uuid',
      'updated_at:timestamp with time zone',
    ],
    zhiban_published_pbl_events: [
      'id:uuid',
      'tenant_id:uuid',
      'offering_id:uuid',
      'resource_id:uuid',
      'publication_id:uuid',
      'actor_id:uuid',
      'enabled:boolean',
      'revision:bigint',
      'created_at:timestamp with time zone',
    ],
    zhiban_published_pbl_state: [
      'owner_id:text',
      'stage_id:text',
      'scene_id:text',
      'source_digest:text',
      'revision:bigint',
      'project:jsonb',
      'updated_at:timestamp with time zone',
    ],
    zhiban_published_pbl_receipt: ['id:boolean', 'digest:text'],
  };
  try {
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtext('zhiban-published-pbl-schema'))");
    const exists = (
      await c.query("SELECT to_regclass('public.zhiban_published_pbl_receipt') AS receipt")
    ).rows[0].receipt;
    if (!exists) {
      for (const table of Object.keys(expected))
        requireContent(
          !(await c.query('SELECT to_regclass($1) AS t', ['public.' + table])).rows[0].t,
          'PBL_SCHEMA_REJECTED',
          503,
        );
      await c.query(sql);
      await c.query('INSERT INTO zhiban_published_pbl_receipt VALUES(true,$1)', [hash(sql)]);
    }
    requireContent(
      (await c.query('SELECT digest FROM zhiban_published_pbl_receipt WHERE id=true')).rows[0]
        ?.digest === hash(sql),
      'PBL_SCHEMA_REJECTED',
      503,
    );
    for (const [table, columns] of Object.entries(expected)) {
      const actual = (
        await c.query(
          'SELECT attname,format_type(atttypid,atttypmod) AS type,attnotnull FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum',
          ['public.' + table],
        )
      ).rows;
      const acl = (
        await c.query(
          "SELECT relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned,NOT relrowsecurity AS plain,NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(relacl,acldefault('r',relowner))) a WHERE a.grantee<>relowner) AS closed FROM pg_class WHERE oid=$1::regclass",
          ['public.' + table],
        )
      ).rows[0];
      requireContent(
        actual.every((a) => a.attnotnull) &&
          JSON.stringify(actual.map((a) => a.attname + ':' + a.type)) === JSON.stringify(columns) &&
          acl?.owned &&
          acl.plain &&
          acl.closed,
        'PBL_SCHEMA_REJECTED',
        503,
      );
    }
    const trigger = (
      await c.query(
        "SELECT p.prosrc,p.prosecdef,p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned,NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner) AS closed,(SELECT count(*) FROM pg_trigger t WHERE t.tgrelid='public.zhiban_published_pbl_events'::regclass AND t.tgfoid=p.oid AND t.tgtype=27 AND t.tgenabled='O')::integer AS triggers FROM pg_proc p WHERE p.oid='public.zhiban_published_pbl_audit_immutable()'::regprocedure",
      )
    ).rows[0];
    requireContent(
      trigger?.owned &&
        trigger.closed &&
        !trigger.prosecdef &&
        trigger.triggers === 1 &&
        trigger.prosrc.trim() === sql.match(/AS \$\$([\s\S]*?)\$\$/)![1].trim(),
      'PBL_SCHEMA_REJECTED',
      503,
    );
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
type Context = Awaited<ReturnType<ClassroomAiService['context']>>;
const json = (data: unknown, revision?: string) =>
  new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      ...(revision ? { 'X-Zhiban-PBL-Revision': revision } : {}),
    },
  });
export class PublishedPblService {
  private readonly runs = new Set<symbol>();
  constructor(readonly classroom: ClassroomAiService) {}
  get pool() {
    return this.classroom.pool;
  }
  keys(x: ContentContext, r: string, p: string) {
    return [x.tenant, x.offering, r, p];
  }
  async policy(x: ContentContext, r: string, p: string) {
    const row = (
      await this.pool.query(
        'SELECT enabled,revision FROM zhiban_published_pbl_policy WHERE tenant_id=$1 AND offering_id=$2 AND resource_id=$3 AND publication_id=$4',
        this.keys(x, r, p),
      )
    ).rows[0];
    return { pblEnabled: row?.enabled === true, pblRevision: String(row?.revision ?? 0) };
  }
  async changePolicy(x: ContentContext, r: string, p: string, enabled: boolean, revision: string) {
    const ctx = await this.classroom.context(x, r, p);
    requireContent(
      ctx.doc.scenes.some(
        (s) => s.content.type === 'pbl' && resolvePBLContent(s.content).kind === 'v2',
      ),
      'PBL_PROJECT_REQUIRED',
      400,
    );
    return this.classroom.content.authoring(x, () =>
      this.classroom.content.withPublishedAccess(x, r, p, async () => {
        const c = await this.pool.connect();
        try {
          await c.query('BEGIN');
          await c.query("SET LOCAL lock_timeout='2500ms'");
          await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
            'pbl-policy:' + this.keys(x, r, p).join(':'),
          ]);
          const old = (
            await c.query(
              'SELECT revision FROM zhiban_published_pbl_policy WHERE tenant_id=$1 AND offering_id=$2 AND resource_id=$3 AND publication_id=$4 FOR UPDATE',
              this.keys(x, r, p),
            )
          ).rows[0];
          requireContent(String(old?.revision ?? 0) === revision, 'CONFLICT', 409);
          const next = String(BigInt(revision) + BigInt(1));
          await c.query(
            'INSERT INTO zhiban_published_pbl_policy VALUES($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT(tenant_id,offering_id,resource_id,publication_id) DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at',
            [...this.keys(x, r, p), enabled, next, x.member],
          );
          await c.query(
            'INSERT INTO zhiban_published_pbl_events(id,tenant_id,offering_id,resource_id,publication_id,actor_id,enabled,revision) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
            [randomUUID(), ...this.keys(x, r, p), x.member, enabled, next],
          );
          await c.query('COMMIT');
          return { pblEnabled: enabled, pblRevision: next };
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        } finally {
          c.release();
        }
      }),
    );
  }
  async guard<T>(
    x: ContentContext,
    r: string,
    p: string,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.classroom.content.withPublishedAccess(
      { ...x, deadline: undefined },
      r,
      p,
      async () => {
        const c = await this.pool.connect();
        try {
          await c.query('BEGIN');
          await c.query("SET LOCAL lock_timeout='2500ms'");
          requireContent(
            (
              await c.query(
                'SELECT enabled FROM zhiban_classroom_ai_policy WHERE tenant_id=$1 AND offering_id=$2 AND resource_id=$3 AND publication_id=$4 FOR SHARE',
                this.keys(x, r, p),
              )
            ).rows[0]?.enabled === true,
            'CLASSROOM_DISABLED',
            403,
          );
          requireContent(
            (
              await c.query(
                'SELECT enabled FROM zhiban_published_pbl_policy WHERE tenant_id=$1 AND offering_id=$2 AND resource_id=$3 AND publication_id=$4 FOR SHARE',
                this.keys(x, r, p),
              )
            ).rows[0]?.enabled === true,
            'PBL_DISABLED',
            403,
          );
          const value = await work(c);
          await c.query('COMMIT');
          return value;
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        } finally {
          c.release();
        }
      },
    );
  }
  blueprint(ctx: Context, sceneId: string) {
    const scene = ctx.doc.scenes.find((s) => s.id === sceneId);
    requireContent(scene?.content.type === 'pbl', 'NOT_FOUND', 404);
    const resolved = resolvePBLContent(scene.content);
    requireContent(resolved.kind === 'v2', 'PBL_PROJECT_REQUIRED', 400);
    const project = stripToDesignTemplate(resolved.projectV2);
    (project as PBLProjectV2 & { coursePblSceneId: string }).coursePblSceneId = sceneId;
    project.language = 'zh-CN';
    normalizeProjectRuntime(project);
    return project;
  }
  async read(ctx: Context, sceneId: string, c: Pool | PoolClient = this.pool) {
    const blueprint = this.blueprint(ctx, sceneId);
    const row = (
      await c.query(
        'SELECT source_digest,revision,project FROM zhiban_published_pbl_state WHERE owner_id=$1 AND stage_id=$2 AND scene_id=$3',
        [ctx.binding.owner, ctx.binding.stage, sceneId],
      )
    ).rows[0];
    requireContent(
      !row || row.source_digest === ctx.snapshot.sourceDigest,
      'PBL_SOURCE_CHANGED',
      409,
    );
    return {
      project: (row?.project ?? blueprint) as PBLProjectV2,
      revision: String(row?.revision ?? 0),
    };
  }
  async handle(
    request: Request,
    x: ContentContext,
    r: string,
    p: string,
    ctx: Context,
    path: string,
  ) {
    const guard = <T>(work: () => Promise<T>) => this.guard(x, r, p, work);
    await guard(async () => {});
    if (path === '/api/pbl/v2/state' && request.method === 'GET') {
      const sceneId = new URL(request.url).searchParams.get('scene') ?? '';
      return this.guard(x, r, p, async (client) => json(await this.read(ctx, sceneId, client)));
    }
    requireContent(request.method === 'POST', 'FORBIDDEN', 403);
    const input = (await body(request, 1500000, 4000)) as Record<string, unknown> & {
      project: PBLProjectV2 & { coursePblSceneId?: string };
    };
    requireContent(input.project && typeof input.project.coursePblSceneId === 'string');
    const sceneId = input.project.coursePblSceneId!;
    this.blueprint(ctx, sceneId);
    const revision = request.headers.get('x-zhiban-pbl-revision');
    requireContent(
      revision && /^(0|[1-9][0-9]{0,14})$/.test(revision),
      'PBL_REVISION_REQUIRED',
      409,
    );
    requireContent(this.runs.size < 2, 'PBL_BUSY', 503);
    const slot = Symbol('pbl-operation');
    this.runs.add(slot);
    const c = await this.pool.connect().catch((error) => {
      this.runs.delete(slot);
      throw error;
    });
    const lock = 'pbl-run:' + ctx.binding.owner + ':' + ctx.binding.stage + ':' + sceneId;
    let acquired = false,
      released = false;
    const release = async () => {
      if (released) return;
      released = true;
      this.runs.delete(slot);
      try {
        if (acquired) await c.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [lock]);
        c.release();
      } catch {
        c.release(true);
      }
    };
    const abort = new AbortController();
    const onAbort = () => abort.abort();
    request.signal.addEventListener('abort', onAbort, { once: true });
    if (request.signal.aborted) abort.abort();
    const timeout = setTimeout(() => abort.abort(), 180000);
    timeout.unref();
    const close = async () => {
      clearTimeout(timeout);
      request.signal.removeEventListener('abort', onAbort);
      await release();
    };
    try {
      acquired = (
        await c.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS held', [lock])
      ).rows[0].held;
      requireContent(acquired, 'PBL_BUSY', 409);
      const saved = await guard(() => this.read(ctx, sceneId, c));
      requireContent(saved.revision === revision, 'PBL_STATE_CHANGED', 409);
      let project = mergePblLearnerInput(saved.project, input.project);
      const next = String(BigInt(revision) + BigInt(1));
      const persist = () =>
        guard(async () => {
          requireContent(!abort.signal.aborted, 'PBL_CANCELLED', 409);
          requireContent(Buffer.byteLength(JSON.stringify(project)) <= 2000000, 'TOO_LARGE', 413);
          await c.query(
            'INSERT INTO zhiban_published_pbl_state(owner_id,stage_id,scene_id,source_digest,revision,project) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner_id,stage_id,scene_id) DO UPDATE SET revision=excluded.revision,project=excluded.project,updated_at=now()',
            [
              ctx.binding.owner,
              ctx.binding.stage,
              sceneId,
              ctx.snapshot.sourceDigest,
              next,
              project,
            ],
          );
        });
      if (path === '/api/pbl/v2/state') {
        await persist();
        await close();
        return json({ project, revision: next }, next);
      }
      const active = currentMicrotask(project);
      const canonical: Record<string, unknown> = { project: structuredClone(project) };
      let handler: typeof instructor.POST;
      if (path === '/api/pbl/v2/task/update') {
        requireContent(
          [
            'start',
            'continue_handover',
            'enter_scenario',
            'complete_act',
            'complete_pending_task',
          ].includes(String(input.action)),
        );
        if (input.action === 'start')
          requireContent(
            active && input.microtaskId === active.microtask.id,
            'PBL_TASK_LOCKED',
            409,
          );
        canonical.action = input.action;
        canonical.microtaskId = input.microtaskId;
        handler = taskUpdate.POST;
      } else if (path === '/api/pbl/v2/evaluate') {
        requireContent(['task', 'milestone', 'final'].includes(String(input.kind)));
        if (input.kind === 'task')
          requireContent(
            active &&
              input.microtaskId === active.microtask.id &&
              input.milestoneId === active.milestone.id &&
              project.submissions.some((s) => s.microtaskId === active.microtask.id),
            'PBL_SUBMISSION_REQUIRED',
            409,
          );
        if (input.kind === 'milestone')
          requireContent(
            project.milestones.some((m) => m.id === input.milestoneId && m.status === 'completed'),
            'PBL_MILESTONE_INCOMPLETE',
            409,
          );
        if (input.kind === 'final')
          requireContent(project.status === 'completed', 'PBL_PROJECT_INCOMPLETE', 409);
        canonical.kind = input.kind;
        canonical.microtaskId = input.microtaskId;
        canonical.milestoneId = input.milestoneId;
        handler = evaluate.POST;
      } else if (path === '/api/pbl/v2/open-task') {
        requireContent(active && ['greeting', 'setup'].includes(String(input.phase)));
        canonical.phase = input.phase;
        handler = openTask.POST;
        // Client quiz snapshots are self-test inputs, not trusted adaptive evidence.
      } else if (path === '/api/pbl/v2/instructor' || path === '/api/pbl/v2/simulator') {
        requireContent(active && project.uiPhase === 'workspace', 'PBL_TASK_REQUIRED', 409);
        const greeting = path.endsWith('/simulator') && input.phase === 'greeting';
        requireContent(
          greeting ||
            (typeof input.userMessage === 'string' &&
              input.userMessage.trim().length > 0 &&
              input.userMessage.length <= 16000),
        );
        canonical.userMessage = greeting ? '' : input.userMessage;
        canonical.phase = greeting ? 'greeting' : 'instructing';
        handler = path.endsWith('/simulator') ? simulator.POST : instructor.POST;
      } else {
        requireContent(false, 'FORBIDDEN', 403);
      }
      const native = new NextRequest(new URL(path, request.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-locale': 'zh-CN' },
        body: JSON.stringify(canonical),
        signal: abort.signal,
      });
      const nativeBinding = { ...ctx.binding, guard };
      const result = await withNativeOwner(ctx.binding.owner, () => handler(native), nativeBinding);
      if (!result.ok) {
        await close();
        await result.body?.cancel().catch(() => {});
        return new Response(
          JSON.stringify({
            error: {
              code: 'PBL_REQUEST_REFUSED',
              message: '本次执行未完成，请核对项目状态或联系教师。',
            },
          }),
          {
            status: result.status,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
          },
        );
      }
      if (!result.headers.get('content-type')?.includes('text/event-stream')) {
        const value = await result.json();
        const data = value.data ?? value;
        requireContent(data.project, 'PBL_NATIVE_RESPONSE', 503);
        project = data.project;
        await persist();
        await close();
        return json(value, next);
      }
      requireContent(result.body, 'PBL_NATIVE_RESPONSE', 503);
      const reader = result.body.getReader(),
        encoder = new TextEncoder(),
        decoder = new TextDecoder();
      let buffer = '',
        finished = false,
        checking = false;
      let pulling: Promise<void> | undefined;
      let streamController: ReadableStreamDefaultController<Uint8Array>;
      const abortStream = () => {
        void reader
          .cancel()
          .catch(() => {})
          .then(async () => {
            await pulling?.catch(() => {});
            await cleanup();
            try {
              streamController.error(new ContentError('PBL_CANCELLED', 409));
            } catch {}
          });
      };
      const probe = setInterval(() => {
        if (checking || finished) return;
        checking = true;
        void guard(async () => {})
          .catch(() => abort.abort())
          .finally(() => {
            checking = false;
          });
      }, 2000);
      probe.unref();
      const cleanup = async () => {
        finished = true;
        abort.signal.removeEventListener('abort', abortStream);
        clearInterval(probe);
        abort.abort();
        await reader.cancel().catch(() => {});
        await close();
      };
      return new Response(
        new ReadableStream<Uint8Array>({
          // Pump on demand. Cancellation aborts the model before releasing its per-scene lock.
          start(controller) {
            streamController = controller;
            abort.signal.addEventListener('abort', abortStream, { once: true });
            if (abort.signal.aborted) abortStream();
          },
          pull(controller) {
            pulling = (async () => {
              try {
                while (!finished) {
                  requireContent(!abort.signal.aborted, 'PBL_CANCELLED', 409);
                  const frameEnd = buffer.indexOf('\n\n');
                  if (frameEnd < 0) {
                    const chunk = await reader.read();
                    if (chunk.done) throw new ContentError('PBL_STREAM_INCOMPLETE', 503);
                    buffer += decoder.decode(chunk.value, { stream: true });
                    continue;
                  }
                  const frame = buffer.slice(0, frameEnd);
                  buffer = buffer.slice(frameEnd + 2);
                  if (frame.startsWith(':')) {
                    controller.enqueue(encoder.encode(frame + '\n\n'));
                    return;
                  }
                  const type = /^event: (.+)$/m.exec(frame)?.[1],
                    data = /^data: (.+)$/m.exec(frame)?.[1];
                  requireContent(type && data, 'PBL_NATIVE_RESPONSE', 503);
                  const event = { ...JSON.parse(data), type } as PBLSSEEvent;
                  if (event.type === 'error') throw new ContentError('PBL_MODEL_FAILED', 503);
                  if (event.type === 'project_patch')
                    project = applyInstructorEvent(event, project, () => {});
                  if (event.type === 'done') {
                    if (path.endsWith('/evaluate') && input.kind === 'task')
                      preparePblTaskCompletion(project, String(input.microtaskId));
                    await persist();
                    await cleanup();
                    controller.enqueue(
                      encoder.encode(
                        `event: zhiban_commit\ndata: ${JSON.stringify({ revision: next })}\n\n`,
                      ),
                    );
                    controller.enqueue(encoder.encode(frame + '\n\n'));
                    controller.close();
                    return;
                  }
                  await guard(async () => {});
                  controller.enqueue(encoder.encode(frame + '\n\n'));
                  return;
                }
              } catch (e) {
                await cleanup();
                // Do not disclose model/provider/internal errors through the adapter.
                try {
                  controller.enqueue(
                    encoder.encode(
                      `event: error\ndata: ${JSON.stringify({ code: e instanceof ContentError ? e.code : 'PBL_UNAVAILABLE', message: '本次执行未保存，请重新打开项目核对后再继续。' })}\n\nevent: done\ndata: {}\n\n`,
                    ),
                  );
                  controller.close();
                } catch {}
              }
            })();
            return pulling;
          },
          async cancel() {
            abort.abort();
            await reader.cancel().catch(() => {});
            await pulling?.catch(() => {});
            await cleanup();
          },
        }),
        {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'private, no-store',
            'X-Accel-Buffering': 'no',
            'X-Content-Type-Options': 'nosniff',
          },
        },
      );
    } catch (e) {
      await close();
      throw e;
    }
  }
}
