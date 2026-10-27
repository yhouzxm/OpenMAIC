import { describe, it, expect } from 'vitest';
import { courseSourceTools } from '@/lib/zhiban/infrastructure/tutor/course-tools';
import type { TutorSource } from '@/lib/zhiban/domain/tutor/model';
const source = {
  resourceId: 'r',
  publicationId: 'p',
  publicationNo: 1,
  title: '欧姆定律',
  text: '电压等于电流乘电阻。',
  digest: 'fixed',
} as TutorSource;
describe('course-only native Agent tools', () => {
  it('provides read/search only, with no network or writes', async () => {
    const tools = courseSourceTools({
      source,
      current: async () => source,
      signal: new AbortController().signal,
    });
    expect(tools.map((t) => t.name)).toEqual(['read_course_source', 'search_course_source']);
    const output = await tools[1].execute('call', { query: '电流' }, undefined, undefined);
    expect(JSON.stringify(output)).toContain('电压等于电流乘电阻');
  });
  it('rechecks current source before each tool operation', async () => {
    const tools = courseSourceTools({
      source,
      current: async () => ({ ...source, publicationId: 'changed' }),
      signal: new AbortController().signal,
    });
    await expect(tools[0].execute('call', {}, undefined, undefined)).rejects.toThrow();
  });
  it('does not register image tools without explicit vision and a selected published image', () => {
    expect(
      courseSourceTools({
        source: { ...source, media: [{ ref: 'a', mime: 'image/png', digest: 'h' }] },
        current: async () => source,
        signal: new AbortController().signal,
      }).map((t) => t.name),
    ).not.toContain('inspect_course_image');
  });
  it('refuses cancelled tool calls', async () => {
    const c = new AbortController();
    c.abort();
    const tools = courseSourceTools({ source, current: async () => source, signal: c.signal });
    await expect(tools[0].execute('call', {}, undefined, undefined)).rejects.toThrow();
  });
});
