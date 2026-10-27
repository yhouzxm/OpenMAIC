/** Real data URI fetch with an observed network boundary; no remote server is contacted. */
import { it, expect, vi } from 'vitest';
import { offlinePptxFetch } from '../../../lib/server/agent-runtime/pptx-offline-fetch.mjs';
it('allows package-local bytes and refuses external Request/URL/string before dispatch', async () => {
  const dispatch = vi.fn(fetch),
    guarded = offlinePptxFetch(dispatch);
  expect(await (await guarded('data:text/plain,owned')).text()).toBe('owned');
  for (const input of [
    'https://example.invalid/image.png',
    'http://127.0.0.1:55433/',
    new URL('http://localhost/internal'),
    new Request('https://example.invalid/formula'),
    '/api/texmath',
  ])
    await expect(guarded(input)).rejects.toThrow('forbids network');
  expect(dispatch).toHaveBeenCalledTimes(1);
});
