import { instant, userId, tenantId, membershipId, roleGrantId } from '@/lib/zhiban/domain/identity';
import {
  authorizeRead,
  validateAuthorizationCatalog,
} from '@/lib/zhiban/application/identity/authorize';
import type { AuthenticatedRequestHandle } from '@/lib/zhiban/application/identity/ports/authenticated-request';
import type {
  IdentitySafeQueriesPort,
  MemberPointQuery,
  MemberPoint,
  ConsentContextQuery,
} from '@/lib/zhiban/application/identity/ports/safe-queries';
import { tenantScopeContext } from '@/lib/zhiban/application/identity/ports/tenant-context';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { tenantTransaction, type TransactionPool } from '../postgres/transactions';
import { loadMembershipOnClient } from '../postgres/repositories/membership';
import { authorizationGlobals } from '../postgres/repositories/authorization-records';
import { integrity, oneRow } from '../postgres/repositories/repository-support';
import { sanitizedCredentialError } from '../credentials/credential-errors';
import type { IdentityAuthentication } from './authentication';
import type { MembershipSecurity } from './membership-security';
import type { ApprovedIdentityCatalog } from '../authorization/identity-catalog';
import { controlManifest, type MembershipOperatorApprovalStore } from './control-approval';
import type { MembershipCompositionPolicy } from '@/lib/zhiban/application/identity/ports/membership-composition';
import { now, ref, type Client } from './support';
import { refuse } from './refusals';

