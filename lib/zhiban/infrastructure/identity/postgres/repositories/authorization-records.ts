import type { PoolClient, QueryResultRow } from 'pg';
import {
  membershipId,
  userId,
  tenantId,
  type MembershipId,
  type TenantId,
} from '@/lib/zhiban/domain/identity/ids';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import type { GlobalAuthorizationFacts } from '@/lib/zhiban/application/identity/ports/authorization';
import { integrity } from './repository-support';

/** Minimal security projection; neither a partial Domain User nor a generic mapper. */
export async function authorizationGlobals(
  client: Pick<PoolClient, 'query'>,
  tenant: TenantId,
  actor: MembershipId,
  targets: readonly MembershipId[],
  mode: 'READ_CONTEXT' | 'GUARD_MEMBERSHIP',
): Promise<GlobalAuthorizationFacts> {
  const result = await client.query<QueryResultRow>(
    'SELECT fact_kind, tenant_id, tenant_status, tenant_revision, membership_id, user_id, user_status, user_revision FROM zhiban_identity.authorization_state($1::uuid,$2::uuid,$3::uuid[],$4::text)',
    [tenant, actor, [...targets], mode],
  );
  integrity(
    result.command === 'SELECT' &&
      result.rowCount === result.rows.length &&
      result.rows.length >= 2 &&
      result.rows.length <= 257,
  );
  let header:
    | {
        tenantStatus: GlobalAuthorizationFacts['tenantStatus'];
        tenantRevision: GlobalAuthorizationFacts['tenantRevision'];
      }
    | undefined;
  const users = new Map<
    MembershipId,
    GlobalAuthorizationFacts['users'] extends ReadonlyMap<MembershipId, infer V> ? V : never
  >();
  for (const row of result.rows) {
    integrity(
      Object.keys(row).sort().join(',') ===
        'fact_kind,membership_id,tenant_id,tenant_revision,tenant_status,user_id,user_revision,user_status',
    );
    integrity(tenantId(row.tenant_id) === tenant && row.tenant_id === tenant);
    if (row.fact_kind === 'TENANT') {
      integrity(
        !header &&
          row.membership_id === null &&
          row.user_id === null &&
          row.user_status === null &&
          row.user_revision === null,
      );
      integrity(row.tenant_status === 'ACTIVE');
      header = {
        tenantStatus: row.tenant_status,
        tenantRevision: repositoryRevision(row.tenant_revision),
      };
    } else {
      integrity(
        row.fact_kind === 'USER' && row.tenant_status === null && row.tenant_revision === null,
      );
      const id = membershipId(row.membership_id),
        user = userId(row.user_id);
      integrity(
        id === row.membership_id &&
          user === row.user_id &&
          !users.has(id) &&
          (row.user_status === 'ACTIVE' || row.user_status === 'DISABLED'),
      );
      users.set(
        id,
        Object.freeze({
          userId: user,
          status: row.user_status,
          revision: repositoryRevision(row.user_revision),
        }),
      );
    }
  }
  integrity(Boolean(header) && users.has(actor) && targets.every((id) => users.has(id)));
  if (mode === 'READ_CONTEXT') integrity(users.size === new Set([actor, ...targets]).size);
  return Object.freeze({ tenantId: tenant, ...header!, users });
}
