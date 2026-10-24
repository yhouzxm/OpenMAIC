import { describe, it, expect } from 'vitest';
import {
  publishedPlayerDocument,
  publishedPlayerManifest,
  PUBLISHED_PLAYER_CSP,
} from '@/lib/zhiban/infrastructure/content/player';
const id = '018f0000-0000-7000-8000-000000000001';
describe('published native player content boundary', () => {
  it('embeds hostile title as data, text as escaped rich text, and only scoped published PNG references', () => {
    const p = {
      title: '</script><script>alert(1)</script>',
      publicationId: id,
      publicationNo: 2,
      slides: [
        {
          id,
          elements: [
            { id, text: '<img src=x onerror=alert(1)>\n&', x: 0, y: 0, width: 100, height: 100 },
            { id, assetId: id, x: 100, y: 0, width: 100, height: 100 },
          ],
        },
      ],
    };
    const base = `/api/zhiban/content/${id}/offerings/${id}/resources/${id}`;
    const manifest = publishedPlayerManifest(base, p);
    const scene = manifest.scenes[0];
    expect(scene.type).toBe('slide');
    expect(scene).not.toHaveProperty('actions');
    if (scene.content.type !== 'slide') throw Error('Expected slide');
    expect(scene.content.canvas.elements[0]).toMatchObject({
      content: '&lt;img src=x onerror=alert(1)&gt;<br>&amp;',
    });
    expect(scene.content.canvas.elements[1]).toMatchObject({
      src: `${base}/assets/${id}?source=published&version=${id}&slide=${id}`,
    });
    const html = publishedPlayerDocument(base, p, id);
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('\\u003c/script\\u003e');
    expect(html).toContain('src="/zhiban/published-player.js"');
    expect(PUBLISHED_PLAYER_CSP).toContain("script-src 'self'");
    expect(PUBLISHED_PLAYER_CSP).toContain("frame-src 'none'");
    expect(PUBLISHED_PLAYER_CSP).not.toContain('unsafe-eval');
  });
});
