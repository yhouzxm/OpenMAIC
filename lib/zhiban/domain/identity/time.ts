import { invariant } from './errors';

declare const instantBrand: unique symbol;
/** UTC milliseconds since the epoch; an immutable value supplied by the caller. */
export type Instant = number & { readonly [instantBrand]: true };

export function instant(value: number): Instant {
  invariant(
    Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000,
    'INVALID_TIME',
    'A nonnegative, representable UTC millisecond instant is required.',
  );
  return value as Instant;
}

export function atOrAfter(value: Instant, previous: Instant): Instant {
  instant(value);
  invariant(value >= previous, 'INVALID_TIME', 'Time cannot move backwards.');
  return value;
}

export function validateValidity(validFrom: Instant, validUntil: Instant | null): void {
  instant(validFrom);
  if (validUntil !== null) {
    instant(validUntil);
    invariant(
      validUntil > validFrom,
      'INVALID_VALIDITY_WINDOW',
      'The validity interval must be nonempty.',
    );
  }
}
