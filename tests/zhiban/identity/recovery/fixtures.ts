import { generateKeyPairSync, sign } from 'node:crypto';
import {
  RecoveryEvidence,
  evidenceFields,
  type EvidenceKind,
  type TrustedRecoveryKey,
} from '@/lib/zhiban/infrastructure/identity/recovery/evidence';
import {
  budgetCeilings,
  type RecoveryPolicy,
} from '@/lib/zhiban/infrastructure/identity/recovery/policy';
import { IdentityIds } from '@/lib/zhiban/infrastructure/identity/composition/ids';
export const ids = new IdentityIds();
export const budgets: RecoveryPolicy = {
  ...budgetCeilings,
  environment_ref: 'synthetic',
  approval_ref: 'synthetic-approved',
  window_ms: 3600000,
  global_limit: 1000,
  site_limit: 1000,
  subject_limit: 1000,
  max_buckets: 10000,
  max_total_cases: 10000,
  registered_ttl_ms: 3600000,
  statement_timeout_ms: 5000,
  body_timeout_ms: 1000,
};
export function signedStore() {
  const pair = generateKeyPairSync('ed25519'),
    records = new Map<string, { canonical: string; signature: string; keyRef: string }>();
  let synchronized = true;
  const key: TrustedRecoveryKey = {
    keyRef: 'test-ed25519',
    issuer: 'test-evidence',
    environment: 'synthetic',
    kinds: [
      'SOURCE_ENROLLMENT',
      'SOURCE_APPOINTMENT',
      'SOURCE_CONTACT',
      'REGISTRATION',
      'VERIFICATION',
      'APPROVAL',
      'HANDOVER',
      'NOTICE',
      'POLICY',
    ],
    validFrom: 0,
    validUntil: Date.now() + 86400000,
    publicKey: pair.publicKey,
  };
  const store = {
    read: async (ref: string) => records.get(ref) ?? null,
    synchronized: async () => synchronized,
  };
  const put = (ref: string, kind: EvidenceKind, input: Record<string, string | null>) => {
    const common = {
      purpose: 'MANUAL_PASSWORD_RECOVERY',
      kind,
      issuer_ref: key.issuer,
      environment_ref: 'synthetic',
      issued_at: (Date.now() - 1000).toString(),
      valid_until: (Date.now() + 3600000).toString(),
    };
    const values = { ...common, ...input };
    const canonical = JSON.stringify(
      evidenceFields(kind).map((name) => [
        name,
        Object.hasOwn(values, name) ? values[name as keyof typeof values] : null,
      ]),
    );
    records.set(ref, {
      canonical,
      keyRef: key.keyRef,
      signature: sign(null, Buffer.from(canonical), pair.privateKey).toString('base64url'),
    });
    return records.get(ref)!;
  };
  return {
    key,
    store,
    put,
    records,
    privateKey: pair.privateKey,
    evidence: new RecoveryEvidence(store, 'synthetic', [key]),
    uncertain: () => {
      synchronized = false;
    },
  };
}
