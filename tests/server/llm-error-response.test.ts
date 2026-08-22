import { describe, expect, it } from 'vitest';
import { llmApiError } from '@/lib/server/llm-error-response';

describe('llmApiError', () => {
  it('classifies a provider location failure hidden inside retry errors', async () => {
    const response = llmApiError({
      errors: [
        {
          statusCode: 400,
          responseBody: JSON.stringify({
            error: {
              code: 400,
              status: 'FAILED_PRECONDITION',
              message: 'User location is not supported for the API use.',
            },
          }),
        },
      ],
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      errorCode: 'UPSTREAM_ERROR',
      error: expect.stringContaining('server region'),
    });
  });

  it('preserves a status nested in a generic retry error', async () => {
    const response = llmApiError({ errors: [{ statusCode: 429 }] });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: 'RATE_LIMITED',
    });
  });
});
