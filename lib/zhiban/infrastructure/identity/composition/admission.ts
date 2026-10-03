import { createHmac, createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { integrity, oneRow } from '../postgres/repositories/repository-support';
import type { TransactionPool } from '../postgres/transactions';
import type { AuthenticationTransport } from '@/lib/zhiban/application/identity/use-cases/authentication';
import { ref, run } from './support';
import { checkRow, checkedInteger, instantMaximum } from '../postgres/mappers/checked-values';

export const purposes = [
  'LOGIN',
  'REAUTHENTICATE',
  'PASSWORD_CHANGE',
  'INITIAL_PROVISION',
] as const;
export type AdmissionPurpose = (typeof purposes)[number];
/** Canonical, nonsecret configuration manifest. Decimal fields mirror PostgreSQL int8. */
export interface AdmissionPolicyRecord {
  purpose: AdmissionPurpose;
  approval_ref: string;
  environment_ref: string;
  created_at: string;
  window_ms: string;
  global_limit: string;
  ip_limit: string | null;
  locator_limit: string | null;
  pair_limit: string | null;
  user_limit: string | null;
  max_buckets: string;
}
export function admissionPolicyDigest(policy: AdmissionPolicyRecord) {
  const fields = [
    'purpose',
    'approval_ref',
    'environment_ref',
    'created_at',
    'window_ms',
    'global_limit',
    'ip_limit',
    'locator_limit',
    'pair_limit',
    'user_limit',
    'max_buckets',
  ] as const;
  checkRow(policy, fields, ['ip_limit', 'locator_limit', 'pair_limit', 'user_limit']);
  integrity(purposes.includes(policy.purpose));
  ref(policy.approval_ref);
  ref(policy.environment_ref);
  checkedInteger(policy.created_at, instantMaximum);
  integrity(checkedInteger(policy.window_ms, BigInt(3600000)) > BigInt(0));
  for (const key of [
    'global_limit',
    'ip_limit',
    'locator_limit',
    'pair_limit',
    'user_limit',
    'max_buckets',
  ] as const)
    if (policy[key] !== null) integrity(checkedInteger(policy[key], BigInt(1000000)) > BigInt(0));
  integrity(
    policy.purpose === 'INITIAL_PROVISION'
      ? policy.user_limit !== null &&
          policy.ip_limit === null &&
          policy.locator_limit === null &&
          policy.pair_limit === null
      : policy.ip_limit !== null &&
          policy.locator_limit !== null &&
          policy.pair_limit !== null &&
          (policy.purpose === 'LOGIN' ? policy.user_limit === null : policy.user_limit !== null),
  );
  return createHash('sha256')
    .update(JSON.stringify(['identity-admission-policy-v1', ...fields.map((k) => [k, policy[k]])]))
    .digest('hex');
}
export interface AdmissionConfig {
  readonly environment: string;
  readonly approvalRef: string;
  readonly hmacKey: Uint8Array;
  readonly policyDigests: Readonly<Record<AdmissionPurpose, string>>;
}
/** The adapter supplies a canonical, server-observed address; never raw X-Forwarded-For. */
export type TransportFacts = AuthenticationTransport;
const transports = new WeakMap<TransportFacts, string>();
export function observedTransport(canonicalAddress: string): TransportFacts {
  integrity(
    typeof canonicalAddress === 'string' &&
      canonicalAddress.length <= 64 &&
      isIP(canonicalAddress) !== 0,
  );
  // Normalize equivalent IPv6 spellings through the platform URL parser, IPv4 remains canonical.
  const address =
    isIP(canonicalAddress) === 6
      ? new URL('http://[' + canonicalAddress + ']/').hostname
      : canonicalAddress;
  const handle = Object.freeze({ kind: 'SERVER_TRANSPORT' as const });
  transports.set(handle, address);
  return handle;
}
export class SharedAdmission {
  #key: Buffer;
  #config: {
    environment: string;
    approvalRef: string;
    policyDigests: Readonly<Record<AdmissionPurpose, string>>;
  };
  constructor(
    private readonly authPool: TransactionPool,
    config: AdmissionConfig,
  ) {
    ref(config?.environment);
    ref(config?.approvalRef);
    integrity(config?.hmacKey instanceof Uint8Array && config.hmacKey.length === 32);
    integrity(
      Object.keys(config.policyDigests).sort().join(',') === [...purposes].sort().join(','),
    );
    for (const purpose of purposes)
      integrity(
        typeof config.policyDigests[purpose] === 'string' &&
          /^[0-9a-f]{64}$(?![\s\S])/.test(config.policyDigests[purpose]),
      );
    this.#key = Buffer.from(config.hmacKey);
    this.#config = {
      environment: config.environment,
      approvalRef: config.approvalRef,
      policyDigests: Object.freeze({ ...config.policyDigests }),
    };
  }
  async reserve(
    purpose: AdmissionPurpose,
    transport: TransportFacts | null,
    locator: string,
    user: string | null = null,
  ) {
    integrity(purposes.includes(purpose) && typeof locator === 'string' && locator.length <= 128);
    const ip = transport === null ? null : transports.get(transport);
    integrity(
      purpose === 'INITIAL_PROVISION'
        ? transport === null && user !== null
        : ip !== undefined && ip !== null,
    );
    integrity(purpose === 'LOGIN' || user !== null);
    const key = (dimension: string, facts: unknown) =>
      createHmac('sha256', this.#key)
        .update(
          JSON.stringify([
            'zhiban-admission-v1',
            this.#config.environment,
            purpose,
            dimension,
            facts,
          ]),
        )
        .digest('hex');
    const keys =
      purpose === 'INITIAL_PROVISION'
        ? [key('GLOBAL', null), key('USER', user)]
        : [
            key('GLOBAL', null),
            key('IP', ip),
            key('LOCATOR', locator),
            key('IP_LOCATOR', [ip, locator]),
          ];
    if (purpose !== 'LOGIN' && purpose !== 'INITIAL_PROVISION') keys.push(key('USER', user));
    return run(this.authPool, async (client) => {
      const row = oneRow(
        await client.query<{ allowed: boolean }>(
          'SELECT zhiban_identity.identity_admission_reserve($1,$2,$3::text[]) AS allowed',
          [purpose, this.#config.policyDigests[purpose], keys],
        ),
        'SELECT',
      );
      integrity(row !== null && typeof row.allowed === 'boolean');
      return row.allowed;
    });
  }
  prune(purpose: AdmissionPurpose, limit: number) {
    integrity(purposes.includes(purpose) && Number.isInteger(limit) && limit >= 1 && limit <= 500);
    return run(this.authPool, async (client) => {
      const row = oneRow(
        await client.query<{ deleted: number }>(
          'SELECT zhiban_identity.identity_admission_prune($1,$2,$3) AS deleted',
          [purpose, this.#config.policyDigests[purpose], limit],
        ),
        'SELECT',
      );
      integrity(
        row !== null && Number.isInteger(row.deleted) && row.deleted >= 0 && row.deleted <= limit,
      );
      return row.deleted;
    });
  }
}
