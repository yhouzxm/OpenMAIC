import { registerServiceOwner } from '../service-center/config';
import { currentServiceTenant, withServiceTenant } from '@/lib/server/service-scope';
/** Course-bound host over the existing OpenMAIC workspace APIs, stores and workers. */
import { configureConversationTitleScheduler } from '@/lib/server/agent-runtime/conversation-title-task';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { NextRequest } from 'next/server';
import type { Pool } from 'pg';
import { configureOwnerAuthentication } from '@/lib/server/identity/registry';
import { StageAccessError } from '@/lib/persistence/stage-meta';
import { configureOwnerHostPolicy } from '@/lib/server/owner-host-policy';
import { stopAgentEventNotifyBus } from '@/lib/server/agent-runtime/event-notify-bus';
import { startAgentRunner } from '@/lib/server/agent-runtime/runner';
import type { ContentContext, ContentService } from '../content/service';
import { hash, requireContent } from '../content/model';
import { nativeRoutes } from './routes';
import {
  currentClassroomBinding,
  withClassroomBinding,
  isClassroomOwner,
  type ClassroomBinding,
} from '../classroom-ai/bindings';
export const authoringBindings = new Map<string, ContentContext>();
export const authoringOwner = (x: ContentContext) =>
  `course-author:${hash(`${x.tenant}:${x.offering}:${x.member}`)}`;
export const isAuthoringOwner = (owner: string) => owner.startsWith('course-author:');
const scope = new AsyncLocalStorage<string>();
const serviceOperator = new AsyncLocalStorage<{owner:string; guard:()=>Promise<void>}>();
export const withServiceOperator = <T>(owner:string, guard:()=>Promise<void>, work:()=>Promise<T>) =>
  serviceOperator.run({owner,guard},()=>withNativeOwner(owner,work));

const authoringRequestScope = new AsyncLocalStorage<ContentContext>();
export const withAuthoringRequest = <T>(x: ContentContext, work: () => Promise<T>) =>
  authoringRequestScope.run(x, () => withNativeOwner(authoringOwner(x), work));
