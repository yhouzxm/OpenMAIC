/* eslint-disable @typescript-eslint/no-explicit-any -- fault injection deliberately exercises raw native envelopes */
/** Fault injection only: native producer and DB double; not real-model or PG evidence. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { autonomousProject } from './pbl-fixtures';
const runtime = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/app/api/pbl/v2/instructor/route', () => ({ POST: runtime.post }));
vi.mock('@/app/api/pbl/v2/open-task/route', () => ({ POST: runtime.post }));
vi.mock('@/app/api/pbl/v2/simulator/route', () => ({ POST: runtime.post }));
vi.mock('@/app/api/pbl/v2/evaluate/route', () => ({ POST: runtime.post }));
vi.mock('@/app/api/pbl/v2/task/update/route', () => ({ POST: runtime.post }));
import { PublishedPblService } from '@/lib/zhiban/infrastructure/classroom-ai/pbl';
import type { ClassroomAiService } from '@/lib/zhiban/infrastructure/classroom-ai/service';
const encoder = new TextEncoder();
const frame = (type: string, data: unknown) =>
  encoder.encode(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
function setup(maxConnections = 10) {
  let borrowed = 0;
  const project = Object.assign(autonomousProject(), {
    coursePblSceneId: 'scene',
    uiPhase: 'workspace' as const,
  });
  let enabled = true,
    locked = false,
    unlocks = 0,
    commits = 0,
    state: any;
  const query = vi.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes('pg_try_advisory_lock')) {
      const held = !locked;
      if (held) locked = true;
      return { rows: [{ held }] };
    }
    if (sql.includes('pg_advisory_unlock')) {
      locked = false;
      unlocks++;
      return { rows: [{}] };
    }
    if (sql.includes('SELECT enabled')) return { rows: [{ enabled }] };
    if (sql.startsWith('SELECT source_digest')) return { rows: state ? [state] : [] };
    if (sql.startsWith('INSERT INTO zhiban_published_pbl_state')) {
      commits++;
      state = { source_digest: args[3], revision: args[4], project: structuredClone(args[5]) };
    }
    return { rows: [] };
  });
  const pool = {
    query: async (...args: Parameters<typeof query>) => {
      if (borrowed >= maxConnections) throw Error('nested pool borrow');
      return query(...args);
    },
    connect: async () => {
      if (borrowed >= maxConnections) throw Error('pool exhausted');
      borrowed++;
      let released = false;
      return {
        query,
        release: () => {
          if (!released) {
            released = true;
            borrowed--;
          }
        },
      };
    },
  } as unknown as Pool;
  const classroom = {
    pool,
    content: {
      withPublishedAccess: async (
        _x: unknown,
        _r: unknown,
        _p: unknown,
        work: () => Promise<unknown>,
      ) => work(),
    },
  } as unknown as ClassroomAiService;
  const service = new PublishedPblService(classroom);
  const context = {
    snapshot: { sourceDigest: 'a'.repeat(64) },
    doc: { scenes: [{ id: 'scene', content: { type: 'pbl', projectV2: project } }] },
    binding: { owner: 'course-learner-local', stage: 'local-stage' },
  } as any;
  const request = (revision = '0') =>
    new Request('https://localhost/api/pbl/v2/instructor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-zhiban-pbl-revision': revision },
      body: JSON.stringify({ project, userMessage: '我的方案', phase: 'instructing' }),
    });
  const handle = (revision = '0') =>
    service.handle(
      request(revision),
      {} as any,
      'resource',
      'publication',
      context,
      '/api/pbl/v2/instructor',
    );
  let controller: ReadableStreamDefaultController<Uint8Array>;
  runtime.post.mockImplementation(async (req: Request) => {
    return new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          req.signal.addEventListener('abort', () => {
            try {
              c.close();
            } catch {}
          });
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  });
  return {
    handle,
    read: () =>
      service.handle(
        new Request('https://localhost/api/pbl/v2/state?scene=scene'),
        {} as any,
        'resource',
        'publication',
        context,
        '/api/pbl/v2/state',
      ),
    emit: (type: string, data: unknown) => controller.enqueue(frame(type, data)),
    disable: () => {
      enabled = false;
    },
    stats: () => ({ locked, unlocks, commits, state }),
    project,
    query,
  };
}
beforeEach(() => {
  runtime.post.mockReset();
});
describe('published PBL stream terminal/cancellation boundaries (injected)', () => {
  it('reads personal state with a single native connection rather than borrowing inside a lease', async () => {
    const s = setup(1);
    const response = await s.read();
    expect(response.status).toBe(200);
    expect((await response.json()).project.title).toBe('教室节能方案');
    expect(runtime.post).not.toHaveBeenCalled();
  });
  it('commits a successful server patch before publishing its terminal receipt', async () => {
    const s = setup(),
      response = await s.handle(),
      body = response.text();
    s.emit('project_patch', {
      patch: {
        kind: 'message',
        message: {
          id: 'ai',
          roleType: 'instructor',
          agentId: 'instructor',
          content: 'server output',
          ts: new Date().toISOString(),
          microtaskId: 'task-1',
        },
      },
    });
    s.emit('done', {});
    const text = await body;
    expect(text).toContain('event: zhiban_commit');
    expect(text.indexOf('event: zhiban_commit')).toBeLessThan(text.indexOf('event: done'));
    expect(s.stats().commits).toBe(1);
    expect(s.stats().locked).toBe(false);
    expect(s.stats().state.project.threads[0].messages[0].content).toBe('server output');
  });
  it('does not save a model error or disclose its private error text', async () => {
    const s = setup(),
      response = await s.handle(),
      body = response.text();
    s.emit('error', { code: 'MODEL_ERROR', message: 'private provider diagnostic' });
    const text = await body;
    expect(text).toContain('PBL_MODEL_FAILED');
    expect(text).not.toContain('private provider');
    expect(text).not.toContain('zhiban_commit');
    expect(s.stats()).toMatchObject({ commits: 0, locked: false });
  });
  it('cancellation releases the lock and cannot persist an unfinished response', async () => {
    const s = setup(),
      response = await s.handle(),
      reader = response.body!.getReader();
    s.emit('token', { delta: 'partial' });
    await reader.read();
    await reader.cancel();
    expect(s.stats()).toMatchObject({ commits: 0, locked: false });
  });
  it('a disabled policy rejects pending output and leaves state untouched', async () => {
    const s = setup(),
      response = await s.handle(),
      body = response.text();
    s.disable();
    s.emit('token', { delta: 'must not be delivered' });
    const text = await body;
    expect(text).not.toContain('must not');
    expect(text).not.toContain('zhiban_commit');
    expect(s.stats()).toMatchObject({ commits: 0, locked: false });
  });
  it('rejects a concurrent operation before invoking another producer', async () => {
    const s = setup(),
      response = await s.handle();
    await expect(s.handle()).rejects.toMatchObject({ code: 'PBL_BUSY' });
    expect(runtime.post).toHaveBeenCalledTimes(1);
    await response.body!.cancel();
    expect(s.stats().locked).toBe(false);
  });
  it('non-stream provider refusal also releases its reserved slot', async () => {
    const s = setup();
    runtime.post.mockResolvedValue(new Response('{}', { status: 403 }));
    const response = await s.handle();
    expect(response.status).toBe(403);
    expect(s.stats()).toMatchObject({ commits: 0, locked: false });
  });
});
