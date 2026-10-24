import { describe, expect, it } from 'vitest';
import { v7 } from 'uuid';
import { randomUUID } from 'node:crypto';
import { curriculumCommand } from '@/lib/zhiban/domain/curriculum/model';
const chapter = () => ({
  id: v7(),
  title: '第一章',
  units: [{ id: v7(), title: '讲义', kind: 'LECTURE', target: v7() }],
});
describe('curriculum authoring input boundary', () => {
  it('accepts an ordered outline and an empty published outline', () => {
    const c = chapter();
    c.id = randomUUID();
    c.units[0].id = randomUUID();
    expect(curriculumCommand({ type: 'SAVE_OUTLINE', revision: '1', chapters: [c] })).toMatchObject(
      { chapters: [c] },
    );
    expect(curriculumCommand({ type: 'SAVE_OUTLINE', revision: '1', chapters: [] })).toMatchObject({
      chapters: [],
    });
    expect(curriculumCommand({ type: 'PUBLISH_OUTLINE', revision: '2' })).toMatchObject({
      revision: '2',
    });
  });
  it('rejects duplicate chapter/unit identity and forged fields', () => {
    const c = chapter();
    c.units[0].id = c.id;
    expect(() =>
      curriculumCommand({ type: 'SAVE_OUTLINE', revision: '1', chapters: [c] }),
    ).toThrow();
    expect(() =>
      curriculumCommand({ type: 'PUBLISH_OUTLINE', revision: '2', teacher: true }),
    ).toThrow();
  });
  it('rejects unsafe target, blank titles, malformed revisions and unknown kinds', () => {
    for (const patch of [{ target: 'https://evil.example' }, { title: ' ' }, { kind: 'HTML' }]) {
      const c = chapter();
      Object.assign(c.units[0], patch);
      expect(() =>
        curriculumCommand({ type: 'SAVE_OUTLINE', revision: '1', chapters: [c] }),
      ).toThrow();
    }
    expect(() => curriculumCommand({ type: 'PUBLISH_OUTLINE', revision: '0' })).toThrow();
  });
  it('bounds total chapters and units', () => {
    expect(() =>
      curriculumCommand({
        type: 'SAVE_OUTLINE',
        revision: '1',
        chapters: Array.from({ length: 51 }, chapter),
      }),
    ).toThrow();
    const c = chapter();
    c.units = Array.from({ length: 201 }, () => chapter().units[0]);
    expect(() =>
      curriculumCommand({ type: 'SAVE_OUTLINE', revision: '1', chapters: [c] }),
    ).toThrow();
  });
});
