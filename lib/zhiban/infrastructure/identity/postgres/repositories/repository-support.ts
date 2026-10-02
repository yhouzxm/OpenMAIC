import { IdentityDomainError } from '@/lib/zhiban/domain/identity/errors';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';
import { repositoryRevision, type RepositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';

export function integrity(condition: boolean): asserts condition {
  if (!condition) throw new IdentityPortError('INTEGRITY_FAILURE');
}

function own(error: unknown, key: string): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && 'value' in descriptor ? descriptor.value : undefined;
  } catch { return undefined; }
}

/** Sanitize driver/Domain details at the Port boundary; no retries or error hierarchy. */
export async function atPortBoundary<T>(work: () => Promise<T>, uniqueConstraints: readonly string[] = []): Promise<T> {
  try { return await work(); } catch (error) {
    if (error instanceof IdentityPortError) throw error;
    if (error instanceof IdentityDomainError)
      throw new IdentityPortError('INTEGRITY_FAILURE');
    const code = own(error, 'code');
    if (code === '40001' || code === '40P01') throw new IdentityPortError('RETRYABLE_PERSISTENCE_FAILURE');
    if (code === '23503' || code === '23514' || code === '22003') throw new IdentityPortError('INTEGRITY_FAILURE');
    // Only schema-owned, approved uniqueness constraints receive CONFLICT.
    const constraint = own(error, 'constraint');
    if (code === '23505' && typeof constraint === 'string' &&
      uniqueConstraints.includes(constraint))
      throw new IdentityPortError('CONFLICT');
    throw new IdentityPortError('UNAVAILABLE');
  }
}

export function oneRow<Row>(result: { command: string; rowCount: number | null; rows: Row[] }, command: string, optional = false): Row | null {
  integrity(typeof result === 'object' && result !== null);
  integrity(result.command === command && Array.isArray(result.rows) &&
    result.rowCount === result.rows.length && result.rows.length <= 1);
  if (result.rows.length === 0) {
    integrity(optional);
    return null;
  }
  return result.rows[0];
}

export function expectedRevision(actual: RepositoryRevision, expected: RepositoryRevision): void {
  validateRevision(expected);
  if (actual !== expected) throw new IdentityPortError('STALE_WRITE');
}

/** Only parser failures are malformed revision input, not arbitrary driver TypeErrors. */
export function validateRevision(value: RepositoryRevision): void {
  try { repositoryRevision(value); } catch { throw new IdentityPortError('INTEGRITY_FAILURE'); }
}

/** BigInt is used only for precision checks; the UPDATE increments in PostgreSQL. */
export function nextRevision(current: RepositoryRevision): RepositoryRevision {
  integrity(current !== '9223372036854775807');
  return repositoryRevision((BigInt(current) + BigInt(1)).toString());
}
