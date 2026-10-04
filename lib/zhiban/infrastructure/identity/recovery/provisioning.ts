import type { TransactionPool } from '../postgres/transactions';
import { controlTransaction } from '../postgres/transactions';
import { IdentityIds } from '../composition/ids';
import { RecoveryEvidence } from './evidence';
import { policy, policyDigest, budgetCeilings, type RecoveryPolicy } from './policy';
import { must, increment, reference, revision, safeError } from './values';
/** Separate trusted control backchannel. No browser route and no owner DSN. */
export class RecoveryProvisioning {
  constructor(
    private readonly pool: TransactionPool,
    private readonly evidence: RecoveryEvidence,
    private readonly ids = new IdentityIds(),
  ) {}
  async policy(config: RecoveryPolicy, approvalReference: string) {
    try {
      const p = policy(config),
        d = policyDigest(p),
        e = await this.evidence.load(approvalReference, 'POLICY');
      must(
        e.fields.policy_digest === d &&
          e.fields.approval_ref === p.approval_ref &&
          e.fields.environment_ref === p.environment_ref,
      );
      const at = Date.now(),
        keys = [
          'environment_ref',
          'policy_digest',
          'approval_ref',
          'created_at',
          'updated_at',
          'repository_revision',
          ...Object.keys(budgetCeilings),
        ];
      await controlTransaction(this.pool, (client) =>
        client.query(
          `INSERT INTO zhiban_identity.identity_recovery_policy(${keys.join(',')}) VALUES(${keys.map((_, i) => '$' + (i + 1)).join(',')})`,
          [
            p.environment_ref,
            d,
            p.approval_ref,
            at.toString(),
            at.toString(),
            '1',
            ...Object.keys(budgetCeilings).map((k) => p[k as keyof RecoveryPolicy]),
          ],
        ),
      );
    } catch (e) {
      throw safeError(e);
    }
  }
  async source(ref: string, kind: 'ENROLLMENT' | 'APPOINTMENT' | 'CONTACT') {
    try {
      const e = await this.evidence.load(ref, ('SOURCE_' + kind) as 'SOURCE_ENROLLMENT'),
        f = e.fields;
      must(f.enrollment_approval_ref !== null);
      await controlTransaction(this.pool, async (client) => {
        const p = (
          await client.query<{ policy_digest: string }>(
            'SELECT policy_digest FROM zhiban_identity.identity_recovery_policy WHERE environment_ref=$1',
            [f.environment_ref],
          )
        ).rows[0];
        must(p !== undefined);
        await client.query('SELECT * FROM zhiban_identity.identity_recovery_gate($1,$2)', [
          f.environment_ref,
          p.policy_digest,
        ]);
        const at = Date.now();
        await client.query(
          `INSERT INTO zhiban_identity.identity_recovery_sources
 (source_id,environment_ref,source_kind,source_ref,bound_user_id,source_version,manifest_digest,issuer_ref,key_ref,attested_at,valid_until,state,repository_revision,created_at,updated_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'CURRENT',1,$12,$12)`,
          [
            f.source_id,
            f.environment_ref,
            kind,
            f.source_ref,
            f.bound_user_id,
            f.source_version,
            e.digest,
            f.issuer_ref,
            e.keyRef,
            f.issued_at,
            f.valid_until,
            at.toString(),
          ],
        );
      });
    } catch (e) {
      throw safeError(e);
    }
  }
  async enabled(
    environment: string,
    digest: string,
    expected: string,
    enable: boolean,
    approvalReference?: string,
  ) {
    try {
      reference(environment);
      revision(expected);
      must(typeof enable === 'boolean');
      const approval = enable ? await this.evidence.load(approvalReference!, 'POLICY') : null;
      if (approval)
        must(
          approval.fields.policy_digest === digest &&
            approval.fields.environment_ref === environment,
        );
      await controlTransaction(this.pool, async (client) => {
        const row = (
          await client.query<{ policy_revision: string }>(
            'SELECT * FROM zhiban_identity.identity_recovery_gate($1,$2)',
            [environment, digest],
          )
        ).rows[0];
        must(row !== undefined && row.policy_revision === expected);
        if (approval) {
          const stored = (
            await client.query<{ approval_ref: string }>(
              'SELECT approval_ref FROM zhiban_identity.identity_recovery_policy WHERE environment_ref=$1',
              [environment],
            )
          ).rows[0];
          must(
            stored !== undefined &&
              stored.approval_ref === approval.fields.approval_ref &&
              Date.now() < approval.deadline,
          );
        }
        await client.query(
          'UPDATE zhiban_identity.identity_recovery_policy SET enabled=$1,repository_revision=$2,updated_at=$3 WHERE environment_ref=$4 AND repository_revision=$5',
          [enable, increment(expected), Date.now().toString(), environment, expected],
        );
      });
    } catch (e) {
      throw safeError(e);
    }
  }
  async block(source: string, expected: string, requestId: string, maximum = 256) {
    try {
      revision(expected);
      reference(requestId);
      must(Number.isInteger(maximum) && maximum > 0 && maximum <= 256);
      const events = Array.from({ length: maximum }, () => this.ids.nextCommandId());
      await controlTransaction(this.pool, (client) =>
        client.query('SELECT zhiban_identity.identity_recovery_source_block($1,$2,$3,$4)', [
          source,
          expected,
          requestId,
          events,
        ]),
      );
    } catch (e) {
      throw safeError(e);
    }
  }
}
