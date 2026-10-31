import { courseSourceTools } from './course-tools';
import { AuthoringSnapshots } from '../authoring/snapshot';
import { getServerPersistenceProvider } from '@/lib/persistence/server-provider';
import { proseToPlainText } from '@/lib/export/pptx-rich-text';
import { ContentError } from '../content/model';
import type { TutorContent } from '../../application/tutor/service';
import type { AcademicContext } from '../../application/academic/service';
import { requireAcademic } from '../../domain/academic/model';
import { digest, type TutorSource } from '../../domain/tutor/model';
import type { ContentService } from '../content/service';
const context = (x: AcademicContext, o: string) => ({
  handle: x.handle,
  tenant: x.tenantId,
  member: x.actorMembershipId,
  offering: o,
});
export function tutorContent(service: ContentService): TutorContent {
  const native = async () =>
    new AuthoringSnapshots(
      (await getServerPersistenceProvider(process.env.DATABASE_URL ?? '')).pool,
      service,
    );
  const adapter: TutorContent = {
    async list(x, o) {
      const result = await service.list(context(x, o));
      return result.resources
        .filter(
          (r: { state: string; interactive: boolean; publication: unknown }) =>
            r.state === 'PUBLISHED' && !r.interactive && !!r.publication,
        )
        .map(
          (r: {
            id: string;
            publication: { id: string; title: string; publication_no: number };
          }) => ({
            id: r.id,
            title: r.publication.title,
            publicationId: r.publication.id,
            publicationNo: Number(r.publication.publication_no),
          }),
        );
    },
    async load(x, o, resource) {
      const p = await service.preview(context(x, o), resource, 'published');
      requireAcademic(!('interactive' in p), 'INVALID_INPUT');
      let media: TutorSource['media'], sharedResultId: string | undefined;
      let text: string;
      try {
        const snapshot = await (await native()).published(context(x, o), resource, p.publicationId);
        const chunks: string[] = [];
        const extract = (elements: unknown[]) => {
          for (const raw of elements) {
            const e = raw as { type?: string; content?: string; elements?: unknown[] };
            if (e.type === 'text' && typeof e.content === 'string')
              chunks.push(proseToPlainText(e.content));
            if (Array.isArray(e.elements)) extract(e.elements);
          }
        };
        for (const scene of snapshot.document.scenes) {
          if (scene.content.type === 'slide') {
            chunks.push(scene.title);
            extract(scene.content.canvas.elements);
          }
        }
        media = snapshot.assets
          .filter((a) => /^image\/(png|jpeg|webp)$/.test(a.mime) && a.size <= 1048576)
          .slice(0, 2)
          .map((a) => ({ ref: a.ref, mime: a.mime, digest: a.digest }));
        const pool = (await getServerPersistenceProvider(process.env.DATABASE_URL ?? '')).pool;
        const shared = (
          await pool.query(
            `SELECT id,summary,whiteboard FROM zhiban_course_shared_results s WHERE tenant_id=$1 AND offering_id=$2 AND resource_id=$3 AND publication_id=$4 AND NOT EXISTS(SELECT 1 FROM zhiban_course_result_events e WHERE e.tenant_id=s.tenant_id AND e.event_kind='RETRACT_SHARED' AND e.payload->>'sharedId'=s.id::text) ORDER BY id DESC LIMIT 1`,
            [x.tenantId, o, resource, p.publicationId],
          )
        ).rows[0];
        if (shared) {
          sharedResultId = shared.id;
          chunks.push(
            '教师显式共享课堂小结：' + shared.summary,
            ...(Array.isArray(shared.whiteboard) ? shared.whiteboard : []),
          );
        }
        text = chunks.filter(Boolean).join('\n\n');
        if (!text.trim() && media?.length)
          text = '本资料含已发布图片，可在支持视觉的模型中通过受限图片工具查看。';
      } catch (e) {
        if (!(e instanceof ContentError && e.status === 404)) throw e;
        text = p.slides
          .map((s: { elements: unknown[] }) =>
            s.elements
              .flatMap((e) =>
                typeof (e as { text?: unknown }).text === 'string'
                  ? [(e as { text: string }).text]
                  : [],
              )
              .join('\n'),
          )
          .filter(Boolean)
          .join('\n\n');
      }
      // No silent truncation, image interpretation, HTML, draft content or assessment solutions.
      requireAcademic(text.trim().length > 0 && text.length <= 12000, 'INVALID_INPUT');
      const source = {
        resourceId: resource,
        publicationId: p.publicationId,
        publicationNo: p.publicationNo,
        title: p.title,
        text,
        ...(media?.length ? { media } : {}),
        ...(sharedResultId ? { sharedResultId } : {}),
      };
      return { ...source, digest: digest(source) } as TutorSource;
    },
    async tools(x, o, source, signal, vision) {
      if (!source) return [];
      return courseSourceTools({
        source,
        signal,
        current: () => adapter.guard(x, o, source, async () => source),
        ...(vision && source.media?.length
          ? {
              image: async (index: number) => {
                requireAcademic(
                  Number.isInteger(index) && index >= 0 && index < (source.media?.length ?? 0),
                );
                const item = source.media![index];
                const bytes = await (
                  await native()
                ).asset(context(x, o), source.resourceId, source.publicationId, item.ref);
                requireAcademic(bytes.digest === item.digest, 'INVALID_STATE');
                return { bytes: Buffer.from(bytes.bytes), mime: bytes.mime };
              },
            }
          : {}),
      });
    },
    async guard(x, o, source, work) {
      if (source?.sharedResultId) {
        const pool = (await getServerPersistenceProvider(process.env.DATABASE_URL ?? '')).pool;
        const row = (
          await pool.query(
            "SELECT 1 FROM zhiban_course_result_events WHERE tenant_id=$1 AND offering_id=$2 AND event_kind='RETRACT_SHARED' AND payload->>'sharedId'=$3 LIMIT 1",
            [x.tenantId, o, source.sharedResultId],
          )
        ).rows[0];
        requireAcademic(!row, 'INVALID_STATE');
      }

      return source
        ? service.withTutorPublication(context(x, o), source.resourceId, source.publicationId, work)
        : work();
    },
  };
  return adapter;
}
