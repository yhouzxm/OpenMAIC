import type { Slide } from '@openmaic/dsl';
import { slideMediaReferenceSlots } from '@/lib/media/slide-media-slots';

/** Project a cloned, already-authorized snapshot into the native player's media contract. */
export function rewritePublishedSlideMedia(
  slide: Pick<Slide, 'background' | 'elements'>,
  refs: ReadonlyMap<string, string>,
  videoRefs: ReadonlySet<string>,
) {
  // The editor uses src; the standalone player resolves only mediaRef through
  // its media table. Bind only bytes in this exact authorized snapshot.
  for (const element of slide.elements) {
    if (element.type !== 'video') continue;
    const ref = [element.src, element.mediaRef].find(
      (candidate) => candidate && refs.has(candidate) && videoRefs.has(candidate),
    );
    if (ref) element.mediaRef = ref;
    else delete element.mediaRef;
  }
  for (const slot of slideMediaReferenceSlots(slide)) {
    const ref = slot.read();
    if (ref && refs.has(ref)) slot.write(refs.get(ref));
  }
}
