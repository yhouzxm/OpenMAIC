import type { Slide } from '@openmaic/dsl';

// Closed preview subset: no rich HTML, URLs, CSS, chart/table/shape or execution-bearing fields.
// Reconstruct objects rather than carrying arbitrary input properties to renderer sinks.
export function projectSlide(slide: Slide, gateway: (asset: string) => string): Slide {
  const reject = (): never => {
    throw new Error('DIAGNOSTIC_REJECTED');
  };
  const number = (value: unknown) =>
    typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 9600
      ? value
      : reject();
  const positive = (value: unknown) => (number(value) > 0 ? number(value) : reject());
  const text = (value: unknown) =>
    typeof value === 'string' && value.length <= 2048 && !/[<>&]/.test(value) ? value : reject();
  const source = (value: unknown) => {
    if (typeof value !== 'string' || !/^asset:[a-zA-Z0-9_-]{1,96}$/.test(value)) return reject();
    return gateway(value.slice(6));
  };
  if (!slide || !Array.isArray(slide.elements) || slide.elements.length > 32) return reject();
  const elements = slide.elements.map((element) => {
    if (
      element.type !== 'image' &&
      element.type !== 'audio' &&
      element.type !== 'video' &&
      element.type !== 'text'
    )
      return reject();
    const base = {
      id: text(element.id),
      type: element.type,
      left: number(element.left),
      top: number(element.top),
      width: positive(element.width),
      height: positive(element.height),
      rotate: number(element.rotate),
    };
    switch (element.type) {
      case 'image':
        return { ...base, type: 'image' as const, src: source(element.src), fixedRatio: true };
      case 'video':
        return {
          ...base,
          type: 'video' as const,
          src: source(element.src),
          poster: element.poster ? source(element.poster) : undefined,
        };
      case 'audio':
        return { ...base, type: 'audio' as const, src: source(element.src), loop: false };
      case 'text':
        return {
          ...base,
          type: 'text' as const,
          content: text(element.content),
          defaultFontName: 'sans-serif',
          defaultColor: '#111111',
        };
      default:
        return reject();
    }
  });
  if (slide.background && slide.background.type !== 'image' && slide.background.type !== 'solid')
    return reject();
  const background =
    slide.background?.type === 'image'
      ? {
          type: 'image' as const,
          image: { src: source(slide.background.image?.src), size: 'contain' as const },
        }
      : { type: 'solid' as const, color: '#ffffff' };
  return {
    id: text(slide.id),
    viewportSize: positive(slide.viewportSize),
    viewportRatio: positive(slide.viewportRatio),
    elements,
    background,
    theme: {
      backgroundColor: '#ffffff',
      themeColors: ['#111111'],
      fontColor: '#111111',
      fontName: 'sans-serif',
    },
  } as Slide;
}
