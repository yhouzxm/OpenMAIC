import { createHash, randomBytes } from 'node:crypto';
import { userId } from '@/lib/zhiban/domain/identity';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';

export class BridgeError extends Error {
  constructor() {
    super('Bridge request rejected');
    this.name = 'BridgeError';
  }
}
export function check(value: unknown): asserts value {
  if (!value) throw new BridgeError();
}
export function uuid(value: unknown): string {
  try {
    check(typeof value === 'string');
    return userId(value);
  } catch {
    throw new BridgeError();
  }
}
export function revision(value: unknown) {
  try {
    check(typeof value === 'string');
    return repositoryRevision(value);
  } catch {
    throw new BridgeError();
  }
}
export function successor(value: string) {
  const n = BigInt(revision(value));
  check(n < BigInt('9223372036854775807'));
  return revision((n + BigInt(1)).toString());
}
export function instant(value: unknown): number {
  check(
    typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 8640000000000000,
  );
  return value;
}
export function storedInstant(value: unknown) {
  check(
    typeof value === 'string' &&
      /^(0|[1-9][0-9]*)$/.test(value) &&
      BigInt(value) <= BigInt('8640000000000000'),
  );
  return instant(Number(value));
}
export function counter(value: unknown) {
  check(
    typeof value === 'string' &&
      /^(0|[1-9][0-9]*)$/.test(value) &&
      BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER),
  );
  return Number(value);
}
export function opaque(value: unknown): string {
  check(
    typeof value === 'string' &&
      Buffer.byteLength(value) >= 1 &&
      Buffer.byteLength(value) <= 256 &&
      !/[\x00-\x1f\x7f-\x9f]/.test(value),
  );
  return value;
}
export function digest(value: unknown): string {
  check(typeof value === 'string' && /^[0-9a-f]{64}$/.test(value));
  return value;
}
export function hash(bytes: Uint8Array | string) {
  return createHash('sha256').update(bytes).digest('hex');
}
export function newPrincipal() {
  return randomBytes(32).toString('base64url');
}
export function principal(value: unknown): string {
  check(
    typeof value === 'string' &&
      /^[A-Za-z0-9_-]{43}$/.test(value) &&
      Buffer.from(value, 'base64url').toString('base64url') === value,
  );
  return value;
}
export function exact(
  row: unknown,
  keys: readonly string[],
): asserts row is Record<string, unknown> {
  check(
    row !== null &&
      typeof row === 'object' &&
      [null, Object.prototype].includes(Object.getPrototypeOf(row)) &&
      Object.keys(row).sort().join(',') === [...keys].sort().join(','),
  );
}
export function fail(): never {
  throw new BridgeError();
}
