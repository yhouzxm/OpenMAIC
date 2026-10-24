import { describe, it, expect } from 'vitest';
import {
  canonicalLoginAlias,
  aliasManifestDigest,
  type AliasManifest,
} from '../../../lib/zhiban/domain/login-identifiers/model';
import { canonicalLoginIdentifier } from '../../../lib/zhiban/infrastructure/identity/composition/identifier';
describe('separate controlled alias namespace', () => {
  it('preserves UUID-only frozen resolution and refuses business/email/unicode forms', () => {
    expect(canonicalLoginAlias(' \t@Chen.Study01\r\n')).toBe('@chen.study01');
    for (const bad of [
      '123456',
      'chen@example.com',
      '@a',
      '@中文标识',
      '＠chen.study01',
      '@chen..@x',
      '@bad ',
    ])
      expect(canonicalLoginAlias(bad)).toBeNull();
    expect(canonicalLoginIdentifier('@chen.study01')).toBeNull();
    expect(canonicalLoginAlias('01a165dd-211b-731a-887e-6bd53f136614')).toBeNull();
    expect(canonicalLoginIdentifier('01a165dd-211b-731a-887e-6bd53f136614')).toBe(
      '01a165dd-211b-731a-887e-6bd53f136614',
    );
  });
  it('binds signed target/purpose/revision independently of property insertion order', () => {
    const m = {
      kind: 'LOGIN_IDENTIFIER_NOMINATION',
      environment: 'LOCAL',
      sourceRef: 'source',
      alias: '@chen.study01',
      userId: 'user',
      expectedUserRevision: '1',
      operatorUserId: 'operator',
      operatorRevision: '1',
      grantId: 'grant',
      grantRevision: '1',
      subjectReference: 'LOCAL_ROSTER',
      issuedAt: 1,
      expiresAt: 100,
    } as AliasManifest;
    expect(aliasManifestDigest(m)).toBe(
      aliasManifestDigest(
        Object.fromEntries(Object.entries(m).reverse()) as unknown as AliasManifest,
      ),
    );
    for (const change of [
      { userId: 'other' },
      { alias: '@chen.study02' },
      { expectedUserRevision: '2' },
    ])
      expect(aliasManifestDigest({ ...m, ...change })).not.toBe(aliasManifestDigest(m));
  });
});
