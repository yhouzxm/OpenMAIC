import { afterEach, describe, expect, it, vi } from 'vitest';
import { textSlides, publishedSnapshot } from '@/app/zhiban/local/published-export';
import { buildPptxBlob } from '@/lib/export/pptx-builder';
import JSZip from 'jszip';
const unit = { id: 'u', target: 'm', kind: 'MATERIAL' as const, title: '参考资料' };
const outline = { mode: 'STUDENT', publicationNo: 3, chapters: [{ units: [unit] }] };
const material = {
  publicationNo: 2,
  digest: 'abc',
  text: '隔离 <script>window.evil=1</script>\n验电',
};
afterEach(() => vi.unstubAllGlobals());
function mock(...values: unknown[]) {
  const f = vi.fn();
  for (const value of values)
    f.mockResolvedValueOnce(
      value instanceof Response ? value : new Response(JSON.stringify(value)),
    );
  vi.stubGlobal('fetch', f);
  return f;
}
describe('published exports', () => {
  it('escapes plain resource text and retains all text across bounded pages', () => {
    const s = textSlides('甲'.repeat(1100) + '<script>');
    expect(s.length).toBeGreaterThan(1);
    const content = s
      .flatMap((p) => p.elements)
      .map((e) => (e.type === 'text' ? e.content : ''))
      .join('');
    expect(content.match(/甲/g)).toHaveLength(1100);
    expect(content).not.toContain('<script>');
    expect(content).toContain('&lt;script&gt;');
    expect(() => textSlides('')).toThrow();
    expect(() => textSlides('甲'.repeat(34 * 2800 + 1))).toThrow();
  });
  it('uses authenticated no-store published reads, then rechecks both publication and directory', async () => {
    const f = mock(outline, material, material, outline);
    const s = await publishedSnapshot('t', 'o', unit, new AbortController().signal);
    await s.confirm();
    expect(s.version).toBe('2');
    expect(f).toHaveBeenCalledTimes(4);
    for (const [url, opt] of f.mock.calls) {
      expect(url).not.toContain('draft');
      expect(opt).toMatchObject({
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'x-zhiban-request': 'identity-v1' },
      });
    }
  });
  it.each([401, 403, 404])('rejects authorization/unpublished response %s', async (status) => {
    mock(new Response('', { status }));
    await expect(publishedSnapshot('t', 'o', unit, new AbortController().signal)).rejects.toThrow();
  });
  it('rejects units outside the published outline including teacher draft-only references', async () => {
    mock({ ...outline, mode: 'TEACHER', published: [] });
    await expect(publishedSnapshot('t', 'o', unit, new AbortController().signal)).rejects.toThrow(
      '课程目录',
    );
  });
  it('cancels when publication changes while building', async () => {
    mock(outline, material, { ...material, publicationNo: 3 });
    const s = await publishedSnapshot('t', 'o', unit, new AbortController().signal);
    await expect(s.confirm()).rejects.toThrow('版本已变化');
  });
  it('cancels when membership is revoked before download', async () => {
    mock(outline, material, new Response('', { status: 403 }));
    const s = await publishedSnapshot('t', 'o', unit, new AbortController().signal);
    await expect(s.confirm()).rejects.toThrow('访问权限');
  });
  it('cancels when the published directory changes before download', async () => {
    mock(outline, material, material, { ...outline, publicationNo: 4 });
    const s = await publishedSnapshot('t', 'o', unit, new AbortController().signal);
    await expect(s.confirm()).rejects.toThrow('课程目录');
  });
  it('preserves native editable text and creates no external PPTX relationships', async () => {
    const f = vi.fn(() => {
      throw Error('No network allowed');
    });
    vi.stubGlobal('fetch', f);
    const b = await buildPptxBlob(textSlides('隔离与验电'), [], 0.5625, 960, 96, 96 / 72);
    const z = await JSZip.loadAsync(await b.arrayBuffer());
    expect(await z.file('ppt/slides/slide1.xml')!.async('string')).toContain('隔离与验电');
    for (const file of Object.values(z.files).filter((f) => f.name.endsWith('.rels')))
      expect(await file.async('string')).not.toContain('TargetMode="External"');
    expect(f).not.toHaveBeenCalled();
  });
  it('rejects owner IDs, remote media, audio and placeholder scenes before generating', async () => {
    const slides = textSlides('hello');
    await expect(buildPptxBlob(slides, [], 0.5625, 960, 96, 96 / 72, 'owner')).rejects.toThrow(
      'Data-only',
    );
    const image = {
      id: 'e',
      type: 'image',
      left: 0,
      top: 0,
      width: 1,
      height: 1,
      rotate: 0,
      fixedRatio: true,
      src: 'https://external/image.png',
    } as const;
    await expect(
      buildPptxBlob([{ ...slides[0], elements: [image] }], [], 0.5625, 960, 96, 96 / 72),
    ).rejects.toThrow('Data-only');
  });
});
