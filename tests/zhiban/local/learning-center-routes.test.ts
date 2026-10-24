import { expect, it } from 'vitest';
import {
  localCoursePageTarget,
  localCoursePageAsset,
  localRequestTarget,
} from '../../../scripts/zhiban-local/request-target';
const course = '00000000-0000-7000-8000-000000000001',
  unit = '00000000-0000-4000-8000-000000000002';
it.each(['teacher', 'student'])(
  'routes %s learning center and unit to the protected content surface',
  (role) => {
    for (const suffix of ['', '/' + unit]) {
      const path = `/zhiban/${role}/courses/${course}/learning-center${suffix}`;
      expect(localCoursePageTarget(path)).toBe(true);
      expect(localCoursePageAsset(path)).toBe('/zhiban/content');
    }
  },
);
it.each(['admin', 'student/courses'])('rejects an unsupported role/path %s', (role) => {
  expect(localCoursePageTarget(`/zhiban/${role}/courses/${course}/learning-center`)).toBe(false);
});
it('rejects malformed units, extra segments, traversal and encoded paths', () => {
  const base = `/zhiban/student/courses/${course}/learning-center`;
  for (const suffix of ['/unknown', '/' + '-'.repeat(36), '/' + unit + '/extra'])
    expect(localCoursePageTarget(base + suffix)).toBe(false);
  for (const suffix of ['/../resources', '/%2e%2e'])
    expect(localRequestTarget(base + suffix)).toBe(false);
});
