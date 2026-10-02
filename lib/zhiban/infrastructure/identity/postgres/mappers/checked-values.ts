import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';

export const instantMaximum = BigInt('8640000000000000');
export const safeIntegerMaximum = BigInt('9007199254740991');
export const int8Maximum = BigInt('9223372036854775807');

export function integrityFailure(): never {
  throw new IdentityPortError('INTEGRITY_FAILURE');
}

/** pg int8 must remain canonical text until its precise range has been checked. */
export function checkedInteger(value: unknown, maximum: bigint): bigint {
  if (typeof value !== 'string' || value.length > 19 ||
      !/^(?:0|[1-9][0-9]*)$(?![\s\S])/.test(value)) integrityFailure();
  const parsed = BigInt(value);
  if (parsed > maximum) integrityFailure();
  return parsed;
}

export function checkedUuid(value: unknown): void {
  if (typeof value !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$(?![\s\S])/.test(value))
    integrityFailure();
}

/** PostgreSQL text has no NUL; pg's UTF-8 encoder must not replace lone surrogates. */
export function checkedText(value: unknown): string {
  if (typeof value !== 'string') integrityFailure();
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit === 0 || (unit >= 0xDC00 && unit <= 0xDFFF)) integrityFailure();
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) integrityFailure();
    }
  }
  return value;
}

export function checkedNullableText(value: unknown): string | null {
  return value === null ? null : checkedText(value);
}

/** Exact, plain, own data fields: no missing fields, coercion, getters or NULL defaults. */
export function checkRow(value: unknown, columns: readonly string[], nullable: readonly string[]): void {
  if (typeof value !== 'object' || value === null ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
      Reflect.ownKeys(value).length !== columns.length) integrityFailure();
  for (const field of columns) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) integrityFailure();
    const raw: unknown = descriptor.value;
    if (raw === null && nullable.includes(field)) continue;
    if (typeof raw !== 'string') integrityFailure();
    checkedText(raw);
    if (field.endsWith('_id')) checkedUuid(raw);
    if (field === 'repository_revision' && checkedInteger(raw, int8Maximum) === BigInt('0')) integrityFailure();
  }
}
