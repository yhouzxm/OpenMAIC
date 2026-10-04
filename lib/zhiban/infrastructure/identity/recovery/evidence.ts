import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import type { RecoveryEvidenceStore } from '@/lib/zhiban/application/identity/ports/manual-recovery';
import { must, reference, exact, time, revision, uuid, RecoveryError } from './values';
export type EvidenceKind =
  | 'SOURCE_ENROLLMENT'
  | 'SOURCE_APPOINTMENT'
  | 'SOURCE_CONTACT'
  | 'REGISTRATION'
  | 'VERIFICATION'
  | 'APPROVAL'
  | 'HANDOVER'
  | 'NOTICE'
  | 'POLICY';
export interface TrustedRecoveryKey {
  readonly keyRef: string;
  readonly issuer: string;
  readonly environment: string;
  readonly kinds: readonly EvidenceKind[];
  readonly validFrom: number;
  readonly validUntil: number;
  readonly publicKey: KeyObject;
}
const common = ['purpose', 'kind', 'issuer_ref', 'environment_ref', 'issued_at', 'valid_until'];
export const sourceFields = [
  'source_id',
  'source_ref',
  'bound_user_id',
  'source_version',
  'enrollment_approval_ref',
];
export const persistedRegistrationFields = [
  'case_id',
  'environment_ref',
  'site_ref',
  'subject_user_id',
  'verifier_user_id',
  'actor_user_id',
  'enrollment_source_id',
  'appointment_source_id',
  'contact_source_id',
  'expected_enrollment_source_revision',
  'expected_appointment_source_revision',
  'expected_contact_source_revision',
  'registration_manifest_digest',
  'registration_key_ref',
  'approval_ref',
  'intent',
  'security_clearance_ref',
  'expected_subject_user_revision',
  'expected_verifier_user_revision',
  'expected_slot_revision',
  'expected_security_epoch',
  'expected_credential_id',
  'expected_generation',
  'expected_actor_user_revision',
  'expected_actor_slot_revision',
  'expected_actor_security_epoch',
  'actor_admin_grant_id',
  'expected_admin_grant_revision',
];
export const registrationFields = persistedRegistrationFields.filter(
  (k) => !['environment_ref', 'registration_manifest_digest', 'registration_key_ref'].includes(k),
);
export const receiptFields = [
  'case_id',
  'registration_manifest_digest',
  'verifier_user_id',
  'appointment_source_id',
  'expected_appointment_source_revision',
  'receipt_ref',
  'notice_kind',
  'route_source_id',
  'route_source_revision',
  'ticket_generation',
  'verified_at',
  'expires_at',
  'pre_notice_receipt_ref',
];
export function evidenceFields(kind: EvidenceKind) {
  return [
    ...common,
    ...(kind.startsWith('SOURCE_')
      ? sourceFields
      : kind === 'REGISTRATION'
        ? registrationFields
        : kind === 'POLICY'
          ? ['policy_digest', 'approval_ref', 'transport_digest']
          : receiptFields),
  ];
}
export type Evidence = Readonly<Record<string, string | null>>;
/** Exact-import, pinned Ed25519 backchannel; signatures alone never authorize a SQL write. */
export class RecoveryEvidence {
  #keys = new Map<string, TrustedRecoveryKey>();
  constructor(
    private readonly store: RecoveryEvidenceStore,
    readonly environment: string,
    keys: readonly TrustedRecoveryKey[],
  ) {
    reference(environment);
    must(keys.length > 0 && keys.length <= 32);
    for (const k of keys) {
      reference(k.keyRef);
      reference(k.issuer);
      must(
        k.environment === environment &&
          Number.isSafeInteger(k.validFrom) &&
          Number.isSafeInteger(k.validUntil) &&
          k.validFrom >= 0 &&
          k.validUntil <= 8640000000000000 &&
          k.validUntil > k.validFrom &&
          !this.#keys.has(k.keyRef) &&
          k.publicKey.type === 'public' &&
          k.kinds.length > 0,
      );
      const key = createPublicKey(k.publicKey.export({ type: 'spki', format: 'pem' }));
      must(key.asymmetricKeyType === 'ed25519');
      this.#keys.set(
        k.keyRef,
        Object.freeze({ ...k, kinds: Object.freeze([...k.kinds]), publicKey: key }),
      );
    }
  }
  async synchronized() {
    must((await this.store.synchronized()) === true);
  }
  keyDeadline(ref: string) {
    const k = this.#keys.get(ref);
    must(k !== undefined && Date.now() >= k.validFrom && Date.now() < k.validUntil);
    return k.validUntil;
  }
  async load(
    ref: string,
    kind: EvidenceKind,
    expectedKey?: string,
  ): Promise<{ fields: Evidence; digest: string; keyRef: string; deadline: number }> {
    reference(ref);
    await this.synchronized();
    const envelope = await this.store.read(ref);
    must(envelope !== null);
    exact(envelope, ['canonical', 'keyRef', 'signature']);
    must(typeof envelope.canonical === 'string' && Buffer.byteLength(envelope.canonical) <= 16384);
    reference(envelope.keyRef);
    const k = this.#keys.get(envelope.keyRef);
    must(k !== undefined && k.kinds.includes(kind));
    if (expectedKey !== undefined) must(expectedKey === envelope.keyRef);
    must(
      typeof envelope.signature === 'string' &&
        /^[A-Za-z0-9_-]{86}$(?![\s\S])/.test(envelope.signature),
    );
    const signature = Buffer.from(envelope.signature, 'base64url');
    must(signature.length === 64 && signature.toString('base64url') === envelope.signature);
    must(verify(null, Buffer.from(envelope.canonical, 'utf8'), k.publicKey, signature) === true);
    let pairs: unknown;
    try {
      pairs = JSON.parse(envelope.canonical);
    } catch {
      throw new RecoveryError('RECOVERY_REJECTED');
    }
    const names = evidenceFields(kind);
    must(Array.isArray(pairs) && pairs.length === names.length);
    const values: Record<string, string | null> = {};
    for (let i = 0; i < names.length; i++) {
      const pair = pairs[i];
      must(
        Array.isArray(pair) &&
          pair.length === 2 &&
          pair[0] === names[i] &&
          (typeof pair[1] === 'string' || pair[1] === null),
      );
      values[names[i]] = pair[1];
    }
    must(
      JSON.stringify(pairs) === envelope.canonical &&
        values.purpose === 'MANUAL_PASSWORD_RECOVERY' &&
        values.kind === kind &&
        values.issuer_ref === k.issuer &&
        values.environment_ref === this.environment,
    );
    const at = Date.now(),
      issued = time(values.issued_at),
      until = time(values.valid_until);
    must(at >= issued && at < until && at >= k.validFrom && at < k.validUntil);
    for (const [name, v] of Object.entries(values)) {
      if (v === null) continue;
      if (
        name.endsWith('_revision') ||
        name === 'source_version' ||
        name === 'expected_security_epoch' ||
        name === 'expected_actor_security_epoch' ||
        name === 'expected_generation'
      )
        revision(v);
      else if (name.endsWith('_id')) uuid(v);
      else if (name.endsWith('_ref')) reference(v);
    }
    return Object.freeze({
      fields: Object.freeze(values),
      digest: createHash('sha256').update(envelope.canonical).digest('hex'),
      keyRef: k.keyRef,
      deadline: Math.min(until, k.validUntil),
    });
  }
}
