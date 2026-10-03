import {
  createIdentityAuditEvent,
  type IdentityAuditEventInput,
} from '@/lib/zhiban/application/identity/ports/audit';
import { repositoryRevision } from '@/lib/zhiban/application/identity/ports/repository-types';
import { integrity, oneRow } from '../postgres/repositories/repository-support';
import { changed, type Client } from './support';

/** Closed transaction-private projection. IDs are persisted links, never public responses. */
export async function appendMemberAudit(client: Client, input: IdentityAuditEventInput) {
  const event = createIdentityAuditEvent(input);
  integrity(
    'membershipId' in event && 'tenantId' in event && 'authorizationVersionBefore' in event,
  );
  let payload: object;
  switch (event.type) {
    case 'MEMBERSHIP_PENDING_CREATED':
    case 'MEMBERSHIP_DISABLED':
    case 'MEMBERSHIP_LEFT':
      payload = {};
      break;
    case 'MEMBERSHIP_CONSENT_RECORDED':
      payload = { purpose: event.purpose };
      break;
    case 'ROLE_GRANT_GRANTED':
    case 'ROLE_GRANT_REVOKED':
      payload = { grant: event.grant };
      break;
    case 'MEMBERSHIP_REACTIVATED':
      payload = {
        mode: event.mode,
        priorGrantIds: event.priorGrantIds,
        approvedGrants: event.approvedGrants,
      };
      break;
    case 'MEMBERSHIP_ACTIVATED':
    case 'MEMBERSHIP_REJOINED':
    case 'ROLE_GRANTS_REPLACED':
      payload = { priorGrantIds: event.priorGrantIds, approvedGrants: event.approvedGrants };
      break;
    default:
      throw new TypeError('Unsupported membership audit.');
  }
  const seq = oneRow(
    await client.query<{ id: string }>(
      "SELECT nextval('zhiban_identity.audit_events_event_id_seq'::regclass)::text AS id",
    ),
    'SELECT',
  );
  integrity(seq !== null);
  const id = repositoryRevision(seq.id);
  changed(
    await client.query(
      `INSERT INTO zhiban_identity.audit_events
    (event_id,event_shape_version,event_type,event_scope,occurred_at,actor_type,actor_user_id,actor_service_code,
     request_id,reason,tenant_id,subject_user_id,subject_membership_id,authorization_version_before,authorization_version_after,event_payload)
    OVERRIDING SYSTEM VALUE VALUES ($1,1,$2,'TENANT',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)`,
      [
        id,
        event.type,
        event.occurredAt.toString(),
        event.actor.kind,
        event.actor.kind === 'USER' ? event.actor.userId : null,
        event.actor.kind === 'SERVICE' ? event.actor.serviceCode : null,
        event.requestId,
        event.reason,
        event.tenantId,
        event.userId,
        event.membershipId,
        event.authorizationVersionBefore?.toString() ?? null,
        event.authorizationVersionAfter?.toString() ?? null,
        JSON.stringify(payload),
      ],
    ),
    'INSERT',
  );
  return id;
}
