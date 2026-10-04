import { createRoot } from 'react-dom/client';
import { SlideCanvas } from '@openmaic/renderer';
import type { Slide } from '@openmaic/dsl';

const root = document.getElementById('preview');
if (!root?.dataset.slide) throw new Error('DIAGNOSTIC_REJECTED');
const slide = JSON.parse(
  new TextDecoder().decode(Uint8Array.from(atob(root.dataset.slide), (c) => c.charCodeAt(0))),
) as Slide;
createRoot(root).render(
  <SlideCanvas
    className="diagnostic-slide"
    style={{ width: 960, height: 540 }}
    slide={slide}
    scale={1}
  />,
);
