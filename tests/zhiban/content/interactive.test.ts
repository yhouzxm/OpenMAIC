import { describe, it, expect } from 'vitest';
import { v7 } from 'uuid';
import {
  interactiveHtml,
  newInteractiveDraft,
  interactiveDocument,
  checkInteractiveDocument,
  INTERACTIVE_FRAME_CSP,
} from '@/lib/zhiban/infrastructure/content/interactive';
import { draft } from '@/lib/zhiban/infrastructure/content/model';
describe('offline interactive policy', () => {
  it('keeps scripts as bounded isolated document content; old text/PNG policy cannot accept it', () => {
    const html =
      '<html><body><button id="x">x</button><script>document.getElementById("x").addEventListener("click",()=>{})</script></body></html>';
    const d = newInteractiveDraft('互动', html);
    expect(d.html).toBe(html);
    expect(() => draft(d)).toThrow();
    const stage = v7(),
      doc = interactiveDocument(d, stage, [v7()], 1000),
      checked = checkInteractiveDocument(doc, stage);
    expect(checked.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(checked.scenes).toHaveLength(1);
    expect(() =>
      checkInteractiveDocument(
        {
          ...doc,
          scenes: [{ ...doc.scenes[0], content: { type: 'interactive', html: html + '!' } }],
        },
        stage,
      ),
    ).not.toThrow();
    expect(
      checkInteractiveDocument(
        {
          ...doc,
          scenes: [{ ...doc.scenes[0], content: { type: 'interactive', html: html + '!' } }],
        },
        stage,
      ).digest,
    ).not.toBe(checked.digest);
    expect(() =>
      checkInteractiveDocument({ ...doc, scenes: [{ ...doc.scenes[0], actions: [] }] }, stage),
    ).toThrow();
    expect(INTERACTIVE_FRAME_CSP).toContain('sandbox allow-scripts');
    expect(INTERACTIVE_FRAME_CSP).not.toContain('allow-same-origin');
    expect(INTERACTIVE_FRAME_CSP).toContain("connect-src 'none'");
  });
  it('rejects unsupported URLs, attribute handlers, nesting, empty/unbounded and malformed input', () => {
    for (const h of [
      '',
      '<img src="https://example.com/a.png">',
      '<script src="x"></script>',
      '<button onclick="x()">x</button>',
      '<iframe></iframe>',
      '<form></form>',
      '<base href="/">',
      '<meta http-equiv="refresh" content="0;url=/">',
      'x'.repeat(65537),
      '\ud800',
      '\0',
      '<div>'.repeat(100) + 'x' + '</div>'.repeat(100),
    ])
      expect(() => interactiveHtml(h)).toThrow();
  });
});