function requestContext(owner: string) {
  const x = authoringRequestScope.getStore();
  return x && authoringOwner(x) === owner ? x : authoringBindings.get(owner);
}
export const withNativeOwner = <T>(
  owner: string,
  work: () => Promise<T>,
  binding?: ClassroomBinding,
) => scope.run(owner, () => withServiceTenant(
  binding?.tenant ?? requestContext(owner)?.tenant ?? currentServiceTenant(),
  async () => {
    const tenant=currentServiceTenant();
    if(tenant) await registerServiceOwner(owner,tenant);
    return withClassroomBinding(binding, work);
  },
));
const titleTasks = new Set<Promise<void>>();
let worker: ReturnType<typeof startAgentRunner> | undefined;
export function configureAuthoringHost(content: ContentService) {
  configureConversationTitleScheduler((task) => {
    const pending = task().catch(() => {});
    titleTasks.add(pending);
    void pending.finally(() => titleTasks.delete(pending));
  });
  configureOwnerAuthentication({
    anonymousFallback: false,
    methods: [
      {
        name: 'zhiban-current-course-teacher',
        async authenticate() {
          const owner = scope.getStore();
          return owner && (requestContext(owner) || currentClassroomBinding(owner) || serviceOperator.getStore()?.owner === owner)
            ? {
                status: 'authenticated',
                principal: {
                  ownerId: owner,
                  kind: 'user',
                  roles: new Set<string>(),
                  assurance: 'verified',
                },
              }
            : { status: 'invalid' };
        },
        describeStoredOwner(owner) {
          return isAuthoringOwner(owner) || isClassroomOwner(owner) ? { kind: 'user' } : undefined;
        },
      },
    ],
  });
  configureOwnerHostPolicy({
    async execution(owner) {
      if (owner.startsWith('zhiban-services:')) {
        const op=serviceOperator.getStore(); requireContent(op?.owner===owner,'FORBIDDEN',403);
        await op!.guard(); return;
      }
      if (isClassroomOwner(owner)) {
        const binding = currentClassroomBinding(owner);
        requireContent(binding, 'CLASSROOM_ACCESS_REQUIRED', 403);
        await binding.guard(async () => {});
        return;
      }
      if (!isAuthoringOwner(owner)) return;
      const x = requestContext(owner);
      requireContent(x, 'TEACHER_AUTHORIZATION_REQUIRED', 403);
      await content.authoring({ ...x, deadline: undefined }, async () => {});
    },
    async withExecution(owner, work) {
      if (owner.startsWith('zhiban-services:')) {
        const op=serviceOperator.getStore(); requireContent(op?.owner===owner,'FORBIDDEN',403);
        await op!.guard(); const result=await work(); await op!.guard(); return result;
      }
      if (isClassroomOwner(owner)) {
        const binding = currentClassroomBinding(owner);
        requireContent(binding, 'CLASSROOM_ACCESS_REQUIRED', 403);
        return binding.guard(work);
      }
      if (isAuthoringOwner(owner)) {
        const x = requestContext(owner);
        requireContent(x, 'TEACHER_AUTHORIZATION_REQUIRED', 403);
        return content.authoring({ ...x, deadline: undefined }, work);
      }
      return work();
    },
    async document(owner, stage, mode, q) {
      if (owner.startsWith('zhiban-services:')) throw new StageAccessError(stage, owner, 'foreign');
      if (isClassroomOwner(owner)) throw new StageAccessError(stage, owner, 'foreign');
      if (!isAuthoringOwner(owner)) return;
      const x = requestContext(owner);
      requireContent(x, 'TEACHER_AUTHORIZATION_REQUIRED', 403);
      // The host deliberately disables upstream capability-by-id foreign reads.
      if (mode !== 'create') {
        const row = await q.query('SELECT owner_id,deleted_at FROM stage_meta WHERE stage_id=$1', [
          stage,
        ]);
        if (row.rows[0]?.owner_id !== owner || row.rows[0]?.deleted_at !== null)
          throw new StageAccessError(stage, owner, 'foreign');
      }
    },
  });
  process.env.OPENMAIC_AGENT_RUNTIME_ENABLED = 'true';
}
export async function initializeAuthoringStorage(pool: Pool) {
  const sql = await readFile('lib/zhiban/infrastructure/authoring/schema.sql', 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('zhiban-native-authoring-schema'))");
    const exists = (
      await client.query(
        "SELECT to_regclass('public.zhiban_authoring_schema_receipt') AS receipt,to_regclass('public.zhiban_authoring_snapshots') AS snapshots,to_regclass('public.zhiban_authoring_snapshot_bytes') AS bytes",
      )
    ).rows[0];
    if (!exists.receipt) {
      requireContent(!exists.snapshots && !exists.bytes, 'AUTHORING_SCHEMA_REJECTED', 503);
      await client.query(sql);
      await client.query('INSERT INTO zhiban_authoring_schema_receipt VALUES(true,$1)', [
        hash(sql),
      ]);
    } else {
      const receipt = (
        await client.query('SELECT digest FROM zhiban_authoring_schema_receipt WHERE id=true')
      ).rows[0];
      requireContent(receipt?.digest === hash(sql), 'AUTHORING_SCHEMA_REJECTED', 503);
      const guards = (
        await client.query(
          "SELECT tgrelid::regclass::text AS name FROM pg_trigger WHERE tgname IN('zhiban_authoring_immutable','zhiban_authoring_bytes_immutable') AND tgenabled='O'",
        )
      ).rows;
      requireContent(guards.length === 2, 'AUTHORING_SCHEMA_REJECTED', 503);
    }
    const expected: Record<string, string[]> = {
      zhiban_authoring_snapshots: [
        'id:uuid',
        'tenant_id:uuid',
        'offering_id:uuid',
        'owner_id:text',
        'stage_id:text',
        'document:jsonb',
        'digest:text',
        'assets:jsonb',
        'created_at:timestamp with time zone',
      ],
      zhiban_authoring_snapshot_bytes: [
        'snapshot_id:uuid',
        'asset_id:text',
        'mime:text',
        'digest:text',
        'bytes:bytea',
      ],
      zhiban_authoring_schema_receipt: ['id:boolean', 'digest:text'],
    };
    for (const [table, columns] of Object.entries(expected)) {
      const actual = (
        await client.query(
          'SELECT attname,format_type(atttypid,atttypmod) AS type,attnotnull FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum',
          ['public.' + table],
        )
      ).rows;
      requireContent(
        actual.every((a) => a.attnotnull) &&
          JSON.stringify(actual.map((a) => a.attname + ':' + a.type)) === JSON.stringify(columns),
        'AUTHORING_SCHEMA_REJECTED',
        503,
      );
      const acl = (
        await client.query(
          "SELECT c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned, NOT c.relrowsecurity AS private, NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner) AS closed FROM pg_class c WHERE c.oid=$1::regclass",
          ['public.' + table],
        )
      ).rows[0];
      requireContent(acl?.owned && acl.private && acl.closed, 'AUTHORING_SCHEMA_REJECTED', 503);
    }
    const guards = (
      await client.query(
        "SELECT tgrelid::regclass::text AS name FROM pg_trigger WHERE tgrelid IN('public.zhiban_authoring_snapshots'::regclass,'public.zhiban_authoring_snapshot_bytes'::regclass) AND NOT tgisinternal AND tgtype=27 AND tgenabled='O' AND tgfoid='public.zhiban_authoring_immutable()'::regprocedure",
      )
    ).rows;
    const fn = (
      await client.query(
        "SELECT p.prosrc,p.prosecdef,p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AS owned,NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner) AS closed FROM pg_proc p WHERE p.oid='public.zhiban_authoring_immutable()'::regprocedure",
      )
    ).rows[0];
    requireContent(
      guards.length === 2 &&
        fn?.prosrc.trim() === sql.match(/AS \$\$([\s\S]*?)\$\$/)![1].trim() &&
        !fn.prosecdef &&
        fn.owned &&
        fn.closed,
      'AUTHORING_SCHEMA_REJECTED',
      503,
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  worker ??= startAgentRunner();
}
export async function stopAuthoringHost() {
  await worker?.stop({ timeoutMs: 5000 });
  worker = undefined;
  await Promise.race([
    Promise.allSettled([...titleTasks]),
    new Promise((resolve) => {
      const timer = setTimeout(resolve, 3000);
      timer.unref();
    }),
  ]);
  authoringBindings.clear();
  await stopAgentEventNotifyBus();
}
export async function nativeAuthoringRequest(
  content: ContentService,
  x: ContentContext,
  request: Request,
  tail: string,
) {
  requireContent(
    /^\/api\/[a-zA-Z0-9_:/.%\[\]-]+$/.test(tail) && !/%(?!3[aA])|\.\./.test(tail),
    'NOT_FOUND',
    404,
  );
  requireContent(!tail.includes('/learners/') || !tail.endsWith('/merge'), 'FORBIDDEN', 403);
  requireContent(
    !tail.startsWith('/api/agents/import') && !tail.startsWith('/api/usage'),
    'FORBIDDEN',
    403,
  );
  const url = new URL(request.url);
  const pathname = tail;
  const target = nativeRoutes.find((r) => r.pattern.test(pathname));
  requireContent(target, 'NOT_FOUND', 404);
  if (
    (tail.startsWith('/api/model-config') ||
      tail.startsWith('/api/server-providers') ||
      tail.startsWith('/api/usage')) &&
    request.method !== 'GET'
  )
    requireContent(false, 'FORBIDDEN', 403);
  const fn = (target.handlers as Record<string, unknown>)[request.method];
  requireContent(typeof fn === 'function', 'METHOD_NOT_ALLOWED', 405);
  const owner = authoringOwner(x);
  requireContent(authoringBindings.has(owner) || authoringBindings.size < 100, 'UNAVAILABLE', 503);
  authoringBindings.set(owner, { ...x, deadline: undefined });
  const params: Record<string, string | string[]> = {};
  const match = target.pattern.exec(pathname)!;
  target.keys.forEach(
    (key, i) => (params[key] = key === 'path' ? match[i + 1].split('/') : match[i + 1]),
  );
  const headers = new Headers(request.headers);
  // No browser-supplied upstream owner/legacy import credentials enter the native routes.
  for (const key of [
    'authorization',
    'x-openmaic-legacy-import',
    'x-lesson-owner',
    'x-lesson-command',
    'x-lesson-intent',
  ])
    headers.delete(key);
  const native = new NextRequest(new URL(pathname + url.search, url.origin), {
    method: request.method,
    headers,
    signal: request.signal,
    ...(!['GET', 'HEAD'].includes(request.method) ? { body: await request.arrayBuffer() } : {}),
  });
  const response = await content.authoring(x, () =>
    scope.run(owner, async () => {
      if (pathname.startsWith('/api/stage-meta/')) {
        const { getServerPersistenceProvider } = await import('@/lib/persistence/server-provider');
        const { pool } = await getServerPersistenceProvider(process.env.DATABASE_URL ?? '');
        const row = await pool.query(
          'SELECT 1 FROM stage_meta WHERE stage_id=$1 AND owner_id=$2 AND deleted_at IS NULL',
          [params.stageId, owner],
        );
        requireContent(row.rowCount, 'NOT_FOUND', 404);
      }
      // Every request resolves its owner from this verified host scope, never from an id in the body.
      const response = await (fn as (r: NextRequest, c: unknown) => Promise<Response>)(native, {
        params: Promise.resolve(params),
      });
      response.headers.delete('set-cookie');
      response.headers.set('Cache-Control', 'private, no-store');
      response.headers.set('X-Content-Type-Options', 'nosniff');
      return response;
    }),
  );
  if (response.headers.get('content-type')?.includes('text/event-stream') && response.body) {
    const reader = response.body.getReader();
    return new Response(
      new ReadableStream({
        async pull(controller) {
          try {
            const next = await reader.read();
            if (next.done) {
              controller.close();
              return;
            }
            await content.authoring({ ...x, deadline: undefined }, async () => {});
            controller.enqueue(next.value);
          } catch (e) {
            await reader.cancel().catch(() => {});
            controller.error(e);
          }
        },
        async cancel() {
          await reader.cancel();
        },
      }),
      { status: response.status, headers: response.headers },
    );
  }
  return response;
}
