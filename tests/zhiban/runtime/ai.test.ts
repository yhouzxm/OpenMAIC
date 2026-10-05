import { it, expect } from 'vitest';
import { fakeDraft } from '@/lib/zhiban/infrastructure/openmaic/ai/fake';
it('fake draft has fixed purpose, bounded output and versioned safe provenance', async () => {
  const input = {
    requestId: 'synthetic',
    purpose: 'AUTHORING_DRAFT_TEXT',
    brief: 'Synthetic plain draft',
  };
  const result = await fakeDraft(input);
  expect(result).toEqual(await fakeDraft(input));
  expect(result).toMatchObject({
    status: 'DRAFT',
    text: 'Draft: Synthetic plain draft',
    provenance: {
      provider: 'FAKE',
      inputSchemaVersion: 1,
      outputSchemaVersion: 1,
      promptRevision: 'c9-draft-text-v1',
      policyRevision: 'c9-ai-foundation-v1',
    },
  });
});
it.each([
  { purpose: 'OTHER' },
  { brief: '\ud800' },
  { brief: '\0' },
  { brief: '' },
  { brief: 'x'.repeat(8193) },
  { endpoint: 'https://sentinel.invalid' },
  { tools: [] },
  { requestId: '\n' },
])('invalid AI input produces no content/error details', async (override) => {
  const r = await fakeDraft({
    requestId: 'synthetic',
    purpose: 'AUTHORING_DRAFT_TEXT',
    brief: 'sentinel-private',
    ...override,
  });
  expect(r.status).toBe('FAILED');
  expect(JSON.stringify(r)).not.toContain('sentinel');
  expect(r).not.toHaveProperty('cause');
});
it('cancelled draft returns no output', async () => {
  const c = new AbortController();
  c.abort();
  expect(
    await fakeDraft(
      { requestId: 'synthetic', purpose: 'AUTHORING_DRAFT_TEXT', brief: 'private' },
      c.signal,
    ),
  ).toEqual({ status: 'FAILED', reason: 'CANCELLED' });
});
