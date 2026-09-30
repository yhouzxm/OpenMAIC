import { invariant } from './errors';
import { instant, type Instant } from './time';

/** Capture a closed, behavior-free Domain snapshot before reconstruction. */
export function persistenceRecord(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  invariant(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    'INVALID_ENTITY',
    'A persistence state object is required.',
  );
  const prototype = Object.getPrototypeOf(value);
  invariant(
    prototype === Object.prototype || prototype === null,
    'INVALID_ENTITY',
    'A plain persistence state object is required.',
  );
  const keys = Reflect.ownKeys(value);
  invariant(
    keys.length === fields.length &&
      fields.every((field) => keys.includes(field)) &&
      keys.every((key) => typeof key === 'string' && fields.includes(key)),
    'INVALID_ENTITY',
    'Unexpected persistence state fields.',
  );
  const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    invariant(
      descriptor !== undefined && 'value' in descriptor,
      'INVALID_ENTITY',
      'Persistence state fields must be own data properties.',
    );
    snapshot[field] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

export function persistenceInstant(value: unknown): Instant {
  invariant(typeof value === 'number', 'INVALID_TIME', 'An instant is required.');
  return instant(value);
}

export function nullablePersistenceInstant(value: unknown): Instant | null {
  return value === null ? null : persistenceInstant(value);
}

export function persistenceText(value: unknown): string {
  invariant(
    typeof value === 'string' && value.trim().length > 0,
    'INVALID_ENTITY',
    'Nonblank text is required.',
  );
  return value;
}
