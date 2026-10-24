import { fileAccept } from '../../domain/learning/file-policy';
import { QuizLimitError } from '../../domain/quiz/model';
import { ContentError } from '../content/model';
import { classroomCommand } from '../../domain/classroom/model';
import type { AcademicContext } from '../../application/academic/service';
import { createHash } from 'node:crypto';
import type { ClassroomLecture } from '@/lib/zhiban/domain/classroom/model';
import type { LearningService } from '@/lib/zhiban/application/learning/service';
import { AcademicError, academicId } from '@/lib/zhiban/domain/academic/model';
import type { IdentityAuthentication } from '@/lib/zhiban/infrastructure/identity/composition/authentication';
import { academicSessionAuthentication } from '../academic/session-authentication';
import { observeOperation } from '@/lib/zhiban/infrastructure/identity/composition/refusals';
import {
  body,
  query,
  cookie,
  headers,
  ProtocolRefusal,
  response,
  failure,
  requestId,
} from '@/lib/zhiban/infrastructure/identity/http/protocol';

export function createLearningHttp(
  service: LearningService,
  security: IdentityAuthentication,
  allowedOrigin: string,
  observe: (code: string) => void = () => {},
  contentRead?: (request: Request) => Promise<Response>,
  outlineEnabled = false,
  classroomEnabled = false,
  attachmentsEnabled = false,
  discussionEnabled = false,
  materialsEnabled = false,
  jointPublication?: (
    context: AcademicContext,
    offering: string,
    resource: string,
    publication: string,
    work: () => Promise<unknown>,
  ) => Promise<unknown>,
) {
  let active = 0;
  const authenticate = academicSessionAuthentication(
    (token) => security.authenticate(token),
    observe,
  );
  return async (request: Request) => {
    const id = requestId();
    if (active >= 8) return failure(id, 503, 'SERVICE_UNAVAILABLE');
    active++;
    try {
      headers(request, allowedOrigin, request.method === 'POST');
      const url = new URL(request.url),
        match =
          /^\/api\/zhiban\/learning\/([^/]+)\/offerings\/([^/]+)(?:\/(activities|attempts|submissions|outline|classrooms|classroom-results|attachments|quizzes|quiz-submissions|discussions)(?:\/([^/]+)\/(posts|events))?)?$/.exec(
            url.pathname,
          );
      if (!match || (match[4] && match[3] !== 'discussions')) return failure(id, 404, 'NOT_FOUND');
      if (match[3] === 'discussions' && !discussionEnabled)
        return failure(id, 503, 'SERVICE_UNAVAILABLE');
      if (match[4]) {
        academicId(match[4]);
        if (request.method !== 'GET') return failure(id, 405, 'METHOD_NOT_ALLOWED');
      }
      if (!['GET', 'POST'].includes(request.method)) return failure(id, 405, 'METHOD_NOT_ALLOWED');
      if (
        match[3] &&
        !['outline', 'classrooms', 'quizzes', 'discussions'].includes(match[3]) &&
        request.method !== 'GET'
      )
        return failure(id, 405, 'METHOD_NOT_ALLOWED');
      const filters = query(
        request,
        match[3] === 'classroom-results'
          ? ['page']
          : match[3] === 'discussions'
            ? ['limit', 'cursor', ...(!match[4] ? ['state'] : [])]
            : match[3] === 'quizzes'
              ? ['activity', 'attempt']
              : match[3] === 'quiz-submissions'
                ? ['submission']
                : match[3] === 'attachments'
                  ? ['submission', 'file']
                  : !match[3] || ['outline', 'classrooms'].includes(match[3])
                    ? []
                    : [
                        'limit',
                        'cursor',
                        ...(match[3] === 'activities'
                          ? ['q', 'state']
                          : match[3] === 'attempts'
                            ? ['activity', 'state', 'member', 'id']
                            : match[3] === 'submissions'
                              ? ['attempt']
                              : ['submission']),
                      ],
      );
      const tenant = academicId(match[1]);
      const offering = academicId(match[2]);
      const token = cookie(request);
      const verified =
        token === null
          ? { ok: true as const, value: null }
          : await observeOperation(() => authenticate(token));
      if (!verified.ok)
        return failure(
          id,
          verified.refusal === 'SESSION_REJECTED' ? 401 : 503,
          verified.refusal === 'SESSION_REJECTED' ? 'UNAUTHENTICATED' : 'SERVICE_UNAVAILABLE',
        );
      const handle = verified.value;
      if (handle === null) return failure(id, 401, 'UNAUTHENTICATED');
      let space = null;
      let cursor = null;
      do {
        const page = await security.spaces(handle, cursor, 50);
        space = page.find((row) => row.tenantId === tenant) ?? space;
        cursor = page.length === 50 ? page.at(-1)!.membershipId : null;
      } while (!space && cursor);
      if (!space) return failure(id, 403, 'FORBIDDEN');
      const context = { handle, tenantId: tenant, actorMembershipId: space.membershipId };
      if (request.method === 'GET' && match[3] === 'discussions')
        return response(
          id,
          200,
          await service.discussions.read(
            context,
            offering,
            match[5] === 'events' ? 'events' : match[4] ? 'posts' : 'topics',
            match[4] ?? null,
            filters,
          ),
        );
      if (request.method === 'GET' && ['quizzes', 'quiz-submissions'].includes(match[3])) {
        return response(id, 200, await service.quizzes.read(context, offering, filters));
      }
      if (match[3] === 'attachments') {
        if (!attachmentsEnabled) return failure(id, 503, 'SERVICE_UNAVAILABLE');
        const files = await service.files(context, offering, filters.submission, filters.file);
        if (!filters.file) return response(id, 200, { files });
        if (files.length !== 1) return failure(id, 404, 'NOT_FOUND');
        const f = files[0];
        const cleared =
          (f.clearance_status === 'LOCAL_SYNTHETIC_PINNED' &&
            f.clearance_ref === 'local-synthetic-sha256:' + f.digest) ||
          (f.clearance_status === 'TRUSTED_SCANNER' &&
            /^[a-f0-9]{64}$/.test(String(f.digest)) &&
            new RegExp('^clamav-sha256:[a-f0-9]{64}:' + f.digest + ':[0-9]{13}$').test(
              String(f.clearance_ref),
            ));
        if (!cleared) return failure(id, 409, 'ATTACHMENT_NOT_CLEARED');
        const bytes = f.bytes as Buffer;
        if (createHash('sha256').update(bytes).digest('hex') !== f.digest)
          throw new AcademicError('UNAVAILABLE');
        return new Response(new Uint8Array(bytes), {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${f.id}.${f.mime === 'application/pdf' ? 'pdf' : 'txt'}"; filename*=UTF-8''${encodeURIComponent(String(f.name)).replaceAll("'", '%27')}`,
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "sandbox; default-src 'none'",
            'Cross-Origin-Resource-Policy': 'same-origin',
            'X-Zhiban-File-Clearance': String(f.clearance_status),
          },
        });
      }
      const outline = match[3] === 'outline';
      const classroom = ['classrooms', 'classroom-results'].includes(match[3]);
      if (match[3] === 'classroom-results') {
        if (!classroomEnabled) return failure(id, 503, 'SERVICE_UNAVAILABLE');
        return response(id, 200, await service.classrooms.results(context, offering, filters.page));
      }
      if (classroom && !classroomEnabled) return failure(id, 503, 'SERVICE_UNAVAILABLE');
      if (outline && !outlineEnabled) return failure(id, 503, 'SERVICE_UNAVAILABLE');
      const lectures = async () => {
        if (!contentRead) return [] as ClassroomLecture[];
        const r = await contentRead(
          new Request(`${allowedOrigin}/api/zhiban/content/${tenant}/offerings/${offering}`, {
            headers: request.headers,
          }),
        );
        requireContentResponse(r.ok);
        return (await r.json()).resources as ClassroomLecture[];
      };
      function requireContentResponse(ok: boolean) {
        if (!ok) throw new AcademicError('UNAVAILABLE');
      }
      if (classroom && request.method === 'GET')
        return response(
          id,
          200,
          await service.classrooms.read(context, offering, await lectures()),
        );
      if (outline && request.method === 'GET') {
        const value = await service.outline(context, offering);
        const resources = await lectures();
        const materials = materialsEnabled
          ? ((await service.materials(context, offering)).rows as { id: string; status: string }[])
          : [];
        const materialTargets = new Set(
          materials.filter((m) => m.status === 'PUBLISHED').map((m) => m.id),
        );
        const targets = new Set(resources.map((r) => r.id));
        const activities = new Set(
          value.activities.filter((a) => a.status === 'PUBLISHED').map((a) => a.id),
        );
        return response(id, 200, {
          ...value,
          resources,
          materials,
          chapters:
            value.mode === 'TEACHER'
              ? value.chapters
              : value.chapters
                  .map((c) => ({
                    ...c,
                    units: c.units.filter((u) =>
                      u.kind === 'LECTURE'
                        ? targets.has(u.target)
                        : u.kind === 'MATERIAL'
                          ? materialTargets.has(u.target)
                          : activities.has(u.target),
                    ),
                  }))
                  .filter((c) => c.units.length),
        });
      }
      if (request.method === 'GET')
        return response(
          id,
          200,
          match[3]
            ? {
                submissionAttachments: attachmentsEnabled,
                submissionAttachmentMode: service.attachmentMode,
                submissionAttachmentFormats: fileAccept,
                ...(await service.page(
                  context,
                  offering,
                  match[3] as 'activities' | 'attempts' | 'submissions',
                  filters,
                )),
              }
            : await service.read(context, offering),
        );
      if (request.headers.get('content-type') !== 'application/json')
        return failure(id, 415, 'UNSUPPORTED_MEDIA_TYPE');
      const csrf = request.headers.get('x-zhiban-csrf');
      if (!csrf || !/^[A-Za-z0-9_-]{43}$/.test(csrf)) return failure(id, 403, 'FORBIDDEN');
      try {
        await security.assertUnsafe(handle, allowedOrigin, csrf);
      } catch {
        return failure(id, 403, 'FORBIDDEN');
      }
      if (match[3] === 'discussions')
        return response(
          id,
          200,
          await service.discussions.command(
            context,
            offering,
            await body(request, 32768, 3000),
            request.headers.get('x-zhiban-command') ?? '',
          ),
        );
      if (match[3] === 'quizzes')
        return response(
          id,
          200,
          await service.quizzes.command(
            context,
            offering,
            await body(request, 2097152, 3000),
            request.headers.get('x-zhiban-command') ?? '',
          ),
        );
      if (classroom) {
        const command = classroomCommand(await body(request, 8192, 3000));
        const choices = await lectures();
        const run = () =>
          service.classrooms.command(
            context,
            offering,
            command,
            request.headers.get('x-zhiban-command') ?? '',
            choices,
          );
        const joint =
          command.type === 'DISPATCH_JOINT_TASK'
            ? { resource_id: command.interactiveId, publication_id: command.publicationId }
            : command.type === 'ENTER_TASK' && service.jointEnabled
              ? await service.classrooms.jointTarget(
                  context,
                  offering,
                  command.id,
                  command.dispatchId,
                )
              : null;
        if (joint) {
          if (!jointPublication) return failure(id, 503, 'SERVICE_UNAVAILABLE');
          return response(
            id,
            200,
            await jointPublication(context, offering, joint.resource_id, joint.publication_id, run),
          );
        }
        return response(id, 200, await run());
      }
      if (outline) {
        if ((await service.outline(context, offering)).mode !== 'TEACHER')
          throw new AcademicError('FORBIDDEN');
        const input = await body(request, 32768, 3000);
        const resources = await lectures();
        if (
          !materialsEnabled &&
          (input as { chapters?: { units?: { kind?: string }[] }[] }).chapters?.some((c) =>
            c.units?.some((u) => u.kind === 'MATERIAL'),
          )
        )
          throw new AcademicError('UNAVAILABLE');
        const publishing = (input as { type?: string }).type === 'PUBLISH_OUTLINE';
        return response(
          id,
          200,
          await service.arrange(
            context,
            offering,
            input,
            request.headers.get('x-zhiban-command') ?? '',
            new Set(
              resources
                .filter((r) => !publishing || (r.state === 'PUBLISHED' && !r.quarantined))
                .map((r) => r.id),
            ),
          ),
        );
      }
      return response(
        id,
        200,
        await service.command(
          context,
          offering,
          await body(request, attachmentsEnabled ? 1450000 : 32768, 3000),
          request.headers.get('x-zhiban-command') ?? '',
          attachmentsEnabled,
        ),
      );
    } catch (error) {
      if (error instanceof ContentError) return failure(id, error.status, error.code);
      if (error instanceof QuizLimitError) return failure(id, 413, 'PAYLOAD_TOO_LARGE');
      if (error instanceof ProtocolRefusal) return failure(id, error.status, 'INVALID_REQUEST');
      if (error instanceof AcademicError) {
        const status =
          error.code === 'INVALID_INPUT'
            ? 400
            : error.code === 'FORBIDDEN' || error.code === 'INACTIVE_MEMBER'
              ? 403
              : error.code === 'NOT_FOUND'
                ? 404
                : error.code === 'UNAVAILABLE'
                  ? 503
                  : 409;
        return failure(id, status, error.code);
      }
      const code = (error as { code?: string }).code;
      observe(typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code) ? code : 'UNKNOWN');
      return failure(id, 503, 'SERVICE_UNAVAILABLE');
    } finally {
      active--;
    }
  };
}
