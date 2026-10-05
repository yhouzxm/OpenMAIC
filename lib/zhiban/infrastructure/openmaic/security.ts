import type { AuthenticatedRequestHandle } from '@/lib/zhiban/application/identity/use-cases/authentication';
import type { TenantContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { requireTenantContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { membershipId, userId, type MembershipId } from '@/lib/zhiban/domain/identity';
import { securityEpoch } from '@/lib/zhiban/application/identity/ports/credential-repository';
import type { BridgePgClient } from './transactions';
import {
  BridgeError,
  check,
  exact,
  digest,
  revision,
  storedInstant,
  uuid,
  counter,
} from './validation';

interface Binding {
  readonly digest: string;
  readonly user: string;
  readonly session: string;
}
const columns = [
  'membership_id',
  'user_id',
  'user_status',
  'user_revision',
  'membership_status',
  'membership_revision',
  'authorization_version',
  'tenant_revision',
  'security_epoch',
  'absolute_expires_at',
  'idle_expires_at',
  'evaluated_at',
  'effective_grants',
] as const;
export interface BridgeIdentityFacts {
  readonly actor: MembershipId;
  readonly tenantRevision: string;
  readonly authorizationVersion: number;
  readonly evaluatedAt: number;
  readonly expiresAt: number;
  readonly members: readonly Readonly<{
    membershipId: MembershipId;
    userId: string;
    userStatus: string;
    membershipStatus: string;
    userRevision: string;
    membershipRevision: string;
    grants: readonly Record<string, unknown>[];
  }>[];
}
/** Only the authentic Identity registry resolver supplies a binding. No exported registry. */
export class BridgeSessionSecurity {
  constructor(private readonly resolve: (handle: AuthenticatedRequestHandle) => Binding) {}
  guard(
    handle: AuthenticatedRequestHandle,
    context: TenantContext,
    actor: MembershipId,
    related: readonly MembershipId[],
    expectedVersion: number,
  ) {
    const participants = Object.freeze(related.map(membershipId));
    counter(String(expectedVersion));
    return async (client: BridgePgClient) => {
      const facts = await this.assertCurrent(client, handle, context, actor, participants);
      check(facts.authorizationVersion === expectedVersion);
      return facts;
    };
  }
  async assertCurrent(
    client: BridgePgClient,
    handle: AuthenticatedRequestHandle,
    context: TenantContext,
    actorMembershipId: MembershipId,
    relatedMembershipIds: readonly MembershipId[],
  ): Promise<BridgeIdentityFacts> {
    try {
      const tenant = requireTenantContext(context),
        actor = membershipId(actorMembershipId);
      check(
        relatedMembershipIds.length <= 2 &&
          new Set(relatedMembershipIds).size === relatedMembershipIds.length,
      );
      const related = relatedMembershipIds.map(membershipId),
        binding = this.resolve(handle);
      const result = await client.query(
        'SELECT * FROM zhiban_identity.bridge_identity_context($1,$2,$3,$4,$5)',
        [tenant, digest(binding.digest), userId(binding.user), actor, related],
      );
      const ids = [...new Set([actor, ...related])].sort();
      check(
        result.command === 'SELECT' &&
          result.rowCount === ids.length &&
          result.rows.length === ids.length,
      );
      const members = result.rows.map((row, index) => {
        exact(row, columns);
        check(row.membership_id === ids[index]);
        uuid(row.user_id);
        revision(row.user_revision);
        revision(row.membership_revision);
        revision(row.tenant_revision);
        check(
          ['ACTIVE', 'DISABLED'].includes(String(row.user_status)) &&
            ['ACTIVE', 'PENDING', 'DISABLED', 'LEFT'].includes(String(row.membership_status)),
        );
        counter(row.authorization_version);
        check(
          typeof row.security_epoch === 'string' &&
            BigInt(revision(row.security_epoch)) > BigInt(0),
        );
        securityEpoch(row.security_epoch);
        const at = storedInstant(row.evaluated_at),
          absolute = storedInstant(row.absolute_expires_at),
          idle = storedInstant(row.idle_expires_at);
        check(
          at < idle &&
            idle <= absolute &&
            Array.isArray(row.effective_grants) &&
            row.effective_grants.length <= 64,
        );
        const grants = row.effective_grants.map((grant: unknown) => {
          exact(grant, ['grantId', 'roleCode', 'scopeKind', 'scopeId', 'validFrom', 'validUntil']);
          uuid(grant.grantId);
          check(['STUDENT', 'TEACHER', 'TENANT_ADMIN'].includes(String(grant.roleCode)));
          check(['SELF', 'TENANT', 'CLASS', 'COURSE'].includes(String(grant.scopeKind)));
          if (grant.scopeKind === 'CLASS' || grant.scopeKind === 'COURSE') uuid(grant.scopeId);
          else check(grant.scopeId === null);
          check(
            typeof grant.validFrom === 'number' &&
              grant.validFrom >= 0 &&
              grant.validFrom <= at &&
              Number.isSafeInteger(grant.validFrom),
          );
          check(
            grant.validUntil === null ||
              (typeof grant.validUntil === 'number' &&
                Number.isSafeInteger(grant.validUntil) &&
                grant.validUntil > at &&
                grant.validUntil <= 8640000000000000),
          );
          return Object.freeze({ ...grant });
        });
        if (row.membership_id === actor)
          check(
            row.user_id === binding.user &&
              row.user_status === 'ACTIVE' &&
              row.membership_status === 'ACTIVE',
          );
        else check(grants.length === 0);
        const first = result.rows[0];
        for (const key of [
          'tenant_revision',
          'security_epoch',
          'absolute_expires_at',
          'idle_expires_at',
          'evaluated_at',
        ])
          check(row[key] === first[key]);
        return Object.freeze({
          membershipId: membershipId(row.membership_id),
          userId: userId(row.user_id),
          userStatus: String(row.user_status),
          membershipStatus: String(row.membership_status),
          userRevision: revision(row.user_revision),
          membershipRevision: revision(row.membership_revision),
          grants: Object.freeze(grants),
        });
      });
      const actorRow = result.rows.find((row) => row.membership_id === actor)!;
      return Object.freeze({
        actor,
        tenantRevision: revision(actorRow.tenant_revision),
        authorizationVersion: counter(actorRow.authorization_version),
        evaluatedAt: storedInstant(actorRow.evaluated_at),
        expiresAt: storedInstant(actorRow.idle_expires_at),
        members: Object.freeze(members),
      });
    } catch {
      throw new BridgeError();
    }
  }
}
