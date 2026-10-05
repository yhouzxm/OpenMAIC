import { createHash, randomBytes } from 'node:crypto';
import { v7 } from 'uuid';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import type { RuntimeReason } from '@/lib/zhiban/application/openmaic/runtime';
export class RuntimeFailure extends Error {
  readonly reason: RuntimeReason;
  constructor(reason: RuntimeReason = 'INTEGRITY_FAILURE') {
    super('Runtime request rejected');
    this.name = 'RuntimeFailure';
    this.reason = [
      'DENIED',
      'STALE',
      'INVALID_INPUT',
      'BUDGET_EXCEEDED',
      'STORAGE_FAILURE',
      'INTEGRITY_FAILURE',
      'CANCELLED',
      'OUTCOME_UNKNOWN',
    ].includes(reason)
      ? reason
      : 'STORAGE_FAILURE';
  }
}
export function requireFact(
  value: unknown,
  reason: RuntimeReason = 'INTEGRITY_FAILURE',
): asserts value {
  if (!value) throw new RuntimeFailure(reason);
}
export function exact(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  requireFact(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'INVALID_INPUT',
  );
  requireFact(
    Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null,
    'INVALID_INPUT',
  );
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireFact(
    Reflect.ownKeys(value).length === keys.length &&
      keys.every((k) => Object.hasOwn(descriptors, k) && 'value' in descriptors[k]),
    'INVALID_INPUT',
  );
}
export function text(value: unknown, maximum: number, controls = false): string {
  requireFact(
    typeof value === 'string' && value.length > 0 && value.isWellFormed() && !value.includes('\0'),
    'INVALID_INPUT',
  );
  requireFact(!controls || !/[\u0000-\u001f\u007f-\u009f]/u.test(value), 'INVALID_INPUT');
  requireFact(Buffer.byteLength(value, 'utf8') <= maximum, 'BUDGET_EXCEEDED');
  return value;
}
export function uuid(value: unknown): string {
  requireFact(
    typeof value === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value),
    'INVALID_INPUT',
  );
  return value;
}
export function opaque(value: unknown): string {
  requireFact(typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value), 'INVALID_INPUT');
  requireFact(
    Buffer.from(value, 'base64url').length === 32 &&
      Buffer.from(value, 'base64url').toString('base64url') === value,
    'INVALID_INPUT',
  );
  return value;
}
export function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
export function digest(value: unknown): string {
  requireFact(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value));
  return value;
}
export function rev(value: unknown): string {
  try {
    requireFact(typeof value === 'string');
    return repositoryRevision(value);
  } catch {
    throw new RuntimeFailure('INTEGRITY_FAILURE');
  }
}
export const MAX_REVISION = BigInt('9223372036854775807');
export function next(value: string): string {
  const r = BigInt(rev(value));
  requireFact(r < MAX_REVISION);
  return (r + BigInt(1)).toString();
}
export function instant(value: unknown): number {
  requireFact(
    typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 8640000000000000,
  );
  return value;
}
export function tail(value: unknown): number | null {
  if (value === null) return null;
  requireFact(
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 127,
    'INVALID_INPUT',
  );
  return value;
}
export const allocateId = () => v7();
export const allocateRef = () => randomBytes(32).toString('base64url');
export function canonicalTime(value: unknown): string {
  requireFact(typeof value === 'string');
  const at = Date.parse(value);
  requireFact(Number.isFinite(at) && new Date(at).toISOString() === value);
  return value;
}
