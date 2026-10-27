/** Optional course-host transport. The ordinary OpenMAIC PBL remains untouched. */
import type { PBLProjectV2 } from '@/lib/pbl/v2/types';

type Entry = {
  revision: string;
  pending?: PBLProjectV2;
  timer?: ReturnType<typeof setTimeout>;
  chain: Promise<void>;
  failed: boolean;
  active?: AbortController;
  notify?: (message: string) => void;
};
const entries = new Map<string, Entry>();
const statePath = '/api/pbl/v2/state';
const sceneKey = (project: PBLProjectV2) =>
  (project as PBLProjectV2 & { coursePblSceneId: string }).coursePblSceneId;
export async function loadPublishedPbl(scene: string, notify: (message: string) => void) {
  const previous = entries.get(scene);
  if (previous) {
    if (!previous.failed && previous.pending) await flushPublishedPbl(previous.pending);
    await previous.chain;
  }
  const response = await fetch(statePath + '?scene=' + encodeURIComponent(scene));
  if (!response.ok) throw Error('自主 PBL 尚未开启，或当前课程／发布资格已变化。');
  const data = (await response.json()) as { project: PBLProjectV2; revision: string };
  entries.set(sceneKey(data.project), {
    revision: data.revision,
    chain: Promise.resolve(),
    failed: false,
    notify,
  });
  return data.project;
}
function entry(project: PBLProjectV2) {
  const value = entries.get(sceneKey(project));
  if (!value || value.failed) throw Error('项目状态已变化，请重新打开后继续。');
  return value;
}
function failed(value: Entry) {
  value.failed = true;
  value.pending = undefined;
  if (value.timer) clearTimeout(value.timer);
  value.notify?.('本次执行或保存未完成。请重新打开项目核对，避免覆盖其他窗口的进度。');
}
async function serialized<T>(value: Entry, work: () => Promise<T>): Promise<T> {
  const previous = value.chain;
  let release!: () => void;
  value.chain = new Promise<void>((r) => {
    release = r;
  });
  await previous;
  try {
    if (value.failed) throw Error('项目须重新打开');
    return await work();
  } catch (error) {
    failed(value);
    throw error;
  } finally {
    release();
  }
}
export function changePublishedPbl(project: PBLProjectV2) {
  const value = entry(project);
  value.pending = structuredClone(project);
  if (value.timer) clearTimeout(value.timer);
  value.timer = setTimeout(() => {
    void flushPublishedPbl(project).catch(() => {});
  }, 250);
}
export async function flushPublishedPbl(project: PBLProjectV2) {
  const value = entry(project);
  if (value.timer) clearTimeout(value.timer);
  const pending = value.pending;
  value.pending = undefined;
  if (!pending) return;
  await serialized(value, async () => {
    const response = await fetch(statePath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-zhiban-pbl-revision': value.revision },
      body: JSON.stringify({ project: pending }),
    });
    if (!response.ok) throw Error('项目保存失败');
    const data = await response.json();
    value.revision = data.revision;
    value.notify?.('本人练习已保存');
  });
}
/** Serialize requests until their SSE body settles, not merely until headers arrive. */
export async function publishedPblRequest(
  request: Request,
  transport: (request: Request) => Promise<Response>,
): Promise<Response> {
  const input = (await request.clone().json()) as { project: PBLProjectV2 };
  const value = entry(input.project);
  await flushPublishedPbl(input.project);
  const previous = value.chain;
  let release!: () => void;
  value.chain = new Promise<void>((r) => {
    release = r;
  });
  await previous;
  let released = false;
  const finish = () => {
    if (!released) {
      released = true;
      value.active = undefined;
      release();
    }
  };
  try {
    if (value.failed) throw Error('项目须重新打开');
    const headers = new Headers(request.headers);
    headers.set('x-zhiban-pbl-revision', value.revision);
    value.active = new AbortController();
    const response = await transport(
      new Request(request, {
        headers,
        signal: AbortSignal.any([request.signal, value.active.signal]),
      }),
    );
    if (!response.ok) {
      failed(value);
      finish();
      return response;
    }
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
      const revision = response.headers.get('x-zhiban-pbl-revision');
      if (revision) value.revision = revision;
      finish();
      return response;
    }
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    let buffer = '',
      committed = false,
      closed = false;
    const settle = (success: boolean) => {
      if (closed) return;
      closed = true;
      if (!success) failed(value);
      else value.notify?.('本人练习已保存');
      finish();
    };
    return new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const chunk = await reader.read();
            if (chunk.done) {
              settle(committed);
              controller.close();
              return;
            }
            buffer += decoder.decode(chunk.value, { stream: true });
            let i: number;
            while ((i = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, i);
              buffer = buffer.slice(i + 2);
              if (frame.startsWith('event: zhiban_commit\n')) {
                const data = JSON.parse(frame.split('\ndata: ')[1]);
                value.revision = data.revision;
                committed = true;
              }
            }
            controller.enqueue(chunk.value);
          } catch (error) {
            settle(false);
            controller.error(error);
          }
        },
        async cancel() {
          await reader.cancel().catch(() => {});
          settle(committed);
        },
      }),
      { status: response.status, headers: response.headers },
    );
  } catch (error) {
    failed(value);
    finish();
    throw error;
  }
}
export function hasPendingPublishedPbl() {
  return [...entries.values()].some((value) => !!value.pending || !!value.active);
}

export function disconnectPublishedPbl(scene: string) {
  const value = entries.get(scene);
  if (!value) return;
  value.notify = undefined;
  value.active?.abort();
  if (value.pending && !value.failed) void flushPublishedPbl(value.pending).catch(() => {});
}
