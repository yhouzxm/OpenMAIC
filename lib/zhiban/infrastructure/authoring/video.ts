/** Course-qualified proxy for the upstream isolated renderer. No new renderer or formal evidence. */
import { v7 } from 'uuid';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import {
  getRenderServiceCapability,
  resolveRenderServiceUrl,
  isRenderOwnerBoundResponse,
  renderServiceOwnerHeaders,
} from '@/lib/server/render-service';
import { proxyFetch } from '@/lib/server/proxy-fetch';
import { hash, requireContent, id } from '../content/model';
import type { ContentContext, ContentService } from '../content/service';
import { NativeArchiveService } from './archive/service';
const MAX_PROJECT = 64 * 1024 * 1024;
const fields = (query: URLSearchParams) => {
  const q = new URLSearchParams(query);
  q.delete('fps');
  q.delete('quality');
  requireContent(
    (q.size === 1 && q.has('stage')) || (q.size === 2 && q.has('resource') && q.has('publication')),
  );
  return Object.fromEntries(q);
};
export class CourseVideoService {
  readonly archives: NativeArchiveService;
  constructor(
    readonly content: ContentService,
    readonly pool: Pool,
  ) {
    this.archives = new NativeArchiveService(content, pool);
  }
  private owner(x: ContentContext) {
    return 'zhiban-video-' + hash([x.tenant, x.offering, x.member].join(':'));
  }
  private async guard<T>(
    x: ContentContext,
    source: Record<string, string>,
    work: () => Promise<T>,
  ) {
    return this.content.authoring(x, async () => {
      await this.archives.access(x, new URLSearchParams(source));
      return source.resource
        ? this.content.withPublishedAccess(x, source.resource, source.publication, work)
        : work();
    });
  }
  private async remote(x: ContentContext, path: string, init: RequestInit = {}) {
    const config = resolveRenderServiceUrl();
    requireContent(!('error' in config), 'RENDER_UNAVAILABLE', 503);
    const r = await proxyFetch(config.url + '/owner-bound/render' + path, {
      ...init,
      redirect: 'manual',
      headers: {
        ...renderServiceOwnerHeaders(this.owner(x)),
        'x-openmaic-client': this.owner(x),
        ...Object.fromEntries(new Headers(init.headers)),
      },
      signal: AbortSignal.timeout(30000),
    });
    requireContent(isRenderOwnerBoundResponse(r), 'RENDER_UNAVAILABLE', 503);
    return r;
  }
  async capability(x: ContentContext, q: URLSearchParams) {
    return this.guard(x, fields(q), () => getRenderServiceCapability());
  }
  async list(x: ContentContext, q: URLSearchParams) {
    const source = fields(q);
    return this.guard(
      x,
      source,
      async () =>
        (
          await this.pool.query(
            'SELECT id,status,created_at,project_digest FROM zhiban_course_video_jobs WHERE owner_id=$1 AND source=$2::jsonb ORDER BY created_at DESC LIMIT 20',
            [this.owner(x), JSON.stringify(source)],
          )
        ).rows,
    );
  }
  async submit(x: ContentContext, q: URLSearchParams, request: Request) {
    const source = fields(q),
      fps = Number(q.get('fps') ?? 24),
      quality = q.get('quality') ?? 'draft';
    requireContent([24, 30, 60].includes(fps) && ['draft', 'standard', 'high'].includes(quality));
    await this.guard(x, source, async () => {});
    requireContent(request.headers.get('content-type') === 'application/zip');
    const chunks: Uint8Array[] = [];
    let size = 0;
    const reader = request.body?.getReader();
    requireContent(reader);
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      void reader.cancel();
    }, 30000);
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        requireContent(size <= MAX_PROJECT, 'VIDEO_TOO_LARGE', 413);
        chunks.push(part.value);
      }
    } catch (e) {
      await reader.cancel().catch(() => {});
      throw e;
    } finally {
      clearTimeout(timeout);
      reader.releaseLock();
    }
    requireContent(!timedOut, 'VIDEO_UPLOAD_TIMEOUT', 408);
    requireContent(size > 0);
    const bytes = Buffer.concat(chunks),
      project = createHash('sha256').update(bytes).digest('hex'),
      command = id(request.headers.get('x-zhiban-command')),
      intent = hash(JSON.stringify({ source, fps, quality, project })),
      job = v7(),
      owner = this.owner(x);
    const reserve = await this.guard(x, source, async () => {
      const r = await this.pool.query(
        `INSERT INTO zhiban_course_video_jobs(id,owner_id,command_id,intent_digest,tenant_id,offering_id,actor_id,source,project_digest,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'SUBMITTING') ON CONFLICT(owner_id,command_id) DO NOTHING RETURNING id`,
        [job, owner, command, intent, x.tenant, x.offering, x.member, source, project],
      );
      const row = (
        await this.pool.query(
          'SELECT id,intent_digest,status FROM zhiban_course_video_jobs WHERE owner_id=$1 AND command_id=$2',
          [owner, command],
        )
      ).rows[0];
      requireContent(row?.intent_digest === intent, 'CONFLICT', 409);
      return { created: !!r.rowCount, row };
    });
    if (!reserve.created) return { id: reserve.row.id, status: reserve.row.status, replayed: true };
    let upstream: string | undefined;
    try {
      const form = new FormData();
      form.set(
        'project',
        new Blob([new Uint8Array(bytes)], { type: 'application/zip' }),
        'classroom.zip',
      );
      form.set('fps', String(fps));
      form.set('quality', quality);
      form.set('format', 'mp4');
      const r = await this.remote(x, '', { method: 'POST', body: form });
      requireContent(
        r.ok,
        r.status === 429 ? 'RENDER_BUSY' : 'RENDER_FAILED',
        r.status === 429 ? 429 : 503,
      );
      const value = await r.json();
      requireContent(
        typeof value.jobId === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value.jobId),
        'RENDER_FAILED',
        503,
      );
      upstream = value.jobId;
      await this.guard(x, source, () =>
        this.pool.query(
          "UPDATE zhiban_course_video_jobs SET upstream_id=$2,status='SUBMITTED' WHERE id=$1 AND status='SUBMITTING'",
          [job, upstream],
        ),
      );
      return { id: job, status: 'queued' };
    } catch (e) {
      if (upstream) await this.remote(x, '/' + upstream, { method: 'DELETE' }).catch(() => {});
      await this.pool.query(
        "UPDATE zhiban_course_video_jobs SET status='FAILED' WHERE id=$1 AND status='SUBMITTING'",
        [job],
      );
      throw e;
    }
  }
  async job(x: ContentContext, job: string, operation: 'status' | 'cancel' | 'download') {
    id(job);
    const row = (
      await this.pool.query(
        'SELECT source,upstream_id,status FROM zhiban_course_video_jobs WHERE id=$1 AND owner_id=$2',
        [job, this.owner(x)],
      )
    ).rows[0];
    requireContent(row, 'NOT_FOUND', 404);
    await this.guard(x, row.source, async () => {});
    if (!row.upstream_id) {
      requireContent(operation === 'status', 'VIDEO_NOT_READY', 409);
      return {
        id: job,
        status: row.status === 'SUBMITTING' ? 'submitting' : 'failed',
        progress: 0,
      };
    }
    const r = await this.remote(
      x,
      '/' + row.upstream_id + (operation === 'download' ? '/download' : ''),
      { method: operation === 'cancel' ? 'DELETE' : 'GET' },
    );
    if (r.status === 404) {
      await this.pool.query("UPDATE zhiban_course_video_jobs SET status='EXPIRED' WHERE id=$1", [
        job,
      ]);
      requireContent(false, 'VIDEO_EXPIRED', 410);
    }
    requireContent(
      r.ok,
      operation === 'download' ? 'VIDEO_NOT_READY' : 'RENDER_UNAVAILABLE',
      operation === 'download' ? 409 : 503,
    );
    try {
      return await this.guard(x, row.source, async () => {
        if (operation === 'download') {
          requireContent(
            r.headers.get('content-type')?.startsWith('video/mp4'),
            'RENDER_FAILED',
            503,
          );
          return new Response(r.body, {
            headers: {
              'Content-Type': 'video/mp4',
              'Content-Disposition': 'attachment; filename=classroom.mp4',
              'Cache-Control': 'private, no-store',
              'X-Content-Type-Options': 'nosniff',
            },
          });
        }
        if (operation === 'cancel') {
          await r.body?.cancel();
          return { id: job, status: 'cancelled' };
        }
        const value = await r.json();
        requireContent(
          ['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(value.status),
          'RENDER_FAILED',
          503,
        );
        return {
          id: job,
          status: value.status,
          progress: Math.min(1, Math.max(0, Number(value.progress) || 0)),
          error: value.status === 'failed' ? 'RENDER_FAILED' : null,
        };
      });
    } catch (e) {
      await r.body?.cancel().catch(() => {});
      throw e;
    }
  }
}
