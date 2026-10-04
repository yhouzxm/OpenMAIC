import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { checkedUuid, checkedInteger, instantMaximum } from '../postgres/mappers/checked-values';
export function denied(): never {
  throw new RecoveryError('RECOVERY_REJECTED');
}
export class RecoveryError extends Error {
  constructor(readonly code: 'RECOVERY_REJECTED' | 'RECOVERY_UNAVAILABLE' | 'OUTCOME_UNKNOWN') {
    super(code);
    this.name = 'RecoveryError';
  }
}
export function safeError(error: unknown): RecoveryError {
  try {
    if (error instanceof RecoveryError) {
      const d = Object.getOwnPropertyDescriptor(error, 'code');
      if (
        d &&
        Object.hasOwn(d, 'value') &&
        ['RECOVERY_REJECTED', 'RECOVERY_UNAVAILABLE', 'OUTCOME_UNKNOWN'].includes(d.value)
      )
        return new RecoveryError(d.value);
    }
  } catch {
    /* Untrusted error/proxy details are not inspected or logged. */
  }
  return new RecoveryError('RECOVERY_UNAVAILABLE');
}
export function must(condition: unknown): asserts condition {
  if (condition !== true) denied();
}
export function reference(v: unknown): asserts v is string {
  must(typeof v === 'string' && /^[A-Za-z0-9._:-]{1,128}$(?![\s\S])/.test(v));
}
export function digest(v: unknown): asserts v is string {
  must(typeof v === 'string' && /^[a-f0-9]{64}$(?![\s\S])/.test(v));
}
export function uuid(v: unknown): asserts v is string {
  try {
    checkedUuid(v);
  } catch {
    denied();
  }
}
export function revision(v: unknown): asserts v is string {
  try {
    repositoryRevision(v as string);
  } catch {
    denied();
  }
}
export function time(v: unknown): number {
  try {
    return Number(checkedInteger(v, instantMaximum));
  } catch {
    denied();
  }
}
export function exact(v: unknown, keys: readonly string[]): asserts v is Record<string, unknown> {
  must(
    typeof v === 'object' &&
      v !== null &&
      (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null),
  );
  must(Reflect.ownKeys(v).length === keys.length);
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    must(d !== undefined && Object.hasOwn(d, 'value'));
  }
}
export function increment(v: string) {
  revision(v);
  must(v !== '9223372036854775807');
  return (BigInt(v) + BigInt(1)).toString();
}
export function portError(): never {
  throw new IdentityPortError('INTEGRITY_FAILURE');
}
