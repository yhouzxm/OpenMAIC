import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';
import { v7 } from 'uuid';
const window = {} as {
  zhibanCurriculum: {
    flow(
      path: string,
      hash: string,
      search: string,
    ): { chapter: string; kind: string; target?: string; returnUrl(target: string): string } | null;
  };
};
runInNewContext(readFileSync('app/zhiban/local/curriculum.js', 'utf8'), {
  window,
  URLSearchParams,
});
const course = v7(),
  chapter = v7(),
  target = v7(),
  space = v7(),
  offering = v7();
const path = `/zhiban/teacher/courses/${course}`,
  query = `?space=${space}&offering=${offering}`;
it('keeps author return on the same course/offering and chapter without an arbitrary URL', () => {
  const flow = window.zhibanCurriculum.flow(
    path + '/resources',
    `#compose-${chapter}-LECTURE`,
    query,
  )!;
  expect(flow.chapter).toBe(chapter);
  expect(flow.returnUrl(target)).toBe(path + query + `#attach-${chapter}-LECTURE-${target}`);
  expect(
    window.zhibanCurriculum.flow(path, `#attach-${chapter}-ACTIVITY-${target}`, query)?.target,
  ).toBe(target);
  expect(() => flow.returnUrl('https://evil.example')).toThrow();
});
it('rejects role, page, duplicate query, forged target and mode mismatches', () => {
  for (const [p, h, q] of [
    [path.replace('/teacher/', '/student/') + '/resources', `#compose-${chapter}-LECTURE`, query],
    [path + '/classrooms', `#compose-${chapter}-LECTURE`, query],
    [path + '/resources', `#compose-${chapter}-LECTURE-${target}`, query],
    [path + '/resources', `#edit-${chapter}-LECTURE`, query],
    [path + '/resources', `#attach-${chapter}-LECTURE-${target}`, query],
    [path, `#attach-${chapter}-ACTIVITY-https://evil.example`, query],
    [path + '/resources', `#compose-${chapter}-LECTURE`, query + '&space=' + space],
    [path + '/resources', `#compose-${chapter}-LECTURE`, query + '&return=https://evil.example'],
  ])
    expect(window.zhibanCurriculum.flow(p, h, q)).toBeNull();
});
