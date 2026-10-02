import type { PasswordScreeningPort } from '@/lib/zhiban/application/identity/ports/password-screening';
import { IdentityPortError } from '@/lib/zhiban/application/identity/ports/errors';

/** Explicitly provisioned, approved public compromised-password corpus; not submitted-secret storage.
 * Deployment must maintain/refresh the corpus. No network, queued inputs or fail-open fallback.
 * Corpora are configuration, not credentials and are never generated from authentication traffic.
 */
export class LocalCompromisedPasswordScreening implements PasswordScreeningPort {
  private readonly corpus: ReadonlySet<string>;
  constructor(approvedCorpus: readonly string[]) {
    if (
      !Array.isArray(approvedCorpus) ||
      approvedCorpus.length < 1 ||
      approvedCorpus.length > 100000
    )
      throw new IdentityPortError('INTEGRITY_FAILURE');
    const values: string[] = [];
    for (let i = 0; i < approvedCorpus.length; i++) {
      const field = Object.getOwnPropertyDescriptor(approvedCorpus, i.toString());
      const value: unknown = field && 'value' in field ? field.value : undefined;
      if (
        typeof value !== 'string' ||
        value.length === 0 ||
        Buffer.byteLength(value, 'utf8') > 1024
      )
        throw new IdentityPortError('INTEGRITY_FAILURE');
      values.push(value);
    }
    this.corpus = new Set(values);
  }
  async isCompromised(secret: string): Promise<boolean> {
    return this.corpus.has(secret);
  }
}
