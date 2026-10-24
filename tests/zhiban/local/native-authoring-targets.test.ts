import { expect, it } from 'vitest';
import { localRequestTarget } from '../../../scripts/zhiban-local/request-target';
const base =
  '/api/zhiban/authoring/00000000-0000-7000-8000-000000000001/offerings/00000000-0000-7000-8000-000000000002';
it('allows only the scoped native owner colon encoding and query assets', () => {
  expect(
    localRequestTarget(
      base + '/native/api/persistence/runtime/stages/stage-a/learners/course-author%3A123/sessions',
    ),
  ).toBe(true);
  expect(
    localRequestTarget(
      base + '/published/00000000-0000-7000-8000-000000000003/asset?ref=asset%3Abounded',
    ),
  ).toBe(true);
  for (const suffix of [
    '/native/api/stages/%2fprivate',
    '/native/api/stages/%252fprivate',
    '/native/api/stages/%2e%2e',
    '/native/api/stages/../private',
    '/native//api/stages',
    '/native/api/stages/a\\b',
  ])
    expect(localRequestTarget(base + suffix)).toBe(false);
  expect(localRequestTarget('/api/persistence/learners/course-author%3A123')).toBe(false);
});
