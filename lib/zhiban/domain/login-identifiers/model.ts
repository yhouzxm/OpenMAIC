import { createHash } from 'node:crypto';
/** Separate namespace; never expands the frozen canonical UserId resolver. */
export function canonicalLoginAlias(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 128) return null;
  const value = input.replace(/^[\x09-\x0d\x20]+|[\x09-\x0d\x20]+$/g, '').toLowerCase();
  return /^@[a-z][a-z0-9._-]{3,46}[a-z0-9]$(?![\s\S])/.test(value) ? value : null;
}
export interface AliasManifest {
  kind: 'LOGIN_IDENTIFIER_NOMINATION';
  environment: string;
  sourceRef: string;
  alias: string;
  userId: string;
  expectedUserRevision: string;
  operatorUserId: string;
  operatorRevision: string;
  grantId: string;
  grantRevision: string;
  subjectReference: string;
  issuedAt: number;
  expiresAt: number;
}
export const aliasManifestFields = [
  'kind',
  'environment',
  'sourceRef',
  'alias',
  'userId',
  'expectedUserRevision',
  'operatorUserId',
  'operatorRevision',
  'grantId',
  'grantRevision',
  'subjectReference',
  'issuedAt',
  'expiresAt',
] as const;
export function aliasManifestDigest(m: AliasManifest) {
  return createHash('sha256')
    .update(
      JSON.stringify(['zhiban-login-identifier-v1', ...aliasManifestFields.map((k) => [k, m[k]])]),
    )
    .digest('hex');
}
