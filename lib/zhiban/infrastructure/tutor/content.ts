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
  return {
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
      const text = p.slides
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
      // No silent truncation, image interpretation, HTML, draft content or assessment solutions.
      requireAcademic(text.trim().length > 0 && text.length <= 12000, 'INVALID_INPUT');
      const source = {
        resourceId: resource,
        publicationId: p.publicationId,
        publicationNo: p.publicationNo,
        title: p.title,
        text,
      };
      return { ...source, digest: digest(source) } as TutorSource;
    },
    guard(x, o, source, work) {
      return source
        ? service.withTutorPublication(context(x, o), source.resourceId, source.publicationId, work)
        : work();
    },
  };
}