export class IdentitySafeQueryComposition implements IdentitySafeQueriesPort {
  constructor(
    private readonly authentication: IdentityAuthentication,
    private readonly pool: TransactionPool,
    private readonly security: MembershipSecurity,
    private readonly catalog: ApprovedIdentityCatalog,
    private readonly policy: MembershipCompositionPolicy,
    private readonly store: MembershipOperatorApprovalStore | null,
  ) {}
  passwordState(handle: AuthenticatedRequestHandle) {
    return this.authentication.passwordState(handle);
  }
  async member(handle: AuthenticatedRequestHandle, q: MemberPointQuery): Promise<MemberPoint> {
    try {
      q = Object.freeze({ ...q });
      tenantId(q.tenantId);
      membershipId(q.membershipId);
      membershipId(q.actorMembershipId);
      if (q.afterGrantId !== null) roleGrantId(q.afterGrantId);
      integrity(
        q.consentPurpose === null ||
          ['ACTIVATE', 'REACTIVATE', 'REJOIN'].includes(q.consentPurpose),
      );
      const authenticated = this.security.actor(handle);
      return await tenantTransaction(this.pool, tenantScopeContext(q.tenantId), async (client) => {
        // Scoped immutable binding FIRST; no untrusted actor can add an out-of-order User lock.
        const binding = oneRow(
          await client.query<{ user_id: string }>(
            'SELECT user_id FROM zhiban_identity.memberships WHERE tenant_id=$1 AND membership_id=$2',
            [q.tenantId, q.actorMembershipId],
          ),
          'SELECT',
          true,
        );
        if (binding === null) refuse('TARGET_HIDDEN');
        integrity(Object.keys(binding).join(',') === 'user_id');
        userId(binding.user_id);
        if (binding.user_id !== authenticated) refuse('TARGET_HIDDEN');
        const hint = oneRow(
          await client.query<{ user_id: string }>(
            'SELECT user_id FROM zhiban_identity.memberships WHERE tenant_id=$1 AND membership_id=$2',
            [q.tenantId, q.membershipId],
          ),
          'SELECT',
          true,
        );
        if (hint === null) refuse('TARGET_HIDDEN');
        integrity(Object.keys(hint).join(',') === 'user_id');
        userId(hint.user_id);
        const globals = await authorizationGlobals(
          client,
          q.tenantId,
          q.actorMembershipId,
          [q.membershipId],
          'GUARD_MEMBERSHIP',
        );
        await this.security.assertSession(client, handle);
        const actor = await loadMembershipOnClient(client, q.tenantId, q.actorMembershipId, true);
        const target = await loadMembershipOnClient(client, q.tenantId, q.membershipId, true);
        integrity(
          actor !== null &&
            target !== null &&
            actor.value.userId === authenticated &&
            target.value.userId === hint.user_id,
        );
        const catalog = await this.catalog.load();
        validateAuthorizationCatalog(catalog);
        const request = {
          actorUserId: authenticated,
          actorMembershipId: q.actorMembershipId,
          targetMembershipId: q.membershipId,
          context: tenantScopeContext(q.tenantId),
          action: 'MEMBERSHIP_READ' as const,
          requestId: null,
        };
        const at = await now(client);
        if (authorizeRead(request, { globals, actor, target }, catalog, at).decision !== 'ALLOW')
          refuse('TARGET_HIDDEN');
        const consent =
          q.consentPurpose === null ||
          globals.users.get(q.membershipId)!.status !== 'ACTIVE' ||
          target.value.status !==
            { ACTIVATE: 'PENDING', REACTIVATE: 'DISABLED', REJOIN: 'LEFT' }[q.consentPurpose]
            ? null
            : await this.consent(
                client,
                q,
                target.revision,
                target.value.authorizationVersion,
                target.value.userId,
                globals.users.get(q.membershipId)!.revision,
                at,
              );
        await this.security.assertSession(client, handle);
        const final = await now(client);
        integrity(final >= at);
        if (authorizeRead(request, { globals, actor, target }, catalog, final).decision !== 'ALLOW')
          refuse('TARGET_HIDDEN');
        integrity((await this.catalog.load()).contentDigest === catalog.contentDigest);
        if (consent !== null && consent.expiresAt <= final) refuse('REQUEST_STALE');
        const effective = target.value.roleGrants
          .filter(
            (g) => g.isEffectiveAt(final) && (q.afterGrantId === null || g.id > q.afterGrantId),
          )
          .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
        const page = effective.slice(0, 16);
        return Object.freeze({
          tenantId: q.tenantId,
          membershipId: target.value.id,
          userId: target.value.userId,
          status: target.value.status,
          revision: target.revision,
          authorizationVersion: target.value.authorizationVersion,
          actorRevision: actor.revision,
          actorAuthorizationVersion: actor.value.authorizationVersion,
          tenantRevision: globals.tenantRevision,
          grants: Object.freeze(
            page.map((g) =>
              Object.freeze({
                grantId: g.id,
                roleCode: g.roleCode,
                scope: g.scope,
                validUntil: g.validUntil,
              }),
            ),
          ),
          nextGrantCursor: effective.length > 16 ? page[15].id : null,
          consent,
        });
      });
    } catch (error) {
      throw sanitizedCredentialError(error);
    }
  }
  private async consent(
    client: Client,
    q: MemberPointQuery,
    revision: string,
    version: number,
    subject: string,
    userRevision: string,
    at: number,
  ): Promise<MemberPoint['consent']> {
    const result = await client.query<{
      consent_id: string;
      admission_id: string;
      purpose: 'ACTIVATE' | 'REACTIVATE' | 'REJOIN';
      expected_member_revision: string;
      expected_auth_version: string;
      expires_at: string;
    }>(
      `SELECT c.consent_id,c.admission_id,c.purpose,c.expected_member_revision,c.expected_auth_version,c.expires_at
       FROM zhiban_identity.identity_member_consents c JOIN zhiban_identity.identity_member_admissions a
       ON a.tenant_id=c.tenant_id AND a.admission_id=c.admission_id AND a.user_id=c.user_id AND a.membership_id=c.membership_id
       WHERE c.tenant_id=$1 AND c.membership_id=$2 AND c.user_id=$3 AND c.purpose=$4
       AND c.expected_member_revision=$5 AND c.expected_auth_version=$6 AND c.subject_user_revision=$7
       AND a.subject_user_revision=c.subject_user_revision AND c.issued_at <= $8 AND c.expires_at > $8
       AND a.issued_at <= $8 AND a.expires_at > $8
       AND ((c.purpose='ACTIVATE' AND a.purpose='INVITE' AND a.repository_revision=2)
         OR (c.purpose IN ('REACTIVATE','REJOIN') AND a.purpose=c.purpose AND a.repository_revision=1
           AND a.expected_member_revision=c.expected_member_revision AND a.expected_auth_version=c.expected_auth_version))
       AND NOT EXISTS (SELECT 1 FROM zhiban_identity.identity_member_approvals p WHERE p.tenant_id=c.tenant_id AND p.consent_id=c.consent_id)
       ORDER BY c.consent_id LIMIT 2`,
      [
        q.tenantId,
        q.membershipId,
        subject,
        q.consentPurpose,
        revision,
        version,
        userRevision,
        at.toString(),
      ],
    );
    integrity(
      result.command === 'SELECT' &&
        result.rowCount === result.rows.length &&
        result.rows.length <= 2,
    );
    if (result.rows.length > 1) refuse('REQUEST_STALE');
    const row = result.rows[0];
    if (!row) return null;
    integrity(
      Object.keys(row).sort().join(',') ===
        'admission_id,consent_id,expected_auth_version,expected_member_revision,expires_at,purpose',
    );
    integrity(
      row.purpose === q.consentPurpose &&
        row.expected_member_revision === revision &&
        row.expected_auth_version === version.toString(),
    );
    const expiry = repositoryRevision(row.expires_at);
    integrity(BigInt(expiry) <= BigInt('8640000000000000') && BigInt(expiry) > BigInt(at));
    return Object.freeze({
      consentId: userId(row.consent_id),
      admissionId: userId(row.admission_id),
      purpose: row.purpose,
      expectedMemberRevision: repositoryRevision(row.expected_member_revision),
      expectedAuthorizationVersion: version,
      expiresAt: instant(Number(BigInt(expiry))),
    });
  }
  async consentContext(handle: AuthenticatedRequestHandle, q: ConsentContextQuery) {
    try {
      q = Object.freeze({ ...q });
      tenantId(q.tenantId);
      integrity((q.admissionId === null) !== (q.onboardingRef === null));
      const actor = this.security.actor(handle);
      let approval: string | null = null;
      if (q.admissionId !== null) userId(q.admissionId);
      if (q.onboardingRef !== null) {
        ref(q.onboardingRef);
        integrity(this.store !== null);
        const loaded = await this.store.load(q.onboardingRef);
        integrity(loaded !== null);
        const manifest = controlManifest(
          loaded,
          this.policy.environmentRef,
          (await this.catalog.load()).contentDigest,
          this.policy.sourceTtlMs,
        );
        integrity(
          manifest.approval_ref === q.onboardingRef &&
            manifest.purpose === 'FIRST_TENANT_ADMIN' &&
            manifest.target_user_id === actor &&
            manifest.tenant_id === q.tenantId,
        );
        approval = manifest.approval_id;
      }
      return await tenantTransaction(this.pool, tenantScopeContext(q.tenantId), async (client) => {
        if (q.admissionId !== null) {
          const source = oneRow(
            await client.query<{ user_id: string }>(
              'SELECT user_id FROM zhiban_identity.identity_member_admissions WHERE tenant_id=$1 AND admission_id=$2',
              [q.tenantId, q.admissionId],
            ),
            'SELECT',
            true,
          );
          if (source === null) refuse('TARGET_HIDDEN');
          integrity(Object.keys(source).join(',') === 'user_id');
          userId(source.user_id);
          if (source.user_id !== actor) refuse('TARGET_HIDDEN');
        }
        const state = await this.security.consentContext(
          client,
          handle,
          q.tenantId,
          q.admissionId,
          approval,
        );
        await this.security.assertSession(client, handle);
        const at = await now(client);
        integrity(BigInt(state.expires_at) > BigInt(at));
        return Object.freeze({
          membershipId: state.membership_id === null ? null : membershipId(state.membership_id),
          expectedMemberRevision:
            state.member_revision === null ? null : repositoryRevision(state.member_revision),
          expectedAuthorizationVersion:
            state.auth_version === null ? null : Number(BigInt(state.auth_version)),
          purpose: state.purpose as 'ACTIVATE' | 'REACTIVATE' | 'REJOIN' | 'FIRST_TENANT_ADMIN',
          expiresAt: instant(Number(BigInt(state.expires_at))),
        });
      });
    } catch (error) {
      throw sanitizedCredentialError(error);
    }
  }
}
