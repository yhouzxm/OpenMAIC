import { APICallError, RetryError } from 'ai';
import { apiError } from '@/lib/server/api-response';

const HTTP_ERROR_MIN = 400;
const HTTP_ERROR_MAX = 599;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toHttpErrorStatus(value: unknown): number | undefined {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;

  return Number.isInteger(parsed) && parsed >= HTTP_ERROR_MIN && parsed <= HTTP_ERROR_MAX
    ? parsed
    : undefined;
}

function statusFromError(error: unknown, seen = new Set<unknown>()): number | undefined {
  if (!error || seen.has(error)) return undefined;
  seen.add(error);

  if (APICallError.isInstance(error)) {
    return toHttpErrorStatus(error.statusCode);
  }

  if (RetryError.isInstance(error)) {
    return (
      statusFromError(error.lastError, seen) ??
      error.errors
        .map((nested) => statusFromError(nested, seen))
        .find((status): status is number => status !== undefined)
    );
  }

  if (!isRecord(error)) return undefined;

  const status = toHttpErrorStatus(error.statusCode ?? error.status ?? error.status_code);
  if (status !== undefined) return status;

  const nestedErrors = Array.isArray(error.errors) ? error.errors : [];
  return (
    statusFromError(error.cause, seen) ??
    statusFromError(error.lastError, seen) ??
    nestedErrors
      .map((nested) => statusFromError(nested, seen))
      .find((nestedStatus): nestedStatus is number => nestedStatus !== undefined)
  );
}

function messagesFromError(error: unknown, seen = new Set<unknown>()): string[] {
  if (!error || seen.has(error)) return [];
  seen.add(error);

  if (typeof error === 'string') return [error];
  if (!isRecord(error)) return [];

  const messages = [error.message, error.responseBody]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  const nestedErrors = Array.isArray(error.errors) ? error.errors : [];
  return [
    ...messages,
    ...messagesFromError(error.cause, seen),
    ...messagesFromError(error.lastError, seen),
    ...nestedErrors.flatMap((nested) => messagesFromError(nested, seen)),
  ];
}

function isUnsupportedProviderLocation(error: unknown): boolean {
  const message = messagesFromError(error).join(' ').toLowerCase();
  return (
    message.includes('user location is not supported') ||
    (message.includes('failed_precondition') && message.includes('location'))
  );
}

function messageForStatus(status: number): string {
  if (status === 401 || status === 403) {
    return 'Upstream authentication or authorization failed.';
  }
  if (status === 404) return 'Upstream endpoint not found.';
  if (status === 429) return 'Upstream rate limit reached. Please try again shortly.';
  if (status >= 500) return 'Upstream model provider is temporarily unavailable. Please try again.';
  return 'Upstream provider rejected the request.';
}

/**
 * Preserve a provider's HTTP semantics for client retry classification without
 * exposing provider response bodies, URLs, or credential-adjacent details.
 */
export function llmApiError(error: unknown) {
  if (isUnsupportedProviderLocation(error)) {
    return apiError(
      'UPSTREAM_ERROR',
      400,
      'The configured model provider is unavailable from this server region. Configure an accessible model endpoint or proxy and try again.',
    );
  }

  const status = statusFromError(error);
  if (status === undefined) {
    return apiError('INTERNAL_ERROR', 500, 'Scene generation failed. Please try again.');
  }

  return apiError(
    status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR',
    status,
    messageForStatus(status),
  );
}
